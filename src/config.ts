/**
 * Toolbelt config loading and validation.
 *
 * Fail-soft: missing file, invalid JSON, wrong shape, and untrusted Project
 * all return tagged ConfigSource values (never throw). Project trust is
 * applied before any Project parse or merge. Empty objects and unknown-only
 * objects are valid configured scopes; known fields validate through TypeBox.
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
import { CONFIG_FILE_NAME } from "./constants.js";
import { SearchConfigSchema, ToolbeltConfigFileSchema } from "./schemas.js";
import type {
  BaselineConfig,
  ConfigSource,
  EffectiveConfig,
  ResolvedBaseline,
  RuntimeMode,
  SearchConfig,
  ToolbeltConfig,
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
// Type guard
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
// Reader (fail-soft - never throws)
// ---------------------------------------------------------------------------

/**
 * Read, parse, and validate a single toolbelt config file.
 * Returns a tagged ConfigSource - never throws.
 *
 * A JSON object is valid even when known fields are absent (`{}`) or only
 * unknown fields are present. Present known fields must pass TypeBox checks.
 */
export function readToolbeltConfig(path: string): ConfigSource {
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
export function readProjectConfigSource(
  path: string,
  projectTrusted: boolean,
): ConfigSource {
  if (!projectTrusted) {
    return existsSync(path)
      ? { state: "ignored", path }
      : { state: "missing", path };
  }
  return readToolbeltConfig(path);
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

const toolbeltConfigFileValidator = Compile(ToolbeltConfigFileSchema);
const searchConfigValidator = Compile(SearchConfigSchema);

/**
 * Map TypeBox validation errors onto stable user-facing wording.
 */
function mapToolbeltConfigError(
  errors: readonly { instancePath: string; message?: string }[],
  path: string,
): string {
  const error = errors[0];
  if (error === undefined) {
    return `${path}: invalid toolbelt configuration`;
  }

  const { instancePath } = error;

  if (instancePath === "/baseline") {
    return `${path}: 'baseline' must be null or an array of tool names`;
  }
  if (instancePath.startsWith("/baseline/")) {
    return `${path}: 'baseline' entries must be strings`;
  }
  if (instancePath === "/search" || instancePath.startsWith("/search/")) {
    return `${path}: 'search' must be { "type": "bm25" } or { "type": "llm" } with optional model`;
  }

  return `${path}: invalid toolbelt configuration`;
}

/**
 * Validate present known fields. Missing known fields are fine.
 * Unknown top-level keys are retained only on `raw`.
 */
function validateConfig(
  raw: Record<string, unknown>,
  path: string,
): ConfigSource {
  if (!toolbeltConfigFileValidator.Check(raw)) {
    return {
      state: "invalid",
      path,
      error: mapToolbeltConfigError(
        toolbeltConfigFileValidator.Errors(raw),
        path,
      ),
    };
  }

  const config: Partial<ToolbeltConfig> = {};
  if (raw.baseline !== undefined) {
    // Present null or string[] — both are valid BaselineConfig values.
    config.baseline = raw.baseline as BaselineConfig;
  }
  if (raw.search !== undefined) {
    if (!searchConfigValidator.Check(raw.search)) {
      return {
        state: "invalid",
        path,
        error: `${path}: 'search' must be { "type": "bm25" } or { "type": "llm", "model"?: "provider/id" }`,
      };
    }
    config.search = raw.search as SearchConfig;
  }

  return {
    state: "valid",
    path,
    config,
    raw: deepCloneObject(raw),
  };
}

// ---------------------------------------------------------------------------
// Merge - project arrays replace, scalars override, search object replaces
// ---------------------------------------------------------------------------

/**
 * Map a present scope baseline (null | string[]) onto ResolvedBaseline.
 * Callers must only pass defined values; omit is handled by inheritance.
 */
function resolveBaselineValue(
  value: BaselineConfig,
  source: "global" | "project",
): ResolvedBaseline {
  if (value === null) {
    return { kind: "unrestricted", source };
  }
  return { kind: "list", tools: [...value], source };
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

  const baselineFromProject = projectValid?.config.baseline;
  const baselineFromGlobal = globalValid?.config.baseline;
  const searchFromProject = projectValid?.config.search;
  const searchFromGlobal = globalValid?.config.search;

  let baseline: ResolvedBaseline;
  if (baselineFromProject !== undefined) {
    baseline = resolveBaselineValue(baselineFromProject, "project");
  } else if (baselineFromGlobal !== undefined) {
    baseline = resolveBaselineValue(baselineFromGlobal, "global");
  } else {
    baseline = { kind: "unrestricted", source: "default" };
  }

  let searchSource: EffectiveConfig["searchSource"] = "default";
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

  let source: EffectiveConfig["source"] = "none";
  if (globalValid && projectValid) source = "both";
  else if (projectValid) source = "project";
  else if (globalValid) source = "global";

  return {
    baseline,
    search,
    source,
    searchSource,
    globalPath,
    projectPath,
    global,
    project,
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
// Writer - atomic per-scope replacement
// ---------------------------------------------------------------------------

/**
 * Write a complete raw JSON object via temp file + same-directory rename.
 * Creates parent directories as needed. Cleans up the temporary file on
 * handled failures when possible. Throws on filesystem errors.
 */
export function writeConfigRaw(
  path: string,
  raw: Record<string, unknown>,
): void {
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
export function deleteConfigFile(path: string): void {
  if (!existsSync(path)) return;
  unlinkSync(path);
}
