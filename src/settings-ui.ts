/**
 * Production Toolbelt Settings editor.
 *
 * Non-overlay custom view for Global/Project configuration. Drafts are
 * tagged per-scope mutations (unchanged / write / remove). Save never
 * mutates session tools. Interaction patterns from the validated settings
 * prototype and @aliou/pi-utils-settings 0.17.0 chrome.
 */

import type {
  ExtensionCommandContext,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  buildEffectiveConfig,
  deleteConfigFile,
  writeConfigRaw,
} from "./config.js";
import type {
  ConfigSource,
  EffectiveConfig,
  ResolvedBaseline,
  SearchConfig,
} from "./types.js";
import { FuzzyMultiSelector } from "./ui/fuzzy-multi-selector.js";
import {
  flattenSettingsRows,
  renderSectionedSettings,
  type SettingsSection,
  type ValueSourceLabel,
} from "./ui/sectioned-settings.js";
import { getSettingsTheme, type SettingsTheme } from "./ui/settings-theme.js";
import {
  type SingleSelectOption,
  SingleSelector,
} from "./ui/single-selector.js";
import { ToolbeltFrame } from "./ui/toolbelt-frame.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ScopeId = "global" | "project";

export type ScopeMutation =
  | { kind: "unchanged" }
  | { kind: "write"; raw: Record<string, unknown> }
  | { kind: "remove" };

export interface ScopeEditorState {
  source: ConfigSource;
  mutation: ScopeMutation;
}

export type SettingsView =
  | { kind: "main" }
  | { kind: "baseline-mode"; selector: SingleSelector }
  | { kind: "baseline"; editor: FuzzyMultiSelector }
  | { kind: "backend"; selector: SingleSelector }
  | {
      kind: "model";
      selector: SingleSelector;
      origin: "backend" | "model-row";
    };

export interface SettingsEditorState {
  scope: ScopeId;
  selected: number;
  status: string;
  global: ScopeEditorState;
  project: ScopeEditorState;
  view: SettingsView;
  projectTrusted: boolean;
  cwd: string;
}

export type SettingsUiResult =
  | { kind: "close" }
  | { kind: "discard-request"; editor: SettingsEditorState };

// ---------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------

function deepCloneRaw(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirty(scope: ScopeEditorState): boolean {
  return scope.mutation.kind !== "unchanged";
}

function isWritable(
  scope: ScopeEditorState,
  scopeId: ScopeId,
  projectTrusted: boolean,
): boolean {
  if (scopeId === "project" && !projectTrusted) return false;
  return scope.source.state === "missing" || scope.source.state === "valid";
}

/** Current draft raw for a writable scope, or undefined when removed/absent. */
function draftRaw(
  scope: ScopeEditorState,
): Record<string, unknown> | undefined {
  if (scope.mutation.kind === "write") return scope.mutation.raw;
  if (scope.mutation.kind === "remove") return undefined;
  if (scope.source.state === "valid") return scope.source.raw;
  return undefined;
}

function stageWrite(
  scope: ScopeEditorState,
  raw: Record<string, unknown>,
): ScopeEditorState {
  return { ...scope, mutation: { kind: "write", raw: deepCloneRaw(raw) } };
}

function stageRemove(scope: ScopeEditorState): ScopeEditorState {
  return { ...scope, mutation: { kind: "remove" } };
}

function clearMutation(source: ConfigSource): ScopeEditorState {
  return { source, mutation: { kind: "unchanged" } };
}

/**
 * Present baseline on a draft: undefined = omitted/inherit;
 * null = explicit unrestricted; string[] = custom list (may be empty).
 */
function knownBaseline(
  raw: Record<string, unknown> | undefined,
): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Object.hasOwn(raw, "baseline")) return undefined;
  const value = raw["baseline"];
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (!value.every((entry) => typeof entry === "string")) return undefined;
  return value as string[];
}

function knownSearch(
  raw: Record<string, unknown> | undefined,
): SearchConfig | undefined {
  if (raw === undefined) return undefined;
  const value = raw["search"];
  if (!isPlainObject(value)) return undefined;
  if (value["type"] === "bm25") return { type: "bm25" };
  if (value["type"] === "llm") {
    const model = value["model"];
    if (typeof model === "string") return { type: "llm", model };
    return { type: "llm" };
  }
  return undefined;
}

/**
 * Write baseline onto raw draft.
 * undefined → omit key (Default/Inherit);
 * null → explicit unrestricted;
 * string[] → custom list (including empty).
 */
function setBaselineOnRaw(
  raw: Record<string, unknown>,
  baseline: string[] | null | undefined,
): Record<string, unknown> {
  const next = deepCloneRaw(raw);
  if (baseline === undefined) delete next["baseline"];
  else if (baseline === null) next["baseline"] = null;
  else next["baseline"] = [...baseline];
  return next;
}

/**
 * Update known search fields while preserving unknown nested siblings.
 * `search === undefined` removes the whole search key (Default/Inherit).
 */
function setSearchOnRaw(
  raw: Record<string, unknown>,
  search: SearchConfig | undefined,
): Record<string, unknown> {
  const next = deepCloneRaw(raw);
  if (search === undefined) {
    delete next["search"];
    return next;
  }

  const previous = isPlainObject(next["search"])
    ? { ...(next["search"] as Record<string, unknown>) }
    : {};
  // Drop known keys then re-apply, keeping unknown siblings.
  delete previous["type"];
  delete previous["model"];
  previous["type"] = search.type;
  if (search.type === "llm" && search.model !== undefined) {
    previous["model"] = search.model;
  }
  next["search"] = previous;
  return next;
}

function formatBaselineList(tools: readonly string[]): string {
  if (tools.length === 0) return "(none)";
  if (tools.length <= 4) return tools.join(", ");
  return `${tools.slice(0, 3).join(", ")} +${tools.length - 3}`;
}

function formatResolvedBaseline(baseline: ResolvedBaseline): string {
  if (baseline.kind === "unrestricted") return "unrestricted";
  return formatBaselineList(baseline.tools);
}

function formatSearch(s: SearchConfig): string {
  if (s.type === "bm25") return "bm25";
  return s.model !== undefined ? `llm (${s.model})` : "llm (active model)";
}

function sourceLabel(
  source: "default" | "global" | "project",
): ValueSourceLabel {
  if (source === "global") return "Global";
  if (source === "project") return "Project";
  return "Default";
}

// ---------------------------------------------------------------------------
// Resolve effective values from drafts (for display)
// ---------------------------------------------------------------------------

function resolveBaselineFromKnown(
  value: string[] | null,
  source: "global" | "project",
): ResolvedBaseline {
  if (value === null) return { kind: "unrestricted", source };
  return { kind: "list", tools: [...value], source };
}

function resolveFromDrafts(
  global: ScopeEditorState,
  project: ScopeEditorState,
  projectTrusted: boolean,
): {
  baseline: ResolvedBaseline;
  search: SearchConfig;
  searchSource: "default" | "global" | "project";
} {
  const gRaw = draftRaw(global);
  const pRaw =
    projectTrusted && isWritable(project, "project", projectTrusted)
      ? draftRaw(project)
      : undefined;

  const pBase = knownBaseline(pRaw);
  const gBase = knownBaseline(gRaw);
  let baseline: ResolvedBaseline;
  if (pBase !== undefined) {
    baseline = resolveBaselineFromKnown(pBase, "project");
  } else if (gBase !== undefined) {
    baseline = resolveBaselineFromKnown(gBase, "global");
  } else {
    baseline = { kind: "unrestricted", source: "default" };
  }

  const pSearch = knownSearch(pRaw);
  const gSearch = knownSearch(gRaw);
  let search: SearchConfig;
  let searchSource: "default" | "global" | "project" = "default";
  if (pSearch !== undefined) {
    search = pSearch;
    searchSource = "project";
  } else if (gSearch !== undefined) {
    search = gSearch;
    searchSource = "global";
  } else {
    search = { type: "bm25" };
  }

  return { baseline, search, searchSource };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createSettingsEditorState(
  effective: EffectiveConfig,
  projectTrusted: boolean,
  cwd: string,
): SettingsEditorState {
  return {
    scope: "global",
    selected: 0,
    status: "Edit drafts in memory. Ctrl+S saves. Esc closes.",
    global: { source: effective.global, mutation: { kind: "unchanged" } },
    project: { source: effective.project, mutation: { kind: "unchanged" } },
    view: { kind: "main" },
    projectTrusted,
    cwd,
  };
}

function anyDirty(state: SettingsEditorState): boolean {
  return isDirty(state.global) || isDirty(state.project);
}

function activeScope(state: SettingsEditorState): ScopeEditorState {
  return state.scope === "global" ? state.global : state.project;
}

function withActiveScope(
  state: SettingsEditorState,
  scope: ScopeEditorState,
): SettingsEditorState {
  return state.scope === "global"
    ? { ...state, global: scope }
    : { ...state, project: scope };
}

// ---------------------------------------------------------------------------
// Model options
// ---------------------------------------------------------------------------

interface ModelOption {
  id: string;
  label: string;
  model: string | undefined;
}

function buildModelOptions(
  ctx: ExtensionCommandContext,
  configuredModel: string | undefined,
): ModelOption[] {
  const options: ModelOption[] = [
    { id: "active", label: "Active model", model: undefined },
  ];
  const seen = new Set<string>();
  let models: Array<{ provider: string; id: string }> = [];
  try {
    models = ctx.modelRegistry.getAvailable().map((m) => ({
      provider: String(m.provider),
      id: String(m.id),
    }));
  } catch {
    models = [];
  }
  for (const m of models) {
    const key = `${m.provider}/${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ id: key, label: key, model: key });
  }
  if (
    configuredModel !== undefined &&
    configuredModel.length > 0 &&
    !seen.has(configuredModel)
  ) {
    options.push({
      id: configuredModel,
      label: `${configuredModel} (unavailable)`,
      model: configuredModel,
    });
  }
  return options;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

class SettingsUiComponent implements Component {
  private state: SettingsEditorState;
  private readonly theme: SettingsTheme;
  private readonly tools: ToolInfo[];
  private readonly modelSnapshot: ModelOption[];

  constructor(
    private readonly tui: Pick<TUI, "requestRender">,
    theme: import("@earendil-works/pi-coding-agent").Theme,
    initial: SettingsEditorState,
    tools: ToolInfo[],
    modelSnapshot: ModelOption[],
    private readonly onConfigSaved: (() => void) | undefined,
    private readonly done: (result: SettingsUiResult) => void,
  ) {
    this.theme = getSettingsTheme(theme);
    this.state = initial;
    this.tools = tools;
    this.modelSnapshot = modelSnapshot;
  }

  invalidate(): void {
    const view = this.state.view;
    if (view.kind === "baseline") view.editor.invalidate();
    if (view.kind === "baseline-mode") view.selector.invalidate();
    if (view.kind === "backend") view.selector.invalidate();
    if (view.kind === "model") view.selector.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c"))) {
      if (anyDirty(this.state)) {
        this.done({
          kind: "discard-request",
          editor: this.snapshotState(),
        });
      } else {
        this.done({ kind: "close" });
      }
      return;
    }

    const view = this.state.view;
    if (view.kind === "baseline") {
      this.handleBaselineInput(data);
      return;
    }
    if (view.kind === "baseline-mode") {
      this.handleSingleSelectInput(data, "baseline-mode");
      return;
    }
    if (view.kind === "backend") {
      this.handleSingleSelectInput(data, "backend");
      return;
    }
    if (view.kind === "model") {
      this.handleSingleSelectInput(data, "model");
      return;
    }

    this.handleMainInput(data);
  }

  render(width: number): string[] {
    const frame = new ToolbeltFrame({
      title: "Toolbelt Settings",
      theme: this.theme,
      tabs: {
        kind: "scopes",
        active: this.state.scope,
        globalDirty: isDirty(this.state.global),
        projectDirty: isDirty(this.state.project),
      },
      body: {
        invalidate: () => this.invalidate(),
        render: (w) => this.renderBody(w),
      },
      status: this.state.status,
      footer: this.footerText(),
    });
    return frame.render(width);
  }

  private snapshotState(): SettingsEditorState {
    // Nested components are live objects; fine to retain by reference.
    return {
      ...this.state,
      global: {
        ...this.state.global,
        mutation: cloneMutation(this.state.global.mutation),
      },
      project: {
        ...this.state.project,
        mutation: cloneMutation(this.state.project.mutation),
      },
    };
  }

  private footerText(): string {
    const view = this.state.view;
    if (view.kind === "baseline") {
      return "Baseline · Space toggle · Enter confirm · Esc cancel";
    }
    if (
      view.kind === "baseline-mode" ||
      view.kind === "backend" ||
      view.kind === "model"
    ) {
      return "Picker · Up/Down · Enter confirm · Esc back";
    }
    return "Up/Down · Enter edit · Tab scope · Ctrl+S save · Esc close";
  }

  /**
   * Resolve a valid row cursor at use-time. Mutations may leave `selected`
   * past the end of a rebuilt list (create/remove/save); paint and input
   * both go through here instead of fixing selection at every write site.
   */
  private clampSelected(rowCount: number): number {
    if (
      rowCount === 0 ||
      this.state.selected < 0 ||
      this.state.selected >= rowCount
    ) {
      this.state.selected = 0;
    }
    return this.state.selected;
  }

  private renderBody(width: number): string[] {
    const view = this.state.view;
    if (view.kind === "baseline") return view.editor.render(width);
    if (view.kind === "baseline-mode") return view.selector.render(width);
    if (view.kind === "backend") return view.selector.render(width);
    if (view.kind === "model") return view.selector.render(width);
    const sections = this.buildSections();
    const selected = this.clampSelected(flattenSettingsRows(sections).length);
    return renderSectionedSettings(this.theme, sections, selected, width);
  }

  // ---- main navigation ------------------------------------------------

  private handleMainInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (anyDirty(this.state)) {
        this.done({
          kind: "discard-request",
          editor: this.snapshotState(),
        });
      } else {
        this.done({ kind: "close" });
      }
      return;
    }

    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
      this.state.scope = this.state.scope === "global" ? "project" : "global";
      this.state.selected = 0;
      this.state.status = `Editing ${this.state.scope === "global" ? "Global" : "Project"} scope`;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("s"))) {
      this.save();
      return;
    }

    const rows = flattenSettingsRows(this.buildSections());
    if (rows.length === 0) {
      this.clampSelected(0);
      this.tui.requestRender();
      return;
    }
    const selected = this.clampSelected(rows.length);

    if (matchesKey(data, Key.up)) {
      this.state.selected = selected === 0 ? rows.length - 1 : selected - 1;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.state.selected = selected === rows.length - 1 ? 0 : selected + 1;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const row = rows[selected];
      if (row) this.activate(row.id);
      this.tui.requestRender();
    }
  }

  private handleBaselineInput(data: string): void {
    const view = this.state.view;
    if (view.kind !== "baseline") return;

    if (matchesKey(data, Key.escape)) {
      this.state.view = { kind: "main" };
      this.state.status = "Baseline edit cancelled.";
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const checked = view.editor.confirmSelection();
      this.applyBaselineCustom(checked);
      this.state.view = { kind: "main" };
      this.tui.requestRender();
      return;
    }
    view.editor.handleInput(data);
    this.tui.requestRender();
  }

  private handleSingleSelectInput(
    data: string,
    kind: "baseline-mode" | "backend" | "model",
  ): void {
    const view = this.state.view;
    if (view.kind !== kind) return;

    if (matchesKey(data, Key.escape)) {
      if (
        kind === "model" &&
        view.kind === "model" &&
        view.origin === "backend"
      ) {
        this.openBackendPicker();
        this.state.status =
          "Model picker cancelled - returned to backend picker.";
      } else {
        this.state.view = { kind: "main" };
        this.state.status = "Cancelled - draft unchanged.";
      }
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.up)) {
      view.selector.move(-1);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      view.selector.move(1);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const selected = view.selector.selected;
      if (!selected) return;
      if (kind === "baseline-mode") this.applyBaselineMode(selected.id);
      else if (kind === "backend") this.applyBackendChoice(selected.id);
      else if (kind === "model" && view.kind === "model") {
        this.applyModelChoice(selected.id);
      }
      this.tui.requestRender();
      return;
    }

    // Searchable selectors (model picker) consume filter typing.
    view.selector.handleInput(data);
    this.tui.requestRender();
  }

  // ---- activate rows --------------------------------------------------

  private activate(id: string): void {
    const scope = activeScope(this.state);

    if (id === "create") {
      if (this.state.scope === "project" && !this.state.projectTrusted) return;
      if (
        !isWritable(scope, this.state.scope, this.state.projectTrusted) ||
        draftRaw(scope) !== undefined
      )
        return;
      if (
        scope.source.state !== "missing" &&
        scope.mutation.kind !== "remove"
      ) {
        return;
      }
      this.state = withActiveScope(this.state, stageWrite(scope, {}));
      this.state.status = `Staged empty ${this.state.scope} configuration ({}). Ctrl+S to write.`;
      return;
    }

    if (id === "remove") {
      if (!isWritable(scope, this.state.scope, this.state.projectTrusted))
        return;
      // Allow remove when file exists (valid) or write draft exists over missing.
      if (
        scope.source.state === "missing" &&
        scope.mutation.kind === "unchanged"
      ) {
        return;
      }
      if (scope.mutation.kind === "remove") {
        this.state.status = "Removal already staged.";
        return;
      }
      // If only a create draft on missing, discard back to missing.
      if (scope.source.state === "missing" && scope.mutation.kind === "write") {
        this.state = withActiveScope(this.state, {
          ...scope,
          mutation: { kind: "unchanged" },
        });
        this.state.status = "Discarded staged create.";
        return;
      }
      this.state = withActiveScope(this.state, stageRemove(scope));
      this.state.status = `Staged removal of ${this.state.scope} configuration. Ctrl+S to delete file.`;
      return;
    }

    if (
      !isWritable(scope, this.state.scope, this.state.projectTrusted) ||
      scope.mutation.kind === "remove"
    ) {
      this.state.status = this.readOnlyStatus(scope);
      return;
    }

    // Ensure a write draft exists before editing known fields on valid/missing.
    if (draftRaw(scope) === undefined) {
      this.state.status = "Create the configuration first.";
      return;
    }

    if (id === "baseline") {
      this.openBaselineModePicker();
      return;
    }
    if (id === "search.type") {
      this.openBackendPicker();
      return;
    }
    if (id === "search.model") {
      this.openModelPicker("model-row");
    }
  }

  private readOnlyStatus(scope: ScopeEditorState): string {
    if (scope.source.state === "invalid") {
      return `Read-only: ${scope.source.error}`;
    }
    if (scope.source.state === "ignored") {
      return "Project configuration ignored until this project is trusted.";
    }
    if (scope.mutation.kind === "remove") {
      return "Scope staged for removal. Save or discard.";
    }
    return "This scope is read-only.";
  }

  // ---- pickers --------------------------------------------------------

  private openBaselineModePicker(): void {
    const scope = this.state.scope;
    const options: SingleSelectOption[] =
      scope === "global"
        ? [
            { id: "default", label: "Default - unrestricted (omit)" },
            { id: "unrestricted", label: "Unrestricted - write null" },
            { id: "custom", label: "Custom - choose tools" },
          ]
        : [
            { id: "inherit", label: "Inherit - use Global or Default" },
            { id: "unrestricted", label: "Unrestricted - write null" },
            { id: "custom", label: "Custom - choose tools" },
          ];
    const own = knownBaseline(draftRaw(activeScope(this.state)));
    let selected = 0;
    if (own === undefined) selected = 0;
    else if (own === null) selected = 1;
    else selected = 2;
    this.state.view = {
      kind: "baseline-mode",
      selector: new SingleSelector(
        "Baseline",
        `Editing ${scope}`,
        options,
        this.theme,
        selected,
      ),
    };
    this.state.status = "Choose baseline mode.";
  }

  private openBaselineEditor(): void {
    const scope = activeScope(this.state);
    const raw = draftRaw(scope);
    const own = knownBaseline(raw);
    const resolved = resolveFromDrafts(
      this.state.global,
      this.state.project,
      this.state.projectTrusted,
    );
    // Seed custom editor from own list, else resolved list, else empty.
    const seed: string[] =
      own !== undefined && own !== null
        ? own
        : resolved.baseline.kind === "list"
          ? resolved.baseline.tools
          : [];
    const selected = new Set(seed);
    const registered = new Map(
      this.tools.map((t) => [t.name, t.description ?? ""] as const),
    );
    const names = new Set<string>([...registered.keys(), ...selected]);

    const items = [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const item: import("./ui/fuzzy-multi-selector.js").MultiSelectItem = {
          id: name,
          label: name,
          checked: selected.has(name),
          description: registered.get(name) ?? "",
        };
        if (!registered.has(name)) item.badge = "unavailable";
        return item;
      });

    this.state.view = {
      kind: "baseline",
      editor: new FuzzyMultiSelector(
        `Baseline tools (${this.state.scope})`,
        items,
        this.theme,
        10,
      ),
    };
    this.state.status = "Editing baseline tools.";
  }

  private openBackendPicker(): void {
    const scope = this.state.scope;
    const options: SingleSelectOption[] =
      scope === "global"
        ? [
            { id: "default", label: "Default - BM25" },
            { id: "bm25", label: "BM25 - explicit global override" },
            { id: "llm", label: "LLM - explicit global override" },
          ]
        : [
            {
              id: "inherit",
              label: `Inherit from Global - currently ${formatSearch(
                // Project inherit shows Global draft (or default BM25).
                knownSearch(draftRaw(this.state.global)) ?? { type: "bm25" },
              )}`,
            },
            { id: "bm25", label: "BM25 - explicit project override" },
            { id: "llm", label: "LLM - explicit project override" },
          ];

    const own = knownSearch(draftRaw(activeScope(this.state)));
    let selected = 0;
    if (own === undefined) selected = 0;
    else if (own.type === "bm25") selected = 1;
    else selected = 2;

    this.state.view = {
      kind: "backend",
      selector: new SingleSelector(
        "Search backend",
        `Editing ${scope} - selection applies only on confirm`,
        options,
        this.theme,
        selected,
      ),
    };
    this.state.status = "Choose search backend (LLM opens model picker).";
  }

  private openModelPicker(origin: "backend" | "model-row"): void {
    const own = knownSearch(draftRaw(activeScope(this.state)));
    const resolved = resolveFromDrafts(
      this.state.global,
      this.state.project,
      this.state.projectTrusted,
    );
    const configuredModel =
      own?.type === "llm"
        ? own.model
        : resolved.search.type === "llm"
          ? resolved.search.model
          : undefined;

    // Rebuild options so unavailable configured model is included.
    const options = buildModelOptionsFromSnapshot(
      this.modelSnapshot,
      configuredModel,
    );
    let selected = 0;
    if (configuredModel !== undefined) {
      const idx = options.findIndex((o) => o.model === configuredModel);
      selected = idx >= 0 ? idx : 0;
    }

    this.state.view = {
      kind: "model",
      origin,
      selector: new SingleSelector(
        "LLM model",
        "Active model stores an omitted model field on the draft",
        options.map((o) => ({ id: o.id, label: o.label })),
        this.theme,
        selected,
        { searchable: true, maxVisible: 10 },
      ),
    };
    this.state.status =
      origin === "backend"
        ? "Choose LLM model (Esc returns to backend picker)."
        : "Choose LLM model.";
  }

  // ---- apply edits ----------------------------------------------------

  private applyBaselineMode(id: string): void {
    if (id === "custom") {
      this.openBaselineEditor();
      return;
    }
    const scope = activeScope(this.state);
    const raw = draftRaw(scope);
    if (raw === undefined) return;

    if (id === "unrestricted") {
      const next = setBaselineOnRaw(raw, null);
      this.state = withActiveScope(this.state, stageWrite(scope, next));
      this.state.view = { kind: "main" };
      this.state.status =
        this.state.scope === "global"
          ? "Global baseline set to Unrestricted (null)."
          : "Project baseline set to Unrestricted (null).";
      return;
    }

    // default / inherit: remove baseline key
    const next = setBaselineOnRaw(raw, undefined);
    this.state = withActiveScope(this.state, stageWrite(scope, next));
    this.state.view = { kind: "main" };
    this.state.status =
      this.state.scope === "global"
        ? "Global baseline set to Default."
        : "Project baseline set to Inherit.";
  }

  private applyBaselineCustom(tools: string[]): void {
    const scope = activeScope(this.state);
    const raw = draftRaw(scope);
    if (raw === undefined) return;
    const next = setBaselineOnRaw(raw, tools);
    this.state = withActiveScope(this.state, stageWrite(scope, next));
    this.state.status = `Baseline set on ${this.state.scope} (${tools.length} tools).`;
  }

  private applyBackendChoice(id: string): void {
    if (id === "llm") {
      this.openModelPicker("backend");
      return;
    }
    const scope = activeScope(this.state);
    const raw = draftRaw(scope);
    if (raw === undefined) return;

    if (id === "default" || id === "inherit") {
      const next = setSearchOnRaw(raw, undefined);
      this.state = withActiveScope(this.state, stageWrite(scope, next));
      this.state.view = { kind: "main" };
      this.state.status =
        id === "inherit"
          ? "Project search reset to inherited."
          : "Global search set to default (BM25).";
      return;
    }

    if (id === "bm25") {
      const next = setSearchOnRaw(raw, { type: "bm25" });
      this.state = withActiveScope(this.state, stageWrite(scope, next));
      this.state.view = { kind: "main" };
      this.state.status = `${this.state.scope} search override: bm25`;
    }
  }

  private applyModelChoice(optionId: string): void {
    const scope = activeScope(this.state);
    const raw = draftRaw(scope);
    if (raw === undefined) return;

    const currentSearch = knownSearch(raw);
    const configuredModel =
      currentSearch?.type === "llm" ? currentSearch.model : undefined;
    const options = buildModelOptionsFromSnapshot(
      this.modelSnapshot,
      configuredModel,
    );
    const opt = options.find((o) => o.id === optionId);
    const search: SearchConfig =
      opt === undefined || opt.model === undefined
        ? { type: "llm" }
        : { type: "llm", model: opt.model };

    const next = setSearchOnRaw(raw, search);
    this.state = withActiveScope(this.state, stageWrite(scope, next));
    this.state.view = { kind: "main" };
    this.state.status = `${this.state.scope} search set to ${formatSearch(search)}.`;
  }

  // ---- save -----------------------------------------------------------

  private save(): void {
    const messages: string[] = [];
    let anySuccess = false;

    // Global then Project.
    for (const scopeId of ["global", "project"] as const) {
      const scope =
        scopeId === "global" ? this.state.global : this.state.project;
      if (!isDirty(scope)) continue;

      if (scopeId === "project" && !this.state.projectTrusted) {
        messages.push("Project: ignored (untrusted) - not saved");
        continue;
      }
      if (
        !isWritable(scope, scopeId, this.state.projectTrusted) &&
        scope.mutation.kind !== "remove"
      ) {
        // invalid/ignored cannot save
        if (scope.source.state === "invalid") {
          messages.push(`${scopeId}: invalid - not saved`);
        }
        continue;
      }

      const path = scope.source.path;
      try {
        if (scope.mutation.kind === "remove") {
          deleteConfigFile(path);
          const reloaded = buildEffectiveConfig(
            this.state.cwd,
            this.state.projectTrusted,
          );
          const source =
            scopeId === "global" ? reloaded.global : reloaded.project;
          if (scopeId === "global") {
            this.state.global = clearMutation(source);
          } else {
            this.state.project = clearMutation(source);
          }
          messages.push(`${scopeId}: removed ${path}`);
          anySuccess = true;
        } else if (scope.mutation.kind === "write") {
          writeConfigRaw(path, scope.mutation.raw);
          const reloaded = buildEffectiveConfig(
            this.state.cwd,
            this.state.projectTrusted,
          );
          const source =
            scopeId === "global" ? reloaded.global : reloaded.project;
          if (scopeId === "global") {
            this.state.global = clearMutation(source);
          } else {
            this.state.project = clearMutation(source);
          }
          messages.push(`${scopeId}: saved ${path}`);
          anySuccess = true;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        messages.push(`${scopeId}: FAILED ${path} - ${msg}`);
      }
    }

    if (anySuccess) {
      // Refresh sources for clean scopes so labels stay current after the
      // other scope saved. Dirty scopes keep their in-memory drafts.
      const reloaded = buildEffectiveConfig(
        this.state.cwd,
        this.state.projectTrusted,
      );
      if (!isDirty(this.state.global)) {
        this.state.global = {
          source: reloaded.global,
          mutation: { kind: "unchanged" },
        };
      }
      if (!isDirty(this.state.project)) {
        this.state.project = {
          source: reloaded.project,
          mutation: { kind: "unchanged" },
        };
      }
      this.onConfigSaved?.();
    }

    this.state.status =
      messages.length > 0
        ? messages.join(" · ")
        : "Nothing dirty - no file was written.";
    this.tui.requestRender();
  }

  // ---- sections / rows ------------------------------------------------

  private buildSections(): SettingsSection[] {
    const scope = activeScope(this.state);
    const scopeId = this.state.scope;

    // Untrusted project: always read-only, whether missing or ignored-on-disk.
    if (scopeId === "project" && !this.state.projectTrusted) {
      return [
        {
          title: "PROJECT",
          rows: [
            {
              id: "ignored",
              label: "Status",
              value: "ignored until trusted",
              note: scope.source.path,
              source: "Action",
            },
          ],
        },
      ];
    }

    // Invalid
    if (scope.source.state === "invalid") {
      return [
        {
          title: "ERROR",
          rows: [
            {
              id: "invalid",
              label: "Invalid",
              value: scope.source.error,
              note: scope.source.path,
              source: "Action",
            },
          ],
        },
      ];
    }

    // Staged removal
    if (scope.mutation.kind === "remove") {
      return [
        {
          title: "SCOPE",
          rows: [
            {
              id: "remove",
              label: "Remove",
              value: "staged - Ctrl+S deletes file",
              note: scope.source.path,
              source: "Action",
            },
          ],
        },
      ];
    }

    // Missing with no create draft
    if (draftRaw(scope) === undefined) {
      const label =
        scopeId === "global"
          ? "Create global configuration"
          : "Create project configuration";
      return [
        {
          title: "SCOPE",
          rows: [
            {
              id: "create",
              label: "Create",
              value: label,
              note: scope.source.path,
              source: "Action",
            },
          ],
        },
      ];
    }

    const resolved = resolveFromDrafts(
      this.state.global,
      this.state.project,
      this.state.projectTrusted,
    );
    const raw = draftRaw(scope);
    const ownBase = knownBaseline(raw);
    const ownSearch = knownSearch(raw);

    // Baseline display — unrestricted shown distinctly from list membership.
    let baselineValue: string;
    let baselineSource: ValueSourceLabel;
    let baselineNote: string | undefined;
    if (ownBase !== undefined) {
      baselineValue =
        ownBase === null ? "unrestricted" : formatBaselineList(ownBase);
      baselineSource = scopeId === "global" ? "Global" : "Project";
    } else {
      baselineValue = formatResolvedBaseline(resolved.baseline);
      if (scopeId === "global") {
        baselineSource = "Default";
        baselineNote = "(inherited from Default)";
      } else if (resolved.baseline.source === "global") {
        baselineSource = "Global";
        baselineNote = "(inherited from Global)";
      } else {
        baselineSource = "Default";
        baselineNote = "(inherited from Default)";
      }
    }

    // Search display
    let searchValue: string;
    let searchSource: ValueSourceLabel;
    let searchNote: string | undefined;
    if (ownSearch !== undefined) {
      searchValue = formatSearch(ownSearch);
      searchSource = scopeId === "global" ? "Global" : "Project";
    } else {
      searchValue = formatSearch(resolved.search);
      if (scopeId === "global") {
        searchSource = "Default";
        searchNote = "(inherited from Default)";
      } else if (resolved.searchSource === "global") {
        searchSource = "Global";
        searchNote = "(inherited from Global)";
      } else {
        searchSource = "Default";
        searchNote = "(inherited from Default)";
      }
    }

    const baselineRow: import("./ui/sectioned-settings.js").SettingsRow = {
      id: "baseline",
      label: "Baseline",
      value: baselineValue,
      source: baselineSource,
    };
    if (baselineNote !== undefined) baselineRow.note = baselineNote;

    const searchRow: import("./ui/sectioned-settings.js").SettingsRow = {
      id: "search.type",
      label: "Backend",
      value: searchValue,
      source: searchSource,
    };
    if (searchNote !== undefined) searchRow.note = searchNote;

    const sections: SettingsSection[] = [
      {
        title: "TOOLS",
        rows: [baselineRow],
      },
      {
        title: "SEARCH",
        rows: [searchRow],
      },
    ];

    const showModel =
      ownSearch?.type === "llm" ||
      (ownSearch === undefined && resolved.search.type === "llm");
    if (showModel) {
      const model =
        (ownSearch?.type === "llm" ? ownSearch.model : undefined) ??
        (resolved.search.type === "llm" ? resolved.search.model : undefined);
      const modelText = model ?? "active model";
      const modelSource: ValueSourceLabel =
        ownSearch?.type === "llm"
          ? scopeId === "global"
            ? "Global"
            : "Project"
          : sourceLabel(resolved.searchSource);
      sections[1]?.rows.push({
        id: "search.model",
        label: "LLM model",
        value: modelText,
        source: modelSource,
      });
    }

    sections.push({
      title: "SCOPE",
      rows: [
        {
          id: "remove",
          label: "Remove",
          value: "Remove scope configuration",
          source: "Action",
        },
      ],
    });

    return sections;
  }
}

function cloneMutation(mutation: ScopeMutation): ScopeMutation {
  if (mutation.kind === "write") {
    return { kind: "write", raw: deepCloneRaw(mutation.raw) };
  }
  return mutation;
}

function buildModelOptionsFromSnapshot(
  snapshot: ModelOption[],
  configuredModel: string | undefined,
): ModelOption[] {
  const options = snapshot.map((o) => ({ ...o }));
  if (
    configuredModel !== undefined &&
    configuredModel.length > 0 &&
    !options.some((o) => o.model === configuredModel)
  ) {
    options.push({
      id: configuredModel,
      label: `${configuredModel} (unavailable)`,
      model: configuredModel,
    });
  }
  return options;
}

// ---------------------------------------------------------------------------
// Public open
// ---------------------------------------------------------------------------

export async function openSettingsUi(
  ctx: ExtensionCommandContext,
  options: {
    initialState?: SettingsEditorState;
    onConfigSaved?: () => void;
    tools?: ToolInfo[];
  } = {},
): Promise<SettingsUiResult> {
  const projectTrusted = ctx.isProjectTrusted?.() ?? false;
  const effective = buildEffectiveConfig(ctx.cwd, projectTrusted);
  const initial =
    options.initialState ??
    createSettingsEditorState(effective, projectTrusted, ctx.cwd);

  // Keep trust/cwd fresh even when reopening retained state.
  initial.projectTrusted = projectTrusted;
  initial.cwd = ctx.cwd;

  const tools = options.tools ?? [];
  const configuredModel = (() => {
    const raw = draftRaw(
      initial.scope === "global" ? initial.global : initial.project,
    );
    const search = knownSearch(raw);
    return search?.type === "llm" ? search.model : undefined;
  })();
  const modelSnapshot = buildModelOptions(ctx, configuredModel);

  return ctx.ui.custom<SettingsUiResult>(
    (tui, theme, _kb, done) =>
      new SettingsUiComponent(
        tui,
        theme,
        initial,
        tools,
        modelSnapshot,
        options.onConfigSaved,
        done,
      ),
    // Non-overlay: replaces composer at bottom, grows upward.
  );
}
