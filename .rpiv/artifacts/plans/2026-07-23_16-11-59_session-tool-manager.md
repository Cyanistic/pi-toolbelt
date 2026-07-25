---
date: 2026-07-23T16:11:59-0400
author: Cyanism
commit: d18893c
branch: main
repository: pi-toolbelt
topic: "Session Tool Manager"
tags: [plan, session-tools, tool-activation, tui, snapshots]
status: ready
parent: .rpiv/artifacts/research/2026-07-23_15-45-10_session-tool-manager.md
phase_count: 4
phases:
  - { n: 1, title: Exact Active-Set Snapshots }
  - { n: 2, title: Discovery and Model Control }
  - { n: 3, title: Atomic Interactive Tool Modal }
  - { n: 4, title: Resume, Reset, Status, and Documentation }
unresolved_phase_count: 0
last_updated: 2026-07-23T16:11:59-0400
last_updated_by: Cyanism
---

# Session Tool Manager Implementation Plan

## Overview

Separate tool discovery from active-set mutation. `query_tools` will return ranked candidates with current active state, `manage_tools` will perform explicit model-side activation or deactivation, and `/toolbelt tools` will open a keyboard-driven modal that stages changes before one persisted active-set replacement.

Durable custom session entries will store complete active-name snapshots. The newest valid snapshot is authoritative on resume, while sessions without snapshots restart from the configured baseline. No tool is protected or force-added: configured and explicitly selected membership is preserved exactly after filtering out names that are no longer registered.

## Requirements

- `query_tools` discovers ranked registered tools without calling `pi.setActiveTools()`.
- Discovery results include name, score, and current active state with unchanged before/after counts.
- `manage_tools` accepts one `activate` or `deactivate` action plus a list of registered tool names.
- Model and user mutations persist a full active-set snapshot before changing Pi's active tools.
- Persistence failure aborts mutation and returns or displays an actionable error.
- `/toolbelt tools` lists every registered tool with a text active marker, name, and description.
- The modal supports keyboard navigation, text filtering, staged toggles, explicit confirm, and cancellation.
- The modal is read-only without valid Toolbelt configuration and directs the user to setup.
- Neither `query_tools` nor `manage_tools` is protected; both can be activated or deactivated like any registered tool.
- New session and reset membership comes only from the effective configured baseline.
- Resume restores the newest valid snapshot exactly after filtering unregistered names.
- `/toolbelt status` prints active tool names.
- `/toolbelt reset` persists and applies the effective configured baseline atomically.
- Modal filtering over a deterministic 100-tool fixture remains below 100 ms p95.
- Type checking and all node:test suites pass.

## Current State Analysis

`query_tools` currently combines Fuse discovery and additive activation in one inline tool execution. Session restoration unions `SearchReceipt.activated` values and reset relies on a best-effort synthetic receipt marker. Commands expose counts but not the exact active names, and there is no interactive tool-selection surface.

### Key Discoveries

- `src/index.ts:124-218` performs discovery and then immediately merges matches into `pi.getActiveTools()`.
- `src/session.ts:53-90` scans old search receipts backward and unions additions, so it cannot represent removals.
- `src/commands.ts:305-334` mutates before best-effort persistence; a failed marker can resurrect reset tools.
- `src/commands.ts:217-253` already reads active and registered tools but reports only counts.
- `src/index.ts:36-121` provides the existing completion-tree, command-dispatch, and closure-config wiring to extend.
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/tools.ts:17-126` is the closest built-in tool-selector precedent, including custom-entry restore and `ctx.ui.custom()`, but it applies every toggle immediately and therefore does not meet atomic staging.
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts:49-230` shows keyboard input, cached rendering, and custom component completion.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:67-132` exposes `ctx.ui.custom()` with overlay support.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:900-922` exposes required `appendEntry()`, `getAllTools()`, `getActiveTools()`, and `setActiveTools()` APIs.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:65-69` defines durable custom entries as `{ type: "custom", customType, data }`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:1094-1099` confirms `ToolInfo` has name and description but no registration label.

## Desired End State

```typescript
// Discovery never mutates the active set.
const discovery = await queryTools({ query: "browser automation" });
// discovery.rankings => [{ name: "agent_browser", score: 0.08, active: false }]

// The model explicitly performs one direction per atomic mutation.
await manageTools({ action: "activate", tools: ["agent_browser"] });
await manageTools({ action: "deactivate", tools: ["query_tools"] });

// The user can always manage the same registered catalog through the command.
/toolbelt tools
// Type to filter, Up/Down to navigate, Space to stage a toggle,
// Enter to persist and apply once, Esc to cancel without mutation.

// Resume restores the latest persisted membership exactly.
// Snapshot: ["read", "agent_browser"]
// Registered now: ["read", "agent_browser", "query_tools", "manage_tools"]
// Restored active set: ["read", "agent_browser"]
```

## What We're NOT Doing

- No visual editor for global or project `toolbelt.json`; document it as roadmap work only.
- No footer, status-bar widget, or persistent side panel.
- No automatic pruning or usage-based policy.
- No allowlist, denylist, authorization, or tool execution inside Toolbelt.
- No activation-origin claims; Pi exposes current membership but not why a tool is active.
- No forced/protected management tools. The user may disable `query_tools` and `manage_tools`.
- No legacy receipt replay when a pre-feature session lacks an active-set snapshot.
- No remote search, embeddings, or changes to Fuse configuration.

## Decisions

### Complete snapshots replace activation history

`SearchReceipt.activated` cannot encode removals (`src/session.ts:53-90`). Every confirmed mutation will append a versioned custom entry containing the complete active-name array before calling `pi.setActiveTools()`. Resume uses the newest valid snapshot.

### No protected or force-added tools

The earlier protected-loader direction was explicitly revised during the blueprint checkpoint. `query_tools` and `manage_tools` are normal registered tools: new session and reset use only effective configured baseline names; modal and model mutations may remove either tool.

### One model-side mutation direction per call

**Ambiguity:** the new management tool could accept simultaneous activation and deactivation arrays or one action plus names.

**Explored:**
- `manage_tools({ activate, deactivate })` supports a one-call swap but needs overlap validation and a larger conditional schema.
- `manage_tools({ action, tools })` has one unambiguous operation per call and matches the developer's chosen smaller contract, at the cost of two persisted calls for a swap.

**Decision:** use `manage_tools({ action: "activate" | "deactivate", tools: string[] })`.

### Legacy sessions restart from baseline

When no valid snapshot exists, resume ignores historical `SearchReceipt.activated` entries and applies the effective configured baseline. This is a deliberate migration boundary rather than replaying the superseded additive model.

### Modal state is staged and testable independently

The modal keeps filter text, selected index, and staged membership in local deterministic state. Rendering and input handling wrap those transitions; only Enter confirmation returns a final set. Escape returns cancellation and causes no append or active-set mutation.

### Direct Pi TUI dependency

The modal imports component and keyboard utilities from `@earendil-works/pi-tui`, matching Pi's own extension examples. The package will declare the dependency directly rather than rely on the coding-agent package's nested transitive installation.

## Phase 1: Exact Active-Set Snapshots

### Overview

Introduce versioned active-set snapshots and a persistence-first transaction helper alongside the legacy lifecycle functions. Foundation phase; all later phases depend on it, while Phase 4 switches the existing baseline and receipt consumers atomically.

### Changes Required:

#### 1. src/types.ts:after line 48

**File**: src/types.ts
**Changes**: MODIFY — ADD the snapshot and mutation types after the existing interfaces; do not replace `ToolRanking`, `SearchBackend`, `SearchReceipt`, or `ConfigSource` in this phase

```typescript
/** Complete active-set state persisted in a custom session entry. */
export interface ActiveToolSnapshot {
  version: 1;
  active: string[];
}

/** Observable result of one persisted active-set replacement. */
export interface ActiveToolChange {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}
```

#### 2. src/constants.ts:7-17

**File**: src/constants.ts
**Changes**: MODIFY — add model-management and snapshot constants

```typescript
/** The explicit model-facing active-set management tool. */
export const MANAGE_TOOL_NAME = "manage_tools";

/** Custom session entry used for complete active-set snapshots. */
export const ACTIVE_TOOL_SNAPSHOT_ENTRY = "toolbelt-active-set";

/** Current persisted active-set snapshot schema version. */
export const ACTIVE_TOOL_SNAPSHOT_VERSION = 1 as const;
```

#### 3. src/session.ts:12-116

**File**: src/session.ts
**Changes**: MODIFY — add registered filtering, persistence-first mutation, snapshot restore, and snapshot validation without replacing legacy consumers yet

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_TOOL_SNAPSHOT_ENTRY,
  ACTIVE_TOOL_SNAPSHOT_VERSION,
  LOADER_TOOL_NAME,
} from "./constants.js";
import type {
  ActiveToolChange,
  ActiveToolSnapshot,
  EffectiveConfig,
  SearchReceipt,
} from "./types.js";

/** Keep requested order, remove duplicates, and enforce Pi's registration boundary. */
export function filterRegisteredTools(
  pi: Pick<ExtensionAPI, "getAllTools">,
  names: readonly string[],
): string[] {
  const registered = new Set(pi.getAllTools().map((tool) => tool.name));
  return [...new Set(names)].filter((name) => registered.has(name));
}

/**
 * Persist the complete final set before replacing Pi's active tools.
 * appendEntry is synchronous and required by ExtensionAPI; a thrown write
 * aborts before setActiveTools is reached.
 */
export function persistActiveTools(
  pi: ExtensionAPI,
  requested: readonly string[],
): ActiveToolChange {
  const before = pi.getActiveTools();
  const after = filterRegisteredTools(pi, requested);
  const snapshot: ActiveToolSnapshot = {
    version: ACTIVE_TOOL_SNAPSHOT_VERSION,
    active: after,
  };

  pi.appendEntry(ACTIVE_TOOL_SNAPSHOT_ENTRY, snapshot);
  pi.setActiveTools(after);

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    before,
    after,
    added: after.filter((name) => !beforeSet.has(name)),
    removed: before.filter((name) => !afterSet.has(name)),
  };
}

/** Return the newest valid branch snapshot, or undefined when none exists. */
export function restoreActiveToolSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string[] | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (
      entry.type !== "custom" ||
      entry.customType !== ACTIVE_TOOL_SNAPSHOT_ENTRY ||
      !isActiveToolSnapshot(entry.data)
    ) {
      continue;
    }
    return filterRegisteredTools(pi, entry.data.active);
  }

  return undefined;
}

/** Validate a versioned full active-set snapshot. */
export function isActiveToolSnapshot(
  value: unknown,
): value is ActiveToolSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.version === ACTIVE_TOOL_SNAPSHOT_VERSION &&
    Array.isArray(snapshot.active) &&
    snapshot.active.every((name) => typeof name === "string")
  );
}
```

#### 4. src/__tests__/session.test.ts:1-357

**File**: src/__tests__/session.test.ts
**Changes**: MODIFY — extend existing receipt/baseline tests with snapshot validation, filtering, ordering, failure, and newest-valid restore coverage

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBaseline,
  filterRegisteredTools,
  isActiveToolSnapshot,
  isSearchReceipt,
  persistActiveTools,
  restoreActiveToolSnapshot,
  restoreFromBranch,
} from "../session.js";
import type { SearchReceipt, EffectiveConfig } from "../types.js";
import { ACTIVE_TOOL_SNAPSHOT_ENTRY } from "../constants.js";

const SNAPSHOT_REGISTERED = [
  "read",
  "bash",
  "query_tools",
  "manage_tools",
  "agent_browser",
];
const snapshotTools = () =>
  SNAPSHOT_REGISTERED.map((name) => ({ name, description: name }));

describe("isActiveToolSnapshot", () => {
  it("accepts version 1 snapshots containing only string names", () => {
    assert.equal(isActiveToolSnapshot({ version: 1, active: ["read", "bash"] }), true);
    assert.equal(isActiveToolSnapshot({ version: 1, active: [] }), true);
  });

  it("rejects malformed and unsupported snapshots", () => {
    assert.equal(isActiveToolSnapshot(null), false);
    assert.equal(isActiveToolSnapshot({ version: 2, active: ["read"] }), false);
    assert.equal(isActiveToolSnapshot({ version: 1, active: ["read", 7] }), false);
    assert.equal(isActiveToolSnapshot({ version: 1, active: "read" }), false);
  });
});

describe("filterRegisteredTools", () => {
  it("keeps requested order while removing duplicates and unknown names", () => {
    const pi = { getAllTools: snapshotTools } as any;
    assert.deepEqual(
      filterRegisteredTools(pi, ["bash", "missing", "read", "bash"]),
      ["bash", "read"],
    );
  });
});

describe("persistActiveTools", () => {
  it("appends the final snapshot before one active-set replacement", () => {
    const calls: string[] = [];
    let entry: { type: string; data: unknown } | undefined;
    let active = ["read", "query_tools"];
    const pi = {
      getAllTools: snapshotTools,
      getActiveTools: () => [...active],
      appendEntry(type: string, data: unknown) {
        calls.push("append");
        entry = { type, data };
      },
      setActiveTools(names: string[]) {
        calls.push("set");
        active = names;
      },
    } as any;

    const change = persistActiveTools(pi, ["read", "manage_tools", "missing"]);

    assert.deepEqual(calls, ["append", "set"]);
    assert.deepEqual(entry, {
      type: ACTIVE_TOOL_SNAPSHOT_ENTRY,
      data: { version: 1, active: ["read", "manage_tools"] },
    });
    assert.deepEqual(change, {
      before: ["read", "query_tools"],
      after: ["read", "manage_tools"],
      added: ["manage_tools"],
      removed: ["query_tools"],
    });
  });

  it("does not mutate when snapshot persistence throws", () => {
    let setCalls = 0;
    const pi = {
      getAllTools: snapshotTools,
      getActiveTools: () => ["read"],
      appendEntry() { throw new Error("disk full"); },
      setActiveTools() { setCalls++; },
    } as any;

    assert.throws(() => persistActiveTools(pi, ["bash"]), /disk full/);
    assert.equal(setCalls, 0);
  });
});

describe("restoreActiveToolSnapshot", () => {
  it("uses the newest valid snapshot and filters unregistered names", () => {
    const branch = [
      {
        type: "custom",
        customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
        data: { version: 1, active: ["read", "query_tools"] },
      },
      {
        type: "custom",
        customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
        data: { version: 1, active: ["agent_browser", "removed_tool"] },
      },
    ];
    const pi = { getAllTools: snapshotTools } as any;
    const ctx = { sessionManager: { getBranch: () => branch } } as any;

    assert.deepEqual(restoreActiveToolSnapshot(pi, ctx), ["agent_browser"]);
  });

  it("skips malformed newer entries and returns undefined without a snapshot", () => {
    const pi = { getAllTools: snapshotTools } as any;
    const malformed = {
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: ACTIVE_TOOL_SNAPSHOT_ENTRY,
            data: { version: 2, active: ["read"] },
          },
        ],
      },
    } as any;
    const empty = { sessionManager: { getBranch: () => [] } } as any;

    assert.equal(restoreActiveToolSnapshot(pi, malformed), undefined);
    assert.equal(restoreActiveToolSnapshot(pi, empty), undefined);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Snapshot/session unit tests pass with legacy behavior still intact: `npx tsx --test src/__tests__/session.test.ts`
- [x] Persistence is ordered before mutation: `grep -n "appendEntry\|setActiveTools" src/session.ts` shows `appendEntry` first inside `persistActiveTools`
- [x] Snapshot restoration scans custom entries: `grep -A20 "restoreActiveToolSnapshot" src/session.ts | grep 'entry.type !== "custom"'` returns one match

#### Manual Verification:
- [ ] Inspect `persistActiveTools` and confirm no tool name is force-added to the requested registered set.

## Phase 2: Discovery and Model Control

### Overview

Make `query_tools` discovery-only, register explicit one-direction `manage_tools` mutations, and atomically switch every existing active-set producer and lifecycle consumer to Phase 1's snapshot transaction. Depends on Phase 1.

### Changes Required:

#### 5. src/types.ts:24-65

**File**: src/types.ts
**Changes**: MODIFY — add active state to discovery results and define model mutation receipt details

```typescript
/** A ranked discovery result annotated with current active membership. */
export interface ToolDiscoveryResult extends ToolRanking {
  active: boolean;
}

/** Discovery-only receipt persisted in query_tools result details. */
export interface DiscoveryReceipt {
  query: string;
  backend: string;
  rankings: ToolDiscoveryResult[];
  activeCounts: { before: number; after: number };
  catalogHash: string;
}

export type ToolManagementAction = "activate" | "deactivate";

/** Details returned by one explicit model-side active-set mutation. */
export interface ToolManagementReceipt extends ActiveToolChange {
  action: ToolManagementAction;
  requested: string[];
}
```

#### 6. src/index.ts:17-310

**File**: src/index.ts
**Changes**: MODIFY (incremental) — preserve existing `SearchEngine`/`buildToolIndex`, config, and command imports plus the factory's `searchEngine`/`currentEffectiveConfig` declarations; replace the tool registrations and session-start body shown below

```typescript
import {
  BACKEND_ID,
  COMMAND_NAME,
  FLAG_DEBUG,
  LOADER_TOOL_NAME,
  MANAGE_TOOL_NAME,
} from "./constants.js";
import type {
  DiscoveryReceipt,
  ToolDiscoveryResult,
  ToolManagementAction,
  ToolManagementReceipt,
  ToolRanking,
} from "./types.js";
import {
  filterRegisteredTools,
  persistActiveTools,
  restoreActiveToolSnapshot,
} from "./session.js";

function annotateActiveState(
  rankings: ToolRanking[],
  activeNames: readonly string[],
): ToolDiscoveryResult[] {
  const active = new Set(activeNames);
  return rankings.map((ranking) => ({
    ...ranking,
    active: active.has(ranking.name),
  }));
}

function formatDiscoveryResults(rankings: ToolDiscoveryResult[]): string {
  return rankings
    .map(
      ({ name, score, active }) =>
        `${name} (${active ? "active" : "inactive"}, ${score.toFixed(3)})`,
    )
    .join(", ");
}

pi.registerTool({
  name: LOADER_TOOL_NAME,
  label: "Query Tools",
  description:
    "Discover registered tools by capability without changing the active set. " +
    `Results include current active state. Use ${MANAGE_TOOL_NAME} to activate or deactivate exact names.\n\n` +
    "HOW TO USE: describe a concrete capability or task. Do not ask to list every tool; " +
    "search by capability and broaden the query if no result clears the configured threshold.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Concrete capability or task to find a registered tool for, such as web search or PDF reading",
      },
    },
    required: ["query"],
  },
  async execute(_toolCallId, params) {
    const query = String(params.query ?? "");
    const active = pi.getActiveTools();

    if (!currentEffectiveConfig) {
      return {
        content: [
          {
            type: "text",
            text:
              "Toolbelt is not yet configured. " +
              "Run /toolbelt setup to enable tool discovery.",
          },
        ],
        details: {
          query,
          backend: BACKEND_ID,
          rankings: [],
          activeCounts: { before: active.length, after: active.length },
          catalogHash: "",
        } satisfies DiscoveryReceipt,
      };
    }

    const { threshold, topK } = currentEffectiveConfig;
    const indexed = buildToolIndex(pi.getAllTools());
    if (!searchEngine) {
      searchEngine = new SearchEngine(indexed);
    } else {
      searchEngine.refresh(indexed);
    }

    const ranked = searchEngine.search(query, threshold, topK);
    if (ranked.length === 0) {
      const nearMisses = annotateActiveState(
        searchEngine.search(query, 1.0, topK),
        active,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `No tools matched "${query}" above threshold ${threshold}. ` +
              (nearMisses.length > 0
                ? `Near misses: ${formatDiscoveryResults(nearMisses)}`
                : "No ranking results found."),
          },
        ],
        details: {
          query,
          backend: BACKEND_ID,
          rankings: nearMisses,
          activeCounts: { before: active.length, after: active.length },
          catalogHash: searchEngine.getCatalogHash(),
        } satisfies DiscoveryReceipt,
      };
    }

    const rankings = annotateActiveState(ranked, active);
    return {
      content: [
        {
          type: "text",
          text:
            `Matching registered tools: ${formatDiscoveryResults(rankings)}. ` +
            `Use ${MANAGE_TOOL_NAME} with an exact tool name to change membership.`,
        },
      ],
      details: {
        query,
        backend: BACKEND_ID,
        rankings,
        activeCounts: { before: active.length, after: active.length },
        catalogHash: searchEngine.getCatalogHash(),
      } satisfies DiscoveryReceipt,
    };
  },
});

pi.registerTool({
  name: MANAGE_TOOL_NAME,
  label: "Manage Tools",
  description:
    "Activate or deactivate registered Pi tools by exact name. Performs one direction per call, " +
    "persists the complete final active set before applying it, and never executes the target tools. " +
    "Any registered tool, including query_tools and manage_tools, may be deactivated.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["activate", "deactivate"],
        description: "Whether to activate or deactivate every supplied tool name",
      },
      tools: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "One or more exact registered tool names",
      },
    },
    required: ["action", "tools"],
  },
  async execute(_toolCallId, params) {
    if (!currentEffectiveConfig) {
      throw new Error(
        "Toolbelt is not configured. Run /toolbelt setup before changing active tools.",
      );
    }

    const action = String(params.action ?? "") as ToolManagementAction;
    if (action !== "activate" && action !== "deactivate") {
      throw new Error(`Invalid tool-management action: ${String(params.action)}`);
    }

    const requested = Array.isArray(params.tools)
      ? [...new Set(params.tools.filter((name): name is string => typeof name === "string"))]
      : [];
    if (requested.length === 0) {
      throw new Error("At least one exact registered tool name is required.");
    }

    const registered = new Set(pi.getAllTools().map((tool) => tool.name));
    const unknown = requested.filter((name) => !registered.has(name));
    if (unknown.length > 0) {
      throw new Error(`Unknown registered tool names: ${unknown.join(", ")}`);
    }

    const before = pi.getActiveTools();
    const requestedSet = new Set(requested);
    const target =
      action === "activate"
        ? [...new Set([...before, ...requested])]
        : before.filter((name) => !requestedSet.has(name));

    let change;
    try {
      change = persistActiveTools(pi, target);
    } catch (error) {
      throw new Error(
        `Failed to persist active-tool snapshot; no tools were changed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const changed = action === "activate" ? change.added : change.removed;
    return {
      content: [
        {
          type: "text",
          text:
            changed.length > 0
              ? `${action === "activate" ? "Activated" : "Deactivated"}: ${changed.join(", ")}. ` +
                `Active tools: ${change.after.join(", ") || "(none)"}.`
              : `No tools changed. Active tools: ${change.after.join(", ") || "(none)"}.`,
        },
      ],
      details: {
        action,
        requested,
        ...change,
      } satisfies ToolManagementReceipt,
    };
  },
});

pi.on("session_start", async (event, ctx) => {
  const effective = buildEffectiveConfig(ctx.cwd);
  const debug = !!pi.getFlag(FLAG_DEBUG);

  if (hasConfigError(effective)) {
    const errors = [effective.globalError, effective.projectError].filter(
      (error): error is string => typeof error === "string",
    );
    ctx.ui.notify(`[toolbelt] ${errors.join("; ")}`, "warning");
  }

  if (!isEnabled(effective)) {
    currentEffectiveConfig = null;
    if (debug) {
      ctx.ui.notify("[toolbelt] disabled - no valid config found", "info");
    }
    return;
  }

  currentEffectiveConfig = effective;
  const isResume =
    event &&
    typeof event === "object" &&
    "reason" in event &&
    (event as { reason: string }).reason === "resume";
  const configuredBaseline = filterRegisteredTools(pi, effective.baseline);
  const restored = isResume ? restoreActiveToolSnapshot(pi, ctx) : undefined;
  const active = restored ?? configuredBaseline;
  pi.setActiveTools(active);

  if (debug) {
    ctx.ui.notify(
      isResume
        ? `[toolbelt] resume: ${active.length} active tools from ${restored ? "snapshot" : "configured baseline"}`
        : `[toolbelt] configured baseline active: ${active.join(", ")} (source: ${effective.source})`,
      "info",
    );
  }
});
```

#### 7. src/commands.ts:8-344

**File**: src/commands.ts
**Changes**: MODIFY — move setup and reset to registered baseline snapshots and remove forced-loader/reset-marker behavior

```typescript
import {
  filterRegisteredTools,
  isSearchReceipt,
  persistActiveTools,
} from "./session.js";

const newEffective = buildEffectiveConfig(ctx.cwd);
const requested = filterRegisteredTools(pi, newEffective.baseline);
let active: string[];
try {
  active = persistActiveTools(pi, requested).after;
} catch (error) {
  ctx.ui.notify(
    `Config was written, but active tools were not changed because the session snapshot could not be persisted: ${
      error instanceof Error ? error.message : String(error)
    }`,
    "error",
  );
  return;
}

const debug = !!pi.getFlag(FLAG_DEBUG);
ctx.ui.notify(buildSetupReport(targetPath, newEffective, active, debug), "info");

function buildSetupConfirm(
  targetPath: string,
  config: ToolbeltConfig,
): string {
  const lines: string[] = [
    "Toolbelt will apply the following changes:",
    "",
    `Config file: ${targetPath}`,
    `Baseline tools: ${config.baseline.join(", ")}`,
    `Discovery tool: ${LOADER_TOOL_NAME} (active only when included in baseline or enabled for the session)`,
    `Threshold: ${config.threshold}  |  Top-K: ${config.topK}`,
    "",
    "The configured baseline will be activated immediately.",
    "Proceed?",
  ];
  return lines.join("\n");
}

async function handleReset(
  pi: ExtensionAPI,
  ctx: {
    cwd: string;
    ui: {
      notify(msg: string, sev: "info" | "warning" | "error"): void;
    };
  },
): Promise<void> {
  const effective = buildEffectiveConfig(ctx.cwd);
  if (!isEnabled(effective)) {
    ctx.ui.notify(
      "Toolbelt: disabled (no valid config). Nothing to reset.",
      "warning",
    );
    return;
  }

  const requested = filterRegisteredTools(pi, effective.baseline);
  let change;
  try {
    change = persistActiveTools(pi, requested);
  } catch (error) {
    ctx.ui.notify(
      `Toolbelt reset aborted; active tools were not changed because the session snapshot could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
    return;
  }

  if (change.removed.length > 0 || change.added.length > 0) {
    const lines = ["✓ Toolbelt reset"];
    if (change.added.length > 0) lines.push(`Added: ${change.added.join(", ")}`);
    if (change.removed.length > 0) lines.push(`Removed: ${change.removed.join(", ")}`);
    lines.push(
      `Active: ${change.after.length} tools (${change.after.join(", ") || "none"})`,
    );
    ctx.ui.notify(lines.join("\n"), "warning");
  } else {
    ctx.ui.notify(
      `Toolbelt reset: nothing to change. ` +
        `Active: ${change.after.length} tools unchanged.`,
      "info",
    );
  }
}
```

#### 8. src/__tests__/integration.test.ts:1-220

**File**: src/__tests__/integration.test.ts
**Changes**: MODIFY — exercise registered discovery/model tools, exact lifecycle restore, reset snapshots, no-protection, validation, and persistence failure

```typescript
import toolbeltExtension from "../index.js";
import {
  ACTIVE_TOOL_SNAPSHOT_ENTRY,
  MANAGE_TOOL_NAME,
} from "../constants.js";

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
```

### Success Criteria:

#### Automated Verification:
- [x] Model/lifecycle integration tests pass: `npx tsx --test src/__tests__/integration.test.ts`
- [x] Query execution contains no active-set mutation: `sed -n '/name: LOADER_TOOL_NAME/,/name: MANAGE_TOOL_NAME/p' src/index.ts | grep "setActiveTools"` returns no matches
- [x] Legacy reset marker production is gone: `grep -n '"tool_result"' src/commands.ts` returns no matches

#### Manual Verification:
- [ ] Invoke `query_tools` for an inactive capability and confirm the text identifies the result as inactive and directs the model to `manage_tools`.

## Phase 3: Atomic Interactive Tool Modal

### Overview

Add the keyboard-driven staged tool manager, `/toolbelt tools` wiring, focused tests, and modal-filter performance coverage. Depends on Phases 1-2. Execution order within this phase: apply the `package.json`/`package-lock.json` dependency changes and run `npm install` before creating `src/tool-manager.ts`, then apply the remaining source, test, and benchmark changes.

### Changes Required:

#### 9. src/tool-manager.ts

**File**: src/tool-manager.ts
**Changes**: NEW — deterministic modal state helpers, custom overlay component, and read-only/enabled result contract

```typescript
import type {
  ExtensionCommandContext,
  Theme,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

export interface ToolManagerRow {
  name: string;
  description: string;
}

export interface ToolManagerState {
  filter: string;
  selectedIndex: number;
  staged: string[];
  readOnly: boolean;
}

export type ToolManagerResult =
  | { kind: "confirm"; active: string[] }
  | { kind: "cancel" };

export type ToolManagerAction =
  | { type: "filter"; value: string }
  | { type: "move"; delta: -1 | 1 }
  | { type: "toggle" }
  | { type: "confirm" }
  | { type: "cancel" };

export function buildToolManagerRows(tools: ToolInfo[]): ToolManagerRow[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
  }));
}

export function createToolManagerState(
  rows: ToolManagerRow[],
  activeNames: readonly string[],
  readOnly: boolean,
): ToolManagerState {
  const registered = new Set(rows.map((row) => row.name));
  return {
    filter: "",
    selectedIndex: 0,
    staged: [...new Set(activeNames)].filter((name) => registered.has(name)),
    readOnly,
  };
}

export function filterToolRows(
  rows: ToolManagerRow[],
  filter: string,
): ToolManagerRow[] {
  const query = filter.trim().toLocaleLowerCase();
  if (query.length === 0) return rows;
  return rows.filter((row) =>
    `${row.name}\n${row.description}`.toLocaleLowerCase().includes(query),
  );
}

export function selectedActiveNames(
  rows: ToolManagerRow[],
  state: ToolManagerState,
): string[] {
  const staged = new Set(state.staged);
  return rows.filter((row) => staged.has(row.name)).map((row) => row.name);
}

export function reduceToolManagerState(
  rows: ToolManagerRow[],
  state: ToolManagerState,
  action: ToolManagerAction,
): { state: ToolManagerState; result?: ToolManagerResult } {
  if (action.type === "cancel") {
    return { state, result: { kind: "cancel" } };
  }
  if (action.type === "confirm") {
    return state.readOnly
      ? { state, result: { kind: "cancel" } }
      : {
          state,
          result: { kind: "confirm", active: selectedActiveNames(rows, state) },
        };
  }
  if (action.type === "filter") {
    return {
      state: { ...state, filter: action.value, selectedIndex: 0 },
    };
  }

  const visible = filterToolRows(rows, state.filter);
  if (action.type === "move") {
    return {
      state: {
        ...state,
        selectedIndex: Math.max(
          0,
          Math.min(
            Math.max(0, visible.length - 1),
            state.selectedIndex + action.delta,
          ),
        ),
      },
    };
  }
  if (state.readOnly || visible.length === 0) return { state };

  const selected = visible[state.selectedIndex];
  const staged = new Set(state.staged);
  if (staged.has(selected.name)) staged.delete(selected.name);
  else staged.add(selected.name);
  return { state: { ...state, staged: [...staged] } };
}

function decodeFilterText(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty) return kitty;
  return /^[^\u0000-\u001f\u007f]+$/u.test(data) ? data : undefined;
}

class ToolManagerComponent implements Component {
  private state: ToolManagerState;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly rows: ToolManagerRow[],
    state: ToolManagerState,
    private readonly done: (result: ToolManagerResult) => void,
  ) {
    this.state = state;
  }

  private dispatch(action: ToolManagerAction): void {
    const next = reduceToolManagerState(this.rows, this.state, action);
    this.state = next.state;
    if (next.result) this.done(next.result);
    else this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.dispatch({ type: "cancel" });
    } else if (matchesKey(data, Key.enter)) {
      this.dispatch({ type: "confirm" });
    } else if (matchesKey(data, Key.up)) {
      this.dispatch({ type: "move", delta: -1 });
    } else if (matchesKey(data, Key.down)) {
      this.dispatch({ type: "move", delta: 1 });
    } else if (matchesKey(data, Key.space)) {
      this.dispatch({ type: "toggle" });
    } else if (matchesKey(data, Key.ctrl("u"))) {
      this.dispatch({ type: "filter", value: "" });
    } else if (matchesKey(data, Key.backspace)) {
      const chars = Array.from(this.state.filter);
      chars.pop();
      this.dispatch({ type: "filter", value: chars.join("") });
    } else {
      const printable = decodeFilterText(data);
      if (printable) {
        this.dispatch({ type: "filter", value: this.state.filter + printable });
      }
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
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
    const lines = [
      this.theme.fg("accent", this.theme.bold("Toolbelt Tools")),
      "",
    ];

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
}

export async function openToolManager(
  ctx: ExtensionCommandContext,
  tools: ToolInfo[],
  activeNames: readonly string[],
  readOnly: boolean,
): Promise<ToolManagerResult> {
  const rows = buildToolManagerRows(tools);
  const state = createToolManagerState(rows, activeNames, readOnly);
  return ctx.ui.custom<ToolManagerResult>(
    (tui, theme, _keybindings, done) =>
      new ToolManagerComponent(tui, theme, rows, state, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: 76, maxHeight: 24 },
    },
  );
}
```

#### 10. src/__tests__/tool-manager.test.ts

**File**: src/__tests__/tool-manager.test.ts
**Changes**: NEW — filtering, navigation, staged toggle, cancel, confirmation, read-only mode, and no-protection tests

```typescript
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
    assert.equal(state.selectedIndex, 0);
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
});
```

#### 11. src/commands.ts:8-190

**File**: src/commands.ts
**Changes**: MODIFY — use the real command context and dispatch `/toolbelt tools` through the modal and snapshot transaction

```typescript
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { openToolManager } from "./tool-manager.js";

type CommandContext = ExtensionCommandContext;

export async function handleToolbeltCommand(
  args: string,
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/toolbelt requires interactive mode", "error");
    return;
  }

  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";
  switch (subcommand) {
    case "":
      ctx.ui.notify(
        "Toolbelt commands:\n" +
          "  /toolbelt setup [global|project]  - create config and apply baseline\n" +
          "  /toolbelt tools                   - inspect and change session tools\n" +
          "  /toolbelt status                  - show current state\n" +
          "  /toolbelt reset                   - restore configured baseline",
        "info",
      );
      break;
    case "setup":
      await handleSetup(parts.slice(1), pi, ctx);
      break;
    case "tools":
      await handleTools(pi, ctx);
      break;
    case "status":
      await handleStatus(pi, ctx);
      break;
    case "reset":
      await handleReset(pi, ctx);
      break;
    default:
      ctx.ui.notify(
        `Unknown subcommand: ${subcommand}. Valid subcommands: setup, tools, status, reset`,
        "warning",
      );
  }
}

async function handleTools(
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/toolbelt tools requires TUI mode", "error");
    return;
  }

  const effective = buildEffectiveConfig(ctx.cwd);
  const result = await openToolManager(
    ctx,
    pi.getAllTools(),
    pi.getActiveTools(),
    !isEnabled(effective),
  );
  if (result.kind === "cancel") return;

  try {
    const change = persistActiveTools(pi, result.active);
    ctx.ui.notify(
      change.added.length === 0 && change.removed.length === 0
        ? `Toolbelt tools: active set unchanged (${change.after.length} tools).`
        : `Toolbelt tools applied. Active: ${change.after.join(", ") || "none"}.`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify(
      `Toolbelt tools not applied; active tools were unchanged because the session snapshot could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
  }
}
```

#### 12. src/index.ts:36-121

**File**: src/index.ts
**Changes**: MODIFY — add `tools` completion/help text while preserving the existing completion function and command-side config refresh

```typescript
const COMPS: Record<string, CompletionNode> = {
  setup: {
    description: "Create config and apply baseline",
    children: {
      global: { description: "Write ~/.pi/agent/toolbelt.json" },
      project: { description: "Write .pi/toolbelt.json" },
    },
  },
  tools: { description: "Inspect and change active session tools" },
  status: { description: "Show current toolbelt state" },
  reset: { description: "Restore configured baseline" },
};

// In the existing pi.registerCommand(COMMAND_NAME, { ... }) block:
description: "Toolbelt: setup, inspect, manage, status, and reset session tools",
```

#### 13. src/__tests__/commands.test.ts:1-180

**File**: src/__tests__/commands.test.ts
**Changes**: MODIFY — add enabled confirm, cancel, persistence failure, and invalid-config read-only modal command coverage

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleToolbeltCommand } from "../commands.js";
import { writeToolbeltConfig } from "../config.js";

const modalTmp = join(tmpdir(), `pi-toolbelt-modal-${process.pid}`);
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function customResult(inputs: string[]) {
  return async (factory: any) =>
    new Promise((resolve) => {
      const component = factory(
        { requestRender() {} },
        theme,
        {},
        resolve,
      );
      for (const input of inputs) component.handleInput(input);
    });
}

function modalContext(cwd: string, inputs: string[]) {
  const notifications: Array<{ msg: string; sev: string }> = [];
  return {
    notifications,
    ctx: {
      cwd,
      mode: "tui",
      hasUI: true,
      ui: {
        notify(msg: string, sev: string) {
          notifications.push({ msg, sev });
        },
        confirm: async () => true,
        custom: customResult(inputs),
      },
    } as any,
  };
}

describe("tools command", () => {
  it("persists and applies one final set on confirm", async () => {
    rmSync(modalTmp, { recursive: true, force: true });
    writeToolbeltConfig(join(modalTmp, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.4,
      topK: 5,
    });
    const order: string[] = [];
    let active = ["read"];
    const pi = {
      getAllTools: () => [
        { name: "read", description: "Read" },
        { name: "query_tools", description: "Discover" },
      ],
      getActiveTools: () => [...active],
      appendEntry() { order.push("append"); },
      setActiveTools(names: string[]) { order.push("set"); active = names; },
    } as any;
    const { ctx } = modalContext(modalTmp, [" ", "\r"]);

    await handleToolbeltCommand("tools", pi, ctx);

    assert.deepEqual(order, ["append", "set"]);
    assert.deepEqual(active, []);
    rmSync(modalTmp, { recursive: true, force: true });
  });

  it("does not persist or mutate on cancel", async () => {
    const order: string[] = [];
    const pi = {
      getAllTools: () => [{ name: "read", description: "Read" }],
      getActiveTools: () => ["read"],
      appendEntry() { order.push("append"); },
      setActiveTools() { order.push("set"); },
    } as any;
    const { ctx } = modalContext(modalTmp, [" ", "\u001b"]);

    await handleToolbeltCommand("tools", pi, ctx);
    assert.deepEqual(order, []);
  });

  it("opens read-only for invalid config and never mutates", async () => {
    rmSync(modalTmp, { recursive: true, force: true });
    mkdirSync(join(modalTmp, ".pi"), { recursive: true });
    writeFileSync(join(modalTmp, ".pi", "toolbelt.json"), "{ bad json");
    const order: string[] = [];
    const pi = {
      getAllTools: () => [{ name: "read", description: "Read" }],
      getActiveTools: () => ["read"],
      appendEntry() { order.push("append"); },
      setActiveTools() { order.push("set"); },
    } as any;
    const { ctx } = modalContext(modalTmp, [" ", "\r"]);

    await handleToolbeltCommand("tools", pi, ctx);
    assert.deepEqual(order, []);
    rmSync(modalTmp, { recursive: true, force: true });
  });

  it("surfaces persistence failure and leaves the active set unchanged", async () => {
    rmSync(modalTmp, { recursive: true, force: true });
    writeToolbeltConfig(join(modalTmp, ".pi", "toolbelt.json"), {
      baseline: ["read"],
      threshold: 0.4,
      topK: 5,
    });
    let setCalls = 0;
    const pi = {
      getAllTools: () => [{ name: "read", description: "Read" }],
      getActiveTools: () => ["read"],
      appendEntry() { throw new Error("disk full"); },
      setActiveTools() { setCalls++; },
    } as any;
    const { ctx, notifications } = modalContext(modalTmp, ["\r"]);

    await handleToolbeltCommand("tools", pi, ctx);

    assert.equal(setCalls, 0);
    assert.ok(
      notifications.some(
        ({ msg, sev }) =>
          sev === "error" &&
          msg.includes("active tools were unchanged") &&
          msg.includes("disk full"),
      ),
    );
    rmSync(modalTmp, { recursive: true, force: true });
  });
});
```

#### 14. package.json:20-37

**File**: package.json
**Changes**: MODIFY — declare direct Pi TUI runtime dependency

```json
"dependencies": {
  "@earendil-works/pi-tui": "^0.80.7",
  "fuse.js": "^7.0.0"
}
```

#### 15. package-lock.json

**File**: package-lock.json
**Changes**: MODIFY — generated by `npm install`; lock direct Pi TUI dependency metadata at the root

```json
{
  "packages": {
    "": {
      "dependencies": {
        "@earendil-works/pi-tui": "^0.80.7",
        "fuse.js": "^7.0.0"
      }
    },
    "node_modules/@earendil-works/pi-tui": {
      "version": "0.80.7",
      "resolved": "https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.80.7.tgz",
      "license": "MIT",
      "dependencies": {
        "get-east-asian-width": "1.6.0",
        "marked": "18.0.5"
      },
      "engines": {
        "node": ">=22.19.0"
      }
    }
  }
}
```

#### 16. benchmark/index.ts:1-80

**File**: benchmark/index.ts
**Changes**: MODIFY — ADD modal filtering measurement to the existing benchmark; preserve `FIXTURE_TOOLS`, `ITERATIONS`, `P95_INDEX`, and the existing search benchmark

```typescript
import {
  filterToolRows,
  type ToolManagerRow,
} from "../src/tool-manager.js";

const MODAL_ROWS: ToolManagerRow[] = FIXTURE_TOOLS.map((tool) => ({ ...tool }));
const FILTERS = [
  "browser",
  "files",
  "web",
  "agent",
  "questions",
  "tool_09",
  "no-match",
];
for (let i = 0; i < 50; i++) {
  filterToolRows(MODAL_ROWS, FILTERS[i % FILTERS.length]);
}

const filterLatencies: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  filterToolRows(MODAL_ROWS, FILTERS[i % FILTERS.length]);
  filterLatencies.push(performance.now() - t0);
}
filterLatencies.sort((a, b) => a - b);
const filterP95 = filterLatencies[P95_INDEX];
console.log(
  `modal filter p95: ${filterP95.toFixed(3)} ms - ${
    filterP95 < 100 ? "PASS" : "FAIL"
  }`,
);
if (filterP95 >= 100) process.exitCode = 1;
```

### Success Criteria:

#### Automated Verification:
- [x] Tool manager state tests pass: `npx tsx --test src/__tests__/tool-manager.test.ts`
- [ ] Command modal tests pass: `npx tsx --test src/__tests__/commands.test.ts`
- [x] Modal filtering benchmark passes below 100 ms p95: `npm run benchmark`
- [x] Direct TUI dependency is installed: `npm ls @earendil-works/pi-tui --depth=0`

#### Manual Verification:
- [ ] `/toolbelt tools` opens a centered overlay; typing filters name/description, Up/Down moves, Space stages, Enter applies, and Escape cancels.
- [ ] With invalid or missing config, the same overlay shows registered tools and active markers read-only with setup guidance.

## Phase 4: Resume, Reset, Status, and Documentation

### Overview

Remove the superseded activation-replay surface, expose exact active names in status, complete lifecycle assertions, and document the final workflow. Depends on Phases 1-3.

### Changes Required:

#### 17. src/types.ts:24-80

**File**: src/types.ts
**Changes**: MODIFY — remove `SearchReceipt` and leave final ranking, snapshot, discovery, and management contracts

```typescript
/** A single Fuse ranking before current active membership is attached. */
export interface ToolRanking {
  name: string;
  score: number;
}

export interface SearchBackend {
  search(query: string, threshold: number, topK: number): ToolRanking[];
  refresh(tools: Array<{ name: string; description: string }>): boolean;
  getCatalogHash(): string;
}

export interface ActiveToolSnapshot {
  version: 1;
  active: string[];
}

export interface ActiveToolChange {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

export interface ToolDiscoveryResult extends ToolRanking {
  active: boolean;
}

export interface DiscoveryReceipt {
  query: string;
  backend: string;
  rankings: ToolDiscoveryResult[];
  activeCounts: { before: number; after: number };
  catalogHash: string;
}

export type ToolManagementAction = "activate" | "deactivate";

export interface ToolManagementReceipt extends ActiveToolChange {
  action: ToolManagementAction;
  requested: string[];
}
```

#### 18. src/constants.ts:7-20

**File**: src/constants.ts
**Changes**: MODIFY — remove the protected-loader claim from the discovery-tool comment

```typescript
/** Discovery tool name; active membership is controlled by config/session state. */
export const LOADER_TOOL_NAME = "query_tools";
```

#### 19. src/session.ts:1-150

**File**: src/session.ts
**Changes**: MODIFY — final snapshot transaction, newest-valid restore, and discovery receipt guard; remove legacy baseline/receipt replay helpers

```typescript
/** Active-set persistence and session restoration. */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_TOOL_SNAPSHOT_ENTRY,
  ACTIVE_TOOL_SNAPSHOT_VERSION,
} from "./constants.js";
import type {
  ActiveToolChange,
  ActiveToolSnapshot,
  DiscoveryReceipt,
} from "./types.js";

export function filterRegisteredTools(
  pi: Pick<ExtensionAPI, "getAllTools">,
  names: readonly string[],
): string[] {
  const registered = new Set(pi.getAllTools().map((tool) => tool.name));
  return [...new Set(names)].filter((name) => registered.has(name));
}

export function persistActiveTools(
  pi: ExtensionAPI,
  requested: readonly string[],
): ActiveToolChange {
  const before = pi.getActiveTools();
  const after = filterRegisteredTools(pi, requested);
  const snapshot: ActiveToolSnapshot = {
    version: ACTIVE_TOOL_SNAPSHOT_VERSION,
    active: after,
  };

  pi.appendEntry(ACTIVE_TOOL_SNAPSHOT_ENTRY, snapshot);
  pi.setActiveTools(after);

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    before,
    after,
    added: after.filter((name) => !beforeSet.has(name)),
    removed: before.filter((name) => !afterSet.has(name)),
  };
}

export function restoreActiveToolSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string[] | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (
      entry.type !== "custom" ||
      entry.customType !== ACTIVE_TOOL_SNAPSHOT_ENTRY ||
      !isActiveToolSnapshot(entry.data)
    ) {
      continue;
    }
    return filterRegisteredTools(pi, entry.data.active);
  }
  return undefined;
}

export function isActiveToolSnapshot(
  value: unknown,
): value is ActiveToolSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.version === ACTIVE_TOOL_SNAPSHOT_VERSION &&
    Array.isArray(snapshot.active) &&
    snapshot.active.every((name) => typeof name === "string")
  );
}

export function isDiscoveryReceipt(value: unknown): value is DiscoveryReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.query !== "string" ||
    typeof receipt.backend !== "string" ||
    !Array.isArray(receipt.rankings) ||
    typeof receipt.activeCounts !== "object" ||
    receipt.activeCounts === null ||
    typeof receipt.catalogHash !== "string"
  ) {
    return false;
  }
  const counts = receipt.activeCounts as Record<string, unknown>;
  return (
    typeof counts.before === "number" &&
    typeof counts.after === "number" &&
    receipt.rankings.every((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const ranking = value as Record<string, unknown>;
      return (
        typeof ranking.name === "string" &&
        typeof ranking.score === "number" &&
        typeof ranking.active === "boolean"
      );
    })
  );
}
```

#### 20. src/index.ts:1-12

**File**: src/index.ts
**Changes**: MODIFY — describe the final two-tool, snapshot-backed lifecycle accurately

```typescript
/**
 * pi-toolbelt: discovery and explicit session tool management for Pi.
 *
 * Registers query_tools, manage_tools, and the /toolbelt command family
 * unconditionally. Config validity gates every active-set mutation, while the
 * tools command remains available read-only before setup. Session start applies
 * the registered configured baseline or the newest exact active-set snapshot.
 */
```

#### 21. src/commands.ts:8-285

**File**: src/commands.ts
**Changes**: MODIFY — replace activation-oriented status with exact active names and discovery-only receipt output

```typescript
import type {
  DiscoveryReceipt,
  ToolbeltConfig,
} from "./types.js";
import {
  filterRegisteredTools,
  isDiscoveryReceipt,
  persistActiveTools,
} from "./session.js";

async function handleStatus(
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  const effective = buildEffectiveConfig(ctx.cwd);
  const active = pi.getActiveTools();
  const registered = pi.getAllTools();
  const branch = ctx.sessionManager.getBranch();
  let lastReceipt: DiscoveryReceipt | undefined;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.toolName === LOADER_TOOL_NAME &&
      isDiscoveryReceipt(entry.message.details)
    ) {
      lastReceipt = entry.message.details;
      break;
    }
  }

  const lines: string[] = [];
  if (isEnabled(effective)) {
    const configPaths: string[] = [];
    if (effective.globalValid) configPaths.push(effective.globalPath);
    if (effective.projectValid) configPaths.push(effective.projectPath);
    lines.push("Toolbelt: enabled");
    lines.push(`Config: ${configPaths.join(", ")}`);
    lines.push(`Source: ${effective.source}`);
    lines.push(`Baseline: ${effective.baseline.join(", ") || "(none)"}`);
    lines.push(
      `Backend: ${BACKEND_ID} | threshold: ${effective.threshold} | topK: ${effective.topK}`,
    );
  } else if (hasConfigError(effective)) {
    lines.push("Toolbelt: disabled (config has errors)");
    const errors = [effective.globalError, effective.projectError].filter(
      (error): error is string => typeof error === "string",
    );
    if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
  } else {
    lines.push(
      "Toolbelt: disabled - no config files found. Run /toolbelt setup to enable changes.",
    );
  }

  lines.push(`Active: ${active.length} / ${registered.length} registered`);
  lines.push(`Active names: ${active.join(", ") || "(none)"}`);

  if (lastReceipt) {
    lines.push("");
    lines.push(`Last search: "${lastReceipt.query}"`);
    lines.push(
      lastReceipt.rankings.length > 0
        ? `  matches: ${lastReceipt.rankings
            .map(
              ({ name, score, active }) =>
                `${name} (${active ? "active" : "inactive"}, ${score.toFixed(3)})`,
            )
            .join(", ")}`
        : "  no ranked tools",
    );
  }

  ctx.ui.notify(lines.join("\n"), "info");
}
```

#### 22. src/__tests__/session.test.ts:1-240

**File**: src/__tests__/session.test.ts
**Changes**: MODIFY — replace legacy receipt-union tests with final snapshot, discovery receipt, and legacy-ignore coverage

```typescript
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

describe("active-set snapshots", () => {
  it("validates snapshot version and string names", () => {
    assert.equal(isActiveToolSnapshot({ version: 1, active: ["read"] }), true);
    assert.equal(isActiveToolSnapshot({ version: 1, active: [] }), true);
    assert.equal(isActiveToolSnapshot({ version: 2, active: ["read"] }), false);
    assert.equal(isActiveToolSnapshot({ version: 1, active: [7] }), false);
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
      appendEntry() { order.push("append"); },
      setActiveTools(names: string[]) { order.push("set"); active = names; },
    } as any;
    persistActiveTools(pi, ["agent_browser"]);
    assert.deepEqual(order, ["append", "set"]);
    assert.deepEqual(active, ["agent_browser"]);

    let setCalls = 0;
    const failing = {
      getAllTools: tools,
      getActiveTools: () => ["read"],
      appendEntry() { throw new Error("disk full"); },
      setActiveTools() { setCalls++; },
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

  it("rejects legacy mutation receipts", () => {
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
});
```

#### 23. src/__tests__/integration.test.ts:220-400

**File**: src/__tests__/integration.test.ts
**Changes**: MODIFY — add exact removal, setup snapshot, no-snapshot baseline fallback, and stale-registration resume coverage

```typescript
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
  await manage.execute("remove-read", { action: "deactivate", tools: ["read"] });
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
  assert.deepEqual(harness.active, ["read"]);
  assert.deepEqual(harness.entries.at(-1), {
    type: ACTIVE_TOOL_SNAPSHOT_ENTRY,
    data: { version: 1, active: ["read"] },
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
```

#### 24. src/__tests__/commands.test.ts:180-280

**File**: src/__tests__/commands.test.ts
**Changes**: MODIFY — assert exact status names and reset failure abort

```typescript
describe("status and reset", () => {
  it("status prints exact active names", async () => {
    rmSync(modalTmp, { recursive: true, force: true });
    writeToolbeltConfig(join(modalTmp, ".pi", "toolbelt.json"), {
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
      cwd: modalTmp,
      mode: "tui",
      hasUI: true,
      ui: { notify(msg: string) { notifications.push(msg); } },
      sessionManager: { getBranch: () => [] },
    } as any;

    await handleToolbeltCommand("status", pi, ctx);
    assert.ok(
      notifications.at(-1)?.includes("Active names: read, agent_browser"),
    );
    rmSync(modalTmp, { recursive: true, force: true });
  });

  it("reset aborts without setActiveTools when persistence fails", async () => {
    rmSync(modalTmp, { recursive: true, force: true });
    writeToolbeltConfig(join(modalTmp, ".pi", "toolbelt.json"), {
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
      cwd: modalTmp,
      mode: "tui",
      hasUI: true,
      ui: { notify(msg: string) { notifications.push(msg); } },
    } as any;

    await handleToolbeltCommand("reset", pi, ctx);
    assert.equal(setCalls, 0);
    assert.ok(notifications.at(-1)?.includes("reset aborted"));
    assert.ok(notifications.at(-1)?.includes("disk full"));
    rmSync(modalTmp, { recursive: true, force: true });
  });
});
```

#### 25. README.md:1-100

**File**: README.md
**Changes**: MODIFY — document discovery, explicit model/user management, snapshots, config-decides membership, and roadmap

```markdown
# pi-toolbelt

Progressive tool discovery and explicit session tool management for [Pi](https://github.com/earendil-works/pi-coding-agent).

Toolbelt keeps active-tool membership visible and deliberate. The model discovers candidates without silently enabling them, the user stages changes in a keyboard-driven modal, and resume restores the latest exact selection.

## Install

```sh
npm install pi-toolbelt
```

## Configure

```text
/toolbelt setup global
/toolbelt setup project
```

The configured `baseline` is the exact set applied on a new session or `/toolbelt reset`, after unregistered names are removed. Toolbelt does not force `query_tools` or `manage_tools` into that set.

## Manage session tools

Run `/toolbelt tools`. The modal lists every registered tool as `[x]` active or `[ ]` inactive with its name and description. Type to filter, use Up/Down to move, Space to stage, Enter to persist/apply once, and Escape to cancel. Without valid config, the modal remains available read-only and points to setup.

Use `/toolbelt status` to inspect exact active names. Use `/toolbelt reset` to restore the registered configured baseline.

## Model workflow

`query_tools` returns ranked `{ name, score, active }` results and never changes active tools. `manage_tools` performs one direction per call:

```json
{ "action": "activate", "tools": ["agent_browser"] }
```

```json
{ "action": "deactivate", "tools": ["query_tools", "manage_tools"] }
```

Both are ordinary registered tools and may be enabled or disabled. Toolbelt validates exact names and never executes target tools.

## Session restoration

Each confirmed model, modal, setup, or reset mutation persists the complete final active-name set before applying it. Resume uses the newest valid snapshot and filters unregistered names. An older session without a snapshot starts from configured baseline instead of replaying legacy activations.

## Config

Global: `~/.pi/agent/toolbelt.json`. Project: `.pi/toolbelt.json` (fields override global; arrays replace).

```json
{ "baseline": ["read", "bash", "edit", "write"], "threshold": 0.4, "topK": 5 }
```

- `baseline`: exact new-session/reset active names
- `threshold`: Fuse strictness from 0 (exact) to 1 (anything)
- `topK`: maximum discovery results

## Roadmap

A visual global/project config editor is intentionally deferred. This release manages session state only.

## License

MIT
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck`
- [x] All unit and integration tests pass: `npm test`
- [x] Search and modal-filter p95 benchmarks pass: `npm run benchmark`
- [x] No legacy activation-replay symbols remain: `grep -R -E "SearchReceipt|restoreFromBranch|isSearchReceipt|\\.activated" src --exclude-dir=__tests__` returns no matches
- [x] Status code prints exact membership: `grep -n "Active names:" src/commands.ts` returns one match

#### Manual Verification:
- [ ] Run `/toolbelt tools` with valid config and verify filter, navigation, text markers, staged add/remove, cancel, and one-shot confirm.
- [ ] Remove a configured baseline tool plus `query_tools` and `manage_tools`, resume, and verify none is resurrected.
- [ ] Force snapshot persistence failure for modal and reset and verify both preserve the prior set.
- [ ] Open the manager with missing and malformed config and verify full-catalog read-only setup guidance.

## Ordering Constraints

- Phase 1 must complete first because all mutations and resume paths depend on its snapshot transaction.
- Phase 2 depends on Phase 1 and atomically switches discovery, model control, setup, reset, and session lifecycle to snapshots.
- Phase 3 depends on Phase 1 for atomic application and Phase 2 for final management-tool names and semantics.
- Phase 4 depends on all prior phases because it removes compatibility code only after every producer and consumer uses the new contracts, then runs project-wide verification.
- No phases run in parallel; `src/index.ts`, `src/commands.ts`, `src/session.ts`, and integration tests evolve across sequential phases.

## Verification Notes

- Discovery-only invariant: invoking matched and no-match `query_tools` paths must leave `pi.getActiveTools()` byte-for-byte unchanged and never call `setActiveTools`.
- Registered-tool boundary: both model and modal mutation paths reject or omit names absent from `pi.getAllTools()`.
- Atomic persistence: forced `appendEntry` failure must produce an actionable error and zero `setActiveTools` calls.
- Exact restore: newest valid full snapshot wins; removed baseline tools are not resurrected; unregistered snapshot names are filtered.
- No protected tools: tests must prove both `query_tools` and `manage_tools` can be deactivated and are not force-added by baseline, reset, or resume.
- Cancellation: modal state changes remain local until confirmation; Escape leaves active names and session entries unchanged.
- Disabled manager: missing or malformed config still allows catalog inspection but disables toggling and confirmation mutation.
- Reset: successful reset writes the effective baseline snapshot before one active-set replacement; failure leaves the previous set intact.
- Status: exact active names appear in command output in addition to counts.
- Modal accessibility: active state has a text marker and every action is keyboard-accessible.
- Project baseline commands run only after all phases: `npm run typecheck`, `npm test`, and `npm run benchmark`.

## Precedents & Lessons

- The initial extension commit coupled discovery, mutation, receipt history, and resume across source, tests, and benchmarks; this change must update all four together.
- Review finding I1 in `.rpiv/artifacts/reviews/2026-07-23_02-22-59_commit.md` showed that reset producer/consumer persistence is load-bearing. Persist-before-mutate is mandatory, not a warning-only fallback.
- Review finding Q2 showed command-side closure config refresh is a second config-state path. `/toolbelt tools` must preserve the refresh in `src/index.ts:110-120`.
- Pi's built-in `examples/extensions/tools.ts` proves custom active-set state and branch restoration, but its immediate per-toggle mutation must not be copied.
- Pi exposes no activation origin and no registered label. UI and status must restrict claims to public name, description, and membership data.

## Performance Considerations

- Modal filtering is an in-memory case-insensitive substring scan over name and description, O(number of registered tools) per keystroke.
- Keep modal state deterministic and allocation-bounded at the expected 100-tool scale; benchmark 1,000 filter operations after warmup and fail at p95 >= 100 ms.
- Fuse discovery retains catalog-hash refresh behavior; this feature does not add remote calls or alter search configuration.
- Resume changes from O(branch length plus all receipt activations) to O(branch length until the newest valid snapshot plus registered-tool filtering).

## Migration Notes

- The persisted session schema changes from tool-result `SearchReceipt.activated` replay to custom versioned full snapshots.
- Existing branch receipts remain readable session history but are not replayed when no snapshot exists.
- A pre-feature session resumed after upgrade starts from the effective configured baseline exactly.
- No config-file or database migration is required.
- Rollback to the prior release ignores custom snapshot entries and resumes using old search receipts; config files remain compatible.

## Pattern References

- `src/index.ts:36-121` — completion-tree command registration and closure-config refresh.
- `src/index.ts:124-247` — inline model-tool registration and config gate.
- `src/commands.ts:34-72` — command dispatch structure.
- `src/session.ts:53-116` — backward branch scanning and runtime type-guard style to replace.
- `src/__tests__/session.test.ts:13-357` — minimal `as any` Pi/context mocks and branch-state assertions.
- `src/__tests__/integration.test.ts:324-375` — active-set composition test structure.
- `benchmark/index.ts:21-52` — deterministic 100-item p95 benchmark structure.
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/tools.ts:17-126` — custom tool selector, custom-entry persistence, and branch restore precedent.
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts:49-230` — custom keyboard component state/render/result pattern.
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/overlay-qa-tests.ts:20-60` — overlay invocation options.

## Developer Context

**Q:** “The research fixes `query_tools` as discovery-only (`src/index.ts:124-218`) and adds a separate management tool. The inherited decision protects only `query_tools`, but once `manage_tools` is inactive the model can discover names yet has no callable path to activate them. Which contract should the plan use?”
**Initial A:** “Protect both tools.”
**Correction:** “hold on. i think I actually don't want to prevent disabling query or manage tools. i feel like the user should be able to disable or enable them at will if they cnamanage them”
**Fixed decision:** Neither tool is protected.

**Q:** “Got it, neither tool will be protected from modal/model removal. Should new session and `/toolbelt reset` still start with both management tools active, or only whatever the configured baseline names?”
**A:** “Config decides.”

**Q:** “No existing model-side mutation schema exists. For the separate tool registered beside `query_tools` (`src/index.ts:124-247`), should one call support an atomic add/remove swap, or one direction at a time?”
**A:** “Action + tools.”

**Q:** “Existing sessions only contain additive `SearchReceipt.activated` history (`src/session.ts:53-90`); new sessions will use newest-wins full snapshots. On the first resume of a pre-feature session with no snapshot, what should happen?”
**A:** “Start from baseline.”

**Design checkpoint:** Approved the no-protection, config-decides, one-action management, baseline migration, and atomic modal design.

**Decomposition checkpoint:** Approved four sequential vertical slices.

**Phase 1 micro-checkpoint:** Approved the snapshot primitives as generated after verifier-driven revision kept legacy lifecycle consumers intact until the atomic producer/consumer switch. Verifier: Decisions OK, Cross-slice OK, Research OK.

**Phase 2 micro-checkpoint:** Approved discovery-only `query_tools`, one-direction `manage_tools`, and the verifier-driven atomic switch of setup/reset/session lifecycle to snapshots. Verifier: Decisions OK, Cross-slice OK, Research OK.

**Phase 3 micro-checkpoint:** Approved the staged custom modal, command wiring, direct Pi TUI dependency, focused command/state tests, and modal-filter benchmark after correcting the keyboard decoder to Pi TUI's public export and adding persistence-failure coverage. Verifier: Decisions OK, Cross-slice OK, Research OK.

**Phase 4 micro-checkpoint:** Approved final legacy cleanup, discovery-oriented status, exact lifecycle coverage, and documentation after adding an explicit no-snapshot resume assertion. Verifier: Decisions OK, Cross-slice OK, Research OK.

## Plan History

- Phase 1: Exact Active-Set Snapshots — revised: kept legacy `applyBaseline` and receipt restoration intact for intermediate test coherence; approved
- Phase 2: Discovery and Model Control — revised: moved setup/reset and session lifecycle onto snapshots in the same atomic slice; approved
- Phase 3: Atomic Interactive Tool Modal — revised: used public `decodeKittyPrintable` and added command persistence-failure coverage; approved
- Phase 4: Resume, Reset, Status, and Documentation — revised: added explicit no-snapshot resume coverage; approved

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §1 | `src/types.ts:24-50` | concern | actionability | The MODIFY line range overlaps existing interfaces and could be read as literal replacement. | Change the hint to insertion after the existing interfaces or state explicitly that the types are additive. | applied: changed the hint to an additive insertion after line 48 and named the interfaces that remain |
| code | Phase 2 §6 | `src/index.ts:19-21,48-51` | concern | actionability | The code block omits existing search/config/command imports and closure declarations that its emitted code still uses. | Include all preserved imports and closure declarations, or explicitly mark the block as incremental. | applied: marked the block incremental and explicitly listed every import and closure declaration that must remain |
| code | Phase 2 §6 | `src/index.ts:118-130` | concern | codebase-fit | The session lifecycle fragment uses `event`, `effective`, and `debug` without showing the handler wrapper and local declarations. | Include the `session_start` wrapper and local declarations so the replacement is self-contained. | applied: emitted the complete `session_start` wrapper, config/error gate, and local declarations |
| code | Phase 3 §9 | `package.json:20-37` | concern | actionability | `tool-manager.ts` imports Pi TUI before the dependency subsection appears in phase order. | Put package installation before creating/importing the modal module. | applied: Phase 3 now explicitly installs dependencies before creating the modal source |
| code | Phase 3 §16 | `benchmark/index.ts:16-27` | concern | codebase-fit | The additive benchmark fragment references existing fixture and iteration constants without saying they must be preserved. | Mark the block additive or include the referenced definitions. | applied: marked the benchmark change additive and explicitly preserved all referenced constants |
| code | Phase 1 §3 | `src/session.ts` | suggestion | code-quality | `LOADER_TOOL_NAME` appears unused by the newly added Phase 1 helpers. | Remove the import if no preserved Phase 1 code still needs it. | dismissed: preserved Phase 1 legacy helpers still use the constant; Phase 4 removes the import with those helpers |
| code | Phase 3 §9 | `pi-tui/dist/utils.js:811-821` | suggestion | code-quality | Reviewer questioned whether ANSI-styled names are measured correctly by `truncateToWidth`. | Truncate before styling or confirm the utility is ANSI-aware. | dismissed: the installed utility explicitly handles ANSI escape codes and measures visible width |

_Coverage reviewer: no findings; all 16 verification and precedent entries are routed to success criteria or visible code._

## References

- `.rpiv/artifacts/research/2026-07-23_15-45-10_session-tool-manager.md`
- `.rpiv/artifacts/discover/2026-07-23_15-11-17_session-tool-manager.md`
- `.rpiv/artifacts/reviews/2026-07-23_02-22-59_commit.md`
- `.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md`
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/tools.ts`
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts`
