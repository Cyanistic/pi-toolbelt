/**
 * Command handler tests.
 *
 * Full handler integration tested in integration.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("commands", () => {
  it("module compiles with expected exports", async () => {
    const mod = await import("../commands.js");
    assert.equal(typeof mod.handleToolbeltCommand, "function");
  });
});
