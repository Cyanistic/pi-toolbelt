---
date: 2026-07-23T19:42:42-0400
author: Cyanism
commit: d18893c
branch: main
repository: pi-toolbelt
topic: "Restyle /toolbelt tools modal with Panel-based UI"
tags: [plan, tool-manager, ui, panel]
status: ready
parent: .rpiv/artifacts/solutions/2026-07-23_19-05-33_restyle-toolbelt-modal.md
phase_count: 1
phases:
  - { n: 1, title: Vendored Panel and modal integration }
unresolved_phase_count: 0
last_updated: 2026-07-23T19:42:42-0400
last_updated_by: Cyanism
---

# Panel-Styled Tool Manager Implementation Plan

## Overview

Restyle the existing `/toolbelt tools` overlay by wrapping its rendered content in `@aliou/pi-utils-ui`'s round `Panel`. The change preserves the current state reducer, keyboard handling, staged confirm/cancel workflow, persistence boundary, and public function signatures.

## Requirements

- Render `/toolbelt tools` inside a round bordered panel with a styled title.
- Preserve filtering, navigation, staged toggling, confirmation, cancellation, and read-only behavior.
- Preserve the `openToolManager()` signature and `ToolManagerResult` type.
- Keep `ctx.ui.custom()` in overlay mode.
- Vendor the focused MIT-licensed `Panel` component locally because the published package is not NodeNext-compatible.
- Keep all existing state tests unchanged and passing.
- Add focused unit coverage for Panel border, title, padding, width, and invalidation behavior.
- Manually verify the bordered overlay and keyboard behavior in Pi's terminal user interface.

## Current State Analysis

`ToolManagerComponent` currently combines deterministic state dispatch with a raw `string[]` renderer. Its renderer supplies its own heading and hint but has no reusable container, while `openToolManager()` mounts the component in a centered overlay capped at 24 rows.

### Key Discoveries

- `src/tool-manager.ts:86-130` contains the pure state reducer and must remain unchanged.
- `src/tool-manager.ts:138-183` isolates component dispatch and key handling from rendering, allowing a visual-only wrapper.
- `src/tool-manager.ts:185-259` builds the complete body as themed lines and already truncates rows to the supplied width.
- `src/tool-manager.ts:262-278` is the only modal integration point; its overlay remains centered and modal.
- `@aliou/pi-utils-ui@0.4.1/src/containers/panel.ts:6-24` defines a small `Panel` over Pi TUI's existing `Component`, `truncateToWidth`, and `visibleWidth` utilities.
- `@aliou/pi-utils-ui@0.4.1/src/containers/panel.ts:52-88` subtracts borders and padding before rendering the body, so existing width-based truncation remains valid.
- The published `@aliou/pi-utils-ui@0.4.1/src/index.ts:4-34` uses extensionless relative imports and fails this repository's mandatory NodeNext type-check with TS2834/TS2835 errors.
- `src/__tests__/tool-manager.test.ts:1-96` covers state behavior but not rendered output; a focused local Panel test can cover the new reusable rendering primitive while modal interaction remains manually verified.

## Desired End State

Running the existing command still uses the same consumer-facing entry point:

```text
/toolbelt tools
```

The overlay renders the existing content inside a centered round panel:

```text
╭──────────────────────────── Toolbelt Tools ─────────────────────────────╮
│                                                                         │
│ Filter: (type to filter)                                                │
│ 12 of 12 registered tools                                               │
│                                                                         │
│ > [x] read - Read file contents                                         │
│   [ ] agent_browser - Browse websites                                   │
│                                                                         │
│ Type filter | Backspace/Ctrl-U edit | Up/Down navigate | Space toggle…  │
│                                                                         │
╰─────────────────────────────────────────────────────────────────────────╯
```

The caller contract remains unchanged:

```typescript
const result = await openToolManager(ctx, tools, activeNames, readOnly);
if (result.kind === "confirm") {
  persistActiveTools(pi, result.active);
}
```

## What We're NOT Doing

- Replacing `ToolManagerComponent` with `FuzzyMultiSelector` or `SectionedSettings`.
- Adding `@aliou/pi-utils-ui`, `@aliou/pi-utils-settings`, a compatibility shim, or lockfile churn.
- Vendoring the rest of the pi-utils-ui component library; only the focused Panel primitive is included.
- Changing reducer state, key bindings, staged confirm/cancel semantics, or session persistence.
- Changing the `/toolbelt` command surface or `openToolManager()` API.
- Adding a full terminal snapshot harness or rewriting existing state tests.
- Moving the hint into `Panel.footer`; it remains part of the existing body content.

## Decisions

### Use Panel as a visual wrapper only

Wrap the existing rendered body in `Panel` rather than replacing the component. This follows the selected solution and preserves the tested state boundary at `src/tool-manager.ts:86-183`.

### Vendor only the focused Panel primitive

The selected direct dependency failed validation because the package's published TypeScript source is incompatible with this repository's mandatory NodeNext configuration. Copy the MIT-licensed Panel primitive into `src/panel.ts`, retain attribution, and import it through the repository's normal `.js`-suffixed relative path. Do not change `package.json`, `package-lock.json`, or `tsconfig.json`.

### Use a round panel with one row of padding

Construct the local `Panel` with `border: "round"`, `padding: 1`, a border color callback, and an accent/bold title callback. The vendored implementation owns width adjustment and border rendering.

### Keep hints in the body

Remove only the duplicated raw heading from the current line builder. Keep the existing read-only warning, filter summary, rows, and keyboard hint in the body so no additional footer component or separator changes the established content flow.

### Increase the overlay height ceiling

Raise `maxHeight` at `src/tool-manager.ts:275` from 24 to 28 to accommodate two border rows and two padding rows, including the read-only warning path.

### Keep verification additive and behavior-focused

Test the reusable local Panel directly without exposing the private tool-manager component. Run the existing type-check and full test suite, then manually inspect the modal and every keyboard path listed in the source solution.

## Phase 1: Vendored Panel and modal integration

### Overview

Adds the focused local Panel primitive, its unit coverage, and the complete tool-manager rendering integration as one self-contained vertical slice; depends on nothing.

### Changes Required:

#### 1. src/panel.ts

**File**: src/panel.ts
**Changes**: NEW — add the MIT-attributed Panel component with round/square borders, title, footer, padding, width control, and invalidation forwarding.

```typescript
// Adapted from @aliou/pi-utils-ui v0.4.1 (MIT), src/containers/panel.ts.

import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type BorderStyle = "square" | "round";

export interface PanelOptions {
  title?: string | Component;
  body: Component;
  footer?: Component;
  borderStyle?: (text: string) => string;
  titleStyle?: (text: string) => string;
  border?: BorderStyle;
  padding?: number;
}

const BORDERS: Record<
  BorderStyle,
  {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    left: string;
    right: string;
    footerLeft: string;
    horizontal: string;
  }
> = {
  square: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    left: "│",
    right: "│",
    footerLeft: "├",
    horizontal: "─",
  },
  round: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    left: "│",
    right: "│",
    footerLeft: "├",
    horizontal: "─",
  },
};

export class Panel implements Component {
  private readonly title?: string | Component;
  private readonly body: Component;
  private readonly footer?: Component;
  private readonly styleBorder: (text: string) => string;
  private readonly styleTitle: (text: string) => string;
  private readonly border: BorderStyle;
  private readonly padding: number;

  constructor(options: PanelOptions) {
    this.title = options.title;
    this.body = options.body;
    this.footer = options.footer;
    this.styleBorder = options.borderStyle ?? ((text) => text);
    this.styleTitle = options.titleStyle ?? ((text) => text);
    this.border = options.border ?? "square";
    this.padding = options.padding ?? 1;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const border = BORDERS[this.border];
    const innerWidth = Math.max(0, width - 2);
    const contentWidth = Math.max(0, innerWidth - this.padding * 2);

    lines.push(this.renderTopBorder(border, width, innerWidth));

    for (let index = 0; index < this.padding; index++) {
      lines.push(this.renderEmptyLine(border, innerWidth));
    }

    for (const line of this.body.render(contentWidth)) {
      lines.push(this.renderContentLine(border, innerWidth, line));
    }

    for (let index = 0; index < this.padding; index++) {
      lines.push(this.renderEmptyLine(border, innerWidth));
    }

    if (this.footer) {
      lines.push(
        this.styleBorder(border.footerLeft) +
          this.styleBorder(border.horizontal.repeat(innerWidth)) +
          this.styleBorder("┤"),
      );
      for (const line of this.footer.render(contentWidth)) {
        lines.push(this.renderContentLine(border, innerWidth, line));
      }
    }

    lines.push(
      this.styleBorder(border.bottomLeft) +
        this.styleBorder(border.horizontal.repeat(innerWidth)) +
        this.styleBorder(border.bottomRight),
    );

    return lines;
  }

  invalidate(): void {
    this.body.invalidate();
    this.footer?.invalidate();
  }

  private renderTopBorder(
    border: (typeof BORDERS)[BorderStyle],
    width: number,
    innerWidth: number,
  ): string {
    if (!this.title) {
      return (
        this.styleBorder(border.topLeft) +
        this.styleBorder(border.horizontal.repeat(innerWidth)) +
        this.styleBorder(border.topRight)
      );
    }

    const title =
      typeof this.title === "string"
        ? this.title
        : this.title.render(innerWidth).join(" ");
    const styledTitle = this.styleTitle(` ${title} `);
    const fillWidth = Math.max(0, width - visibleWidth(styledTitle) - 2);
    const rightFill = Math.ceil(fillWidth / 2);
    const leftFill = fillWidth - rightFill;

    return (
      this.styleBorder(border.topLeft) +
      this.styleBorder(border.horizontal.repeat(leftFill)) +
      styledTitle +
      this.styleBorder(border.horizontal.repeat(rightFill)) +
      this.styleBorder(border.topRight)
    );
  }

  private renderEmptyLine(
    border: (typeof BORDERS)[BorderStyle],
    innerWidth: number,
  ): string {
    return (
      this.styleBorder(border.left) +
      " ".repeat(innerWidth) +
      this.styleBorder(border.right)
    );
  }

  private renderContentLine(
    border: (typeof BORDERS)[BorderStyle],
    innerWidth: number,
    content: string,
  ): string {
    const padded =
      " ".repeat(this.padding) +
      truncateToWidth(
        content,
        Math.max(0, innerWidth - this.padding * 2),
        "",
        true,
      ) +
      " ".repeat(this.padding);
    const inner = truncateToWidth(padded, innerWidth, "", true);
    return (
      this.styleBorder(border.left) +
      inner +
      this.styleBorder(border.right)
    );
  }
}
```

#### 2. src/__tests__/panel.test.ts

**File**: src/__tests__/panel.test.ts
**Changes**: NEW — verify Panel rendering, styling hooks, width clamping, and invalidation forwarding with node:test.

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Component,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { Panel } from "../panel.js";

function component(lines: string[], invalidate = () => {}): Component {
  return {
    render: () => lines,
    invalidate,
  };
}

describe("Panel", () => {
  it("renders a titled round border with padding at the requested width", () => {
    const styledBorders: string[] = [];
    const panel = new Panel({
      title: "Tools",
      body: component(["abc"]),
      border: "round",
      padding: 1,
      borderStyle(text) {
        styledBorders.push(text);
        return text;
      },
      titleStyle: (text) => text,
    });

    assert.deepEqual(panel.render(12), [
      "╭─ Tools ──╮",
      "│          │",
      "│ abc      │",
      "│          │",
      "╰──────────╯",
    ]);
    assert.ok(styledBorders.includes("╭"));
    assert.ok(styledBorders.includes("╯"));
  });

  it("truncates body content to the available inner width", () => {
    const panel = new Panel({
      body: component(["abcdef"]),
      padding: 1,
    });

    const lines = panel.render(6);
    assert.equal(lines[2]?.startsWith("│ ab"), true);
    assert.equal(lines[2]?.endsWith(" │"), true);
    assert.deepEqual(lines.map(visibleWidth), [6, 6, 6, 6, 6]);
  });

  it("renders a footer and forwards invalidation", () => {
    let bodyInvalidations = 0;
    let footerInvalidations = 0;
    const panel = new Panel({
      body: component(["body"], () => bodyInvalidations++),
      footer: component(["foot"], () => footerInvalidations++),
      padding: 0,
    });

    assert.deepEqual(panel.render(8), [
      "┌──────┐",
      "│body  │",
      "├──────┤",
      "│foot  │",
      "└──────┘",
    ]);

    panel.invalidate();
    assert.equal(bodyInvalidations, 1);
    assert.equal(footerInvalidations, 1);
  });
});
```

#### 3. src/tool-manager.ts:10-21,185-259,275

**File**: src/tool-manager.ts
**Changes**: MODIFY — import the local `Panel`, split body-line generation from the wrapper render method, and increase overlay height.

```typescript
import { Panel } from "./panel.js";

// Replace ToolManagerComponent.render() and add renderBody().
render(width: number): string[] {
  const panel = new Panel({
    title: "Toolbelt Tools",
    body: {
      render: (contentWidth) => this.renderBody(contentWidth),
      invalidate() {},
    },
    border: "round",
    padding: 1,
    borderStyle: (text) => this.theme.fg("border", text),
    titleStyle: (text) =>
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

// In openToolManager() overlay options:
overlayOptions: { anchor: "center", width: 76, maxHeight: 28 },
```

### Success Criteria:

#### Automated Verification:
- [x] NodeNext type checking passes with the local `.js`-suffixed import: `npm run typecheck`
- [x] All tests, including the three new Panel cases and existing tool-manager/command coverage, pass: `npm test`
- [x] No incompatible pi-utils-ui dependency was added: `! grep -q '"@aliou/pi-utils-ui"' package.json package-lock.json`

#### Manual Verification:
- [ ] `/toolbelt tools` opens in a centered round panel with an accent/bold title, padding, and no duplicate raw heading.
- [ ] Filter typing, Backspace, Ctrl-U, Up/Down, Space, Enter, Escape, and Ctrl-C preserve their existing behavior.
- [ ] Read-only mode shows its warning and close-only behavior without clipping at the 28-row overlay ceiling.
- [ ] `/toolbelt setup`, `/toolbelt status`, and `/toolbelt reset` still load and behave normally.

## Ordering Constraints

Phase 1 is atomic: the local component, its tests, and the tool-manager integration land together. There are no parallel or follow-on phases.

## Verification Notes

- Verify all local ESM imports use `.js` suffixes and resolve under NodeNext: `npm run typecheck`.
- Verify the new Panel tests plus the existing seven state tests and two command tests pass: `npm test`.
- Inspect `/toolbelt tools` in Pi to confirm the centered round border, title styling, content padding, and terminal-width truncation.
- Exercise filter typing, Backspace, Ctrl-U, Up/Down, Space, Enter, Escape, and Ctrl-C.
- Exercise read-only mode and confirm its warning plus close behavior fit inside the overlay.
- Confirm `/toolbelt status`, `/toolbelt reset`, and `/toolbelt setup` still load despite the new static import chain.

## Performance Considerations

`Panel` adds one wrapper allocation and linear formatting over at most the existing 14-row viewport per render. It does not change filtering complexity, state transitions, active-tool persistence, or any hot path outside the interactive modal.

## Migration Notes

## Pattern References

- `src/tool-manager.ts:86-183` — preserve the reducer, dispatch, and input-handling boundary.
- `src/tool-manager.ts:185-259` — reuse the existing themed body-line construction and width truncation.
- `src/tool-manager.ts:262-278` — preserve overlay mounting and public API while adjusting only the height ceiling.
- `@aliou/pi-utils-ui@0.4.1/src/containers/panel.ts:1-138` — vendor the focused MIT-licensed component shape and retain attribution.
- `@aliou/pi-utils-ui@0.4.1/src/containers/panel.ts:52-88` — preserve Panel's content-width and border rendering behavior.
- `src/__tests__/tool-manager.test.ts:1-96` — preserve deterministic state coverage.
- `src/__tests__/*.test.ts` — follow node:test plus node:assert/strict conventions.

## Developer Context

- Question: “`package.json:26-32` keeps runtime libraries in `dependencies` and host-provided Pi packages in `peerDependencies`. `@aliou/pi-utils-ui` is imported at runtime and is not host-provided. Where should it live?” Answer: direct dependency; follow-up version decision: caret.
- Question: “About to follow the pi-guardrails-style round `Panel` direction from the selected solution, using `border: \"round\"`, padding 1, the existing hint inside the body, and increasing the overlay ceiling at `src/tool-manager.ts:275` from 24 to 28 for the added border/padding. Confirm that direction, or move off it?” Answer: Follow round Panel.
- Question: “Ready to proceed to decomposition?” Answer: Proceed.
- Question: “1 slice for Panel-styled tool manager. Slice 1: Panel wrapper and dependency wiring. Modify `package.json`, `package-lock.json`, and `src/tool-manager.ts`; preserve the current interaction/state pipeline and adjust overlay height. Approve decomposition?” Answer: Approve.
- Validation correction: installing `@aliou/pi-utils-ui@^0.4.1` in an isolated copy made `npm run typecheck` fail with 17 TS2834/TS2835 errors from the package's extensionless NodeNext imports; `npm test` still passed all 60 tests.
- Question: “Which route should the plan take?” Answer: vendor the UI component after confirming the local copy is simple.
- Question: “Revised single slice: vendor Panel and restyle the modal. NEW `src/panel.ts`; MODIFY `src/tool-manager.ts`; NEW `src/__tests__/panel.test.ts`; remove package and lockfile changes entirely. Approve the revised decomposition?” Answer: Approve.
- Micro-checkpoint: “Slice 1/1: vendored Panel and modal integration” with signatures, key Panel construction, fit references, isolated `npm run typecheck`, 63/63 passing tests, and slice-verifier Decisions/Cross-slice/Research all OK. Answer: Approve.
- Step 9 review: developer approved dismissing both suggestion-level findings as non-impacting style/performance nitpicks.

## Plan History

- Phase 1: Vendored Panel and modal integration — approved as generated

## References

- `.rpiv/artifacts/solutions/2026-07-23_19-05-33_restyle-toolbelt-modal.md`
- `.rpiv/guidance/src/architecture.md`
- `src/tool-manager.ts`
- `src/__tests__/tool-manager.test.ts`
- `src/__tests__/commands.test.ts`
- `@aliou/pi-utils-ui@0.4.1` published package source and MIT license

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §1 (`panel.ts`) | `<n/a>` | suggestion | codebase-fit | The footer separator's right side is hardcoded as `"┤"` while the left side reads from `border.footerLeft`; the border map has no `footerRight` key. | Add `footerRight: "┤"` to both border entries and render `border.footerRight` instead of the literal. | dismissed: square and round panels intentionally share the same right tee; mapping it adds no behavior. |
| code | Phase 1 §3 (`tool-manager.ts`) | `<n/a>` | suggestion | code-quality | The body component and two theme callbacks are recreated on every `render()` call. | Initialize the body component and border/title styling callbacks once on class fields or in the constructor. | dismissed: bounded allocations are insignificant for this small interactive modal; constructor state would add complexity. |
