/**
 * Session unit tests.
 *
 * Tests isSearchReceipt type guard, applyBaseline, and restoreFromBranch
 * branch-scanning logic including reset-marker boundary.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSearchReceipt, applyBaseline, restoreFromBranch } from "../session.js";
import type { SearchReceipt, EffectiveConfig } from "../types.js";

// ── isSearchReceipt ──────────────────────────────────────────────

describe("isSearchReceipt", () => {
  it("returns false for null", () => {
    assert.equal(isSearchReceipt(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isSearchReceipt(undefined), false);
  });

  it("returns false for primitive values", () => {
    assert.equal(isSearchReceipt("string"), false);
    assert.equal(isSearchReceipt(42), false);
    assert.equal(isSearchReceipt(true), false);
  });

  it("returns false for array", () => {
    assert.equal(isSearchReceipt([]), false);
  });

  it("rejects object missing query field", () => {
    assert.equal(
      isSearchReceipt({
        backend: "fuse.js",
        rankings: [],
        activated: [],
        activeCounts: { before: 5, after: 7 },
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects non-string query", () => {
    assert.equal(
      isSearchReceipt({
        query: 123,
        backend: "fuse.js",
        rankings: [],
        activated: [],
        activeCounts: { before: 5, after: 7 },
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects non-string backend", () => {
    assert.equal(
      isSearchReceipt({
        query: "test",
        backend: 123,
        rankings: [],
        activated: [],
        activeCounts: { before: 5, after: 7 },
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects non-array rankings", () => {
    assert.equal(
      isSearchReceipt({
        query: "test",
        backend: "fuse.js",
        rankings: "not-array",
        activated: [],
        activeCounts: { before: 5, after: 7 },
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects non-array activated", () => {
    assert.equal(
      isSearchReceipt({
        query: "test",
        backend: "fuse.js",
        rankings: [],
        activated: "not-array",
        activeCounts: { before: 5, after: 7 },
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects missing activeCounts", () => {
    assert.equal(
      isSearchReceipt({
        query: "test",
        backend: "fuse.js",
        rankings: [],
        activated: [],
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects non-number activeCounts.before", () => {
    assert.equal(
      isSearchReceipt({
        query: "test",
        backend: "fuse.js",
        rankings: [],
        activated: [],
        activeCounts: { before: "5", after: 7 },
        catalogHash: "abc",
      }),
      false,
    );
  });

  it("rejects non-string catalogHash", () => {
    assert.equal(
      isSearchReceipt({
        query: "test",
        backend: "fuse.js",
        rankings: [],
        activated: [],
        activeCounts: { before: 5, after: 7 },
        catalogHash: 123,
      }),
      false,
    );
  });

  it("accepts valid SearchReceipt", () => {
    const receipt: SearchReceipt = {
      query: "browser automation",
      backend: "fuse.js",
      rankings: [{ name: "agent_browser", score: 0.12 }],
      activated: ["agent_browser"],
      activeCounts: { before: 5, after: 6 },
      catalogHash: "abc123",
    };
    assert.equal(isSearchReceipt(receipt), true);
  });
});

// ── applyBaseline ────────────────────────────────────────────────

describe("applyBaseline", () => {
  it("applies baseline plus query_tools and returns active set", () => {
    let calledWith: string[] | null = null;
    const mockPi = {
      setActiveTools(names: string[]) {
        calledWith = names;
      },
      getActiveTools: () => [],
      getAllTools: () => [],
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

    const result = applyBaseline(mockPi, effective);
    assert.deepEqual(calledWith, [
      "read",
      "bash",
      "edit",
      "write",
      "query_tools",
    ]);
    assert.deepEqual(result, [
      "read",
      "bash",
      "edit",
      "write",
      "query_tools",
    ]);
  });
});

// ── restoreFromBranch ────────────────────────────────────────────

describe("restoreFromBranch", () => {
  it("restores tools from query_tools receipts", () => {
    const mockPi = {
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
        { name: "grep", description: "Search files" },
      ],
    } as any;

    const mockCtx = {
      sessionManager: {
        getBranch: () => [
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
        ],
      },
    } as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    assert.deepEqual(result, ["agent_browser"]);
  });

  it("stops at reset marker (does not restore tools from before reset)", () => {
    const mockPi = {
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
        { name: "web_search", description: "Search web" },
      ],
    } as any;

    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          // index 0 — agent_browser activated (oldest)
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
          // index 2 — web_search activated after reset (newest)
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
        ],
      },
    } as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    // Should only restore web_search (after reset), not agent_browser (before reset)
    assert.deepEqual(result, ["web_search"]);
  });

  it("skips entries with wrong toolName", () => {
    const mockPi = {
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
      ],
    } as any;

    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "other_tool", // not query_tools
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
        ],
      },
    } as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    assert.deepEqual(result, []);
  });

  it("filters out tools that are no longer registered", () => {
    const mockPi = {
      // only agent_browser is still registered
      getAllTools: () => [
        { name: "agent_browser", description: "Browse" },
      ],
    } as any;

    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "query_tools",
              details: {
                query: "tools",
                backend: "fuse.js",
                rankings: [
                  { name: "agent_browser", score: 0.12 },
                  { name: "deprecated_tool", score: 0.3 },
                ],
                activated: ["agent_browser", "deprecated_tool"],
                activeCounts: { before: 5, after: 7 },
                catalogHash: "abc",
              },
            },
          },
        ],
      },
    } as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    assert.deepEqual(result, ["agent_browser"]); // deprecated_tool filtered out
  });

  it("returns empty when branch has no query_tools receipts", () => {
    const mockPi = {
      getAllTools: () => [],
    } as any;

    const mockCtx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "some_other_tool",
              details: {},
            },
          },
        ],
      },
    } as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    assert.deepEqual(result, []);
  });

  it("handles empty branch", () => {
    const mockPi = {
      getAllTools: () => [],
    } as any;

    const mockCtx = {
      sessionManager: {
        getBranch: () => [],
      },
    } as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    assert.deepEqual(result, []);
  });

  it("handles missing sessionManager gracefully", () => {
    const mockPi = {
      getAllTools: () => [],
    } as any;

    const mockCtx = {} as any;

    const result = restoreFromBranch(mockPi, mockCtx);
    assert.deepEqual(result, []);
  });
});
