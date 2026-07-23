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

  it("setup shows usage when no scope given", async () => {
    const { handleToolbeltCommand } = await import("../commands.js");
    let notified: { msg: string; sev: string } | null = null;
    const mockPi = { getFlag: () => false, getActiveTools: () => [], getAllTools: () => [], setActiveTools: () => {} } as any;
    const mockCtx = {
      cwd: "/tmp",
      hasUI: true,
      ui: {
        notify(msg: string, sev: string) { notified = { msg, sev }; },
        confirm: async () => false,
      },
    } as any;
    await handleToolbeltCommand("setup", mockPi, mockCtx);
    assert.ok(notified !== null);
    const nm: { msg: string } = notified!;
    assert.ok(nm.msg.includes("global"));
    assert.ok(nm.msg.includes("project"));
  });

  it("status calls notify for any state", async () => {
    const { handleToolbeltCommand } = await import("../commands.js");
    let notified = false;
    const mockPi = {
      getFlag: () => false,
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools: () => {},
    } as any;
    const mockCtx = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        notify(_msg: string, _sev: string) { notified = true; },
      },
    } as any;
    await handleToolbeltCommand("status", mockPi, mockCtx);
    assert.equal(notified, true);
  });

  it("reset calls notify on existing config", async () => {
    const { handleToolbeltCommand } = await import("../commands.js");
    let notified = false;
    const mockPi = {
      getFlag: () => false,
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools: () => {},
      appendEntry: () => {},
    } as any;
    const mockCtx = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        notify(_msg: string, _sev: string) { notified = true; },
        confirm: async () => true,
      },
    } as any;
    await handleToolbeltCommand("reset", mockPi, mockCtx);
    assert.equal(notified, true);
  });

  it("unknown subcommand returns warning", async () => {
    const { handleToolbeltCommand } = await import("../commands.js");
    let notified: { msg: string; sev: string } | null = null;
    const mockPi = {} as any;
    const mockCtx = {
      cwd: "/tmp",
      hasUI: true,
      ui: {
        notify(msg: string, sev: string) { notified = { msg, sev }; },
      },
    } as any;
    await handleToolbeltCommand("nope", mockPi, mockCtx);
    assert.ok(notified !== null);
    const nm2: { msg: string } = notified!;
    assert.ok(nm2.msg.includes("Unknown"));
  });
});
