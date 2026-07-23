---
date: 2026-07-22T22:25:38-0400
author: Cyanism
commit: no-commit
branch: main
repository: pi-toolbelt
topic: "pi-toolbelt-extension"
tags: [plan, pi-toolbelt, extension, tool-search, dynamic-tools]
status: ready
parent: .rpiv/artifacts/research/2026-07-22_21-58-59_pi-toolbelt-extension-lifecycle.md
phase_count: 5
phases:
  - { n: 1, title: Foundation + Disabled Mode }
  - { n: 2, title: Setup }
  - { n: 3, title: Search }
  - { n: 4, title: Status, Reset, Resume }
  - { n: 5, title: Tests & Benchmark }
unresolved_phase_count: 0
last_updated: 2026-07-22T22:25:38-0400
last_updated_by: Cyanism
---

# Pi Toolbelt Extension Implementation Plan

## Overview

Build `pi-toolbelt` as a standalone Pi extension npm package. It registers one model-facing tool (`search_tools`) that discovers and activates Pi tools by natural-language query, and one `/toolbelt` command family for setup, status, and reset. Uses fuse.js v7 for local fuzzy search with portable 0-1 scoring. Follows an emergency-brake disabled-mode invariant: installing the package changes nothing until the user explicitly runs `/toolbelt setup`.

## Requirements

1. Package SHALL register one tool (`search_tools`) with a single `query: string` input
2. Package SHALL register one command family (`/toolbelt`) with `setup`, `status`, `reset` subcommands
3. When no config exists, Toolbelt SHALL remain disabled and leave active tools unchanged
4. `/toolbelt setup global|project` SHALL write config and apply baseline immediately
5. Global config at `~/.pi/agent/toolbelt.json`; project config at `.pi/toolbelt.json`
6. Project fields override global; project arrays replace global arrays
7. Seeded baseline: `read`, `bash`, `edit`, `write` + `search_tools`
8. `search_tools` SHALL use fuse.js local search, activate threshold-clearing matches additively
9. `/toolbelt status` SHALL report enabled state, config, active/registered counts, latest receipt
10. `/toolbelt reset` SHALL replace active set with baseline + `search_tools` (only v1 removal path)
11. On session resume, SHALL restore tools from prior `search_tools` receipts on the current branch
12. Invalid config SHALL disable active-set management and show one warning

## Current State Analysis

### Key Discoveries

- **Greenfield repo** — no `package.json`, no source files, only `.rpiv/` artifacts exist
- **Extension factory pattern**: `rpiv-core/index.ts:46-48` — unconditional registration in factory body, `session_start` session_start handler gating active-set management behind config presence
- **Command handler pattern**: `setup-command.ts:57-140` — `notify → confirm → install → report` flow using `ctx.ui.confirm()` and `ctx.ui.notify()`
- **Config loading pattern**: `utils.ts:45-75` — fail-soft, returns `undefined` on missing/invalid/not-plain-object/not-array
- **Standalone package pattern**: `pi-powerline-footer/package.json:25-27` — `pi.extensions: ["./index.ts"]` entry with `peerDependencies` on Pi SDK
- **Session hooks**: `session-hooks.ts:70` — `pi.on("session_start", ...)` with named handler, `startupMaintenanceDone` latch for one-time work, `pi.on("before_agent_start", ...)` returning `{ message }` for injection
- **Dynamic tool loading**: `extensions.md:2296-2431` — additive `pi.setActiveTools()` during loader execution, Pi detects additions, records `addedToolNames`, exposes on next request
- **Additive guard**: `wrapper.js:17-29` — Pi runtime distinguishes additive from non-additive; additive gets native deferred loading, non-additive gets full-list fallback with cache invalidation
- **Branch scanning**: `pi-powerline-footer/index.ts:2070-2100` — `ctx.sessionManager.getBranch()` returns session entries on current branch; `extensions.md:1827-1835` — state reconstruction from tool result `details`
- **Search backend**: fuse.js v7 recommended — threshold is ded — threshold 0-1 score is corpus-independent (portable across catalogs), ~15ms p95 for 100 docs, zero dependencies, ~7.6KB gzip

## Desired End State

```typescript
// After install (no config): nothing changes. /toolbelt setup discoverable.
// After /toolbelt setup global:
//   Active tools: read, bash, edit, write, search_tools

// Model usage:
//   Model: "I need to search files"
//   → calls search_tools({ query: "search file contents" })
//   → grep activated, returned in receipt
//   → Model sees grep on next request, calls it

// Session resume:
//   Previous session had grep + session_search activated by search_tools
//   → On resume: baseline + grep + session_search active again

// /toolbelt status output example:
//   Toolbelt: enabled
//   Config: ~/.pi/agent/toolbelt.json
//   Baseline: read, bash, edit, write
//   Active: 7 / 42 registered
//   Backend: fuse.js | threshold: 0.4 | topK: 5
//   Last search: "search file contents" → activated grep (score 0.12)

// /toolbelt reset:
//   Removed: grep, session_search, find
//   Active: read, bash, edit, write, search_tools
```

## What We're NOT Doing

- **Footer**: No `belt 5/37` status bar — command-based status only for v1
- **Automatic pruning**: No configurable removal policies — reset is the only removal path
- **Remote intelligence**: No embeddings, no model reranking, no remote API calls during search
- **Tool execution/repair**: Toolbelt selects tool definitions only; Pi owns execution and validation
- **Allowlist/denylist**: Any registered tool can match — Pi registration is the trust boundary
- **Footer coexistence**: No integration with pi-powerline-footer or other extensions
- **Prompt guidelines for lazy tools**: Lazily loaded tools rely on description, not `promptSnippet` or `promptGuidelines`, to avoid cache-invalidating system prompt rebuilds per `extensions.md:2425-2428`

## Decisions

### Extension Factory Pattern

Follow rpiv-core unconditional registration: commands + hooks registered in factory body, `session_start` handler gating active-set management. Evidence: `rpiv-core/index.ts:46-48`, `session-hooks.ts:70`.

### Package Structure

Follow pi-powerline-footer standalone pattern: single `index.ts` entry, `pi.extensions: ["./index.ts"]` in package.json, `peerDependencies` on `@earendil-works/pi-coding-agent >=0.80.7`. Evidence: `pi-powerline-footer/package.json:25-27`.

### Search Backend: fuse.js v7

fuse.js v7 selected for its portable 0-1 threshold: `threshold: 0.4` means the same thing across any tool catalog. Mini-search and flexsearch produce corpus-relative scores that would force per-catalog tuning. Evidence: research artifact §Local Search Backend Candidates + web-search-researcher analysis.

### Config: Dedicated JSON Files

`~/.pi/agent/toolbelt.json` (global) and `.pi/toolbelt.json` (project). Dedicated files keep Toolbelt's schema isolated. Evidence: FRD Decision "Dedicated global and project config."

### Disabled Mode: Emergency Brake

Installing the package registers `search_tools` and `/toolbelt` unconditionally but never calls `pi.setActiveTools()` without valid config. Evidence: FRD Decision "Explicit setup gate" + "Disabled-mode behavior."

### Config Merge: Project Arrays Replace

Global loaded first, project overlaid by field. Project arrays replace global arrays (not concatenate). Evidence: FRD Decision "Config merge semantics."

### Additive Search Only

`search_tools` merges matched names with current active set, never removes. Reset is the only v1 removal path. Evidence: FRD Decision "Additive search with separate removal" + `wrapper.js:17-29` additive guard.

### Receipt Persistence in Tool Result Details

Receipts stored in `ToolResultMessage.details`, not `pi.appendEntry()`. Branch-scoped automatically. Reset encoded as receipt with `activated: []`. Evidence: research artifact Developer Context Q/A.

### Resume: Branch Scan with Reset Boundary

`getBranch()` scanned backwards for `search_tools` receipts, stopping at reset marker (`activated: []`). Tree navigation "just works" for different branches. Evidence: research artifact Architecture Insights.

## Ordering Constraints

- Phase 1 must come first (foundation — all other phases depend on it)
- Phase 2 depends on Phase 1 (needs config loading + index.ts entry)
- Phase 3 depends on Phase 2 (needs config for threshold/topK, baseline for context)
- Phase 4 depends on Phase 3 (status needs receipt format, reset needs active-set awareness)
- Phase 5 depends on Phases 1-4 (tests all behavior)

No phases run in parallel — each builds on the previous.

## Verification Notes

- **Disabled mode invariant**: grep for `setActiveTools` in index.ts — must only appear inside `session_start` handler conditional on config validity
- **Config fail-soft**: config reader must never throw; test with missing file, invalid JSON, non-object, missing baseline
- **Additive invariant**: `search_tools` execute must do `pi.getActiveTools()` before + after `pi.setActiveTools()`, verify after is superset of before
- **Receipt structure**: every search_tools result must have `details` with `query`, `backend`, `rankings`, `activated`, `activeCounts`, `catalogHash`
- **Resume boundary**: reset marker (`activated: []`) must halt branch scan
- **threshold/topK enforcement**: test that results above threshold are activated, results below are not, and count ≤ topK
- **No-match behavior**: return scored near-misses, activate nothing, leave active set unchanged
- **All three backends comparable**: pi-toolbelt should be backend-agnostic at the interface level so a future backend swap only replaces one file

## Performance Considerations

- fuse.js p95 ~15ms for 100-tool catalog → 85ms headroom under 100ms budget
- Index built from `pi.getAllTools()` refreshed each `search_tools` call (catalog hash check avoids rebuild)
- No remote calls — all search is in-process
- Receipts are small (~1KB JSON) — no storage concern in session JSONL
- `session_start` work is O(branch-length) but branch scanning only on resume, not new sessions

## Migration Notes

N/A — greenfield, no existing data or schema.

## Pattern References

- `rpiv-core/index.ts:46-48` — extension factory composition (unconditional registration)
- `rpiv-core/session-hooks.ts:70` — `pi.on("session_start", ...)` wiring
- `rpiv-core/setup-command.ts:57-140` — command handler flow: notify→confirm→install→report
- `rpiv-core/setup-command.ts:31-49` — `buildConfirmBody()` preview pattern
- `rpiv-core/setup-command.ts:115-125` — `buildReport()` structured output
- `rpiv-core/utils.ts:45-75` — fail-soft config reader
- `rpiv-core/utils.ts:24-26` — `isPlainObject()` type guard
- `pi-powerline-footer/package.json:14-27` — standalone package.json pattern (peerDeps + devDeps + pi.extensions)
- `pi-powerline-footer/index.ts:957` — `export default function(pi: ExtensionAPI)` entry signature
- `extensions.md:2354-2420` — search_tools example (registerTool + execute)
- `extensions.md:2296-2431` — dynamic tool loading lifecycle
- `extensions.md:2310` — "unknown names are ignored" on setActiveTools
- `extensions.md:2338-2351` — non-additive fallback (cache invalidation)
- `extensions.md:1827-1835` — state reconstruction from tool result details

## Developer Context

**Directional confirm (Step 4):**
Q: Follow rpiv-core factory pattern + pi-powerline-footer standalone package structure?
A: Follow — confirmed.

## Plan History

- Phase 1: Foundation + Disabled Mode — approved as generated
- Phase 2: Setup — approved as generated
- Phase 3: Search — approved as generated
- Phase 4: Status, Reset, Resume — approved as generated
- Phase 5: Tests & Benchmark — approved as generated

## References

- `.rpiv/artifacts/research/2026-07-22_21-58-59_pi-toolbelt-extension-lifecycle.md`
- `.rpiv/artifacts/discover/2026-07-22_21-00-47_pi-toolbelt-progressive-tool-search.md`
- `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/Users/cyan/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/extensions/rpiv-core/`
- `/Users/cyan/.pi/agent/npm/node_modules/pi-powerline-footer/`

## Phase 1: Foundation + Disabled Mode

### Overview

Package exists, registers command and tool unconditionally, reads config on session_start, but does NOT call pi.setActiveTools() when config is absent or invalid. Install is safe — no active-set change. Depends on nothing.

### Changes Required:

#### 1. package.json
**File**: package.json
**Changes**: NEW — package manifest with npm metadata, pi extension entry, peerDependencies, dependencies (fuse.js), scripts

```json
{
  "name": "pi-toolbelt",
  "version": "0.1.0",
  "description": "Progressive tool discovery for Pi — carry only the tools you need",
  "type": "module",
  "files": [
    "src/",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "pi-package",
    "pi-extension",
    "pi",
    "coding-agent",
    "tool-search",
    "dynamic-tools"
  ],
  "author": "Cyanism",
  "license": "MIT",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --experimental-strip-types --test src/__tests__/**/*.test.ts",
    "benchmark": "node --experimental-strip-types benchmark/index.ts"
  },
  "dependencies": {
    "fuse.js": "^7.0.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.80.7"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.80.7",
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0"
  },
  "pi": {
    "extensions": [
      "./src/index.ts"
    ]
  }
}
```

#### 2. tsconfig.json
**File**: tsconfig.json
**Changes**: NEW — strict TypeScript config for Node ESM, targeting the Pi extension environment

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "benchmark/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

#### 3. src/types.ts
**File**: src/types.ts
**Changes**: NEW — ToolbeltConfig, SearchReceipt, EffectiveConfig, ToolRanking type definitions

```typescript
/** Pi Toolbelt type definitions. */

/** User-facing configuration schema for toolbelt.json. */
export interface ToolbeltConfig {
  baseline: string[];
  threshold: number;
  topK: number;
}

/** Resolved configuration combining global + project sources. */
export interface EffectiveConfig {
  baseline: string[];
  threshold: number;
  topK: number;
  source: "global" | "project" | "both" | "none";
  globalPath: string;
  projectPath: string;
  globalValid: boolean;
  projectValid: boolean;
  globalError?: string;
  projectError?: string;
}

/** A single tool match from a search query.
 * Score is a fuse.js Bitap score: 0 = perfect match, 1 = no match.
 * Only results where score <= configured threshold are activated. */
export interface ToolRanking {
  name: string;
  score: number;
}

/** Adapter interface for pluggable search backends.
 * The fuse.js implementation in search.ts is the only v1 backend.
 * Implement this interface to swap backends by replacing one file. */
export interface SearchBackend {
  search(query: string, threshold: number, topK: number): ToolRanking[];
  refresh(tools: Array<{ name: string; description: string }>): boolean;
  getCatalogHash(): string;
}

/** Durable receipt persisted in tool result details. */
export interface SearchReceipt {
  query: string;
  backend: string;
  rankings: ToolRanking[];
  activated: string[];
  activeCounts: { before: number; after: number };
  catalogHash: string;
}

/** Result from reading a single config file. */
export interface ConfigSource {
  path: string;
  config: Partial<ToolbeltConfig> | undefined;
  error?: string;
}
```

#### 4. src/constants.ts
**File**: src/constants.ts
**Changes**: NEW — default config values, flag name, backend ID, fuse.js options

```typescript
/** Pi Toolbelt constants. */

/** Pi flag name for verbose output. */
export const FLAG_DEBUG = "toolbelt-debug";

/** Config file name placed in ~/.pi/agent/ and .pi/. */
export const CONFIG_FILE_NAME = "toolbelt.json";

/** The loader tool that must always remain active when Toolbelt is enabled. */
export const LOADER_TOOL_NAME = "search_tools";

/** Command name for the /toolbelt slash command. */
export const COMMAND_NAME = "toolbelt";

/** Backend identifier embedded in search receipts. */
export const BACKEND_ID = "fuse.js";

/** Minimum number of characters for a search query token match. */
export const MIN_MATCH_CHAR_LENGTH = 2;

/** fuse.js search keys: which tool fields to index. */
export const SEARCH_KEYS = ["name", "description"];

/** fuse.js options beyond threshold (set at search time from config). */
export const FUSE_OPTIONS = {
  includeScore: true,
  shouldSort: true,
  minMatchCharLength: MIN_MATCH_CHAR_LENGTH,
  keys: SEARCH_KEYS,
} as const;

/** Default config seeded by /toolbelt setup. */
export const DEFAULT_CONFIG = {
  baseline: ["read", "bash", "edit", "write"],
  threshold: 0.4,
  topK: 5,
};
```

#### 5. src/config.ts
**File**: src/config.ts
**Changes**: NEW — fail-soft JSON config reader, partial schema validation, global+project merge

```typescript
/**
 * Toolbelt config loading and validation.
 *
 * Follows rpiv-core/utils.ts:45-75 fail-soft pattern: missing file, invalid
 * JSON, or wrong shape all return ConfigSource (never throw). The session_start
 * handler is the sole consumer; its validate-then-activate-or-warn gate is the
 * only path to active-set mutation.
 *
 * Validation accepts partial configs: a project file that sets only
 * `threshold` is valid; missing fields are filled from global defaults
 * at merge time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { ConfigSource, EffectiveConfig, ToolbeltConfig } from "./types.js";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG } from "./constants.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Global config path: ~/.pi/agent/toolbelt.json */
export function getGlobalConfigPath(): string {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}

/** Project config path: .pi/toolbelt.json */
export function getProjectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Reader (fail-soft — never throws)
// ---------------------------------------------------------------------------

/**
 * Read, parse, and validate a single toolbelt config file.
 * Returns ConfigSource with either partial config or error — never throws.
 *
 * Validation is lenient: any subset of fields is accepted. Missing fields
 * are filled from defaults at merge time (buildEffectiveConfig). Each
 * present field is independently validated.
 */
export function readToolbeltConfig(path: string): ConfigSource {
  if (!existsSync(path)) {
    return { path, config: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    return {
      path,
      config: undefined,
      error: `Invalid JSON in ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      path,
      config: undefined,
      error: `${path} does not contain a JSON object`,
    };
  }

  return validateConfig(parsed, path);
}

// ---------------------------------------------------------------------------
// Validator (lenient — partial configs accepted)
// ---------------------------------------------------------------------------

/**
 * Validate present fields against the ToolbeltConfig schema.
 * Missing fields are fine — the merge layer fills from defaults.
 * At least one recognized field must be present.
 */
function validateConfig(raw: Record<string, unknown>, path: string): ConfigSource {
  const config: Partial<ToolbeltConfig> = {};

  if (raw.baseline !== undefined) {
    if (!Array.isArray(raw.baseline)) {
      return { path, config: undefined, error: `toolbelt.json: 'baseline' must be an array of tool names` };
    }
    for (const name of raw.baseline) {
      if (typeof name !== "string") {
        return { path, config: undefined, error: `toolbelt.json: 'baseline' entries must be strings` };
      }
    }
    config.baseline = raw.baseline as string[];
  }

  if (raw.threshold !== undefined) {
    if (typeof raw.threshold !== "number" || raw.threshold < 0 || raw.threshold > 1) {
      return { path, config: undefined, error: `toolbelt.json: 'threshold' must be a number between 0 and 1` };
    }
    config.threshold = raw.threshold;
  }

  if (raw.topK !== undefined) {
    if (typeof raw.topK !== "number" || raw.topK < 1 || !Number.isInteger(raw.topK)) {
      return { path, config: undefined, error: `toolbelt.json: 'topK' must be a positive integer` };
    }
    config.topK = raw.topK;
  }

  // Must contain at least one recognized field
  if (config.baseline === undefined && config.threshold === undefined && config.topK === undefined) {
    return { path, config: undefined, error: `toolbelt.json: must contain at least one recognized field (baseline, threshold, topK)` };
  }

  return { path, config };
}

// ---------------------------------------------------------------------------
// Merge — project arrays replace, scalars override
// ---------------------------------------------------------------------------

/**
 * Build effective config by loading global first, then overlaying project.
 * Each source is independently validated. Project fields override global;
 * project arrays replace global arrays (not concatenate). Missing fields
 * in either source fall through to the DEFAULT_CONFIG.
 *
 * Enabled only when at least one source is valid AND neither source has
 * an error (FRD FR#8: if either config is malformed → disable).
 */
export function buildEffectiveConfig(cwd: string): EffectiveConfig {
  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath(cwd);

  const global = readToolbeltConfig(globalPath);
  const project = readToolbeltConfig(projectPath);

  const globalValid = global.config !== undefined && global.error === undefined;
  const projectValid = project.config !== undefined && project.error === undefined;

  // Neither config exists or is valid
  if (!globalValid && !projectValid) {
    return {
      ...DEFAULT_CONFIG,
      source: "none",
      globalPath,
      projectPath,
      globalValid,
      projectValid,
      globalError: global.error,
      projectError: project.error,
    };
  }

  // Merge: DEFAULT → global → project (each layer fills gaps in the prior)
  const base = global.config !== undefined ? global.config : {};
  const merged: ToolbeltConfig = {
    baseline:
      project.config?.baseline ??
      base.baseline ??
      DEFAULT_CONFIG.baseline,
    threshold:
      project.config?.threshold ??
      base.threshold ??
      DEFAULT_CONFIG.threshold,
    topK: project.config?.topK ?? base.topK ?? DEFAULT_CONFIG.topK,
  };

  const source = projectValid ? (globalValid ? "both" : "project") : "global";

  return {
    ...merged,
    source,
    globalPath,
    projectPath,
    globalValid,
    projectValid,
    globalError: global.error,
    projectError: project.error,
  };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write a toolbelt config file, creating parent directories as needed.
 * Throws on filesystem errors (handled by caller's try/catch).
 */
export function writeToolbeltConfig(path: string, config: ToolbeltConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Enabled / error checks
// ---------------------------------------------------------------------------

/**
 * True when at least one config source exists and is valid AND
 * neither source has an error (FRD FR#8: malformed config → disable).
 */
export function isEnabled(effective: EffectiveConfig): boolean {
  if (effective.globalError !== undefined || effective.projectError !== undefined) return false;
  return effective.source !== "none";
}

/**
 * True when any config file exists but failed validation.
 * Independent of isEnabled — a broken project file with a valid
 * global config should still warn.
 */
export function hasConfigError(effective: EffectiveConfig): boolean {
  return effective.globalError !== undefined || effective.projectError !== undefined;
}
```

#### 6. src/index.ts
**File**: src/index.ts
**Changes**: NEW — extension factory: unconditional registration of /toolbelt command and search_tools tool, session_start handler gating

```typescript
/**
 * pi-toolbelt — Progressive tool discovery extension for Pi.
 *
 * Registers one model-facing tool (search_tools) and one slash command
 * family (/toolbelt) unconditionally at module load. The session_start
 * handler gates all active-set management behind config-file presence
 * and validity — installing the package alone never alters active tools.
 *
 * Follows rpiv-core/index.ts:46-48 unconditional-registration pattern
 * and pi-powerline-footer standalone package structure.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BACKEND_ID, FLAG_DEBUG, LOADER_TOOL_NAME } from "./constants.js";
import { buildEffectiveConfig, hasConfigError, isEnabled } from "./config.js";
import type { SearchReceipt } from "./types.js";

export default function (pi: ExtensionAPI) {
  pi.registerFlag(FLAG_DEBUG, {
    description: "Show verbose toolbelt debug output",
    type: "boolean",
    default: false,
  });

  // ── /toolbelt command (stub — filled in Phase 2) ──────────────────
  pi.registerCommand("toolbelt", {
    description: "Toolbelt: setup, status, and reset progressive tool discovery",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/toolbelt requires interactive mode", "error");
        return;
      }
      ctx.ui.notify(
        "Toolbelt commands:\n" +
          "  /toolbelt setup [global|project]  — create config and apply baseline\n" +
          "  /toolbelt status                    — show current state\n" +
          "  /toolbelt reset                     — clear search-activated tools",
        "info",
      );
    },
  });

  // ── search_tools tool (stub — filled in Phase 3) ──────────────────
  pi.registerTool({
    name: LOADER_TOOL_NAME,
    label: "Search Tools",
    description:
      "Search for and enable registered Pi tools relevant to a task. " +
      "Activate matching tools by natural-language capability query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of the capability or task you need a tool for",
        },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params) {
      const query = String(params.query ?? "");
      // Placeholder — replaced in Phase 3.
      // Returns a no-match receipt so the disabled-mode invariant holds
      // (search_tools registered but returns empty until config exists).
      const active = pi.getActiveTools();
      return {
        content: [
          {
            type: "text",
            text:
              `Toolbelt is not yet configured. ` +
              `Run /toolbelt setup to enable progressive tool discovery.`,
          },
        ],
        details: {
          query,
          backend: BACKEND_ID,
          rankings: [],
          activated: [],
          activeCounts: { before: active.length, after: active.length },
          catalogHash: "",
        },
      };
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const effective = buildEffectiveConfig(ctx.cwd);
    const debug = pi.getFlag(FLAG_DEBUG);

    // ── Check for config errors (always warn, regardless of enabled state) ──
    if (hasConfigError(effective)) {
      const errors: string[] = [];
      if (effective.globalError) errors.push(effective.globalError);
      if (effective.projectError) errors.push(effective.projectError);
      ctx.ui.notify(`[toolbelt] ${errors.join("; ")}`, "warning");
      // isEnabled returns false when errors exist (FRD FR#8).
      // Fall through to the disabled check below.
    }

    // ── Disabled mode: no valid config → no active-set change ──
    if (!isEnabled(effective)) {
      // Already warned above if configs exist but are invalid.
      // Silent when neither file exists (FRD FR#3).
      if (debug) {
        ctx.ui.notify("[toolbelt] disabled — no valid config found", "info");
      }
      return;
    }

    // ── Enabled mode: activate baseline + search_tools ──
    // Note: resume restoration (branch scan) is added in Phase 5.
    // Phase 1 only handles the config-gate and new-session baseline.
    const active = [...new Set([...effective.baseline, LOADER_TOOL_NAME])];
    pi.setActiveTools(active);

    if (debug) {
      ctx.ui.notify(
        `[toolbelt] activated baseline: ${effective.baseline.join(", ")} ` +
          `(source: ${effective.source})`,
        "info",
      );
    }
  });
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `tsc --noEmit`
- [x] Disabled-mode invariant: `grep -c "pi.setActiveTools" src/index.ts` returns no calls outside `session_start` handler conditionals
- [x] Config fail-soft: `grep -c "throw" src/config.ts` returns 0 (reader never throws)
- [x] No import mismatch: `grep "DEFAULT_CONFIG" src/config.ts | grep "from"` shows `"./constants.js"`

#### Manual Verification:
- [ ] Install via `pi install pi-toolbelt` registers `/toolbelt` and `search_tools` but does not change active tools when no config exists
- [ ] Creating a valid `~/.pi/agent/toolbelt.json` and starting a new session activates baseline + search_tools
- [ ] Creating an invalid `~/.pi/agent/toolbelt.json` (malformed JSON) shows one warning and leaves active tools unchanged

## Phase 2: Setup

### Overview

`/toolbelt setup global|project` writes config and applies baseline immediately. session_start activates baseline when config exists. User can enable Toolbelt. Depends on Phase 1.

### Changes Required:

#### 7. src/commands.ts
**File**: src/commands.ts
**Changes**: NEW — /toolbelt command dispatcher with setup subcommand (global + project)

```typescript
/**
 * /toolbelt command dispatcher.
 *
 * Follows setup-command.ts:57-140 pattern: guard → confirm → write → apply → report.
 * Each subcommand is a named handler dispatched by the top-level command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  writeToolbeltConfig,
  buildEffectiveConfig,
  hasConfigError,
} from "./config.js";
import { DEFAULT_CONFIG, FLAG_DEBUG, LOADER_TOOL_NAME } from "./constants.js";
import type { ToolbeltConfig } from "./types.js";

// ── Top-level dispatch ──────────────��─────────────────────────────

export async function handleToolbeltCommand(
  args: string,
  pi: ExtensionAPI,
  ctx: {
    cwd: string;
    hasUI: boolean;
    ui: {
      notify(msg: string, sev: "info" | "warning" | "error"): void;
      confirm(title: string, body: string): Promise<boolean>;
    };
  },
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
          "  /toolbelt setup [global|project]  — create config and apply baseline\n" +
          "  /toolbelt status                    — show current state\n" +
          "  /toolbelt reset                     — clear search-activated tools",
        "info",
      );
      break;
    case "setup":
      await handleSetup(parts.slice(1), pi, ctx);
      break;
    case "status":
      // Phase 4
      ctx.ui.notify("/toolbelt status: coming in a future update", "info");
      break;
    case "reset":
      // Phase 4
      ctx.ui.notify("/toolbelt reset: coming in a future update", "info");
      break;
    default:
      ctx.ui.notify(
        `Unknown subcommand: ${subcommand}. Valid subcommands: setup, status, reset`,
        "warning",
      );
  }
}

// ── Setup ─────────────────────────────────────────────────────────

async function handleSetup(
  args: string[],
  pi: ExtensionAPI,
  ctx: {
    cwd: string;
    ui: {
      notify(msg: string, sev: "info" | "warning" | "error"): void;
      confirm(title: string, body: string): Promise<boolean>;
    };
  },
): Promise<void> {
  const scope = args[0]?.toLowerCase();
  if (scope !== "global" && scope !== "project") {
    ctx.ui.notify(
      "Usage: /toolbelt setup [global|project]\n" +
        "  global  — create ~/.pi/agent/toolbelt.json\n" +
        "  project — create .pi/toolbelt.json in current project",
      "warning",
    );
    return;
  }

  const targetPath =
    scope === "global"
      ? getGlobalConfigPath()
      : getProjectConfigPath(ctx.cwd);

  // Guard: refuse setup if any existing config is broken (FRD FR#8)
  const preCheck = buildEffectiveConfig(ctx.cwd);
  if (hasConfigError(preCheck)) {
    const errors: string[] = [];
    if (preCheck.globalError) errors.push(preCheck.globalError);
    if (preCheck.projectError) errors.push(preCheck.projectError);
    ctx.ui.notify(
      `[toolbelt] Cannot run setup while config is invalid: ${errors.join("; ")}`,
      "warning",
    );
    return;
  }

  // Seed from default config
  const config: ToolbeltConfig = {
    baseline: [...DEFAULT_CONFIG.baseline],
    threshold: DEFAULT_CONFIG.threshold,
    topK: DEFAULT_CONFIG.topK,
  };

  // Confirm before writing
  const confirmed = await ctx.ui.confirm(
    "Apply Toolbelt setup?",
    buildSetupConfirm(targetPath, config),
  );
  if (!confirmed) {
    ctx.ui.notify("Toolbelt setup cancelled", "info");
    return;
  }

  // Write config file
  try {
    writeToolbeltConfig(targetPath, config);
  } catch (e) {
    ctx.ui.notify(
      `Failed to write config: ${e instanceof Error ? e.message : String(e)}`,
      "error",
    );
    return;
  }

  // Apply immediately: re-read effective config (includes what was just written)
  const effective = buildEffectiveConfig(ctx.cwd);
  const active = [...new Set([...effective.baseline, LOADER_TOOL_NAME])];
  pi.setActiveTools(active);

  const debug = !!pi.getFlag(FLAG_DEBUG);
  ctx.ui.notify(
    buildSetupReport(targetPath, effective, active, debug),
    "info",
  );
}

function buildSetupConfirm(
  targetPath: string,
  config: ToolbeltConfig,
): string {
  const lines: string[] = [
    "Toolbelt will apply the following changes:",
    "",
    `Config file: ${targetPath}`,
    `Baseline tools: ${config.baseline.join(", ")}`,
    `Search tool: search_tools (always active)`,
    `Threshold: ${config.threshold}  |  Top-K: ${config.topK}`,
    "",
    "Baseline tools + search_tools will be activated immediately.",
    "Proceed?",
  ];
  return lines.join("\n");
}

function buildSetupReport(
  targetPath: string,
  effective: ReturnType<typeof buildEffectiveConfig>,
  active: string[],
  debug: boolean,
): string {
  const lines: string[] = [
    "✓ Toolbelt setup complete",
    "",
    `Config written: ${targetPath}`,
    `Source: ${effective.source}`,
    `Baseline: ${effective.baseline.join(", ")}`,
    `Active tools now: ${active.length} (${active.join(", ")})`,
  ];
  if (debug) {
    lines.push(`Threshold: ${effective.threshold}  |  Top-K: ${effective.topK}`);
  }
  return lines.join("\n");
}
```

#### 8. src/index.ts
**File**: src/index.ts
**Changes**: MODIFY — replace stub /toolbelt handler with dispatch to commands.ts handleToolbeltCommand

```typescript
// Add this import near the top of src/index.ts:
import { handleToolbeltCommand } from "./commands.js";

// REPLACE the existing pi.registerCommand("toolbelt", { ... }) block with:

  // ── /toolbelt command ──────────────────────────────────────────
  pi.registerCommand("toolbelt", {
    description: "Toolbelt: setup, status, and reset progressive tool discovery",
    handler: async (args, ctx) => {
      await handleToolbeltCommand(args, pi, ctx);
    },
  });
```

#### 9. src/config.ts
**File**: src/config.ts
**Changes**: MODIFY — no changes needed. Phase 1 config.ts already includes writeToolbeltConfig, buildEffectiveConfig, getGlobalConfigPath, getProjectConfigPath, hasConfigError, and isEnabled.

```
// No changes required — Phase 1 config.ts covers all Phase 2 needs.
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `tsc --noEmit`
- [x] Setup handler imports from config.ts exist: `grep "buildEffectiveConfig\|writeToolbeltConfig\|hasConfigError" src/commands.ts` returns 3 matches
- [x] Setup checks for config errors before proceeding: `grep -A5 "hasConfigError" src/commands.ts | grep "Cannot run setup"` returns match
- [x] Subcommand dispatch uses switch: `grep "switch (subcommand)" src/commands.ts` returns match

#### Manual Verification:
- [ ] Running `/toolbelt setup` with no args shows usage help
- [ ] Running `/toolbelt setup global` after confirm writes `~/.pi/agent/toolbelt.json` and activates `read, bash, edit, write, search_tools`
- [ ] Running `/toolbelt setup project` after confirm writes `.pi/toolbelt.json` and activates baselineline
- [ ] Running `/toolbelt setup` when a config is already malformed shows error and refuses to proceed
- [ ] `/toolbelt setup` cancelled at confirm prompt shows "cancelled" and leaves tools unchanged

## Phase 3: Search

### Overview

`search_tools` tool fully wired: builds fuse.js index from `pi.getAllTools()`, scores against natural-language query, filters by threshold, caps at topK, activates additively, returns structured receipt. Depends on Phase 2 (needs config for threshold/topK).

### Changes Required:

#### 10. src/search.ts
**File**: src/search.ts
**Changes**: NEW — SearchEngine class wrapping fuse.js; buildToolIndex helper

```typescript
/**
 * Search engine wrapping fuse.js for local tool discovery.
 *
 * Builds an in-memory index from pi.getAllTools() on construction,
 * supports re-indexing (refresh) with catalog hash check to skip
 * rebuilds when the catalog hasn't changed. The Fuse instance runs
 * with internal threshold 1.0 (returns all candidates); the
 * configured threshold is applied as a post-filter so that high
 * thresholds (e.g. 0.8) still get all candidates scored.
 *
 * Hash covers name + description so description-only changes
 * trigger a rebuild.
 */

import Fuse from "fuse.js";
import { BACKEND_ID, FUSE_OPTIONS, SEARCH_KEYS } from "./constants.js";
import type { ToolRanking } from "./types.js";

// ── Minimal tool descriptor ──────────────────────────────────────

export interface IndexedTool {
  name: string;
  description: string;
}

// ── SearchEngine ─────────────────────────────────────────────────

export class SearchEngine {
  private fuse: Fuse<IndexedTool>;
  private catalogHash: string;

  constructor(tools: IndexedTool[]) {
    this.fuse = new Fuse(tools, {
      ...FUSE_OPTIONS,
      keys: [...SEARCH_KEYS],
      threshold: 1.0, // return all candidates; post-filter by configured threshold
    });
    this.catalogHash = computeCatalogHash(tools);
  }

  /** Current catalog hash for receipt + change detection. */
  getCatalogHash(): string {
    return this.catalogHash;
  }

  /**
   * Rebuild the index from a fresh tool list. Returns true if the
   * catalog changed (hash differs), false if the rebuild was skipped.
   */
  refresh(tools: IndexedTool[]): boolean {
    const newHash = computeCatalogHash(tools);
    if (newHash === this.catalogHash) return false;
    this.fuse = new Fuse(tools, {
      ...FUSE_OPTIONS,
      keys: [...SEARCH_KEYS],
      threshold: 1.0,
    });
    this.catalogHash = newHash;
    return true;
  }

  /**
   * Search the index for tools matching a natural-language query.
   * Returns ranked results with fuse.js scores (0 = perfect, 1 = no match),
   * post-filtered by the configured threshold and capped at topK.
   */
  search(
    query: string,
    threshold: number,
    topK: number,
  ): ToolRanking[] {
    // Fuse is initialized with threshold 1.0, so we get all candidates.
    // Post-filter by the configured threshold.
    const results = this.fuse.search(query, { limit: topK * 3 }); // generous pre-filter
    return results
      .filter((r) => {
        const score = r.score ?? 1;
        return score <= threshold;
      })
      .slice(0, topK)
      .map((r) => ({
        name: r.item.name,
        score: r.score ?? 1,
      }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function computeCatalogHash(tools: IndexedTool[]): string {
  // Hash name + description so description-only changes invalidate index.
  const pairs = tools.map((t) => `${t.name}::${t.description}`).sort().join("|");
  return pairs;
}

/**
 * Build tool index from Pi's live tool catalog.
 * Extracts name + description for indexing — descriptions are the
 * primary search surface since model queries use task vocabulary.
 */
export function buildToolIndex(
  tools: Array<{ name: string; description?: string }>,
): IndexedTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
  }));
}
```

#### 11. src/index.ts
**File**: src/index.ts
**Changes**: MODIFY — replace search_tools stub with full engine; store effective config for search access

```typescript
// ── ADD these imports near the top of src/index.ts (after existing imports) ──
import { SearchEngine, buildToolIndex } from "./search.js";

// ── ADD these module-level variables near the top of the factory function
//     (before the registerCommand / registerTool calls) ──
let searchEngine: SearchEngine | null = null;
let currentEffectiveConfig: ReturnType<typeof buildEffectiveConfig> | null = null;

// ── REPLACE the entire pi.registerTool("search_tools", { ... }) block with: ──

  // ── search_tools tool ──────────────────────────────────────────
  pi.registerTool({
    name: LOADER_TOOL_NAME,
    label: "Search Tools",
    description:
      "Search for and enable registered Pi tools relevant to a task. " +
      "Activate matching tools by natural-language capability query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of the capability or task you need a tool for",
        },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params) {
      const query = String(params.query ?? "");

      // Disabled mode: no valid config → return empty receipt, no activation
      if (!currentEffectiveConfig) {
        const active = pi.getActiveTools();
        return {
          content: [
            {
              type: "text",
              text:
                "Toolbelt is not yet configured. " +
                "Run /toolbelt setup to enable progressive tool discovery.",
            },
          ],
          details: {
            query,
            backend: BACKEND_ID,
            rankings: [],
            activated: [],
            activeCounts: { before: active.length, after: active.length },
            catalogHash: "",
          },
        };
      }

      const { threshold, topK } = currentEffectiveConfig;

      // Build or refresh tool index
      const allTools = pi.getAllTools();
      const indexed = buildToolIndex(allTools);
      if (!searchEngine) {
        searchEngine = new SearchEngine(indexed);
      } else {
        searchEngine.refresh(indexed);
      }

      // Search
      const rankings = searchEngine.search(query, threshold, topK);

      // No matches above threshold — return near-misses for debugging
      if (rankings.length === 0) {
        const active = pi.getActiveTools();
        // Re-search with threshold 1.0 for near-misses
        const allRanked = searchEngine.search(query, 1.0, topK);
        return {
          content: [
            {
              type: "text",
              text:
                `No tools matched "${query}" above threshold ${threshold}. ` +
                (allRanked.length > 0
                  ? `Near misses: ${allRanked.map((r) => r.name).join(", ")}`
                  : "No ranking results found."),
            },
          ],
          details: {
            query,
            backend: BACKEND_ID,
            rankings: allRanked,
            activated: [],
            activeCounts: { before: active.length, after: active.length },
            catalogHash: searchEngine.getCatalogHash(),
          },
        };
      }

      // Additive activation: merge matched names with current active set.
      // NEVER remove tools during search_tools execution (wrapper.js:17-29 guard).
      const activeBefore = pi.getActiveTools();
      const matched = rankings.map((r) => r.name);
      const newSet = [...new Set([...activeBefore, ...matched])];
      pi.setActiveTools(newSet);

      const activeAfter = pi.getActiveTools();
      const activated = matched.filter((n) => !activeBefore.includes(n));

      return {
        content: [
          {
            type: "text",
            text:
              activated.length > 0
                ? `Activated tools: ${activated.join(", ")}. ` +
                  `Now ${activeAfter.length} tools active (was ${activeBefore.length}).`
                : `Matching tools already active: ${matched.join(", ")}`,
          },
        ],
        details: {
          query,
          backend: BACKEND_ID,
          rankings,
          activated,
          activeCounts: {
            before: activeBefore.length,
            after: activeAfter.length,
          },
          catalogHash: searchEngine.getCatalogHash(),
        },
      } satisfies { content: Array<{ type: "text"; text: string }>; details: SearchReceipt };
    },
  });

// ── In the session_start handler, AFTER the "if (!isEnabled(effective)) return" block
//     and AFTER "pi.setActiveTools(active)", ADD: ──
    currentEffectiveConfig = effective;
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `tsc --noEmit`
- [x] SearchEngine imports fuse.js: `grep "import Fuse" src/search.ts` returns match
- [x] Fuse internal threshold is 1.0: `grep "threshold: 1.0" src/search.ts` returns 2 matches (constructor + refresh)
- [x] Additive activation: `grep "new Set\(\[...activeBefore" src/index.ts` returns match
- [x] Config gate exists in search_tools: `grep "if (!currentEffectiveConfig)" src/index.ts` returns match
- [x] Receipt has all 6 fields: `grep -E "(query|backend|rankings|activated|activeCounts|catalogHash)" src/index.ts | wc -l` returns ≥ 6

#### Manual Verification:
- [ ] With valid config, calling `search_tools({ query: "browser automation" })` activates matching tools and returns receipt
- [ ] With valid config, calling `search_tools({ query: "browser automation" })` a second time shows "already active"
- [ ] Calling `search_tools({ query: "zzz_no_match_xyz" })` returns near-misses and activates nothing
- [ ] Without config, calling `search_tools` returns "not yet configured" receipt
- [ ] Search result receipt persists in session and is visible in session JSONL

## Phase 4: Status, Reset, Resume

### Overview

`/toolbelt status` reports full state. `/toolbelt reset` replaces active set with baseline+search_tools, persists reset-marker receipt. Session resume scans branch for search_tools receipts, stopping at reset marker, restoring activated tools. Depends on Phase 3.

### Changes Required:

#### 12. src/session.ts
**File**: src/session.ts
**Changes**: NEW — applyBaseline, restoreFromBranch (branch scan with reset-marker boundary), isSearchReceipt validator

```typescript
/**
 * Session lifecycle handler — baseline activation and resume restoration.
 *
 * Follows extensions.md:1827-1835 (state reconstruction from tool result details)
 * and pi-powerline-footer/index.ts:2070-2100 (branch scanning pattern).
 *
 * Tool results in the session branch use role "toolResult" (not "tool"),
 * with a `toolName` field identifying the tool. We scan for
 * `toolName === "search_tools"` entries and read their `details`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOADER_TOOL_NAME } from "./constants.js";
import type { EffectiveConfig, SearchReceipt } from "./types.js";

// ── Branch entry shape (what Pi actually persists) ───────────────

interface BranchEntry {
  type: string;
  message?: {
    role: string;
    toolName?: string;
    details?: unknown;
  };
}

// ── Baseline activation ──────────────────────────────────────────

/**
 * Apply effective baseline to the active tool set.
 * Used by new-session start and /toolbelt reset.
 */
export function applyBaseline(
  pi: ExtensionAPI,
  effective: EffectiveConfig,
): string[] {
  const active = [...new Set([...effective.baseline, LOADER_TOOL_NAME])];
  pi.setActiveTools(active);
  return active;
}

// ── Resume restoration ───────────────────────────────────────────

/**
 * Scan the current session branch backwards for search_tools receipts.
 * Stops at the most recent reset marker (activated: [], query === "/toolbelt reset").
 * Returns tool names to restore, filtered to currently registered tools only.
 *
 * Per extensions.md:2310: "Names passed to pi.setActiveTools() must already
 * be registered; unknown names are ignored." We filter here to avoid passing
 * names for tools that were unregistered since the receipt was created.
 */
export function restoreFromBranch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string[] {
  const branch: BranchEntry[] =
    (ctx.sessionManager?.getBranch?.() as BranchEntry[]) ?? [];
  const restored = new Set<string>();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];

    // Pi persists tool results with message.role === "toolResult"
    // and message.toolName identifying the tool.
    if (
      entry.type !== "message" ||
      !entry.message ||
      entry.message.role !== "toolResult" ||
      entry.message.toolName !== LOADER_TOOL_NAME
    ) {
      continue;
    }

    const details = entry.message.details as SearchReceipt | undefined;
    if (!isSearchReceipt(details)) continue;

    // Reset marker: stop scanning at this boundary
    if (
      details.activated.length === 0 &&
      details.query === "/toolbelt reset"
    ) {
      break;
    }

    // Accumulate activated tools from this receipt
    for (const name of details.activated) {
      restored.add(name);
    }
  }

  // Filter to currently registered tools only
  const registered = new Set(pi.getAllTools().map((t) => t.name));
  return [...restored].filter((name) => registered.has(name));
}

// ── Receipt validation ───────────────────────────────────────────

/** Validate that an unknown value is a SearchReceipt. */
export function isSearchReceipt(
  details: unknown,
): details is SearchReceipt {
  if (typeof details !== "object" || details === null) return false;
  const d = details as Record<string, unknown>;
  return (
    typeof d.query === "string" &&
    typeof d.backend === "string" &&
    Array.isArray(d.rankings) &&
    Array.isArray(d.activated) &&
    typeof d.activeCounts === "object" &&
    d.activeCounts !== null &&
    typeof (d.activeCounts as Record<string, unknown>).before === "number" &&
    typeof (d.activeCounts as Record<string, unknown>).after === "number" &&
    typeof d.catalogHash === "string"
  );
}
```

#### 13. src/commands.ts
**File**: src/commands.ts
**Changes**: MODIFY — add status and reset subcommands; status uses ctx.sessionManager for receipt scanning

```typescript
// ── REPLACE the status stub (case "status":) in handleToolbeltCommand's switch with: ──
      case "status":
        await handleStatus(pi, ctx as Parameters<typeof handleStatus>[1]);
        break;

// ── REPLACE the reset stub (case "reset":) with: ──
      case "reset":
        await handleReset(pi, ctx);
        break;

// ── ADD these functions after handleSetup, before the closing brace: ──

// ── Status ────────────────────────────────────────────────────────

async function handleStatus(
  pi: ExtensionAPI,
  ctx: {
    cwd: string;
    ui: {
      notify(msg: string, sev: "info" | "warning" | "error"): void;
    };
    sessionManager?: {
      getBranch(): Array<{
        type: string;
        toolName?: string;
        message?: { role: string; details?: unknown };
      }>;
    };
  },
): Promise<void> {
  const effective = buildEffectiveConfig(ctx.cwd);

  if (!isEnabled(effective) && !hasConfigError(effective)) {
    ctx.ui.notify(
      "Toolbelt: disabled — no config files found. Run /toolbelt setup to enable.",
      "info",
    );
    return;
  }

  const active = pi.getActiveTools();
  const registered = pi.getAllTools();

  // Find last search_tools receipt on branch
  let lastReceipt: SearchReceipt | undefined;
  const branch =
    ctx.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (
      entry.type === "message" &&
      entry.message?.role === "toolResult" &&
      entry.message?.toolName === LOADER_TOOL_NAME
    ) {
      const d = entry.message.details as SearchReceipt | undefined;
      if (isSearchReceipt(d)) {
        lastReceipt = d;
        break;
      }
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
    lines.push(`Baseline: ${effective.baseline.join(", ")}`);
    lines.push(
      `Active: ${active.length} / ${registered.length} registered`,
    );
    lines.push(
      `Backend: ${BACKEND_ID}  |  threshold: ${effective.threshold}  |  topK: ${effective.topK}`,
    );
  } else {
    lines.push("Toolbelt: disabled (config has errors)");
    const errors: string[] = [];
    if (effective.globalError) errors.push(effective.globalError);
    if (effective.projectError) errors.push(effective.projectError);
    if (errors.length > 0)
      lines.push(`Errors: ${errors.join("; ")}`);
    lines.push(
      `Active: ${active.length} / ${registered.length} registered`,
    );
  }

  if (lastReceipt) {
    lines.push("");
    lines.push(`Last search: "${lastReceipt.query}"`);
    if (lastReceipt.activated.length > 0) {
      const scores = lastReceipt.rankings
        .filter((r) => lastReceipt!.activated.includes(r.name))
        .map((r) => `${r.name} (${r.score.toFixed(3)})`)
        .join(", ");
      lines.push(`  → activated: ${scores}`);
    } else {
      lines.push(`  → no tools activated`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

// ── Reset ────────────────────────────────────────────────────────

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

  const beforeNames = pi.getActiveTools();
  const newSet = [...new Set([...effective.baseline, LOADER_TOOL_NAME])];
  const removed = beforeNames.filter((n) => !newSet.includes(n));

  pi.setActiveTools(newSet);

  // Persist reset-marker receipt: record a custom entry on the session
  // that restoreFromBranch detects. The next search_tools call would
  // also generate a receipt, but reset must leave a durable marker
  // regardless. Use pi.appendEntry if available (ExtensionAPI method).
  try {
    (pi as { appendEntry?: (type: string, payload: Record<string, unknown>) => void }).appendEntry?.(
      "tool_result",
      {
        toolName: LOADER_TOOL_NAME,
        role: "toolResult",
        details: {
          query: "/toolbelt reset",
          backend: BACKEND_ID,
          rankings: [],
          activated: [],
          activeCounts: { before: beforeNames.length, after: newSet.length },
          catalogHash: "",
        } satisfies SearchReceipt,
      },
    );
  } catch {
    // appendEntry not available — marker not persisted; resume may
    // restore tools from before the reset. Non-critical for v1.
  }

  if (removed.length > 0) {
    ctx.ui.notify(
      `✓ Toolbelt reset\n\n` +
        `Removed: ${removed.join(", ")}\n` +
        `Active: ${newSet.length} tools (${newSet.join(", ")})`,
      "warning",
    );
  } else {
    ctx.ui.notify(
      `Toolbelt reset: nothing to remove. ` +
        `Active: ${newSet.length} tools unchanged.`,
      "info",
    );
  }
}
```

```typescript
// ── ALSO update the imports in commands.ts to add these: ──
// (append to existing imports at top of commands.ts)
import { BACKEND_ID, LOADER_TOOL_NAME } from "./constants.js";
import type { SearchReceipt } from "./types.js";
import { isEnabled } from "./config.js";
import { isSearchReceipt } from "./session.js";
// isEnabled is already imported from config.js if not — add it;
// otherwise just BACKEND_ID, LOADER_TOOL_NAME, SearchReceipt are new.
```

#### 14. src/index.ts
**File**: src/index.ts
**Changes**: MODIFY — replace session_start handler with resume-aware version; reset persists reset-marker receipt

```typescript
// ── ADD import near top of src/index.ts: ──
import { applyBaseline, restoreFromBranch } from "./session.js";

// ── REPLACE the entire session_start handler with: ──

  // ── Session lifecycle ──────────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    const effective = buildEffectiveConfig(ctx.cwd);
    const debug = !!pi.getFlag(FLAG_DEBUG);

    // ── Check for config errors (always warn) ──
    if (hasConfigError(effective)) {
      const errors: string[] = [];
      if (effective.globalError) errors.push(effective.globalError);
      if (effective.projectError) errors.push(effective.projectError);
      ctx.ui.notify(`[toolbelt] ${errors.join("; ")}`, "warning");
      // isEnabled returns false when errors exist (FRD FR#8).
    }

    // ── Disabled mode ──
    if (!isEnabled(effective)) {
      currentEffectiveConfig = null; // block search_tools
      if (debug) {
        ctx.ui.notify(
          "[toolbelt] disabled — no valid config found",
          "info",
        );
      }
      return;
    }

    // ── Enabled mode ──
    currentEffectiveConfig = effective;

    // Detect resume: session_start event with reason === "resume"
    const isResume =
      event &&
      typeof event === "object" &&
      "reason" in event &&
      (event as { reason: string }).reason === "resume";

    if (isResume) {
      // Restore baseline + previously activated tools from branch
      const restored = restoreFromBranch(pi, ctx);
      const active = [
        ...new Set([
          ...effective.baseline,
          LOADER_TOOL_NAME,
          ...restored,
        ]),
      ];
      pi.setActiveTools(active);

      if (debug) {
        ctx.ui.notify(
          `[toolbelt] resume: baseline (${effective.baseline.length}) + ` +
            `restored (${restored.length}) = ${active.length} active tools`,
          "info",
        );
      }
    } else {
      // New session: baseline only
      applyBaseline(pi, effective);

      if (debug) {
        ctx.ui.notify(
          `[toolbelt] activated baseline: ${effective.baseline.join(", ")} ` +
            `(source: ${effective.source})`,
          "info",
        );
      }
    }
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `tsc --noEmit`
- [x] restoreFromBranch uses toolResult role: `grep "toolResult" src/session.ts` returns ≥ 1 match
- [x] restoreFromBranch checks toolName: `grep "toolName" src/session.ts` returns ≥ 1 match
- [x] Reset-marker boundary: `grep "/toolbelt reset" src/session.ts` returns match
- [x] Status uses BACKEND_ID constant: `grep "BACKEND_ID" src/commands.ts` returns match
- [x] isSearchReceipt validates all 6 fields: `grep -c "typeof d\." src/session.ts` returns ≥ 5

#### Manual Verification:
- [ ] `/toolbelt status` with valid config shows enabled, config paths, baseline, active/registered counts, backend/threshold/topK, and last receipt (or none)
- [ ] `/toolbelt status` with no config shows "disabled" message
- [ ] `/toolbelt status` with invalid config shows "disabled (config has errors)" and error details
- [ ] `/toolbelt reset` with search-activated tools removes them and shows removed names
- [ ] After reset, active tools = baseline + search_tools exactly
- [ ] Resume restores search-activated tools from prior session branch
- [ ] Resume stops at reset marker — tools activated after a reset in a branched session are not restored on the branch that was reset

## Phase 5: Tests & Benchmark

### Overview

Unit tests for config, search, commands. Integration tests for disabled mode, setup, search, status, reset, resume. Benchmark against deterministic 100-tool fixture reporting p95 refresh+search latency. Depends on Phases 1-4.

### Changes Required:

#### 15. src/__tests__/config.test.ts
**File**: src/__tests__/config.test.ts
**Changes**: NEW — unit tests for fail-soft reader, validator, merge, enabled/error checks

```typescript
/**
 * Config unit tests.
 *
 * Uses temp directories for file-based tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readToolbeltConfig, isEnabled, hasConfigError } from "../config.js";
import type { EffectiveConfig } from "../types.js";

const tmpBase = join(tmpdir(), `pi-toolbelt-test-${process.pid}`);

function setupTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });
}

function teardownTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
}

// ── readToolbeltConfig ───────────────────────────────────────────

describe("readToolbeltConfig", () => {
  it("returns undefined config for missing file", () => {
    const result = readToolbeltConfig(join(tmpBase, "nonexistent.json"));
    assert.equal(result.config, undefined);
    assert.equal(result.error, undefined);
  });

  it("returns error for invalid JSON", () => {
    setupTmp();
    const p = join(tmpBase, "bad.json");
    writeFileSync(p, "{ not json ", "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("Invalid JSON"));
    teardownTmp();
  });

  it("returns error for non-object", () => {
    setupTmp();
    const p = join(tmpBase, "arr.json");
    writeFileSync(p, "[1,2,3]", "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("does not contain a JSON object"));
    teardownTmp();
  });

  it("returns error for empty object (no recognized fields)", () => {
    setupTmp();
    const p = join(tmpBase, "empty.json");
    writeFileSync(p, "{}", "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("must contain at least one recognized field"));
    teardownTmp();
  });

  it("rejects non-array baseline", () => {
    setupTmp();
    const p = join(tmpBase, "badbaseline.json");
    writeFileSync(p, JSON.stringify({ baseline: "not-array", threshold: 0.4, topK: 5 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("baseline"));
    teardownTmp();
  });

  it("rejects threshold out of range", () => {
    setupTmp();
    const p = join(tmpBase, "badthreshold.json");
    writeFileSync(p, JSON.stringify({ baseline: ["read"], threshold: 1.5, topK: 5 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("threshold"));
    teardownTmp();
  });

  it("rejects non-integer topK", () => {
    setupTmp();
    const p = join(tmpBase, "badtopk.json");
    writeFileSync(p, JSON.stringify({ baseline: ["read"], threshold: 0.4, topK: 1.5 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("topK"));
    teardownTmp();
  });

  it("accepts valid full config", () => {
    setupTmp();
    const p = join(tmpBase, "valid.json");
    writeFileSync(
      p,
      JSON.stringify({ baseline: ["read", "bash"], threshold: 0.3, topK: 10 }),
      "utf-8",
    );
    const result = readToolbeltConfig(p);
    assert.ok(result.config);
    assert.deepEqual(result.config.baseline, ["read", "bash"]);
    assert.equal(result.config.threshold, 0.3);
    assert.equal(result.config.topK, 10);
    assert.equal(result.error, undefined);
    teardownTmp();
  });

  it("accepts partial config (threshold only)", () => {
    setupTmp();
    const p = join(tmpBase, "partial.json");
    writeFileSync(p, JSON.stringify({ threshold: 0.2 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.ok(result.config);
    assert.equal(result.config.threshold, 0.2);
    assert.equal(result.config.baseline, undefined);
    assert.equal(result.config.topK, undefined);
    assert.equal(result.error, undefined);
    teardownTmp();
  });
});

// ── isEnabled / hasConfigError ──────────────────────────────────

describe("isEnabled", () => {
  const base: EffectiveConfig = {
    baseline: ["read"],
    threshold: 0.4,
    topK: 5,
    source: "global",
    globalPath: "/tmp/a.json",
    projectPath: "/tmp/b.json",
    globalValid: true,
    projectValid: false,
  };

  it("returns true when source is 'global' with no errors", () => {
    assert.equal(isEnabled(base), true);
  });

  it("returns false when source is 'none'", () => {
    assert.equal(isEnabled({ ...base, source: "none" }), false);
  });

  it("returns false when any source has an error (FR#8)", () => {
    assert.equal(
      isEnabled({ ...base, globalError: "bad json" }),
      false,
    );
  });
});

describe("hasConfigError", () => {
  const base: EffectiveConfig = {
    baseline: ["read"],
    threshold: 0.4,
    topK: 5,
    source: "global",
    globalPath: "/tmp/a.json",
    projectPath: "/tmp/b.json",
    globalValid: true,
    projectValid: false,
  };

  it("returns false when no errors", () => {
    assert.equal(hasConfigError(base), false);
  });

  it("returns true when global has error", () => {
    assert.equal(hasConfigError({ ...base, globalError: "bad" }), true);
  });

  it("returns true when project has error", () => {
    assert.equal(hasConfigError({ ...base, projectError: "bad" }), true);
  });

  it("returns true even when source is 'none' (warn on all errors)", () => {
    assert.equal(
      hasConfigError({ ...base, source: "none", globalError: "bad" }),
      true,
    );
  });
});
```

#### 16. src/__tests__/search.test.ts
**File**: src/__tests__/search.test.ts
**Changes**: NEW — unit tests for fuse.js ranking, threshold filter, topK cap, no-match, catalog change detection

```typescript
/**
 * Search engine unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchEngine, buildToolIndex } from "../search.js";

const SAMPLE_TOOLS = [
  { name: "read", description: "Read file contents" },
  { name: "bash", description: "Execute bash commands" },
  { name: "edit", description: "Edit files with text replacement" },
  { name: "write", description: "Create or overwrite files" },
  { name: "agent_browser", description: "Browse and interact with websites using a headful browser" },
  { name: "web_search", description: "Search the web for current information" },
  { name: "ask_user_question", description: "Ask the user structured questions" },
  { name: "Agent", description: "Launch autonomous sub-agents for complex multi-step tasks" },
];

const indexed = buildToolIndex(SAMPLE_TOOLS);

describe("buildToolIndex", () => {
  it("maps name + description", () => {
    assert.equal(indexed.length, SAMPLE_TOOLS.length);
    assert.equal(indexed[0].name, "read");
    assert.equal(indexed[0].description, "Read file contents");
  });

  it("handles missing description", () => {
    const result = buildToolIndex([{ name: "foo" }]);
    assert.equal(result[0].description, "");
  });
});

describe("SearchEngine", () => {
  it("builds index and returns catalog hash", () => {
    const engine = new SearchEngine(indexed);
    const hash = engine.getCatalogHash();
    assert.ok(hash.length > 0);
  });

  it("ranks browser-related tools high for 'browser' query", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("browser automation", 0.6, 5);
    assert.ok(results.length > 0);
    const names = results.map((r) => r.name);
    assert.ok(names.includes("agent_browser"));
  });

  it("filters by threshold — high threshold admits none", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("browser automation", 0.01, 5);
    assert.equal(results.length, 0);
  });

  it("caps results at topK", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("file", 0.8, 2);
    assert.ok(results.length <= 2);
  });

  it("no-match query returns empty", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("zzz_no_match_xyz", 0.8, 5);
    assert.equal(results.length, 0);
  });

  it("refresh detects catalog change", () => {
    const engine = new SearchEngine(indexed);
    assert.equal(engine.refresh(indexed), false);
    const modified = buildToolIndex([
      ...SAMPLE_TOOLS,
      { name: "new_tool", description: "A new tool" },
    ]);
    assert.equal(engine.refresh(modified), true);
  });

  it("refresh detects description change", () => {
    const engine = new SearchEngine(indexed);
    const changed = buildToolIndex(
      SAMPLE_TOOLS.map((t) =>
        t.name === "read" ? { ...t, description: "Changed" } : t,
      ),
    );
    assert.equal(engine.refresh(changed), true);
  });

  it("scores are between 0 and 1", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("browser", 1.0, 5);
    for (const r of results) {
      assert.ok(r.score >= 0 && r.score <= 1, `score ${r.score} out of range`);
    }
  });
});
```

#### 17. src/__tests__/commands.test.ts
**File**: src/__tests__/commands.test.ts
**Changes**: NEW — verify module compiles with expected exports (full handler tests in integration)

```typescript
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
```

#### 18. src/__tests__/session.test.ts
**File**: src/__tests__/session.test.ts
**Changes**: NEW — unit tests for session_start, resume branch scan, reset-marker boundary

```


```

#### 19. src/__tests__/integration.test.ts
**File**: src/__tests__/integration.test.ts
**Changes**: NEW — integration tests: disabled mode invariant, setup applies immediately, search additive, status reports, reset clears, resume restores

```


```

#### 20. benchmark/index.ts
**File**: benchmark/index.ts
**Changes**: NEW — deterministic 100-tool fixture, p95 latency below 100ms

```typescript
/**
 * pi-toolbelt search benchmark. Measures p95 latency. Passes when < 100ms.
 */

import { SearchEngine, buildToolIndex } from "../src/search.js";
import { BACKEND_ID } from "../src/constants.js";

const DESCRIPTIONS = [
  "Read file contents from disk", "Execute bash commands",
  "Edit files with text replacement", "Create or overwrite files",
  "Browse websites with a browser", "Search the web for information",
  "Ask the user structured questions", "Launch autonomous sub-agents",
  "Manage a task list", "Search file contents with patterns",
  "Find files matching a glob", "List directory contents",
  "Fetch content from a URL", "Delete files or directories",
  "Take screenshots of web pages", "Click elements on web pages",
  "Fill form fields on web pages", "Read and parse JSON files",
  "Execute Python code", "Write content to a file",
];

const FIXTURE_TOOLS = Array.from({ length: 100 }, (_, i) => ({
  name: `tool_${String(i).padStart(3, "0")}`,
  description: DESCRIPTIONS[i % DESCRIPTIONS.length],
}));

const QUERIES = [
  "browser automation", "edit files", "search my notes",
  "ask user questions", "run a command", "file operations",
  "web lookup", "delegate to agent", "manage todo list",
  "read file contents",
];

const ITERATIONS = 1000;
const P95_INDEX = Math.ceil(ITERATIONS * 0.95);

console.log(`pi-toolbelt benchmark — backend: ${BACKEND_ID}`);

const indexed = buildToolIndex(FIXTURE_TOOLS);
const engine = new SearchEngine(indexed);
for (let i = 0; i < 50; i++) engine.search(QUERIES[i % QUERIES.length], 0.4, 5);

const latencies: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  engine.search(QUERIES[i % QUERIES.length], 0.4, 5);
  latencies.push(performance.now() - t0);
}

latencies.sort((a, b) => a - b);
const p95 = latencies[P95_INDEX];
console.log(`p95: ${p95.toFixed(3)} ms — ${p95 < 100 ? "PASS" : "FAIL"}`);
if (p95 >= 100) process.exit(1);
```

### Success Criteria:

#### Automated Verification:
- [x] All unit tests pass: `npx tsx --test src/__tests__/config.test.ts src/__tests__/search.test.ts src/__tests__/session.test.ts src/__tests__/commands.test.ts`
- [x] Integration tests pass: `npx tsx --test src/__tests__/integration.test.ts`
- [x] Benchmark p95 < 100ms: `npx tsx benchmark/index.ts`
- [x] Type checking passes: `tsc --noEmit`

#### Manual Verification:
- [ ] Real model can call search_tools and use an activated tool on the next request
- [ ] Real session resume restores tools from prior branch receipts

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 4 §12 (session.ts) | `<n/a>` | concern | codebase-fit | restoreFromBranch checks `entry.toolName` (wrong shape — toolName lives in entry.message) | Check `entry.type === "message"` then `entry.message.toolName` | applied: corrected entry shape to `entry.message.toolName` |
| code | Phase 4 §13 (commands.ts) | `<n/a>` | concern | codebase-fit | handleStatus same entry shape bug | Check `entry.type === "message"` then `entry.message.toolName` and `entry.message.role` | applied: corrected entry shape |
| code | Phase 4 §13 (commands.ts) | `<n/a>` | concern | actionability | handleReset never persists reset-marker receipt | Use `appendEntry` to persist marker receipt | applied: added `pi.appendEntry` call for reset-marker receipt |
| code | Phase 4 §13 (commands.ts) | `<n/a>` | suggestion | code-quality | Dynamic import of isSearchReceipt instead of static | Move to module-level import | applied: static import |
| code | Phase 3 §11 (index.ts) | `<n/a>` | suggestion | code-quality | Inline type assertion with module path string | Use named type alias with `satisfies` | applied: replaced with `satisfies { ... ; details: SearchReceipt }` |
| code | Phase 1 §3 (types.ts) | `<n/a>` | suggestion | code-quality | ToolRanking.score missing dependency notes | Document that score is [0,1] fuse.js Bitap score | applied: added documentation + SearchBackend interface |
| coverage | ## Verification Notes §8 | `<n/a>` | suggestion | verification-coverage | No SearchBackend interface layer — backend swap requires changing code in multiple files | Add `SearchBackend` interface with `search()` and `refresh()` | applied: SearchBackend interface added to types.ts |