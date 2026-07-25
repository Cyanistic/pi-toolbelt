/**
 * Session unit tests for snapshot, discovery-receipt, and filtering helpers.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterRegisteredTools,
  isActiveToolSnapshot,
  isDiscoveryReceipt,
  persistActiveTools,
  restoreActiveToolSnapshot,
} from "../session.js";
import { ACTIVE_TOOL_SNAPSHOT_ENTRY } from "../constants.js";

const registered = ["read", "query_tools", "manage_tools", "agent_browser"];
const tools = () => registered.map((name) => ({ name, description: name }));

// ── active-set snapshots ─────────────────────────────────────────

describe("active-set snapshots", () => {
  it("validates snapshot version and string names", () => {
    assert.equal(isActiveToolSnapshot({ version: 1, active: ["read"] }), true);
    assert.equal(isActiveToolSnapshot({ version: 1, active: [] }), true);
    assert.equal(isActiveToolSnapshot({ version: 2, active: ["read"] }), false);
    assert.equal(isActiveToolSnapshot({ version: 1, active: [7] }), false);
    assert.equal(isActiveToolSnapshot(null), false);
    assert.equal(isActiveToolSnapshot({ version: 1, active: "read" }), false);
  });

  it("filters unknown names and preserves requested order", () => {
    assert.deepEqual(
      filterRegisteredTools(
        { getAllTools: tools } as any,
        ["manage_tools", "missing", "read", "read"],
      ),
      ["manage_tools", "read"],
    );
  });

  it("persists before replacing and aborts on persistence failure", () => {
    const order: string[] = [];
    let active = ["read"];
    const pi = {
      getAllTools: tools,
      getActiveTools: () => [...active],
      appendEntry() {
        order.push("append");
      },
      setActiveTools(names: string[]) {
        order.push("set");
        active = names;
      },
    } as any;
    persistActiveTools(pi, ["agent_browser"]);
    assert.deepEqual(order, ["append", "set"]);
    assert.deepEqual(active, ["agent_browser"]);

    let setCalls = 0;
    const failing = {
      getAllTools: tools,
      getActiveTools: () => ["read"],
      appendEntry() {
        throw new Error("disk full");
      },
      setActiveTools() {
        setCalls++;
      },
    } as any;
    assert.throws(() => persistActiveTools(failing, []), /disk full/);
    assert.equal(setCalls, 0);
  });

  it("restores the newest valid snapshot, including an exact empty set", () => {
    const pi = { getAllTools: tools } as any;
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
            data: { version: 1, active: ["read"] },
          },
          {
            type: "custom",
            customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
            data: { version: 1, active: [] },
          },
        ],
      },
    } as any;
    assert.deepEqual(restoreActiveToolSnapshot(pi, ctx), []);
  });

  it("skips malformed snapshots and filters removed registrations", () => {
    const pi = { getAllTools: tools } as any;
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
            data: { version: 1, active: ["agent_browser", "gone"] },
          },
          {
            type: "custom",
            customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
            data: { version: 2, active: ["read"] },
          },
        ],
      },
    } as any;
    assert.deepEqual(restoreActiveToolSnapshot(pi, ctx), ["agent_browser"]);
  });

  it("ignores a complete legacy search receipt", () => {
    const pi = { getAllTools: tools } as any;
    const ctx = {
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
                rankings: [{ name: "agent_browser", score: 0.1 }],
                activated: ["agent_browser"],
                activeCounts: { before: 1, after: 2 },
                catalogHash: "hash",
              },
            },
          },
        ],
      },
    } as any;
    assert.equal(restoreActiveToolSnapshot(pi, ctx), undefined);
  });
});

// ── isDiscoveryReceipt ────────────────────────────────────────────

describe("isDiscoveryReceipt", () => {
  it("accepts rankings with active markers", () => {
    assert.equal(
      isDiscoveryReceipt({
        query: "browser",
        backend: "fuse.js",
        rankings: [{ name: "agent_browser", score: 0.1, active: false }],
        activeCounts: { before: 1, after: 1 },
        catalogHash: "hash",
      }),
      true,
    );
  });

  it("rejects null, primitives, and arrays", () => {
    assert.equal(isDiscoveryReceipt(null), false);
    assert.equal(isDiscoveryReceipt("string"), false);
    assert.equal(isDiscoveryReceipt([]), false);
  });

  it("rejects legacy mutation receipts without active field", () => {
    assert.equal(
      isDiscoveryReceipt({
        query: "browser",
        backend: "fuse.js",
        rankings: [{ name: "agent_browser", score: 0.1 }],
        activated: ["agent_browser"],
        activeCounts: { before: 1, after: 2 },
        catalogHash: "hash",
      }),
      false,
    );
  });

  it("rejects missing query field", () => {
    assert.equal(
      isDiscoveryReceipt({
        backend: "fuse.js",
        rankings: [{ name: "agent_browser", score: 0.1, active: false }],
        activeCounts: { before: 1, after: 1 },
        catalogHash: "hash",
      }),
      false,
    );
  });

  it("rejects missing activeCounts.before", () => {
    assert.equal(
      isDiscoveryReceipt({
        query: "browser",
        backend: "fuse.js",
        rankings: [{ name: "agent_browser", score: 0.1, active: false }],
        activeCounts: { after: 1 },
        catalogHash: "hash",
      }),
      false,
    );
  });
});
