/**
 * Command-level tests for /toolbelt status and /toolbelt reset.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleToolbeltCommand } from "../commands.js";
import { writeToolbeltConfig } from "../config.js";

const tmpDir = join(tmpdir(), `pi-toolbelt-cmd-${process.pid}`);

describe("status and reset", () => {
  it("status prints exact active names", async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    writeToolbeltConfig(join(tmpDir, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.4,
      topK: 5,
    });
    const notifications: string[] = [];
    const pi = {
      getActiveTools: () => ["read", "agent_browser"],
      getAllTools: () => [
        { name: "read", description: "Read" },
        { name: "agent_browser", description: "Browse" },
      ],
    } as any;
    const ctx = {
      cwd: tmpDir,
      mode: "tui",
      hasUI: true,
      ui: { notify(msg: string) { notifications.push(msg); } },
      sessionManager: { getBranch: () => [] },
    } as any;

    await handleToolbeltCommand("status", pi, ctx);

    assert.ok(
      notifications.at(-1)?.includes("Active names: read, agent_browser"),
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reset aborts without setActiveTools when persistence fails", async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    writeToolbeltConfig(join(tmpDir, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.4,
      topK: 5,
    });
    let setCalls = 0;
    const notifications: string[] = [];
    const pi = {
      getAllTools: () => [{ name: "read", description: "Read" }],
      getActiveTools: () => ["read", "agent_browser"],
      appendEntry() { throw new Error("disk full"); },
      setActiveTools() { setCalls++; },
    } as any;
    const ctx = {
      cwd: tmpDir,
      mode: "tui",
      hasUI: true,
      ui: { notify(msg: string) { notifications.push(msg); } },
    } as any;

    await handleToolbeltCommand("reset", pi, ctx);

    assert.equal(setCalls, 0);
    assert.ok(notifications.at(-1)?.includes("reset aborted"));
    assert.ok(notifications.at(-1)?.includes("disk full"));
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
