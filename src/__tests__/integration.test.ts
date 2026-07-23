/**
 * Integration tests for the pi-toolbelt extension.
 *
 * Tests module interactions: config write/read round-trip, search pipeline
 * composition, disabled-mode guard, session resume with reset boundary.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeToolbeltConfig, readToolbeltConfig, isEnabled, hasConfigError } from "../config.js";
import { SearchEngine, buildToolIndex } from "../search.js";
import { applyBaseline, restoreFromBranch } from "../session.js";
import type { ToolbeltConfig, EffectiveConfig } from "../types.js";
import { DEFAULT_CONFIG, LOADER_TOOL_NAME } from "../constants.js";

const tmpBase = join(tmpdir(), `pi-toolbelt-int-${process.pid}`);

function setupTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });
}

function teardownTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
}

// ── Disabled mode invariant ──────────────────────────────────────

describe("Disabled mode invariant", () => {
  it("no config → isEnabled returns false → baseline not applied", () => {
    const effective: EffectiveConfig = {
      ...DEFAULT_CONFIG,
      source: "none",
      globalPath: "/tmp/nonexistent.json",
      projectPath: "/tmp/nonexistent.json",
      globalValid: false,
      projectValid: false,
    };

    assert.equal(isEnabled(effective), false);

    // Guard check: if isEnabled is false, applyBaseline should not be called
    let setActiveCalled = false;
    const mockPi = {
      setActiveTools: () => {
        setActiveCalled = true;
      },
      getActiveTools: () => [],
      getAllTools: () => [],
    } as any;

    if (isEnabled(effective)) {
      applyBaseline(mockPi, effective);
    }
    assert.equal(setActiveCalled, false, "setActiveTools must not be called when disabled");
  });

  it("config with errors → isEnabled returns false → hasConfigError returns true", () => {
    const effective: EffectiveConfig = {
      ...DEFAULT_CONFIG,
      source: "none",
      globalPath: "/tmp/bad.json",
      projectPath: "/tmp/bad.json",
      globalValid: false,
      projectValid: false,
      globalError: "Invalid JSON in /tmp/bad.json: Unexpected token",
    };

    assert.equal(isEnabled(effective), false);
    assert.equal(hasConfigError(effective), true);
  });

  it("valid global config → isEnabled returns true", () => {
    const effective: EffectiveConfig = {
      baseline: ["read", "bash"],
      threshold: 0.4,
      topK: 5,
      source: "global",
      globalPath: "/tmp/valid.json",
      projectPath: "/tmp/nonexistent.json",
      globalValid: true,
      projectValid: false,
    };

    assert.equal(isEnabled(effective), true);
    assert.equal(hasConfigError(effective), false);
  });
});

// ── Config write/read round-trip ─────────────────────────────────

describe("Config write/read round-trip", () => {
  it("writes then reads back identical config via explicit path", () => {
    setupTmp();
    const p = join(tmpBase, "toolbelt.json");
    const config: ToolbeltConfig = {
      baseline: ["read", "bash", "edit", "write"],
      threshold: 0.3,
      topK: 10,
    };

    writeToolbeltConfig(p, config);
    const result = readToolbeltConfig(p);

    assert.ok(result.config, "config must be read back");
    assert.equal(result.error, undefined, "no error on valid config");
    assert.deepEqual(result.config!.baseline, ["read", "bash", "edit", "write"]);
    assert.equal(result.config!.threshold, 0.3);
    assert.equal(result.config!.topK, 10);

    teardownTmp();
  });

  it("missing file returns undefined config without error", () => {
    const result = readToolbeltConfig("/tmp/nonexistent-toolbelt-test.json");
    assert.equal(result.config, undefined);
    assert.equal(result.error, undefined);
  });
});

// ── Search pipeline composition ──────────────────────────────────

describe("Search pipeline integration", () => {
  const SAMPLE_TOOLS = [
    { name: "agent_browser", description: "Browse and interact with websites using a headful browser" },
    { name: "web_search", description: "Search the web for current information" },
    { name: "read", description: "Read file contents" },
    { name: "bash", description: "Execute bash commands" },
    { name: "edit", description: "Edit files with text replacement" },
  ];

  it("buildToolIndex → SearchEngine → search returns ranked results", () => {
    const indexed = buildToolIndex(SAMPLE_TOOLS);
    assert.equal(indexed.length, SAMPLE_TOOLS.length);

    const engine = new SearchEngine(indexed);
    const results = engine.search("browse", 0.6, 5);

    assert.ok(results.length > 0, "should find browser-related tools");
    const names = results.map((r) => r.name);
    assert.ok(names.includes("agent_browser"), "agent_browser should rank high for 'browse'");
    for (const r of results) {
      assert.ok(r.score >= 0 && r.score <= 1, `score ${r.score} must be in [0,1]`);
    }
  });

  it("no-match query returns empty regardless of topK", () => {
    const indexed = buildToolIndex(SAMPLE_TOOLS);
    const engine = new SearchEngine(indexed);
    const results = engine.search("zzz_no_match_xyz", 0.8, 100);
    assert.equal(results.length, 0);
  });

  it("threshold filter works as expected with borderline scores", () => {
    const indexed = buildToolIndex(SAMPLE_TOOLS);
    const engine = new SearchEngine(indexed);

    // Strict threshold should return few/zero results
    const strict = engine.search("file", 0.1, 5);
    const lenient = engine.search("file", 0.6, 5);

    // Lenient should return at least as many as strict
    assert.ok(lenient.length >= strict.length);
  });

  it("search → additive activation produces correct active set", () => {
    const indexed = buildToolIndex(SAMPLE_TOOLS);
    const engine = new SearchEngine(indexed);

    // Simulate what index.ts does
    const results = engine.search("browse", 0.6, 5);
    const activeBefore = ["read", "bash", "edit", "write", "query_tools"];
    const matched = results.map((r) => r.name);
    const newSet = [...new Set([...activeBefore, ...matched])];
    const activated = matched.filter((n) => !activeBefore.includes(n));

    assert.ok(newSet.includes("agent_browser"), "agent_browser should be in new active set");
    assert.ok(activated.includes("agent_browser"), "agent_browser should be listed as activated");
    assert.ok(newSet.includes("read"), "baseline tools must be preserved");
  });

  it("catalog hash changes when tools change", () => {
    const indexed1 = buildToolIndex(SAMPLE_TOOLS);
    const engine = new SearchEngine(indexed1);
    const hash1 = engine.getCatalogHash();

    const modifiedTools = [...SAMPLE_TOOLS, { name: "new_tool", description: "Brand new tool" }];
    const indexed2 = buildToolIndex(modifiedTools);
    assert.ok(engine.refresh(indexed2), "refresh should detect change");
    assert.notEqual(engine.getCatalogHash(), hash1, "hash should differ after refresh");
  });
});

// ── Session resume ───────────────────────────────────────────────

describe("Session resume integration", () => {
  it("restoreFromBranch correctly reconstructs activated tools after reset boundary", () => {
    const mockPi = {
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
        { name: "web_search", description: "Search web" },
        { name: "grep", description: "Search files" },
      ],
    } as any;

    // Branch entries: oldest first (index 0), newest last
    const branch = [
      // index 0 — agent_browser activated (before reset)
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "query_tools",
          details: {
            query: "browser",
            backend: "fuse.js",
            rankings: [{ name: "agent_browser", score: 0.12 }],
            activated: ["agent_browser"],
            activeCounts: { before: 5, after: 6 },
            catalogHash: "abc",
          },
        },
      },
      // index 1 — reset marker
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "query_tools",
          details: {
            query: "/toolbelt reset",
            backend: "fuse.js",
            rankings: [],
            activated: [],
            activeCounts: { before: 6, after: 5 },
            catalogHash: "",
          },
        },
      },
      // index 2 — web_search activated (after reset, newest)
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "query_tools",
          details: {
            query: "web search",
            backend: "fuse.js",
            rankings: [{ name: "web_search", score: 0.1 }],
            activated: ["web_search"],
            activeCounts: { before: 5, after: 6 },
            catalogHash: "def",
          },
        },
      },
    ];

    const mockCtx = { sessionManager: { getBranch: () => branch } } as any;
    const result = restoreFromBranch(mockPi, mockCtx);

    // Should only restore web_search (after reset), not agent_browser (before reset)
    assert.deepEqual(
      result.sort(),
      ["web_search"],
      "should only restore tools activated after the most recent reset",
    );
  });

  it("restoreFromBranch works with no reset marker", () => {
    const mockPi = {
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
        { name: "grep", description: "Search files" },
      ],
    } as any;

    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "query_tools",
          details: {
            query: "browser",
            backend: "fuse.js",
            rankings: [{ name: "agent_browser", score: 0.12 }],
            activated: ["agent_browser"],
            activeCounts: { before: 5, after: 6 },
            catalogHash: "abc",
          },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "query_tools",
          details: {
            query: "find files",
            backend: "fuse.js",
            rankings: [{ name: "grep", score: 0.2 }],
            activated: ["grep"],
            activeCounts: { before: 6, after: 7 },
            catalogHash: "def",
          },
        },
      },
    ];

    const mockCtx = { sessionManager: { getBranch: () => branch } } as any;
    const result = restoreFromBranch(mockPi, mockCtx);

    assert.deepEqual(result.sort(), ["agent_browser", "grep"]);
  });
});

// ── Apply baseline + resume composition ──────────────────────────

describe("Baseline + resume composition", () => {
  it("applyBaseline then restoreFromBranch produces correct combined active set", () => {
    let activeSet: string[] = [];

    const mockPi = {
      setActiveTools(names: string[]) {
        activeSet = names;
      },
      getActiveTools: () => activeSet,
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
        { name: "grep", description: "Search files" },
      ],
    } as any;

    const effective: EffectiveConfig = {
      baseline: ["read", "bash", "edit", "write"],
      threshold: 0.4,
      topK: 5,
      source: "global",
      globalPath: "/tmp/a.json",
      projectPath: "/tmp/b.json",
      globalValid: true,
      projectValid: false,
    };

    // Phase 1: new session — apply baseline
    applyBaseline(mockPi, effective);
    assert.deepEqual(activeSet, ["read", "bash", "edit", "write", "query_tools"]);

    // Phase 2: resume — restore tools from branch and merge with baseline
    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "query_tools",
          details: {
            query: "browser",
            backend: "fuse.js",
            rankings: [{ name: "agent_browser", score: 0.12 }],
            activated: ["agent_browser"],
            activeCounts: { before: 5, after: 6 },
            catalogHash: "abc",
          },
        },
      },
    ];

    const mockCtx = { sessionManager: { getBranch: () => branch } } as any;
    const restored = restoreFromBranch(mockPi, mockCtx);
    const combined = [...new Set([...effective.baseline, LOADER_TOOL_NAME, ...restored])];
    mockPi.setActiveTools(combined);

    assert.ok(combined.includes("read"), "baseline tools preserved");
    assert.ok(combined.includes("query_tools"), "loader tool always present");
    assert.ok(combined.includes("agent_browser"), "restored tools included");
    assert.equal(combined.length, 6, "total: 4 baseline + query_tools + 1 restored");
  });
});
