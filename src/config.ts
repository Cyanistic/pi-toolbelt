/**
 * Toolbelt config loading, validation, inheritance, and editor sessions.
 *
 * Fail-soft: missing file, invalid JSON, wrong shape, and untrusted Project
 * all return tagged ConfigSource values (never throw). Project trust is
 * applied before any Project parse or merge. Empty objects and unknown-only
 * objects are valid configured scopes; known fields validate through TypeBox.
 *
 * Runtime file resolution and settings draft previews share one private
 * inheritance implementation. Editor raw JSON, mutations, and save details
 * stay inside this module; callers consume semantic snapshots and intents.
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Compile } from "typebox/compile";
import {
  isBaselineModify,
  overlappingModifyNames,
  resolveBaselineLayers,
  uniquePreserveOrder,
} from "./baseline.js";
import { CONFIG_FILE_NAME } from "./constants.js";
import { ToolbeltConfigFileSchema } from "./schemas.js";
import type {
  BaselineConfig,
  ConfigSource,
  EffectiveConfig,
  ResolvedBaseline,
  RuntimeMode,
  SearchConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Global config path: ~/.pi/agent/toolbelt.json */
export function getGlobalConfigPath(): string {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}

/** Project config path: .pi/toolbelt.json */
export function getProjectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

// ---------------------------------------------------------------------------
// Type guard / clone
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepCloneObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Private disk boundary: raw-bearing sources and once-validated documents
// ---------------------------------------------------------------------------

/**
 * Disk read result with private raw round-trip data.
 * Public ConfigSource never exposes `raw`.
 */
type LoadedConfigSource =
  | { state: "missing"; path: string }
  | {
      state: "valid";
      path: string;
      /** Once-decoded semantic local state plus private round-trip template. */
      document: ConfigDocument;
    }
  | { state: "invalid"; path: string; error: string };

type ProjectConfigSource =
  | LoadedConfigSource
  | { state: "ignored"; path: string };

/** Validated known fields decoded once at the untrusted boundary. */
interface ScopeKnownFields {
  baseline?: BaselineConfig;
  search?: SearchConfig;
}

/**
 * Trusted in-memory document: semantic local config plus a private raw
 * template that preserves unknown top-level and nested-search siblings.
 */
interface ConfigDocument {
  local: LocalConfig;
  template: Record<string, unknown>;
}

const toolbeltConfigFileValidator = Compile(ToolbeltConfigFileSchema);

/**
 * Map TypeBox validation errors onto stable user-facing wording.
 */
function describeBaselineConfigError(value: unknown, path: string): string {
  if (Array.isArray(value)) {
    if (value.some((entry) => typeof entry !== "string")) {
      return `${path}: 'baseline' entries must be strings`;
    }
    return `${path}: 'baseline' must be null, an array of tool names, or a { "type": "modify" } object`;
  }
  if (typeof value !== "object" || value === null) {
    return `${path}: 'baseline' must be null, an array of tool names, or a { "type": "modify" } object`;
  }

  const obj = value as Record<string, unknown>;
  if (obj["type"] !== "modify") {
    return `${path}: 'baseline' modify object must set "type" to "modify"`;
  }

  const unknown = Object.keys(obj).filter(
    (key) => key !== "type" && key !== "add" && key !== "remove",
  );
  if (unknown[0] !== undefined) {
    return `${path}: 'baseline' modify object has unknown field '${unknown[0]}'`;
  }

  const add = obj["add"];
  const remove = obj["remove"];
  if (add !== undefined && !Array.isArray(add)) {
    return `${path}: 'baseline' modify "add" must be an array of tool names`;
  }
  if (remove !== undefined && !Array.isArray(remove)) {
    return `${path}: 'baseline' modify "remove" must be an array of tool names`;
  }

  const addList = Array.isArray(add) ? add : [];
  const removeList = Array.isArray(remove) ? remove : [];
  if (
    addList.some((name) => typeof name !== "string" || name.length === 0) ||
    removeList.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    return `${path}: 'baseline' modify names must be non-empty strings`;
  }
  if (addList.length === 0 && removeList.length === 0) {
    return `${path}: 'baseline' modify must include a non-empty "add" or "remove" list`;
  }

  return `${path}: 'baseline' must be null, an array of tool names, or a { "type": "modify" } object`;
}

function mapToolbeltConfigError(
  errors: readonly { instancePath: string; message?: string }[],
  path: string,
  raw: Record<string, unknown>,
): string {
  const error = errors[0];
  if (error === undefined) {
    return `${path}: invalid toolbelt configuration`;
  }

  const { instancePath } = error;
  if (instancePath === "/baseline" || instancePath.startsWith("/baseline/")) {
    return describeBaselineConfigError(raw["baseline"], path);
  }
  if (instancePath === "/search" || instancePath.startsWith("/search/")) {
    return `${path}: 'search' must be { "type": "bm25" } or { "type": "llm" } with optional model`;
  }
  if (Object.hasOwn(raw, "baseline")) {
    const baselineMessage = describeBaselineConfigError(raw["baseline"], path);
    if (
      baselineMessage !==
      `${path}: 'baseline' must be null, an array of tool names, or a { "type": "modify" } object`
    ) {
      return baselineMessage;
    }
  }

  return `${path}: invalid toolbelt configuration`;
}

/**
 * Validate present known fields exactly once. Missing known fields are fine.
 * Unknown top-level keys are retained only on the private raw template.
 */
function validateConfig(
  raw: Record<string, unknown>,
  path: string,
): LoadedConfigSource {
  if (!toolbeltConfigFileValidator.Check(raw)) {
    return {
      state: "invalid",
      path,
      error: mapToolbeltConfigError(
        toolbeltConfigFileValidator.Errors(raw),
        path,
        raw,
      ),
    };
  }

  // After Check succeeds, present known fields match ToolbeltConfigFileSchema.
  // Decode them once into LocalConfig; retain raw only for round-trip.
  const fields: ScopeKnownFields = {};
  if (raw.baseline !== undefined) {
    const baseline = raw.baseline as BaselineConfig;
    if (isBaselineModify(baseline)) {
      const add = uniquePreserveOrder(baseline.add ?? []);
      const remove = uniquePreserveOrder(baseline.remove ?? []);
      const overlap = overlappingModifyNames(add, remove);
      if (overlap[0] !== undefined) {
        return {
          state: "invalid",
          path,
          error: `${path}: 'baseline' modify cannot list '${overlap[0]}' in both add and remove`,
        };
      }
      const normalized: BaselineConfig = { type: "modify" };
      if (add.length > 0) normalized.add = add;
      if (remove.length > 0) normalized.remove = remove;
      fields.baseline = normalized;
    } else {
      fields.baseline = baseline;
    }
  }
  if (raw.search !== undefined) {
    fields.search = raw.search as SearchConfig;
  }

  return {
    state: "valid",
    path,
    document: {
      local: decodeLocal(fields),
      template: deepCloneObject(raw),
    },
  };
}

/**
 * Read, parse, and validate a single toolbelt config file.
 * Returns a private source with raw retained for round-trip editing.
 */
function readToolbeltConfig(path: string): LoadedConfigSource {
  if (!existsSync(path)) {
    return { state: "missing", path };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    return {
      state: "invalid",
      path,
      error: `Invalid JSON in ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      state: "invalid",
      path,
      error: `${path} does not contain a JSON object`,
    };
  }

  return validateConfig(parsed, path);
}

/**
 * Resolve the Project scope under the current trust boundary.
 * Untrusted projects never parse or validate the file.
 */
function readProjectConfigSource(
  path: string,
  projectTrusted: boolean,
): ProjectConfigSource {
  if (!projectTrusted) {
    return existsSync(path)
      ? { state: "ignored", path }
      : { state: "missing", path };
  }
  return readToolbeltConfig(path);
}

/** Strip private raw before crossing the public ConfigSource boundary. */
function toPublicSource(source: ProjectConfigSource): ConfigSource {
  switch (source.state) {
    case "missing":
      return { state: "missing", path: source.path };
    case "invalid":
      return { state: "invalid", path: source.path, error: source.error };
    case "ignored":
      return { state: "ignored", path: source.path };
    case "valid":
      return {
        state: "valid",
        path: source.path,
        config: knownFieldsFromLocal(source.document.local),
      };
  }
}

// ---------------------------------------------------------------------------
// Semantic editor types (public)
// ---------------------------------------------------------------------------

export type ConfigScopeId = "global" | "project";

/** Scope-local baseline: inherit/omit, unrestricted (null), exact list, or modify. */
export type BaselineSelection =
  | { readonly kind: "inherit" }
  | { readonly kind: "unrestricted" }
  | { readonly kind: "list"; readonly tools: readonly string[] }
  | {
      readonly kind: "modify";
      readonly add: readonly string[];
      readonly remove: readonly string[];
    };

/** LLM model selection within a search override. */
export type SearchModelSelection =
  | { readonly kind: "active" }
  | { readonly kind: "named"; readonly id: string };

/** Scope-local search: inherit/omit, bm25, or llm with model choice. */
export type SearchSelection =
  | { readonly kind: "inherit" }
  | { readonly kind: "bm25" }
  | { readonly kind: "llm"; readonly model: SearchModelSelection };

/** Semantic local configuration for one scope draft. */
export interface LocalConfig {
  readonly baseline: BaselineSelection;
  readonly search: SearchSelection;
}

/**
 * Semantic facts for one configuration scope.
 * Impossible combinations are unrepresentable.
 */
export type ConfigScopeSnapshot =
  | {
      readonly kind: "ignored";
      readonly id: "project";
      readonly path: string;
      readonly dirty: boolean;
    }
  | {
      readonly kind: "missing";
      readonly id: ConfigScopeId;
      readonly path: string;
    }
  | {
      readonly kind: "invalid";
      readonly id: ConfigScopeId;
      readonly path: string;
      readonly error: string;
    }
  | {
      readonly kind: "ready";
      readonly id: ConfigScopeId;
      readonly path: string;
      readonly dirty: boolean;
      readonly local: LocalConfig;
    }
  | {
      readonly kind: "removing";
      readonly id: ConfigScopeId;
      readonly path: string;
    };

/** Full semantic snapshot for the settings editor. */
export interface ConfigEditorSnapshot {
  readonly global: ConfigScopeSnapshot;
  readonly project: ConfigScopeSnapshot;
  readonly effectiveBaseline: ResolvedBaseline;
  readonly effectiveSearch: SearchConfig;
  readonly effectiveSearchSource: "default" | "global" | "project";
}

/**
 * Typed user edit. Baseline and search use semantic selections only —
 * never undefined, null, or raw JSON as the editor representation.
 */
export type ConfigEdit =
  | { readonly type: "create"; readonly scope: ConfigScopeId }
  | { readonly type: "remove"; readonly scope: ConfigScopeId }
  | {
      readonly type: "set-baseline";
      readonly scope: ConfigScopeId;
      readonly baseline: BaselineSelection;
    }
  | {
      readonly type: "set-search";
      readonly scope: ConfigScopeId;
      readonly search: SearchSelection;
    };

export type ConfigEditResult =
  | { readonly kind: "applied" }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "untrusted"
        | "read-only"
        | "not-applicable"
        | "no-draft"
        | "already-removing";
    };

/** Explicit per-scope outcome from an independent save attempt. */
export type ScopeSaveOutcome =
  | { readonly status: "saved"; readonly path: string }
  | { readonly status: "removed"; readonly path: string }
  | { readonly status: "failed"; readonly path: string; readonly error: string }
  | { readonly status: "skipped"; readonly reason: "untrusted" | "not-dirty" };

/**
 * One outcome per scope. Success is derived by the UI from outcomes —
 * no redundant anySuccess flag.
 */
export interface ConfigSaveResult {
  readonly global: ScopeSaveOutcome;
  readonly project: ScopeSaveOutcome;
}

/** Configuration-owned editor session: snapshot + apply + save. */
export interface ConfigEditorSession {
  snapshot(): ConfigEditorSnapshot;
  apply(edit: ConfigEdit): ConfigEditResult;
  save(): ConfigSaveResult;
  isDirty(): boolean;
}

// ---------------------------------------------------------------------------
// Encode / decode between semantic LocalConfig and persisted known fields
// ---------------------------------------------------------------------------

function decodeBaseline(value: BaselineConfig | undefined): BaselineSelection {
  if (value === undefined) return { kind: "inherit" };
  if (value === null) return { kind: "unrestricted" };
  if (Array.isArray(value)) return { kind: "list", tools: [...value] };
  return {
    kind: "modify",
    add: uniquePreserveOrder(value.add ?? []),
    remove: uniquePreserveOrder(value.remove ?? []),
  };
}

function decodeSearch(value: SearchConfig | undefined): SearchSelection {
  if (value === undefined) return { kind: "inherit" };
  if (value.type === "bm25") return { kind: "bm25" };
  if (value.model !== undefined) {
    return { kind: "llm", model: { kind: "named", id: value.model } };
  }
  return { kind: "llm", model: { kind: "active" } };
}

function normalizeBaselineSelection(
  baseline: BaselineSelection,
): BaselineSelection {
  if (baseline.kind === "list") {
    return { kind: "list", tools: uniquePreserveOrder(baseline.tools) };
  }
  if (baseline.kind !== "modify") return baseline;
  const add = uniquePreserveOrder(baseline.add);
  const overlap = new Set(overlappingModifyNames(add, baseline.remove));
  const remove = uniquePreserveOrder(baseline.remove).filter(
    (name) => !overlap.has(name),
  );
  if (add.length === 0 && remove.length === 0) return { kind: "inherit" };
  return { kind: "modify", add, remove };
}

function decodeLocal(fields: ScopeKnownFields): LocalConfig {
  return {
    baseline: decodeBaseline(fields.baseline),
    search: decodeSearch(fields.search),
  };
}

function encodeBaseline(
  selection: BaselineSelection,
): BaselineConfig | undefined {
  switch (selection.kind) {
    case "inherit":
      return undefined;
    case "unrestricted":
      return null;
    case "list":
      return [...selection.tools];
    case "modify": {
      const add = uniquePreserveOrder(selection.add);
      const remove = uniquePreserveOrder(selection.remove);
      if (add.length === 0 && remove.length === 0) return undefined;
      const encoded: Extract<BaselineConfig, { type: "modify" }> = {
        type: "modify",
      };
      if (add.length > 0) encoded.add = add;
      if (remove.length > 0) encoded.remove = remove;
      return encoded;
    }
  }
}

function encodeSearch(selection: SearchSelection): SearchConfig | undefined {
  switch (selection.kind) {
    case "inherit":
      return undefined;
    case "bm25":
      return { type: "bm25" };
    case "llm":
      if (selection.model.kind === "named") {
        return { type: "llm", model: selection.model.id };
      }
      return { type: "llm" };
  }
}

function knownFieldsFromLocal(local: LocalConfig): ScopeKnownFields {
  const fields: ScopeKnownFields = {};
  const baseline = encodeBaseline(local.baseline);
  if (baseline !== undefined) fields.baseline = baseline;
  const search = encodeSearch(local.search);
  if (search !== undefined) fields.search = search;
  return fields;
}

/**
 * Encode semantic baseline onto a private raw template.
 * inherit → omit key; unrestricted → null; list → string[];
 * modify → tagged object. Unknown top-level siblings are preserved.
 */
function encodeBaselineOnRaw(
  raw: Record<string, unknown>,
  baseline: BaselineSelection,
): Record<string, unknown> {
  const next = deepCloneObject(raw);
  const encoded = encodeBaseline(baseline);
  if (encoded === undefined) delete next["baseline"];
  else next["baseline"] = encoded;
  return next;
}

/**
 * Encode semantic search onto a private raw template.
 * inherit removes the whole search key; set values re-apply known keys
 * while preserving unknown nested siblings.
 */
function encodeSearchOnRaw(
  raw: Record<string, unknown>,
  search: SearchSelection,
): Record<string, unknown> {
  const next = deepCloneObject(raw);
  const encoded = encodeSearch(search);
  if (encoded === undefined) {
    delete next["search"];
    return next;
  }

  const previous = isPlainObject(next["search"])
    ? { ...(next["search"] as Record<string, unknown>) }
    : {};
  delete previous["type"];
  delete previous["model"];
  previous["type"] = encoded.type;
  if (encoded.type === "llm" && encoded.model !== undefined) {
    previous["model"] = encoded.model;
  }
  next["search"] = previous;
  return next;
}

/** Encode all semantic fields onto the private round-trip template at save. */
function encodeDocument(document: ConfigDocument): Record<string, unknown> {
  const withBaseline = encodeBaselineOnRaw(
    document.template,
    document.local.baseline,
  );
  return encodeSearchOnRaw(withBaseline, document.local.search);
}

function emptyDocument(): ConfigDocument {
  return {
    local: { baseline: { kind: "inherit" }, search: { kind: "inherit" } },
    template: {},
  };
}

// ---------------------------------------------------------------------------
// Shared inheritance (persisted sources and editor semantic drafts)
// ---------------------------------------------------------------------------

function baselineLayer(
  label: string,
  value: BaselineConfig | undefined,
): import("./baseline.js").BaselineLayer {
  return value === undefined ? { label } : { label, value };
}

/**
 * Single inheritance implementation for runtime files and editor drafts.
 *
 * Baseline folds Default → Global → trusted Project. Search objects replace
 * as units. Undefined scope arguments mean the scope does not contribute
 * values (missing, invalid, ignored, removed, or untrusted).
 */
function resolveInheritance(
  globalFields: ScopeKnownFields | undefined,
  projectFields: ScopeKnownFields | undefined,
): {
  baseline: ResolvedBaseline;
  search: SearchConfig;
  searchSource: "default" | "global" | "project";
} {
  const searchFromProject = projectFields?.search;
  const searchFromGlobal = globalFields?.search;

  const baseline = resolveBaselineLayers([
    baselineLayer("Global", globalFields?.baseline),
    baselineLayer("Project", projectFields?.baseline),
  ]);

  let searchSource: "default" | "global" | "project" = "default";
  let search: SearchConfig;
  if (searchFromProject !== undefined) {
    search = searchFromProject;
    searchSource = "project";
  } else if (searchFromGlobal !== undefined) {
    search = searchFromGlobal;
    searchSource = "global";
  } else {
    search = { type: "bm25" };
  }

  return { baseline, search, searchSource };
}

/**
 * Build effective config by loading Global always and Project only when
 * trusted. Project fields override Global; arrays and search objects replace
 * as units. Missing known fields fall through to root defaults (unrestricted
 * baseline, BM25 search).
 *
 * Any malformed participating scope disables config-driven behavior even if
 * the other scope is valid. Missing files are not a disabled state —
 * configured is true whenever no participating scope is invalid. Ignored
 * Project never participates and never disables a valid Global scope.
 */
export function buildEffectiveConfig(
  cwd: string,
  projectTrusted: boolean,
): EffectiveConfig {
  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath(cwd);

  const global = readToolbeltConfig(globalPath);
  const project = readProjectConfigSource(projectPath, projectTrusted);

  const globalValid = global.state === "valid" ? global : undefined;
  const projectValid = project.state === "valid" ? project : undefined;

  const participatingInvalid =
    global.state === "invalid" || project.state === "invalid";
  // Missing files are valid default configuration (unrestricted + BM25).
  const configured = !participatingInvalid;

  const resolved = resolveInheritance(
    globalValid !== undefined
      ? knownFieldsFromLocal(globalValid.document.local)
      : undefined,
    projectValid !== undefined
      ? knownFieldsFromLocal(projectValid.document.local)
      : undefined,
  );

  let source: EffectiveConfig["source"] = "none";
  if (globalValid && projectValid) source = "both";
  else if (projectValid) source = "project";
  else if (globalValid) source = "global";

  return {
    baseline: resolved.baseline,
    search: resolved.search,
    source,
    searchSource: resolved.searchSource,
    globalPath,
    projectPath,
    global: toPublicSource(global),
    project: toPublicSource(project),
    configured,
  };
}

// ---------------------------------------------------------------------------
// Runtime mode
// ---------------------------------------------------------------------------

/**
 * Resolve configured / session-only / inactive behavior from effective config
 * plus whether the session branch already holds an explicit snapshot.
 * Does not mutate tools.
 *
 * Missing files resolve to configured defaults. Session-only is reserved for
 * malformed participating config with a valid snapshot. Inactive remains only
 * when config is unusable and no snapshot exists.
 */
export function resolveRuntimeMode(
  effective: EffectiveConfig,
  hasSnapshot: boolean,
): RuntimeMode {
  if (effective.configured) {
    return { mode: "configured", effective, hasSnapshot };
  }
  if (hasSnapshot) {
    return {
      mode: "session-only",
      effective,
      hasSnapshot: true,
      configInvalid:
        effective.global.state === "invalid" ||
        effective.project.state === "invalid",
    };
  }
  return { mode: "inactive", effective, hasSnapshot: false };
}

/** True when config-driven baseline, search, and reset are available. */
export function isEnabled(effective: EffectiveConfig): boolean {
  return effective.configured;
}

/** True when a participating scope failed validation. */
export function hasConfigError(effective: EffectiveConfig): boolean {
  return (
    effective.global.state === "invalid" ||
    effective.project.state === "invalid"
  );
}

/** Collect user-facing errors from participating invalid scopes. */
export function configErrorMessages(effective: EffectiveConfig): string[] {
  const messages: string[] = [];
  if (effective.global.state === "invalid") {
    messages.push(effective.global.error);
  }
  if (effective.project.state === "invalid") {
    messages.push(effective.project.error);
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Writer - atomic per-scope replacement (private)
// ---------------------------------------------------------------------------

/**
 * Write a complete raw JSON object via temp file + same-directory rename.
 * Creates parent directories as needed. Cleans up the temporary file on
 * handled failures when possible. Throws on filesystem errors.
 */
function writeConfigRaw(path: string, raw: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const directory = dirname(path);
  const tempPath = join(
    directory,
    `.${CONFIG_FILE_NAME}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  const body = `${JSON.stringify(raw, null, 2)}\n`;
  try {
    writeFileSync(tempPath, body, "utf-8");
    renameSync(tempPath, path);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

/**
 * Delete a scope config file. Missing files are a no-op success.
 * Throws on other filesystem errors.
 */
function deleteConfigFile(path: string): void {
  if (!existsSync(path)) return;
  unlinkSync(path);
}

// ---------------------------------------------------------------------------
// Private editor state — transition-specific tagged variants
// ---------------------------------------------------------------------------

/**
 * Origin of a dirty in-memory document draft.
 * - create: staged from missing; discard returns to missing (no disk delete).
 * - edit: staged from a valid file; discard/remove stages file removal.
 */
type DirtyDocumentOrigin = "create" | "edit";

/**
 * Global scope private state. Invalid combinations (invalid+write,
 * missing+remove, etc.) are not representable.
 *
 * creating/editing collapse into one dirty-document variant whose origin
 * encodes create-vs-edit remove semantics.
 */
type GlobalScopeState =
  | { kind: "missing"; path: string }
  | { kind: "invalid"; path: string; error: string }
  | { kind: "clean"; path: string; document: ConfigDocument }
  | {
      kind: "dirty";
      path: string;
      origin: DirtyDocumentOrigin;
      document: ConfigDocument;
    }
  | { kind: "removing"; path: string };

/**
 * Project source is loaded once when the editor opens. An untrusted Project
 * remains unloaded for the session; live trust checks only guard operations.
 */
type ProjectScopeState = { kind: "unloaded"; path: string } | GlobalScopeState;

type ScopeState = GlobalScopeState | ProjectScopeState;

function isDirtyState(state: ScopeState): boolean {
  return state.kind === "dirty" || state.kind === "removing";
}

function scopePath(state: ScopeState): string {
  return state.path;
}

function privateSourceToGlobalState(
  source: LoadedConfigSource,
): GlobalScopeState {
  switch (source.state) {
    case "missing":
      return { kind: "missing", path: source.path };
    case "invalid":
      return { kind: "invalid", path: source.path, error: source.error };
    case "valid":
      return {
        kind: "clean",
        path: source.path,
        document: cloneDocument(source.document),
      };
  }
}

function privateSourceToProjectState(
  source: ProjectConfigSource,
): ProjectScopeState {
  if (source.state === "ignored") {
    return { kind: "unloaded", path: source.path };
  }
  return privateSourceToGlobalState(source);
}

function cloneBaseline(baseline: BaselineSelection): BaselineSelection {
  if (baseline.kind === "list") {
    return { kind: "list", tools: [...baseline.tools] };
  }
  if (baseline.kind === "modify") {
    return {
      kind: "modify",
      add: [...baseline.add],
      remove: [...baseline.remove],
    };
  }
  return { ...baseline };
}

function cloneDocument(document: ConfigDocument): ConfigDocument {
  const search = document.local.search;
  return {
    local: {
      baseline: cloneBaseline(document.local.baseline),
      search:
        search.kind === "llm" && search.model.kind === "named"
          ? { kind: "llm", model: { kind: "named", id: search.model.id } }
          : { ...search },
    },
    template: deepCloneObject(document.template),
  };
}

// ---------------------------------------------------------------------------
// Editor session implementation
// ---------------------------------------------------------------------------

class ConfigEditorSessionImpl implements ConfigEditorSession {
  private global: GlobalScopeState;
  private project: ProjectScopeState;

  constructor(
    cwd: string,
    private readonly isProjectTrusted: () => boolean,
  ) {
    const trusted = isProjectTrusted();
    const globalPath = getGlobalConfigPath();
    const projectPath = getProjectConfigPath(cwd);
    this.global = privateSourceToGlobalState(readToolbeltConfig(globalPath));
    // Untrusted Project starts unloaded and is never parsed in this session.
    this.project = trusted
      ? privateSourceToProjectState(readProjectConfigSource(projectPath, true))
      : { kind: "unloaded", path: projectPath };
  }

  isDirty(): boolean {
    return isDirtyState(this.global) || isDirtyState(this.project);
  }

  snapshot(): ConfigEditorSnapshot {
    const globalSnap = this.globalSnapshot();
    const projectSnap = this.projectSnapshot();

    const globalFields = this.participatingFields(this.global);
    const projectFields =
      this.project.kind !== "unloaded"
        ? this.participatingFields(this.project)
        : undefined;

    const resolved = resolveInheritance(globalFields, projectFields);

    return {
      global: globalSnap,
      project: projectSnap,
      effectiveBaseline: resolved.baseline,
      effectiveSearch: resolved.search,
      effectiveSearchSource: resolved.searchSource,
    };
  }

  apply(edit: ConfigEdit): ConfigEditResult {
    switch (edit.type) {
      case "create":
        return this.applyCreate(edit.scope);
      case "remove":
        return this.applyRemove(edit.scope);
      case "set-baseline":
        return this.applySetBaseline(edit.scope, edit.baseline);
      case "set-search":
        return this.applySetSearch(edit.scope, edit.search);
    }
  }

  save(): ConfigSaveResult {
    return this.saveAll();
  }

  // ---- participation ----------------------------------------------------

  private participatingFields(
    state: GlobalScopeState,
  ): ScopeKnownFields | undefined {
    // Removing scopes do not contribute values.
    if (state.kind === "removing") return undefined;
    // Missing / invalid have no draft values.
    if (state.kind === "missing" || state.kind === "invalid") return undefined;
    return knownFieldsFromLocal(state.document.local);
  }

  // ---- snapshots --------------------------------------------------------

  private globalSnapshot(): ConfigScopeSnapshot {
    return this.loadedSnapshot("global", this.global);
  }

  private projectSnapshot(): ConfigScopeSnapshot {
    if (this.project.kind === "unloaded") {
      return {
        kind: "ignored",
        id: "project",
        path: scopePath(this.project),
        dirty: false,
      };
    }
    return this.loadedSnapshot("project", this.project);
  }

  private loadedSnapshot(
    id: ConfigScopeId,
    state: GlobalScopeState,
  ): ConfigScopeSnapshot {
    switch (state.kind) {
      case "missing":
        return { kind: "missing", id, path: state.path };
      case "invalid":
        return {
          kind: "invalid",
          id,
          path: state.path,
          error: state.error,
        };
      case "removing":
        return { kind: "removing", id, path: state.path };
      case "clean":
        return {
          kind: "ready",
          id,
          path: state.path,
          dirty: false,
          local: cloneDocument(state.document).local,
        };
      case "dirty":
        return {
          kind: "ready",
          id,
          path: state.path,
          dirty: true,
          local: cloneDocument(state.document).local,
        };
    }
  }

  // ---- mutations --------------------------------------------------------

  private projectTrustAllowsMutation(scope: ConfigScopeId): boolean {
    return scope === "global" || this.isProjectTrusted();
  }

  private getLoadedState(scope: ConfigScopeId): GlobalScopeState | undefined {
    if (scope === "global") return this.global;
    if (this.project.kind === "unloaded") return undefined;
    return this.project;
  }

  private setGlobalState(state: GlobalScopeState): void {
    this.global = state;
  }

  private setProjectState(state: ProjectScopeState): void {
    this.project = state;
  }

  private setScopeState(scope: ConfigScopeId, state: GlobalScopeState): void {
    if (scope === "global") this.setGlobalState(state);
    else this.setProjectState(state);
  }

  private applyCreate(scope: ConfigScopeId): ConfigEditResult {
    if (!this.projectTrustAllowsMutation(scope)) {
      return { kind: "rejected", reason: "untrusted" };
    }
    const current = this.getLoadedState(scope);
    if (current === undefined) {
      return { kind: "rejected", reason: "untrusted" };
    }
    // Create only from missing.
    if (current.kind !== "missing") {
      if (current.kind === "invalid") {
        return { kind: "rejected", reason: "read-only" };
      }
      return { kind: "rejected", reason: "not-applicable" };
    }
    this.setScopeState(scope, {
      kind: "dirty",
      path: current.path,
      origin: "create",
      document: emptyDocument(),
    });
    return { kind: "applied" };
  }

  private applyRemove(scope: ConfigScopeId): ConfigEditResult {
    if (!this.projectTrustAllowsMutation(scope)) {
      return { kind: "rejected", reason: "untrusted" };
    }
    const current = this.getLoadedState(scope);
    if (current === undefined) {
      return { kind: "rejected", reason: "untrusted" };
    }
    switch (current.kind) {
      case "invalid":
        return { kind: "rejected", reason: "read-only" };
      case "missing":
        return { kind: "rejected", reason: "not-applicable" };
      case "removing":
        return { kind: "rejected", reason: "already-removing" };
      case "dirty":
        if (current.origin === "create") {
          // Discard staged create back to clean missing.
          this.setScopeState(scope, {
            kind: "missing",
            path: current.path,
          });
          return { kind: "applied" };
        }
        // Dirty edit of an existing file: stage removal.
        this.setScopeState(scope, {
          kind: "removing",
          path: current.path,
        });
        return { kind: "applied" };
      case "clean":
        this.setScopeState(scope, {
          kind: "removing",
          path: current.path,
        });
        return { kind: "applied" };
    }
  }

  private applySetBaseline(
    scope: ConfigScopeId,
    baseline: BaselineSelection,
  ): ConfigEditResult {
    if (!this.projectTrustAllowsMutation(scope)) {
      return { kind: "rejected", reason: "untrusted" };
    }
    const current = this.getLoadedState(scope);
    if (current === undefined) {
      return { kind: "rejected", reason: "untrusted" };
    }
    if (
      current.kind === "missing" ||
      current.kind === "invalid" ||
      current.kind === "removing"
    ) {
      if (current.kind === "missing") {
        return { kind: "rejected", reason: "no-draft" };
      }
      return { kind: "rejected", reason: "read-only" };
    }

    const document = cloneDocument(current.document);
    document.local = {
      ...document.local,
      baseline: normalizeBaselineSelection(baseline),
    };

    this.setScopeState(scope, {
      kind: "dirty",
      path: current.path,
      origin: current.kind === "dirty" ? current.origin : "edit",
      document,
    });
    return { kind: "applied" };
  }

  private applySetSearch(
    scope: ConfigScopeId,
    search: SearchSelection,
  ): ConfigEditResult {
    if (!this.projectTrustAllowsMutation(scope)) {
      return { kind: "rejected", reason: "untrusted" };
    }
    const current = this.getLoadedState(scope);
    if (current === undefined) {
      return { kind: "rejected", reason: "untrusted" };
    }
    if (
      current.kind === "missing" ||
      current.kind === "invalid" ||
      current.kind === "removing"
    ) {
      if (current.kind === "missing") {
        return { kind: "rejected", reason: "no-draft" };
      }
      return { kind: "rejected", reason: "read-only" };
    }

    const document = cloneDocument(current.document);
    document.local = { ...document.local, search };

    this.setScopeState(scope, {
      kind: "dirty",
      path: current.path,
      origin: current.kind === "dirty" ? current.origin : "edit",
      document,
    });
    return { kind: "applied" };
  }

  // ---- save -------------------------------------------------------------

  /**
   * Independent Global-then-Project saves. Each dirty scope is attempted
   * separately; success is not rolled back when a sibling fails. Failed
   * scopes retain drafts. Clean scopes reload after any success.
   */
  private saveAll(): ConfigSaveResult {
    const globalOutcome = this.saveScope("global");
    const projectOutcome = this.saveScope("project");

    const anySuccess =
      globalOutcome.status === "saved" ||
      globalOutcome.status === "removed" ||
      projectOutcome.status === "saved" ||
      projectOutcome.status === "removed";

    if (anySuccess) {
      // Refresh clean scopes so labels stay current after a sibling saved.
      // Dirty scopes keep their in-memory drafts (last-write-wins).
      this.reloadCleanScopes();
    }

    return { global: globalOutcome, project: projectOutcome };
  }

  private saveScope(scopeId: ConfigScopeId): ScopeSaveOutcome {
    const state: ScopeState = scopeId === "global" ? this.global : this.project;

    switch (state.kind) {
      case "missing":
      case "invalid":
      case "clean":
        return { status: "skipped", reason: "not-dirty" };

      case "unloaded":
        return { status: "skipped", reason: "not-dirty" };

      case "removing": {
        // Live trust gate immediately before any Project disk effect.
        if (scopeId === "project" && !this.isProjectTrusted()) {
          return { status: "skipped", reason: "untrusted" };
        }
        const path = state.path;
        try {
          deleteConfigFile(path);
          this.reloadScopeAfterDisk(scopeId, path);
          return { status: "removed", path };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { status: "failed", path, error: msg };
        }
      }

      case "dirty": {
        // Live trust gate immediately before any Project disk effect.
        if (scopeId === "project" && !this.isProjectTrusted()) {
          return { status: "skipped", reason: "untrusted" };
        }
        const path = state.path;
        try {
          writeConfigRaw(path, encodeDocument(state.document));
          this.reloadScopeAfterDisk(scopeId, path);
          return { status: "saved", path };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { status: "failed", path, error: msg };
        }
      }
    }
  }

  /**
   * After a successful disk effect, reload the scope from disk. Project was
   * trust-checked immediately before the effect, so reload stays in the
   * session's original loaded state.
   */
  private reloadScopeAfterDisk(scopeId: ConfigScopeId, path: string): void {
    if (scopeId === "global") {
      this.setGlobalState(privateSourceToGlobalState(readToolbeltConfig(path)));
      return;
    }
    this.setProjectState(
      privateSourceToProjectState(readProjectConfigSource(path, true)),
    );
  }

  private reloadCleanScopes(): void {
    if (!isDirtyState(this.global)) {
      this.global = privateSourceToGlobalState(
        readToolbeltConfig(this.global.path),
      );
    }
    if (this.project.kind !== "unloaded" && !isDirtyState(this.project)) {
      this.project = privateSourceToProjectState(
        readProjectConfigSource(this.project.path, true),
      );
    }
  }
}

/**
 * Create a configuration editor session for the given working directory.
 * `isProjectTrusted` is called live before Project mutations and disk writes.
 */
export function createConfigEditorSession(
  cwd: string,
  isProjectTrusted: () => boolean,
): ConfigEditorSession {
  return new ConfigEditorSessionImpl(cwd, isProjectTrusted);
}
