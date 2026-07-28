# Commands

Top-level slash command: `/toolbelt`. Requires interactive UI. Settings and tools additionally require TUI mode.

## Help

Bare `/toolbelt` (no subcommand) prints:

- `/toolbelt settings` - edit persistent configuration
- `/toolbelt tools` - inspect and change session tools
- `/toolbelt status` - show current state
- `/toolbelt reset` - restore baseline (list) or activate all registered tools (unrestricted)

Unknown subcommands are rejected with the valid list.

## `/toolbelt settings`

Opens the dual-scope settings editor (global + project).

- Shows scope state: missing, valid, invalid, or ignored (untrusted project).
- Known settings show whether the effective value is Default, Global, or Project.
- Baseline modes: Global Default | Unrestricted | Custom; Project Inherit | Unrestricted | Custom. See [config.md](config.md#settings-write-table).
- Search distinguishes default BM25 from an explicit BM25 or LLM selection.
- Invalid scopes are read-only; exact path validation errors are shown; the file is never overwritten from settings.
- Other valid scopes remain editable even when a sibling scope is malformed; config-driven runtime stays disabled until every participating scope is valid.
- Dirty-draft discard is confirmed outside the editor loop.
- On successful save: effective config reloads for discovery; **active tools are not mutated** and no session snapshot is written solely because baseline changed.

## `/toolbelt tools`

Interactive modal over every registered tool: `[x]` active / `[ ]` inactive, name, and description.

- Type to filter; Up/Down move; Space stages; Enter persists then applies once; Escape cancels.
- Persist-first: complete final active-name set is written as a session snapshot before `setActiveTools`.
- Available whenever the host UI allows it - including when config is unusable - so a user can establish a snapshot and unlock session-only discovery/management.
- Staged changes require discard confirmation if closed dirty.

## `/toolbelt status`

Reports runtime mode and membership. Distinguishes:

| Mode | When | Status highlights |
|---|---|---|
| **configured** | No participating scope invalid (includes both files missing) | `Toolbelt: configured`; config paths or `(none - using defaults)`; baseline unrestricted or list with source; search BM25/LLM with source; optional session snapshot present |
| **session-only** | Participating config malformed **and** valid active-tool snapshot | `Toolbelt: session-only (config invalid)`; errors; tools remain via snapshot; search forced BM25 (session-only) |
| **inactive** | Config unusable **and** no snapshot | `Toolbelt: inactive (config invalid)`; errors; points at `/toolbelt settings` or `/toolbelt tools` |

Also always reports:

- Project ignored-until-trusted line when applicable
- Active count vs registered count and exact active names
- Latest `query_tools` discovery receipt on the session branch, by kind:
  - `ranked` - structured matches (BM25 or BM25 fallback)
  - `advisory` - raw LLM text, model, optional usage preview

Missing files with no snapshot report **configured defaults**, not inactive-for-missing-file.

## `/toolbelt reset`

Restores the resolved baseline target. Disabled when config-driven behavior is unavailable:

- session-only → no baseline to restore
- config errors / inactive → reset disabled

When enabled:

| Effective baseline | Target set |
|---|---|
| **list** | Registered subset of the configured allowlist |
| **unrestricted** | Every currently registered tool name |

Flow:

1. Diff current active set vs target (additions, removals, final count).
2. No-op if already equal → report no change; no prompt; no extra snapshot.
3. Otherwise confirm with preview (target label, add/remove, final count, baseline kind + source).
4. On confirm: persist complete target set, then apply. Abort without mutation if persist fails.
5. Cancel → no snapshot, active set unchanged.

Unrestricted reset can re-enable tools another extension expected off; it is an explicit user action over the full registered catalog at invoke time.

## Model-facing tools

Registered by the extension (not slash commands):

### `query_tools`

Discovery only. Parameters:

| Param | Default | Role |
|---|---|---|
| `query` | (required) | Capability / task description |
| `includeActive` | `false` | Include already-active tools |
| `limit` | `5` | Max results (min 1, no upper bound) |
| `timeoutMs` | `30000` | LLM ranking timeout ms; `0` disables mode timeout |

Refuses when runtime mode is inactive. Session-only always uses BM25. Never mutates active tools.

### `manage_tools`

| Param | Role |
|---|---|
| `action` | `activate` or `deactivate` (one direction per call) |
| `tools` | One or more exact registered names |

Unknown names rejected. Persist-first. Refuses when inactive. Any registered tool may be deactivated, including `query_tools` and `manage_tools`.
