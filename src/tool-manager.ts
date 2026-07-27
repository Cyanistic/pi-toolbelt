/**
 * Keyboard-driven staged tool manager for /toolbelt tools.
 *
 * Non-overlay session frame shared with Settings. Tracks applied vs staged
 * sets; Enter applies via callback and stays open; Escape asks the caller
 * to confirm discard when dirty. Always editable regardless of config.
 *
 * Interaction patterns from the validated Toolbelt settings prototype
 * Tools Manager screen and @aliou/pi-utils-settings 0.17.0 chrome.
 */

import type {
  ExtensionCommandContext,
  Theme,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  decodeKittyPrintable,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { getSettingsTheme, type SettingsTheme } from "./ui/settings-theme.js";
import { ToolbeltFrame } from "./ui/toolbelt-frame.js";

export interface ToolManagerRow {
  name: string;
  description: string;
}

export interface ToolManagerState {
  filter: string;
  selectedIndex: number;
  /** Last successfully applied active set. */
  applied: string[];
  /** Working toggles; Enter applies via onApply. */
  staged: string[];
  status: string;
}

export type ToolManagerResult =
  | { kind: "close" }
  | { kind: "discard-request"; state: ToolManagerState };

export type ApplyResult = { ok: true } | { ok: false; error: string };

export function buildToolManagerRows(tools: ToolInfo[]): ToolManagerRow[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
  }));
}

export function createToolManagerState(
  rows: ToolManagerRow[],
  activeNames: readonly string[],
): ToolManagerState {
  const registered = new Set(rows.map((row) => row.name));
  const applied = [...new Set(activeNames)].filter((name) =>
    registered.has(name),
  );
  return {
    filter: "",
    selectedIndex: 0,
    applied: [...applied],
    staged: [...applied],
    status: "Space stages changes. Enter applies. Esc closes.",
  };
}

export function filterToolRows(
  rows: ToolManagerRow[],
  filter: string,
): ToolManagerRow[] {
  const query = filter.trim().toLocaleLowerCase();
  if (query.length === 0) return rows;
  return rows.filter((row) =>
    `${row.name}\n${row.description}`.toLocaleLowerCase().includes(query),
  );
}

function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function isDirty(state: ToolManagerState): boolean {
  return !setsEqual(state.staged, state.applied);
}

function decodeFilterText(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty) return kitty;

  for (const character of data) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) {
      return undefined;
    }
  }
  return data || undefined;
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, width), "", true);
}

function cloneState(state: ToolManagerState): ToolManagerState {
  return {
    filter: state.filter,
    selectedIndex: state.selectedIndex,
    applied: [...state.applied],
    staged: [...state.staged],
    status: state.status,
  };
}

class ToolManagerComponent implements Component {
  private state: ToolManagerState;
  private readonly theme: SettingsTheme;
  private applying = false;

  constructor(
    private readonly tui: Pick<TUI, "requestRender">,
    theme: Theme,
    private readonly rows: ToolManagerRow[],
    state: ToolManagerState,
    private readonly onApply: (active: string[]) => Promise<ApplyResult>,
    private readonly done: (result: ToolManagerResult) => void,
  ) {
    this.theme = getSettingsTheme(theme);
    this.state = state;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.applying) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      if (isDirty(this.state)) {
        this.done({
          kind: "discard-request",
          state: cloneState(this.state),
        });
      } else {
        this.done({ kind: "close" });
      }
      return;
    }

    if (matchesKey(data, Key.enter)) {
      void this.apply();
      return;
    }

    if (matchesKey(data, Key.up)) {
      const visible = filterToolRows(this.rows, this.state.filter);
      if (visible.length === 0) return;
      this.state.selectedIndex =
        this.state.selectedIndex === 0
          ? visible.length - 1
          : this.state.selectedIndex - 1;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      const visible = filterToolRows(this.rows, this.state.filter);
      if (visible.length === 0) return;
      this.state.selectedIndex =
        this.state.selectedIndex === visible.length - 1
          ? 0
          : this.state.selectedIndex + 1;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.space)) {
      const visible = filterToolRows(this.rows, this.state.filter);
      const row = visible[this.state.selectedIndex];
      if (row === undefined) return;
      const staged = new Set(this.state.staged);
      if (staged.has(row.name)) staged.delete(row.name);
      else staged.add(row.name);
      // Preserve registered order for staged names.
      this.state.staged = this.rows
        .map((r) => r.name)
        .filter((name) => staged.has(name));
      // Also keep any staged names not in rows (shouldn't happen).
      for (const name of staged) {
        if (!this.state.staged.includes(name)) this.state.staged.push(name);
      }
      this.state.status = `Staged toggle: ${row.name}`;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("u"))) {
      this.state.filter = "";
      this.state.selectedIndex = 0;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      const chars = Array.from(this.state.filter);
      chars.pop();
      this.state.filter = chars.join("");
      this.state.selectedIndex = 0;
      this.tui.requestRender();
      return;
    }

    const printable = decodeFilterText(data);
    if (printable !== undefined) {
      this.state.filter += printable;
      this.state.selectedIndex = 0;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const frame = new ToolbeltFrame({
      title: "Toolbelt Tools",
      theme: this.theme,
      tabs: { kind: "session" },
      body: {
        invalidate: () => {},
        render: (w) => this.renderBody(w),
      },
      status: this.state.status,
      footer:
        "Type filter · Backspace/^U · Up/Down · Space stage · Enter apply · Esc close",
    });
    return frame.render(width);
  }

  private async apply(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    const active = [...this.state.staged];
    this.state.status = "Applying...";
    this.tui.requestRender();

    let result: ApplyResult;
    try {
      result = await this.onApply(active);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    this.applying = false;
    if (result.ok) {
      this.state.applied = [...active];
      this.state.staged = [...active];
      this.state.status = `Applied ${active.length} tools. Snapshot persisted.`;
    } else {
      this.state.status = `Apply failed: ${result.error}`;
    }
    this.tui.requestRender();
  }

  private renderBody(width: number): string[] {
    const visible = filterToolRows(this.rows, this.state.filter);
    const staged = new Set(this.state.staged);
    const applied = new Set(this.state.applied);
    const unapplied = isDirty(this.state);
    const lines: string[] = [];

    lines.push(
      fit(
        this.theme.fg(
          "muted",
          `Filter: ${this.state.filter || "(type to filter)"}`,
        ),
        width,
      ),
    );
    lines.push(
      fit(
        this.theme.fg(
          "dim",
          `${visible.length}/${this.rows.length} tools · staged ${this.state.staged.length} · applied ${this.state.applied.length}${unapplied ? " · unapplied changes" : " · in sync"}`,
        ),
        width,
      ),
    );
    lines.push("");

    if (visible.length === 0) {
      lines.push(fit(this.theme.fg("warning", "  No matching tools"), width));
    } else {
      const viewport = 12;
      const start = Math.max(
        0,
        Math.min(
          this.state.selectedIndex - Math.floor(viewport / 2),
          Math.max(0, visible.length - viewport),
        ),
      );
      const end = Math.min(start + viewport, visible.length);
      for (let i = start; i < end; i++) {
        const row = visible[i];
        if (row === undefined) continue;
        const sel = i === this.state.selectedIndex;
        const cursor = sel ? this.theme.fg("accent", ">") : " ";
        const box = staged.has(row.name) ? "[x]" : "[ ]";
        const addMark =
          !applied.has(row.name) && staged.has(row.name)
            ? this.theme.fg("warning", " +")
            : "";
        const removeMark =
          applied.has(row.name) && !staged.has(row.name)
            ? this.theme.fg("warning", " -")
            : "";
        const name = sel
          ? this.theme.fg("accent", this.theme.bold(row.name))
          : this.theme.fg("text", row.name);
        const desc =
          row.description.length > 0
            ? this.theme.fg("muted", `  ${row.description}`)
            : "";
        lines.push(
          fit(`${cursor} ${box} ${name}${addMark}${removeMark}${desc}`, width),
        );
      }
      if (visible.length > viewport) {
        lines.push(
          fit(
            this.theme.fg(
              "dim",
              `  (${this.state.selectedIndex + 1}/${visible.length})`,
            ),
            width,
          ),
        );
      }
    }

    return lines;
  }
}

export async function openToolManager(
  ctx: ExtensionCommandContext,
  tools: ToolInfo[],
  activeNames: readonly string[],
  options: {
    initialState?: ToolManagerState;
    onApply: (active: string[]) => Promise<ApplyResult>;
  },
): Promise<ToolManagerResult> {
  const rows = buildToolManagerRows(tools);
  const state =
    options.initialState ?? createToolManagerState(rows, activeNames);

  return ctx.ui.custom<ToolManagerResult>(
    (tui, theme, _keybindings, done) =>
      new ToolManagerComponent(tui, theme, rows, state, options.onApply, done),
    // Non-overlay: replaces composer at bottom, grows upward.
  );
}
