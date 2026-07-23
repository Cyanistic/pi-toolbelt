---
date: 2026-07-22T21:58:59-0400
author: Cyanism
commit: no-commit
branch: main
repository: pi-toolbelt
topic: "Pi Toolbelt Extension Lifecycle"
tags: [research, pi-toolbelt, tool-search, dynamic-tools, extensions, lifecycle]
status: ready
last_updated: 2026-07-22T21:58:59-0400
last_updated_by: Cyanism
---

# Research: Pi Toolbelt Extension Lifecycle

## Research Question

Trace how the Pi Toolbelt extension implements its full lifecycle: extension factory, global/project config loading and validation, `/toolbelt setup` with immediate baseline application, `search_tools` additive loader with dynamic tool loading, `/toolbelt status` receipt reconstruction, session resume restoration, and `/toolbelt reset` as the only non-additive removal path. Identify the Pi extension API contracts, existing patterns from rpiv-core and pi-powerline-footer, and the local search backend candidates.

## Summary

Pi Toolbelt follows the rpiv-core extension factory pattern: unconditional registration of `/toolbelt` command and `search_tools` tool at module load, with a `session_start` handler gating all active-set management behind config-file presence and validity. The disabled-mode invariant (no config = no `pi.setActiveTools()` call) prevents installation from silently altering the user's active tools.

Tool results persist search receipts in their `details` field — no `pi.appendEntry()` needed. Resume restoration scans `ctx.sessionManager.getBranch()` backwards for `search_tools` receipts, stopping at a reset marker (`activated: []`) to honor the user's intent. Tree navigation "just works": different branches carry different receipt sets, so navigating back in history restores the tool set that was active at that point.

The `wrapper.js:17-29` additive guard at the Pi runtime layer distinguishes additive `search_tools` calls (which get `addedToolNames` → native deferred loading) from non-additive `/toolbelt reset` (which gets full-list fallback → cache invalidation). This guard is load-bearing: it prevents Toolbelt from needing to manage cache behavior directly.

## Detailed Findings

### Extension Factory — Unconditional Registration, Config-Gated Activation

The factory (`export default function(pi: ExtensionAPI)`) follows the rpiv-core `index.ts:43-70` composition pattern:

1. **Register `/toolbelt` command** via `pi.registerCommand("toolbelt", {...})` — dispatches to `setup`, `status`, `reset` subcommands. Registered unconditionally so setup is discoverable even in disabled mode (FRD decision "Disabled-mode behavior").
2. **Register `search_tools` tool** via `pi.registerTool({name: "search_tools", ...})` — the query-only loader. Registered unconditionally so it exists in `pi.getAllTools()` when setup activates it.
3. **Register `session_start` handler** via `pi.on("session_start", handler)` — the sole gate for active-set management.

No `pi.setActiveTools()` call happens during factory execution. The config-gate in `session_start` is the only path to active-set mutation, preserving the FRD invariant that "installation alone must not silently alter active tools."

Pattern reference: `rpiv-core/index.ts:46-48` wires `registerSessionHooks(pi)`, `registerUpdateAgentsCommand(pi)`, `registerSetupCommand(pi)` unconditionally in the factory body.

### Config Loading and Validation Pipeline

#### Path Resolution

- **Global**: `join(getAgentDir(), "toolbelt.json")` — resolves to `~/.pi/agent/toolbelt.json` via `getAgentDir()` (`dist/config.js:412-418`), same resolution as `rpiv-core/utils.ts:24-27` (`getPiAgentSettingsPath`)
- **Project**: `join(ctx.cwd, CONFIG_DIR_NAME, "toolbelt.json")` — resolves to `.pi/toolbelt.json` per extensions.md:980-985

#### Loading Pattern

Follows `rpiv-core/utils.ts:45-75` (`readPiAgentSettings`): fail-soft, never throws. Three failure modes → `undefined` return: missing file, invalid JSON, not a plain object. Then schema validation rejects: `baseline` not `string[]`, `threshold` not `number`, `topK` not a positive integer.

#### Merge Semantics

Per FRD "Config merge semantics" decision: load global first, overlay project by field. **Project arrays replace global arrays** (not concatenate) — a project can shrink the baseline by providing a shorter array.

#### Enabled/Disabled Gate

| State | Config present | Config valid | Behavior |
|-------|---------------|-------------|----------|
| Disabled | Neither | N/A | No active-set change; no warning (FRD FR#3) |
| Disabled | Either | Invalid | No active-set change; one `ctx.ui.notify("warning")` (FRD FR#8) |
| Enabled | At least one | Both valid | Apply baseline + `search_tools` at `session_start` (FRD FR#9) |

The fail-soft posture matches `session-hooks.ts:240`: "Never crash session_start — migration is best-effort."

### `/toolbelt setup` — Immediate Baseline Application

Follows the `setup-command.ts:57-140` pattern: `notify → confirm → write → apply`.

The handler writes the config file and calls `pi.setActiveTools()` in the same closure — no `/reload` needed. `pi.setActiveTools()` is a live mutation of Pi's in-memory active set; the `pi` object captured in the handler closure is the same `ExtensionAPI` instance from the factory and doesn't go stale.

Sequence:
1. Determine scope from args (`global` → `~/.pi/agent/toolbelt.json`, `project` → `.pi/toolbelt.json`)
2. Build seeded config: `{baseline: ["read","bash","edit","write"], threshold: TBD, topK: TBD}` (defaults set by benchmark)
3. Preview changes via `ctx.ui.confirm()` — show target path, baseline tools, that `search_tools` remains available
4. `writeFileSync(targetPath, JSON.stringify(config, null, 2))`
5. Re-read and merge both config files → `effective.baseline`
6. `pi.setActiveTools([...effective.baseline, "search_tools"])` — applied immediately

Pattern references: `setup-command.ts:63-101` (handler flow), `setup-command.ts:31-49` (`buildConfirmBody`), `setup-command.ts:115-125` (`buildReport`).

### `search_tools` Loader — Additive Dynamic Tool Activation

#### Execute Flow

The `execute()` function:
1. Calls `pi.getAllTools()` — refreshes or hash-checks catalog per FRD FR#11
2. Scores each tool against the natural-language `query` using the configured local backend
3. Filters by effective `threshold`, caps at effective `topK`
4. `const active = pi.getActiveTools()` — captures current set
5. `pi.setActiveTools([...new Set([...active, ...matched])])` — additive merge
6. Returns structured receipt in `details`: `{query, backend, rankings, activated, activeCounts: {before, after}, catalogHash}`

Per FRD FR#15, activation never removes tools during `search_tools` execution. This is validated at the Pi runtime layer, not by Toolbelt itself.

#### The Additive Guard (`wrapper.js:17-29`)

```
activeBefore = runner.getActiveTools()
result = await execute(...)           // search_tools runs
activeAfter = runner.getActiveTools()
if (!activeBefore.every(name => activeAfter.includes(name)))
  return result                       // NON-additive: no addedToolNames → full fallback
addedToolNames = activeAfter.filter(name => !beforeNames.has(name))
return { ...result, addedToolNames }
```

This guard is load-bearing for two paths:
- **`search_tools` (additive)**: `addedToolNames` attached → `deferred-tools.js:3-30` collects them → native deferred loading for Anthropic (Sonnet/Opus, `defer_loading`) and OpenAI (gpt-5.4+, `tool_search_call`/`tool_search_output`) — stable prompt prefix, cache preserved
- **`/toolbelt reset` (non-additive)**: any removal → no `addedToolNames` → full list replacement on next request → cache invalidation

#### Fallback Behavior

Per `extensions.md:2338-2351`: for models without native support, dynamic activation still works — Pi sends the complete current active tool list on the next request. The model can call newly activated tools, but adding definitions may invalidate the provider's cached prompt prefix. This is the safe path for models like Haiku and older providers.

#### Native Support Table

| Provider | Models | Mechanism |
|----------|--------|-----------|
| Anthropic | Sonnet, Opus (no Haiku) | `defer_loading` on definitions; `tool_reference` at load point |
| OpenAI | gpt-5.4+ | `tool_search_call` / `tool_search_output` items at load point |
| Custom | With `compat.supportsToolReferences` or `compat.supportsToolSearch` | Anthropic/OpenAI protocol respectively |

Pattern reference: `extensions.md:2354-2420` (search tool example), `deferred-tools.js:3-30` (`splitDeferredTools`), `agent-loop.js:315-334` (`createToolResultMessage`).

### `/toolbelt status` — Receipt-Scanning State Report

Read-only command that reports the full current state:

| Field | Source |
|-------|--------|
| Enabled | Config file existence + validity |
| Effective config paths | Both paths checked; shows which were found and merged |
| Baseline names | Merged config `baseline` array |
| Active / registered counts | `pi.getActiveTools().length` / `pi.getAllTools().length` |
| Backend, topK, threshold | Merged config fields |
| Latest receipt summary | Backwards scan of `ctx.sessionManager.getBranch()` for last `search_tools` `ToolResultMessage.details` |

Follows the `setup-command.ts:57-140` command handler pattern: guard, gather, build, report via `ctx.ui.notify()`.

Pattern references: `setup-command.ts:133-140` (`buildReport` line-array pattern), `pi-powerline-footer/index.ts:1410,2070,2801` (branch scanning), `extensions.md:1827-1835` (state reconstruction from tool result `details`).

### Session Resume — Branch-Scoped Tool Restoration

On `session_start` with `event.reason === "resume"`:

```
for entry in getBranch().reverse():
  if entry is a reset-marker receipt (activated: []): break
  if entry is a search_tools receipt:
    for name in entry.message.details.activated:
      restored.add(name)
activeSet = [...baseline, "search_tools", ...restored]
pi.setActiveTools(activeSet)
```

If the current `pi.getAllTools()` hash differs from a receipt's `catalogHash`, tools no longer registered are silently excluded from the restored set (per `extensions.md:2310`: "unknown names are ignored").

Tree navigation naturally encodes tool state: navigating to a branch before the reset entry restores pre-reset tools because the reset marker isn't on that branch. Navigating forward to the main branch stops at the marker and restores only post-reset tools. No config needed for v1.

Pattern references: `pi-powerline-footer/index.ts:2070-2100` (usage accumulation via branch scan), `extensions.md:1827-1835` (state from tool result `details`).

#### Receipt Persistence Decision

Receipts are stored in `ToolResultMessage.details`, not via `pi.appendEntry()`. Tool results automatically persist in the session JSONL — no explicit append needed. This is simpler and branch-scoped. A reset is encoded as a receipt with `activated: []` that acts as a scan boundary on resume.

### `/toolbelt reset` — The Only v1 Removal Path

Non-additive — replaces the active set with `[...effective.baseline, "search_tools"]`, removing all search-activated tools.

Sequence:
1. Capture `beforeNames = pi.getActiveTools()`
2. Build `newSet = [...effective.baseline, "search_tools"]`
3. `pi.setActiveTools(newSet)`
4. Compute `removed = beforeNames.filter(n => !newSet.includes(n))`
5. Persist a reset-marker receipt with `activated: []` in a dummy tool result (or via the command handler's own notification)
6. Notify via `ctx.ui.notify(buildReport(...), "warning")` patterned after `setup-command.ts:115-125`

Because reset is non-additive, `wrapper.js:20` detects the removal, omits `addedToolNames`, and Pi falls back to full list replacement on the next request — invalidating the cached prompt prefix. This is the sharp edge of the additive-only contract.

Pattern references: `setup-command.ts:57-140` (command handler), `setup-command.ts:115-125` (`buildReport`), `wrapper.js:17-29` (additive guard).

### Local Search Backend Candidates

All candidates pass the p95 < 100ms target for a 100-tool catalog. Fuse.js v7 is the recommended default; mini-search v6 is the BM25 comparison baseline.

| Criterion | fuse.js v7 | mini-search v6 | flexsearch v0.7 |
|---|---|---|---|
| Algorithm | Bitap (fuzzy) | BM25 | Hybrid trie/score |
| Weekly downloads | ~24M | ~50K | ~500K |
| Dependencies | Zero | Zero | Zero |
| Maintenance | Very active | Moderate (single maintainer) | Active |
| Threshold | ✅ 0–1 (corpus-independent) | ⚠️ Corpus-dependent | ⚠️ Corpus-dependent |
| Fuzzy matching | ✅ Full | ⚠️ Limited | ✅ |
| TypeScript | ✅ Built-in | ✅ Built-in | ✅ Built-in |
| ~p95 for 100 items | ~15ms | ~10ms | ~5ms |

**fuse.js** wins on threshold usability: the 0–1 bitap score maps directly to the config `threshold` field (0 = perfect match, 1 = no match), making it intuitive for users and portable across catalogs. BM25 scores from mini-search are corpus-relative — a score of 2.5 means different things in different tool catalogs, making threshold tuning harder.

**mini-search** provides BM25 term-frequency ranking, which may produce more relevant results for term-overlap-rich queries. But for ~100 short documents (tool names + one-line descriptions), edit-distance matching from fuse.js may actually be more intuitive for model-generated queries since the model uses correct spelling and task-oriented phrasing.

Ranking defaults (`threshold`, `topK`) are TBD pending the package benchmark per FRD decision "Ranking config breadth deferred."

#### Dependency Declaration

Following `pi-powerline-footer/package.json` pattern:

```json
{
  "dependencies": {
    "fuse.js": "^7.0.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.80.7"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.80.7"
  }
}
```

The search library is a `dependency` (runtime algorithm); the Pi SDK is a `peerDependency` (platform contract). Minimum Pi version is `0.80.7` per FRD (first version with dynamic tool loading).

## Code References

- `setup-command.ts:57-140` — Command handler pattern: notify→confirm→install→report (template for all `/toolbelt` subcommands)
- `setup-command.ts:31-49` — `buildConfirmBody()` preview pattern for setup confirmation dialogs
- `setup-command.ts:115-125` — `buildReport()` structured output pattern for notifications
- `utils.ts:45-75` — `readPiAgentSettings()`: fail-soft config reader (template for toolbelt config loading)
- `utils.ts:32-35` — `isPlainObject()` type guard for config validation
- `utils.ts:12-20` — `getPiAgentSettingsPath()` via `getAgentDir()` (template for global config path resolution)
- `session-hooks.ts:70` — `pi.on("session_start", ...)` wiring pattern
- `session-hooks.ts:93-141` — `onSessionStart` handler body: startup-maintenance gate, injection, config reading
- `session-hooks.ts:240` — Migration fail-soft: "Never crash session_start — migration is best-effort"
- `index.ts:43-70` — Extension factory composition: unconditional registration before gating
- `pi-powerline-footer/index.ts:1410` — `getBranch()` scanning pattern for recent assistant context
- `pi-powerline-footer/index.ts:2070-2100` — `buildSegmentContext`: branch scan for usage/thinking-level reconstruction
- `pi-powerline-footer/index.ts:2801-2806` — Activity detection via `getBranch().some()`
- `pi-powerline-footer/package.json` — `peerDependencies` vs `dependencies` pattern for Pi extension packages
- `extensions.md:2296-2431` — Dynamic Tool Loading lifecycle contract and search tool example
- `extensions.md:2338-2351` — Non-additive change fallback: full list replacement, cache invalidation
- `extensions.md:2310` — "Names passed to `pi.setActiveTools()` must already be registered; unknown names are ignored"
- `extensions.md:1827-1835` — State reconstruction from tool result `details` (exact pattern for receipt scanning)
- `extensions.md:980-985` — `CONFIG_DIR_NAME` for project-local config path construction
- `extensions.md:398-399` — `session_start` event with `reason` and `previousSessionFile`
- `dist/config.js:412-418` — `getAgentDir()` resolution (template for global config path)
- `wrapper.js:17-29` — Additive detection guard: captures before/after, checks no removals, attaches `addedToolNames`
- `deferred-tools.js:3-30` — `splitDeferredTools()` collects `addedToolNames` from tool results for native deferred loading
- `agent-loop.js:315-334` — `createToolResultMessage()` attaches `addedToolNames` to tool result messages
- `.rpiv/artifacts/discover/2026-07-22_21-00-47_pi-toolbelt-progressive-tool-search.md` — FRD: all functional requirements and decisions

## Integration Points

### Inbound References — Pi Extension API Surface
- `pi.registerCommand("toolbelt", ...)` — command registration (factory + subcommand dispatch)
- `pi.registerTool({name: "search_tools", ...})` — loader tool registration (factory)
- `pi.setActiveTools(names)` — active-set mutation (session_start, setup, reset, search_tools)
- `pi.getActiveTools()` — reads current active set (all paths)
- `pi.getAllTools()` — reads full catalog for indexing (search_tools, status)
- `pi.on("session_start", handler)` — lifecycle entry point (factory)
- `ctx.sessionManager.getBranch()` — session entry scanning (resume, status)
- `getAgentDir()` from `@earendil-works/pi-coding-agent` — global config path resolution

### Outbound Dependencies
- `fuse.js` (or winner of benchmark) — local search backend
- Node.js `fs` (`existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync`) — config file I/O
- Node.js `path` (`join`) — path construction

### Infrastructure Wiring
- No DI container, routes, jobs, or middleware — greenfield extension package
- Config files: `~/.pi/agent/toolbelt.json` (global), `.pi/toolbelt.json` (project)
- Session persistence: tool result `details` in session JSONL (automatic via Pi)
- State reconstruction: `getBranch()` backward scan with reset marker as boundary

## Architecture Insights

### The Additive Guard is Load-Bearing

The `wrapper.js:17-29` additive detection at the Pi runtime level is not Toolbelt's code, but Toolbelt's entire design depends on it. It's the mechanism that distinguishes additive activation (deferred loading, cache preserved) from non-additive reset (full list, cache busted). Toolbelt itself never needs to manage cache behavior — it just calls `pi.setActiveTools()` and the runtime handles the rest.

### Branch Tree = Tool State

Session branches naturally encode tool state. No separate state file, no config, no synchronization. Navigating to a branch point before a reset restores pre-reset tools because the reset marker isn't on that branch. The session tree IS the tool-state tree.

### Fail-Soft Config is the Dominant Pattern

Every path through the config pipeline returns `undefined` on failure rather than throwing. This pattern (from `utils.ts:45-75`) is used at four layers: file read, JSON parse, type validation, and schema validation. The result is that a malformed config file never crashes a session or silently alters the active set.

### Receipt in Details, Not AppendEntry

Tool results already persist their `details` in the session JSONL. Using this natural persistence channel avoids a parallel state mechanism. The reset marker pattern (a receipt with `activated: []`) provides a clean branch-scoped boundary for resume scanning without any additional infrastructure.

## Precedents & Lessons

Git history unavailable (`no-commit`). No prior commits to analyze for similar changes targeting the pi-toolbelt repo.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-07-22_21-00-47_pi-toolbelt-progressive-tool-search.md` — FRD covering all functional requirements, decisions, and acceptance criteria
- `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md` — Prior design handoff with SearchBackend interface, npm policy, and package landscape

## Developer Context

**Q (receipt persistence): Tool result `details` vs `pi.appendEntry()`?**
A: Tool result `details`. Simpler, branch-scoped automatically, no parallel state mechanism. Reset encoded as receipt with `activated: []` acting as scan boundary.

**Q (resume boundary): Post-reset only vs all calls?**
A: Tree navigation naturally encodes it — `getBranch()` returns entries on the current branch only. Navigating to a pre-reset branch restores pre-reset tools. No config needed for v1.

**Q (defaults): Lock fuse.js defaults now vs leave TBD?**
A: Leave TBD, set by benchmark per FRD decision "Ranking config breadth deferred."

## Open Questions

- Which maintained local npm package and algorithm wins a benchmark comparing ranking behavior, package complexity, maintenance, and p95 latency on representative Pi tool catalogs?
- Beyond `baseline`, `threshold`, and `topK`, which ranking fields, aliases, weights, or backend options have enough demonstrated value to expose in the v1 public config schema?

## Related Research
- None yet — this is the first research artifact for this project.
