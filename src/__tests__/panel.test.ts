/**
 * Panel unit tests.
 *
 * Verifies rendering of round/square borders, title positioning, content
 * truncation, padding, footer separator, and invalidation forwarding.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { Panel } from "../panel.js";

function component(lines: string[], invalidate = () => {}): Component {
  return { render: () => lines, invalidate };
}

describe("Panel", () => {
  it("renders titled round border with padding at requested width", () => {
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

  it("truncates body content to available inner width", () => {
    const panel = new Panel({
      body: component(["abcdef"]),
      padding: 1,
    });

    const lines = panel.render(6);
    assert.equal(lines[2]?.startsWith("│ ab"), true);
    assert.equal(lines[2]?.endsWith(" │"), true);
    assert.deepEqual(lines.map(visibleWidth), [6, 6, 6, 6, 6]);
  });

  it("renders footer and forwards invalidation", () => {
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
