/**
 * Tool manager state unit tests.
 *
 * Tests are deterministic and cover filtering, navigation, staged toggle,
 * cancel, confirmation, read-only mode, and the no-protection invariant.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createToolManagerState,
  filterToolRows,
  reduceToolManagerState,
  selectedActiveNames,
  type ToolManagerRow,
} from "../tool-manager.js";

const rows: ToolManagerRow[] = [
  { name: "read", description: "Read file contents" },
  { name: "query_tools", description: "Discover registered tools" },
  { name: "manage_tools", description: "Manage active tools" },
  { name: "agent_browser", description: "Browse websites" },
];

describe("tool manager state", () => {
  it("filters case-insensitively across names and descriptions", () => {
    assert.deepEqual(
      filterToolRows(rows, "BROWSE").map((row) => row.name),
      ["agent_browser"],
    );
    assert.deepEqual(
      filterToolRows(rows, "active tools").map((row) => row.name),
      ["manage_tools"],
    );
  });

  it("resets and clamps selection while navigating filtered rows", () => {
    let state = createToolManagerState(rows, ["read"], false);
    state = reduceToolManagerState(rows, state, {
      type: "move",
      delta: 1,
    }).state;
    assert.equal(state.selectedIndex, 1);
    state = reduceToolManagerState(rows, state, {
      type: "filter",
      value: "browse",
    }).state;
    assert.equal(state.selectedIndex, 0);
    state = reduceToolManagerState(rows, state, {
      type: "move",
      delta: 1,
    }).state;
    assert.equal(state.selectedIndex, 0); // clamped at 0 for single-result filter
  });

  it("stages additions and removals, including both model tools", () => {
    let state = createToolManagerState(
      rows,
      ["read", "query_tools", "manage_tools"],
      false,
    );
    for (const value of ["query_tools", "manage_tools", "browse"]) {
      state = reduceToolManagerState(rows, state, {
        type: "filter",
        value,
      }).state;
      state = reduceToolManagerState(rows, state, { type: "toggle" }).state;
    }

    assert.deepEqual(selectedActiveNames(rows, state), ["read", "agent_browser"]);
    assert.deepEqual(
      reduceToolManagerState(rows, state, { type: "confirm" }).result,
      { kind: "confirm", active: ["read", "agent_browser"] },
    );
  });

  it("cancels without exposing staged membership", () => {
    const state = createToolManagerState(rows, ["read"], false);
    assert.deepEqual(
      reduceToolManagerState(rows, state, { type: "cancel" }).result,
      { kind: "cancel" },
    );
  });

  it("keeps read-only state unchanged and closes instead of confirming", () => {
    const state = createToolManagerState(rows, ["read"], true);
    assert.equal(
      reduceToolManagerState(rows, state, { type: "toggle" }).state,
      state,
    );
    assert.deepEqual(
      reduceToolManagerState(rows, state, { type: "confirm" }).result,
      { kind: "cancel" },
    );
  });

  it("staged returns only registered names", () => {
    let state = createToolManagerState(rows, ["read", "missing_tool"], false);
    assert.deepEqual(selectedActiveNames(rows, state), ["read"]);
    state = reduceToolManagerState(rows, state, { type: "filter", value: "browse" }).state;
    state = reduceToolManagerState(rows, state, { type: "toggle" }).state;
    assert.deepEqual(selectedActiveNames(rows, state), ["read", "agent_browser"]);
  });

  it("confirm on empty staged set returns empty active array", () => {
    let state = createToolManagerState(rows, ["read"], false);
    state = reduceToolManagerState(rows, state, { type: "filter", value: "read" }).state;
    state = reduceToolManagerState(rows, state, { type: "toggle" }).state;
    assert.deepEqual(
      reduceToolManagerState(rows, state, { type: "confirm" }).result,
      { kind: "confirm", active: [] },
    );
  });
});
