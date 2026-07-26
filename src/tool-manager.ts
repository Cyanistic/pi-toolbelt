/**
 * Keyboard-driven staged tool manager for /toolbelt tools.
 *
 * State is deterministic and independently testable. The modal component
 * wraps state transitions and delegates rendering to the same stateless
 * helpers. No active-set mutation happens inside this module — the caller
 * receives a confirm or cancel result and applies it.
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
import { Panel } from "./panel.js";

export interface ToolManagerRow {
  name: string;
  description: string;
}

export interface ToolManagerState {
  filter: string;
  selectedIndex: number;
  staged: string[];
  readOnly: boolean;
}

export type ToolManagerResult =
  | { kind: "confirm"; active: string[] }
  | { kind: "cancel" };

export type ToolManagerAction =
  | { type: "filter"; value: string }
  | { type: "move"; delta: -1 | 1 }
  | { type: "toggle" }
  | { type: "confirm" }
  | { type: "cancel" };

export function buildToolManagerRows(tools: ToolInfo[]): ToolManagerRow[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
  }));
}

export function createToolManagerState(
  rows: ToolManagerRow[],
  activeNames: readonly string[],
  readOnly: boolean,
): ToolManagerState {
  const registered = new Set(rows.map((row) => row.name));
  return {
    filter: "",
    selectedIndex: 0,
    staged: [...new Set(activeNames)].filter((name) => registered.has(name)),
    readOnly,
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

export function selectedActiveNames(
  rows: ToolManagerRow[],
  state: ToolManagerState,
): string[] {
  const staged = new Set(state.staged);
  return rows.filter((row) => staged.has(row.name)).map((row) => row.name);
}

export function reduceToolManagerState(
  rows: ToolManagerRow[],
  state: ToolManagerState,
  action: ToolManagerAction,
): { state: ToolManagerState; result?: ToolManagerResult } {
  if (action.type === "cancel") {
    return { state, result: { kind: "cancel" } };
  }
  if (action.type === "confirm") {
    return state.readOnly
      ? { state, result: { kind: "cancel" } }
      : {
          state,
          result: { kind: "confirm", active: selectedActiveNames(rows, state) },
        };
  }
  if (action.type === "filter") {
    return {
      state: { ...state, filter: action.value, selectedIndex: 0 },
    };
  }

  const visible = filterToolRows(rows, state.filter);
  if (action.type === "move") {
    return {
      state: {
        ...state,
        selectedIndex: Math.max(
          0,
          Math.min(
            Math.max(0, visible.length - 1),
            state.selectedIndex + action.delta,
          ),
        ),
      },
    };
  }
  if (state.readOnly || visible.length === 0) return { state };

  const selected = visible[state.selectedIndex];
  if (selected === undefined) return { state };
  const staged = new Set(state.staged);
  if (staged.has(selected.name)) staged.delete(selected.name);
  else staged.add(selected.name);
  return { state: { ...state, staged: [...staged] } };
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

class ToolManagerComponent implements Component {
  private state: ToolManagerState;

  constructor(
    private readonly tui: Pick<TUI, "requestRender">,
    private readonly theme: Theme,
    private readonly rows: ToolManagerRow[],
    state: ToolManagerState,
    private readonly done: (result: ToolManagerResult) => void,
  ) {
    this.state = state;
  }

  private dispatch(action: ToolManagerAction): void {
    const next = reduceToolManagerState(this.rows, this.state, action);
    this.state = next.state;
    if (next.result) this.done(next.result);
    else this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.dispatch({ type: "cancel" });
    } else if (matchesKey(data, Key.enter)) {
      this.dispatch({ type: "confirm" });
    } else if (matchesKey(data, Key.up)) {
      this.dispatch({ type: "move", delta: -1 });
    } else if (matchesKey(data, Key.down)) {
      this.dispatch({ type: "move", delta: 1 });
    } else if (matchesKey(data, Key.space)) {
      this.dispatch({ type: "toggle" });
    } else if (matchesKey(data, Key.ctrl("u"))) {
      this.dispatch({ type: "filter", value: "" });
    } else if (matchesKey(data, Key.backspace)) {
      const chars = Array.from(this.state.filter);
      chars.pop();
      this.dispatch({ type: "filter", value: chars.join("") });
    } else {
      const printable = decodeFilterText(data);
      if (printable) {
        this.dispatch({ type: "filter", value: this.state.filter + printable });
      }
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const panel = new Panel({
      title: "Toolbelt Tools",
      body: {
        render: (contentWidth: number) => this.renderBody(contentWidth),
        invalidate() {},
      },
      border: "round",
      padding: 1,
      borderStyle: (text: string) => this.theme.fg("border", text),
      titleStyle: (text: string) =>
        this.theme.fg("accent", this.theme.bold(text)),
    });
    return panel.render(width);
  }

  private renderBody(width: number): string[] {
    const visible = filterToolRows(this.rows, this.state.filter);
    const staged = new Set(this.state.staged);
    const viewport = 14;
    const start = Math.max(
      0,
      Math.min(
        this.state.selectedIndex - Math.floor(viewport / 2),
        Math.max(0, visible.length - viewport),
      ),
    );
    const shown = visible.slice(start, start + viewport);
    const lines: string[] = [];

    if (this.state.readOnly) {
      lines.push(
        this.theme.fg(
          "warning",
          "Read only: run /toolbelt setup global or /toolbelt setup project to enable changes.",
        ),
        "",
      );
    }

    lines.push(
      this.theme.fg(
        "muted",
        `Filter: ${this.state.filter || "(type to filter)"}`,
      ),
      this.theme.fg(
        "dim",
        `${visible.length} of ${this.rows.length} registered tools`,
      ),
      "",
    );

    if (shown.length === 0) {
      lines.push(this.theme.fg("warning", "  No matching tools"));
    } else {
      for (let index = 0; index < shown.length; index++) {
        const row = shown[index];
        if (row === undefined) continue;
        const absoluteIndex = start + index;
        const selected = absoluteIndex === this.state.selectedIndex;
        const cursor = selected ? this.theme.fg("accent", ">") : " ";
        const marker = staged.has(row.name) ? "[x]" : "[ ]";
        const name = selected
          ? this.theme.fg("accent", this.theme.bold(row.name))
          : this.theme.fg("text", row.name);
        lines.push(
          truncateToWidth(
            `${cursor} ${marker} ${name}${
              row.description
                ? ` - ${this.theme.fg("muted", row.description)}`
                : ""
            }`,
            Math.max(1, width),
          ),
        );
      }
    }

    lines.push(
      "",
      this.theme.fg(
        "dim",
        this.state.readOnly
          ? "Type filter | Up/Down navigate | Esc/Enter close"
          : "Type filter | Backspace/Ctrl-U edit | Up/Down navigate | Space toggle | Enter apply | Esc cancel",
      ),
    );
    return lines;
  }
}

export async function openToolManager(
  ctx: ExtensionCommandContext,
  tools: ToolInfo[],
  activeNames: readonly string[],
  readOnly: boolean,
): Promise<ToolManagerResult> {
  const rows = buildToolManagerRows(tools);
  const state = createToolManagerState(rows, activeNames, readOnly);
  return ctx.ui.custom<ToolManagerResult>(
    (tui, theme, _keybindings, done) =>
      new ToolManagerComponent(tui, theme, rows, state, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: 76, maxHeight: 28 },
    },
  );
}
