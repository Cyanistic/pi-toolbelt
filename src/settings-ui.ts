/**
 * Production Toolbelt Settings editor.
 *
 * Non-overlay custom view for Global/Project configuration. Configuration
 * meaning lives in `config.ts`; this module owns labels, pickers, navigation,
 * cursor, footer/status, and discard flow. Save never mutates session tools.
 * Interaction patterns from the validated settings prototype and
 * @aliou/pi-utils-settings 0.17.0 chrome.
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
  formatBaselineTrace,
  formatModifyLists,
  formatResolvedBaseline,
  resolvedPolicyEqual,
  uniquePreserveOrder,
} from "./baseline.js";
import {
  type BaselineSelection,
  type ConfigEdit,
  type ConfigEditorSession,
  type ConfigEditorSnapshot,
  type ConfigEditResult,
  type ConfigSaveResult,
  type ConfigScopeId,
  type ConfigScopeSnapshot,
  createConfigEditorSession,
  type LocalConfig,
  type ScopeSaveOutcome,
  type SearchSelection,
} from "./config.js";
import type { SearchConfig } from "./types.js";
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

export type ScopeId = ConfigScopeId;

export type SettingsView =
  | { kind: "main" }
  | { kind: "baseline-mode"; selector: SingleSelector }
  | { kind: "baseline"; editor: FuzzyMultiSelector }
  | {
      kind: "baseline-modify";
      add: string[];
      remove: string[];
      selected: number;
    }
  | {
      kind: "baseline-modify-picker";
      operation: "add" | "remove";
      add: string[];
      remove: string[];
      editor: FuzzyMultiSelector;
    }
  | { kind: "backend"; selector: SingleSelector }
  | {
      kind: "model";
      selector: SingleSelector;
      origin: "backend" | "model-row";
    };

/**
 * UI-owned editor state. Configuration drafts live inside `session`;
 * this object retains scope selection, cursor, status, nested picker view,
 * and the session itself across discard confirmation.
 */
export interface SettingsEditorState {
  scope: ScopeId;
  selected: number;
  status: string;
  view: SettingsView;
  session: ConfigEditorSession;
}

export type SettingsUiResult =
  | { kind: "close" }
  | { kind: "discard-request"; editor: SettingsEditorState };

// ---------------------------------------------------------------------------
// Display helpers (labels / formatting only)
// ---------------------------------------------------------------------------

function formatBaselineList(tools: readonly string[]): string {
  if (tools.length === 0) return "(none)";
  if (tools.length <= 4) return tools.join(", ");
  return `${tools.slice(0, 3).join(", ")} +${tools.length - 3}`;
}

function formatSearchConfig(s: SearchConfig): string {
  if (s.type === "bm25") return "bm25";
  return s.model !== undefined ? `llm (${s.model})` : "llm (active model)";
}

function formatSearchSelection(s: SearchSelection): string {
  switch (s.kind) {
    case "inherit":
      return "inherit";
    case "bm25":
      return "bm25";
    case "llm":
      return s.model.kind === "named"
        ? `llm (${s.model.id})`
        : "llm (active model)";
  }
}

function formatBaselineSelection(b: BaselineSelection): string {
  switch (b.kind) {
    case "inherit":
      return "inherit";
    case "unrestricted":
      return "unrestricted";
    case "list":
      return `exact ${formatBaselineList(b.tools)}`;
    case "modify":
      return formatModifyLists(b.add, b.remove);
  }
}

function sourceLabel(
  source: "default" | "global" | "project",
): ValueSourceLabel {
  if (source === "global") return "Global";
  if (source === "project") return "Project";
  return "Default";
}

function sourceLabelFromTrace(scope: string | undefined): ValueSourceLabel {
  if (scope === "Global") return "Global";
  if (scope === "Project") return "Project";
  return "Default";
}

function activeScopeSnapshot(
  snap: ConfigEditorSnapshot,
  scope: ScopeId,
): ConfigScopeSnapshot {
  return scope === "global" ? snap.global : snap.project;
}

function formatSaveStatus(result: ConfigSaveResult): string {
  const parts: string[] = [];
  const globalText = formatSaveOutcome("global", result.global);
  const projectText = formatSaveOutcome("project", result.project);
  if (globalText !== undefined) parts.push(globalText);
  if (projectText !== undefined) parts.push(projectText);
  if (parts.length === 0) return "Nothing dirty - no file was written.";
  return parts.join(" · ");
}

function formatSaveOutcome(
  scope: ScopeId,
  outcome: ScopeSaveOutcome,
): string | undefined {
  switch (outcome.status) {
    case "saved":
      return `${scope}: saved ${outcome.path}`;
    case "removed":
      return `${scope}: removed ${outcome.path}`;
    case "failed":
      return `${scope}: FAILED ${outcome.path} - ${outcome.error}`;
    case "skipped":
      if (outcome.reason === "untrusted") {
        return "Project: ignored (untrusted) - not saved";
      }
      // not-dirty: omit from status (matches prior empty-message behavior)
      return undefined;
  }
}

function saveSucceeded(result: ConfigSaveResult): boolean {
  return (
    result.global.status === "saved" ||
    result.global.status === "removed" ||
    result.project.status === "saved" ||
    result.project.status === "removed"
  );
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createSettingsEditorState(
  session: ConfigEditorSession,
): SettingsEditorState {
  return {
    scope: "global",
    selected: 0,
    status: "Edit drafts in memory. Ctrl+S saves. Esc closes.",
    view: { kind: "main" },
    session,
  };
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

/**
 * Scope-local or effective LLM model for picker seeding.
 *
 * Own LLM model wins; otherwise (including when own search is explicit BM25)
 * seed from effective LLM model if effective search is LLM. This preserves
 * the old persisted model when switching BM25 → LLM and confirming.
 */
function configuredLlmModel(
  snap: ConfigEditorSnapshot,
  scope: ScopeId,
): string | undefined {
  const active = activeScopeSnapshot(snap, scope);
  if (active.kind === "ready") {
    const local = active.local.search;
    if (local.kind === "llm") {
      return local.model.kind === "named" ? local.model.id : undefined;
    }
  }
  // Own is inherit, bm25, missing, etc.: fall through to effective LLM model.
  if (snap.effectiveSearch.type === "llm") {
    return snap.effectiveSearch.model;
  }
  return undefined;
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
    if (view.kind === "baseline-modify-picker") view.editor.invalidate();
    if (view.kind === "baseline-mode") view.selector.invalidate();
    if (view.kind === "backend") view.selector.invalidate();
    if (view.kind === "model") view.selector.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.state.session.isDirty()) {
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
    if (view.kind === "baseline-modify") {
      this.handleModifierDraftInput(data);
      return;
    }
    if (view.kind === "baseline-modify-picker") {
      this.handleModifierPickerInput(data);
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
    const snap = this.state.session.snapshot();
    const frame = new ToolbeltFrame({
      title: "Toolbelt Settings",
      theme: this.theme,
      tabs: {
        kind: "scopes",
        active: this.state.scope,
        globalDirty: isScopeDirty(snap.global),
        projectDirty: isScopeDirty(snap.project),
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
    // Nested picker components and the config session are live objects;
    // fine to retain by reference across discard confirmation.
    return {
      ...this.state,
    };
  }

  private footerText(): string {
    const view = this.state.view;
    if (view.kind === "baseline" || view.kind === "baseline-modify-picker") {
      return "Baseline · Space toggle · Enter confirm · Esc cancel";
    }
    if (view.kind === "baseline-modify") {
      return "Modify · Enter edit row · Apply confirms · Esc cancel";
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
    if (view.kind === "baseline-modify-picker")
      return view.editor.render(width);
    if (view.kind === "baseline-modify") {
      return this.renderModifierDraft(width, view);
    }
    if (view.kind === "baseline-mode") return view.selector.render(width);
    if (view.kind === "backend") return view.selector.render(width);
    if (view.kind === "model") return view.selector.render(width);
    const sections = this.buildSections(this.state.session.snapshot());
    const selected = this.clampSelected(flattenSettingsRows(sections).length);
    return renderSectionedSettings(this.theme, sections, selected, width);
  }

  private apply(edit: ConfigEdit): ConfigEditResult {
    return this.state.session.apply(edit);
  }

  // ---- main navigation ------------------------------------------------

  private handleMainInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.state.session.isDirty()) {
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

    const rows = flattenSettingsRows(
      this.buildSections(this.state.session.snapshot()),
    );
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

  private modifierDraftRows(
    add: readonly string[],
    remove: readonly string[],
  ): import("./ui/sectioned-settings.js").SettingsRow[] {
    return [
      {
        id: "mod-add",
        label: "Add",
        value: add.length === 0 ? "(none)" : formatBaselineList(add),
        source: "Action",
      },
      {
        id: "mod-remove",
        label: "Remove",
        value: remove.length === 0 ? "(none)" : formatBaselineList(remove),
        source: "Action",
      },
      {
        id: "mod-apply",
        label: "Apply",
        value:
          add.length === 0 && remove.length === 0
            ? "empty → Inherit"
            : formatModifyLists(add, remove),
        source: "Action",
      },
    ];
  }

  private renderModifierDraft(
    width: number,
    view: Extract<SettingsView, { kind: "baseline-modify" }>,
  ): string[] {
    const sections: SettingsSection[] = [
      {
        title: `MODIFY ${this.state.scope.toUpperCase()}`,
        rows: this.modifierDraftRows(view.add, view.remove),
      },
    ];
    return renderSectionedSettings(this.theme, sections, view.selected, width);
  }

  private handleModifierDraftInput(data: string): void {
    const view = this.state.view;
    if (view.kind !== "baseline-modify") return;

    if (matchesKey(data, Key.escape)) {
      this.state.view = { kind: "main" };
      this.state.status = "Modify cancelled - draft unchanged.";
      this.tui.requestRender();
      return;
    }

    const rows = this.modifierDraftRows(view.add, view.remove);
    if (matchesKey(data, Key.up)) {
      view.selected = view.selected === 0 ? rows.length - 1 : view.selected - 1;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      view.selected = view.selected === rows.length - 1 ? 0 : view.selected + 1;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const row = rows[view.selected];
      if (row?.id === "mod-add") {
        this.openModifierPicker("add", view.add, view.remove);
      } else if (row?.id === "mod-remove") {
        this.openModifierPicker("remove", view.add, view.remove);
      } else if (row?.id === "mod-apply") {
        this.applyModifierDraft(view.add, view.remove);
      }
      this.tui.requestRender();
    }
  }

  private handleModifierPickerInput(data: string): void {
    const view = this.state.view;
    if (view.kind !== "baseline-modify-picker") return;

    if (matchesKey(data, Key.escape)) {
      this.state.view = {
        kind: "baseline-modify",
        add: view.add,
        remove: view.remove,
        selected: view.operation === "add" ? 0 : 1,
      };
      this.state.status = `${view.operation === "add" ? "Add" : "Remove"} picker cancelled.`;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const checked = uniquePreserveOrder(view.editor.confirmSelection());
      this.applyModifierPicker(view.operation, checked, view.add, view.remove);
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
    const snap = this.state.session.snapshot();
    const scope = activeScopeSnapshot(snap, this.state.scope);

    if (id === "create") {
      const result = this.apply({ type: "create", scope: this.state.scope });
      if (result.kind === "applied") {
        this.state.status = `Staged empty ${this.state.scope} configuration ({}). Ctrl+S to write.`;
      }
      return;
    }

    if (id === "remove") {
      if (scope.kind === "removing") {
        this.state.status = "Removal already staged.";
        return;
      }
      const result = this.apply({ type: "remove", scope: this.state.scope });
      if (result.kind !== "applied") return;
      // Dirty create → missing (discard draft); clean/dirty-edit → removing.
      const after = activeScopeSnapshot(
        this.state.session.snapshot(),
        this.state.scope,
      );
      if (after.kind === "missing") {
        this.state.status = "Discarded staged create.";
      } else {
        this.state.status = `Staged removal of ${this.state.scope} configuration. Ctrl+S to delete file.`;
      }
      return;
    }

    switch (scope.kind) {
      case "invalid":
        this.state.status = `Read-only: ${scope.error}`;
        return;
      case "ignored":
        this.state.status =
          "Project configuration ignored until this project is trusted.";
        return;
      case "removing":
        this.state.status = "Scope staged for removal. Save or discard.";
        return;
      case "missing":
        this.state.status = "Create the configuration first.";
        return;
      case "ready":
        break;
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

  // ---- pickers --------------------------------------------------------

  private openBaselineModePicker(): void {
    const snap = this.state.session.snapshot();
    const scope = this.state.scope;
    const options: SingleSelectOption[] =
      scope === "global"
        ? [
            { id: "inherit", label: "Inherit - use Default (omit)" },
            { id: "unrestricted", label: "Unrestricted - write null" },
            { id: "exact", label: "Exact - choose tools" },
            { id: "modify", label: "Modify - add and remove" },
          ]
        : [
            { id: "inherit", label: "Inherit - use Global or Default" },
            { id: "unrestricted", label: "Unrestricted - write null" },
            { id: "exact", label: "Exact - choose tools" },
            { id: "modify", label: "Modify - add and remove" },
          ];
    const active = activeScopeSnapshot(snap, scope);
    let selected = 0;
    if (active.kind === "ready") {
      const own = active.local.baseline;
      if (own.kind === "inherit") selected = 0;
      else if (own.kind === "unrestricted") selected = 1;
      else if (own.kind === "list") selected = 2;
      else selected = 3;
    }
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

  private buildToolPickerItems(
    checked: readonly string[],
    extraNames: readonly string[] = [],
  ): import("./ui/fuzzy-multi-selector.js").MultiSelectItem[] {
    const selected = new Set(checked);
    const registered = new Map(
      this.tools.map((t) => [t.name, t.description ?? ""] as const),
    );
    const names = new Set<string>([
      ...registered.keys(),
      ...selected,
      ...extraNames,
    ]);
    return [...names]
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
  }

  private openBaselineEditor(): void {
    const snap = this.state.session.snapshot();
    const scopeSnap = activeScopeSnapshot(snap, this.state.scope);
    let seed: readonly string[] = [];
    if (
      scopeSnap.kind === "ready" &&
      scopeSnap.local.baseline.kind === "list"
    ) {
      seed = scopeSnap.local.baseline.tools;
    } else if (snap.effectiveBaseline.kind === "exact") {
      seed = snap.effectiveBaseline.tools;
    }

    this.state.view = {
      kind: "baseline",
      editor: new FuzzyMultiSelector(
        `Exact baseline tools (${this.state.scope})`,
        this.buildToolPickerItems(seed),
        this.theme,
        10,
      ),
    };
    this.state.status = "Editing exact baseline tools.";
  }

  private openModifierDraft(): void {
    const snap = this.state.session.snapshot();
    const scopeSnap = activeScopeSnapshot(snap, this.state.scope);
    let add: string[] = [];
    let remove: string[] = [];
    if (
      scopeSnap.kind === "ready" &&
      scopeSnap.local.baseline.kind === "modify"
    ) {
      add = [...scopeSnap.local.baseline.add];
      remove = [...scopeSnap.local.baseline.remove];
    }
    this.state.view = {
      kind: "baseline-modify",
      add,
      remove,
      selected: 0,
    };
    this.state.status =
      add.length === 0 && remove.length === 0
        ? "New modification. Add and Remove start empty."
        : "Editing saved modification.";
  }

  private openModifierPicker(
    operation: "add" | "remove",
    add: readonly string[],
    remove: readonly string[],
  ): void {
    const checked = operation === "add" ? add : remove;
    this.state.view = {
      kind: "baseline-modify-picker",
      operation,
      add: [...add],
      remove: [...remove],
      editor: new FuzzyMultiSelector(
        `${operation === "add" ? "Add" : "Remove"} tools (${this.state.scope})`,
        this.buildToolPickerItems(checked, [...add, ...remove]),
        this.theme,
        10,
      ),
    };
    this.state.status = `Select tools to ${operation}.`;
  }

  private openBackendPicker(): void {
    const snap = this.state.session.snapshot();
    const scope = this.state.scope;
    // Project inherit shows Global draft (or default BM25).
    const globalSearchLabel =
      snap.global.kind === "ready" &&
      snap.global.local.search.kind !== "inherit"
        ? formatSearchSelection(snap.global.local.search)
        : formatSearchConfig(
            snap.effectiveSearchSource === "global"
              ? snap.effectiveSearch
              : { type: "bm25" },
          );
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
              label: `Inherit from Global - currently ${globalSearchLabel}`,
            },
            { id: "bm25", label: "BM25 - explicit project override" },
            { id: "llm", label: "LLM - explicit project override" },
          ];

    const active = activeScopeSnapshot(snap, scope);
    let selected = 0;
    if (active.kind === "ready") {
      const own = active.local.search;
      if (own.kind === "inherit") selected = 0;
      else if (own.kind === "bm25") selected = 1;
      else selected = 2;
    }

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
    const snap = this.state.session.snapshot();
    const configuredModel = configuredLlmModel(snap, this.state.scope);

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
    if (id === "exact" || id === "custom") {
      this.openBaselineEditor();
      return;
    }
    if (id === "modify") {
      this.openModifierDraft();
      return;
    }

    const baseline: BaselineSelection =
      id === "unrestricted" ? { kind: "unrestricted" } : { kind: "inherit" };
    const result = this.apply({
      type: "set-baseline",
      scope: this.state.scope,
      baseline,
    });
    if (result.kind !== "applied") return;

    this.state.view = { kind: "main" };
    if (id === "unrestricted") {
      this.state.status =
        this.state.scope === "global"
          ? "Global baseline set to Unrestricted (null)."
          : "Project baseline set to Unrestricted (null).";
    } else {
      this.state.status =
        this.state.scope === "global"
          ? "Global baseline set to Inherit (Default)."
          : "Project baseline set to Inherit.";
    }
  }

  private applyBaselineCustom(tools: string[]): void {
    const result = this.apply({
      type: "set-baseline",
      scope: this.state.scope,
      baseline: { kind: "list", tools },
    });
    if (result.kind !== "applied") return;
    this.state.status = `Exact baseline set on ${this.state.scope} (${tools.length} tools).`;
  }

  private applyModifierPicker(
    operation: "add" | "remove",
    checked: readonly string[],
    previousAdd: readonly string[],
    previousRemove: readonly string[],
  ): void {
    let add = [...previousAdd];
    let remove = [...previousRemove];
    let moved: string[] = [];
    if (operation === "add") {
      add = uniquePreserveOrder(checked);
      moved = add.filter((name) => remove.includes(name));
      remove = remove.filter((name) => !add.includes(name));
    } else {
      remove = uniquePreserveOrder(checked);
      moved = remove.filter((name) => add.includes(name));
      add = add.filter((name) => !remove.includes(name));
    }
    this.state.view = {
      kind: "baseline-modify",
      add,
      remove,
      selected: operation === "add" ? 0 : 1,
    };
    if (moved.length > 0) {
      const from = operation === "add" ? "Remove" : "Add";
      const to = operation === "add" ? "Add" : "Remove";
      this.state.status = `Moved ${moved.join(", ")} from ${from} to ${to}.`;
    } else {
      this.state.status = `Updated ${operation === "add" ? "Add" : "Remove"} list.`;
    }
  }

  private applyModifierDraft(
    add: readonly string[],
    remove: readonly string[],
  ): void {
    const nextAdd = uniquePreserveOrder(add);
    const nextRemove = uniquePreserveOrder(remove).filter(
      (name) => !nextAdd.includes(name),
    );
    const baseline: BaselineSelection =
      nextAdd.length === 0 && nextRemove.length === 0
        ? { kind: "inherit" }
        : { kind: "modify", add: nextAdd, remove: nextRemove };
    const result = this.apply({
      type: "set-baseline",
      scope: this.state.scope,
      baseline,
    });
    if (result.kind !== "applied") return;
    this.state.view = { kind: "main" };
    this.state.status =
      baseline.kind === "inherit"
        ? this.state.scope === "global"
          ? "Empty modification became Inherit (Default)."
          : "Empty modification became Inherit."
        : `${this.state.scope} modification: ${formatModifyLists(nextAdd, nextRemove)}.`;
  }

  private applyBackendChoice(id: string): void {
    if (id === "llm") {
      this.openModelPicker("backend");
      return;
    }

    if (id === "default" || id === "inherit") {
      const result = this.apply({
        type: "set-search",
        scope: this.state.scope,
        search: { kind: "inherit" },
      });
      if (result.kind !== "applied") return;
      this.state.view = { kind: "main" };
      this.state.status =
        id === "inherit"
          ? "Project search reset to inherited."
          : "Global search set to default (BM25).";
      return;
    }

    if (id === "bm25") {
      const result = this.apply({
        type: "set-search",
        scope: this.state.scope,
        search: { kind: "bm25" },
      });
      if (result.kind !== "applied") return;
      this.state.view = { kind: "main" };
      this.state.status = `${this.state.scope} search override: bm25`;
    }
  }

  private applyModelChoice(optionId: string): void {
    const snap = this.state.session.snapshot();
    const configuredModel = configuredLlmModel(snap, this.state.scope);
    const options = buildModelOptionsFromSnapshot(
      this.modelSnapshot,
      configuredModel,
    );
    const opt = options.find((o) => o.id === optionId);
    const search: SearchSelection =
      opt === undefined || opt.model === undefined
        ? { kind: "llm", model: { kind: "active" } }
        : { kind: "llm", model: { kind: "named", id: opt.model } };

    const result = this.apply({
      type: "set-search",
      scope: this.state.scope,
      search,
    });
    if (result.kind !== "applied") return;
    this.state.view = { kind: "main" };
    this.state.status = `${this.state.scope} search set to ${formatSearchSelection(search)}.`;
  }

  // ---- save -----------------------------------------------------------

  private save(): void {
    const before = this.state.session.snapshot();
    const result = this.state.session.save();

    if (saveSucceeded(result)) {
      // Refresh subsequent configuration reads only. Never mutates tools.
      this.onConfigSaved?.();
    }

    let status = formatSaveStatus(result);
    if (saveSucceeded(result)) {
      const after = this.state.session.snapshot();
      if (
        !resolvedPolicyEqual(before.effectiveBaseline, after.effectiveBaseline)
      ) {
        status = `${status} Use /toolbelt reset to apply the baseline to this session.`;
      }
    }
    this.state.status = status;
    this.tui.requestRender();
  }

  // ---- sections / rows ------------------------------------------------

  private buildSections(snap: ConfigEditorSnapshot): SettingsSection[] {
    const scopeId = this.state.scope;
    const scope = activeScopeSnapshot(snap, scopeId);

    switch (scope.kind) {
      case "ignored":
        return [
          {
            title: "PROJECT",
            rows: [
              {
                id: "ignored",
                label: "Status",
                value: "ignored until trusted",
                note: scope.path,
                source: "Action",
              },
            ],
          },
        ];

      case "invalid":
        return [
          {
            title: "ERROR",
            rows: [
              {
                id: "invalid",
                label: "Invalid",
                value: scope.error,
                note: scope.path,
                source: "Action",
              },
            ],
          },
        ];

      case "removing":
        return [
          {
            title: "SCOPE",
            rows: [
              {
                id: "remove",
                label: "Remove",
                value: "staged - Ctrl+S deletes file",
                note: scope.path,
                source: "Action",
              },
            ],
          },
        ];

      case "missing": {
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
                note: scope.path,
                source: "Action",
              },
            ],
          },
        ];
      }

      case "ready":
        return this.buildReadySections(snap, scopeId, scope.local, scope.path);
    }
  }

  private buildReadySections(
    snap: ConfigEditorSnapshot,
    scopeId: ScopeId,
    local: LocalConfig,
    path: string,
  ): SettingsSection[] {
    const ownBase = local.baseline;
    const ownSearch = local.search;

    const chain = formatBaselineTrace(snap.effectiveBaseline);
    const effectiveText = formatResolvedBaseline(snap.effectiveBaseline);
    let baselineValue: string;
    let baselineSource: ValueSourceLabel;
    let baselineNote: string;
    if (ownBase.kind !== "inherit") {
      baselineValue = formatBaselineSelection(ownBase);
      baselineSource = scopeId === "global" ? "Global" : "Project";
      baselineNote = `effective ${effectiveText} · ${chain}`;
    } else {
      baselineValue = effectiveText;
      const last =
        snap.effectiveBaseline.trace[snap.effectiveBaseline.trace.length - 1];
      baselineSource = sourceLabelFromTrace(last?.scope);
      baselineNote = `(inherited) ${chain}`;
    }

    // Search display — same inherit parity as baseline.
    let searchValue: string;
    let searchSource: ValueSourceLabel;
    let searchNote: string | undefined;
    if (ownSearch.kind !== "inherit") {
      searchValue = formatSearchSelection(ownSearch);
      searchSource = scopeId === "global" ? "Global" : "Project";
    } else {
      searchValue = formatSearchConfig(snap.effectiveSearch);
      searchSource = sourceLabel(snap.effectiveSearchSource);
      searchNote = `(inherited from ${searchSource})`;
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

    const ownIsLlm = ownSearch.kind === "llm";
    const ownOmitted = ownSearch.kind === "inherit";
    const showModel =
      ownIsLlm || (ownOmitted && snap.effectiveSearch.type === "llm");
    if (showModel) {
      let modelText: string;
      if (ownIsLlm) {
        modelText =
          ownSearch.model.kind === "named"
            ? ownSearch.model.id
            : "active model";
      } else {
        modelText =
          snap.effectiveSearch.type === "llm" &&
          snap.effectiveSearch.model !== undefined
            ? snap.effectiveSearch.model
            : "active model";
      }
      const modelSource: ValueSourceLabel = ownIsLlm
        ? scopeId === "global"
          ? "Global"
          : "Project"
        : sourceLabel(snap.effectiveSearchSource);
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
          note: path,
          source: "Action",
        },
      ],
    });

    return sections;
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers (UI-owned presentation facts only)
// ---------------------------------------------------------------------------

function isScopeDirty(scope: ConfigScopeSnapshot): boolean {
  switch (scope.kind) {
    case "ready":
      return scope.dirty;
    case "ignored":
      return scope.dirty;
    case "removing":
      return true;
    case "missing":
    case "invalid":
      return false;
  }
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
  // Live trust getter — rechecked on every Project mutation and disk write.
  const isProjectTrusted = (): boolean => ctx.isProjectTrusted?.() ?? false;

  const initial =
    options.initialState ??
    createSettingsEditorState(
      createConfigEditorSession(ctx.cwd, isProjectTrusted),
    );

  // Reopens retain the same dirty session; only UI view is reset by commands.
  // Trust is always live via the getter closed over `ctx`.

  const tools = options.tools ?? [];
  const snap = initial.session.snapshot();
  const configuredModel = configuredLlmModel(snap, initial.scope);
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
