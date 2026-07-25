/**
 * Integration tests for the pi-toolbelt extension.
 *
 * Tests the full lifecycle: discovery-only query_tools, explicit manage_tools,
 * snapshot-based session restore, reset, validation, and persistence failure.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import toolbeltExtension from "../index.js";
import {
  ACTIVE_TOOL_SNAPSHOT_ENTRY,
  MANAGE_TOOL_NAME,
} from "../constants.js";
import { writeToolbeltConfig } from "../config.js";
import { SearchEngine, buildToolIndex } from "../search.js";

const tmpBase = join(tmpdir(), `pi-toolbelt-int-${process.pid}`);

function setupTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });
}

function teardownTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
}

function createExtensionHarness(cwd: string) {
  const registeredTools = new Map<string, any>();
  const commands = new Map<string, any>();
  const events = new Map<string, (...args: any[]) => any>();
  const entries: Array<{ type: string; data: unknown }> = [];
  const operationOrder: string[] = [];
  let active: string[] = [];
  let setCalls = 0;
  let failAppend = false;
  let branch: any[] = [];
  const catalog = [
    { name: "read", description: "Read file contents" },
    { name: "query_tools", description: "Discover registered tools" },
    { name: MANAGE_TOOL_NAME, description: "Manage active tools" },
    { name: "agent_browser", description: "Browse and interact with websites" },
  ];
  const pi = {
    registerFlag() {},
    registerCommand(name: string, definition: any) {
      commands.set(name, definition);
    },
    registerTool(definition: any) {
      registeredTools.set(definition.name, definition);
    },
    on(name: string, handler: (...args: any[]) => any) {
      events.set(name, handler);
    },
    getFlag: () => false,
    getAllTools: () => catalog,
    getActiveTools: () => [...active],
    setActiveTools(names: string[]) {
      operationOrder.push("set");
      setCalls++;
      active = [...names];
    },
    appendEntry(type: string, data: unknown) {
      operationOrder.push("append");
      if (failAppend) throw new Error("disk full");
      entries.push({ type, data });
      branch.push({ type: "custom", customType: type, data });
    },
  } as any;
  toolbeltExtension(pi);

  const context = () => ({
    cwd,
    hasUI: true,
    ui: { notify() {}, confirm: async () => true },
    sessionManager: { getBranch: () => branch },
  });

  return {
    registeredTools,
    commands,
    entries,
    operationOrder,
    get active() { return [...active]; },
    get setCalls() { return setCalls; },
    set failAppend(value: boolean) { failAppend = value; },
    set branch(value: any[]) { branch = value; },
    async start(reason = "new") {
      await events.get("session_start")?.({ reason }, context());
    },
    async command(args: string) {
      await commands.get("toolbelt").handler(args, context());
    },
  };
}

// ── Registered model tool workflow ──────────────────────────────

describe("registered model tool workflow", () => {
  it("query_tools returns active markers without mutating the active set", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read", "query_tools", MANAGE_TOOL_NAME],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    await harness.start();
    const before = harness.active;
    const setCallsBefore = harness.setCalls;
    const result = await harness.registeredTools
      .get("query_tools")
      .execute("call-1", { query: "browse websites" });

    assert.deepEqual(harness.active, before);
    assert.equal(harness.setCalls, setCallsBefore);
    assert.deepEqual(result.details.activeCounts, {
      before: before.length,
      after: before.length,
    });
    assert.ok(
      result.details.rankings.some(
        (ranking: any) =>
          ranking.name === "agent_browser" && ranking.active === false,
      ),
    );
    teardownTmp();
  });

  it("manage_tools persists before mutation and can deactivate both model tools", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read", "query_tools", MANAGE_TOOL_NAME],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    await harness.start();
    harness.operationOrder.length = 0;
    const manage = harness.registeredTools.get(MANAGE_TOOL_NAME);

    await manage.execute("call-2", {
      action: "activate",
      tools: ["agent_browser"],
    });
    assert.deepEqual(harness.operationOrder, ["append", "set"]);

    harness.operationOrder.length = 0;
    await manage.execute("call-3", {
      action: "deactivate",
      tools: ["query_tools"],
    });
    assert.equal(harness.active.includes("query_tools"), false);

    harness.operationOrder.length = 0;
    await manage.execute("call-4", {
      action: "deactivate",
      tools: [MANAGE_TOOL_NAME],
    });
    assert.equal(harness.active.includes(MANAGE_TOOL_NAME), false);
    teardownTmp();
  });

  it("uses configured baseline when no snapshot exists and exact snapshot on resume", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    await harness.start();
    assert.deepEqual(harness.active, ["read"]);

    harness.branch = [
      {
        type: "custom",
        customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
        data: { version: 1, active: ["agent_browser"] },
      },
    ];
    await harness.start("resume");
    assert.deepEqual(harness.active, ["agent_browser"]);
    teardownTmp();
  });

  it("reset persists configured baseline before applying it", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    await harness.start();
    await harness.registeredTools.get(MANAGE_TOOL_NAME).execute("call-5", {
      action: "activate",
      tools: ["agent_browser"],
    });
    harness.operationOrder.length = 0;

    await harness.command("reset");

    assert.deepEqual(harness.operationOrder, ["append", "set"]);
    assert.deepEqual(harness.active, ["read"]);
    assert.deepEqual(harness.entries.at(-1), {
      type: ACTIVE_TOOL_SNAPSHOT_ENTRY,
      data: { version: 1, active: ["read"] },
    });
    teardownTmp();
  });

  it("rejects unknown names and aborts on snapshot failure", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read", MANAGE_TOOL_NAME],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    await harness.start();
    harness.operationOrder.length = 0;
    const manage = harness.registeredTools.get(MANAGE_TOOL_NAME);

    await assert.rejects(
      manage.execute("call-6", {
        action: "activate",
        tools: ["missing_tool"],
      }),
      /Unknown registered tool names/,
    );
    assert.deepEqual(harness.operationOrder, []);

    const before = harness.active;
    harness.failAppend = true;
    await assert.rejects(
      manage.execute("call-7", {
        action: "activate",
        tools: ["agent_browser"],
      }),
      /no tools were changed: disk full/,
    );
    assert.deepEqual(harness.operationOrder, ["append"]);
    assert.deepEqual(harness.active, before);
    teardownTmp();
  });
});

// ── Discovery-only invariant ────────────────────────────────────

it("search ranking can be inspected without composing a new active set", () => {
  const sampleTools = [
    { name: "agent_browser", description: "Browse and interact with websites" },
    { name: "web_search", description: "Search the web" },
    { name: "read", description: "Read file contents" },
  ];
  const indexed = buildToolIndex(sampleTools);
  const engine = new SearchEngine(indexed);
  const results = engine.search("browse", 0.6, 5);
  const activeBefore = ["read", "query_tools"];
  const active = new Set(activeBefore);
  const discovery = results.map((result) => ({
    ...result,
    active: active.has(result.name),
  }));

  assert.deepEqual(activeBefore, ["read", "query_tools"]);
  assert.ok(
    discovery.some(
      (result) => result.name === "agent_browser" && result.active === false,
    ),
  );
});

// ── Phase 4: resume, reset, status lifecycle ──────────────────────

describe("Phase 4 lifecycle", () => {
  it("does not resurrect configured or management tools removed from the latest snapshot", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read", "query_tools", MANAGE_TOOL_NAME],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    await harness.start();
    const manage = harness.registeredTools.get(MANAGE_TOOL_NAME);
    await manage.execute("remove-read", {
      action: "deactivate",
      tools: ["read"],
    });
    await manage.execute("remove-query", {
      action: "deactivate",
      tools: ["query_tools"],
    });
    await manage.execute("remove-manage", {
      action: "deactivate",
      tools: [MANAGE_TOOL_NAME],
    });
    assert.deepEqual(harness.active, []);

    await harness.start("resume");
    assert.deepEqual(harness.active, []);
    teardownTmp();
  });

  it("setup persists and applies only registered default-baseline names", async () => {
    setupTmp();
    const harness = createExtensionHarness(tmpBase);
    await harness.command("setup project");
    assert.deepEqual(harness.operationOrder, ["append", "set"]);
    assert.deepEqual(harness.active, ["read", "query_tools", "manage_tools"]);
    assert.deepEqual(harness.entries.at(-1), {
      type: ACTIVE_TOOL_SNAPSHOT_ENTRY,
      data: { version: 1, active: ["read", "query_tools", "manage_tools"] },
    });
    teardownTmp();
  });

  it("uses configured registered baseline when resume has no snapshot", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read", "missing"],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    harness.branch = [];

    await harness.start("resume");

    assert.deepEqual(harness.active, ["read"]);
    teardownTmp();
  });

  it("filters unregistered names from the newest snapshot on resume", async () => {
    setupTmp();
    writeToolbeltConfig(join(tmpBase, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.8,
      topK: 5,
    });
    const harness = createExtensionHarness(tmpBase);
    harness.branch = [
      {
        type: "custom",
        customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
        data: { version: 1, active: ["agent_browser", "gone"] },
      },
    ];

    await harness.start("resume");
    assert.deepEqual(harness.active, ["agent_browser"]);
    teardownTmp();
  });
});
