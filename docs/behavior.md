# Behavior

Runtime behavior for session lifecycle, snapshots, discovery, and mode gates. Config field rules live in [config.md](config.md); slash-command UX in [commands.md](commands.md).

## Runtime modes

Resolved from effective config + whether the session branch holds a valid active-tool snapshot:

```
if no participating scope is invalid:
  → configured   (includes both files missing → unrestricted + BM25)
else if valid active-tool snapshot on branch:
  → session-only (search forced BM25; management ok; reset off)
else:
  → inactive     (discovery and management refuse)
```

| Mode | `query_tools` | `manage_tools` | `/toolbelt reset` | Baseline apply on session_start |
|---|---|---|---|---|
| configured | yes (config search) | yes | yes | list → `setActiveTools`; unrestricted → no call |
| session-only | yes (BM25 only) | yes | no | snapshot restore only when resume has snapshot; no baseline apply when config invalid |
| inactive | refuse | refuse | no | no mutation |

`isEnabled()` / config-driven baseline+reset track `effective.configured`. Missing files are **not** a disabled state.

## Session start

On `session_start`:

1. Build effective config with project trust.
2. Surface config errors as UI warnings when present.
3. If **resume** and a valid active-tool snapshot exists on the branch:
   - Filter snapshot names to currently registered tools.
   - `setActiveTools(filtered)`.
   - Snapshot wins even when config files are missing or participating config is malformed.
   - Stop (do not apply baseline).
4. Else if configured **and** baseline `kind === "list"`:
   - `setActiveTools(filterRegistered(baseline.tools))`.
   - Empty list → empty registered subset (clears tools).
5. Else (configured unrestricted, or config unusable without snapshot):
   - **Do not** call `setActiveTools`. Host active set left unchanged.

Implications:

- Fresh install, no files, no snapshot → unrestricted; host set untouched; discovery/management available.
- Explicit list baseline clamps a new session to the registered subset.
- `baseline: null` → unrestricted; no clamp.
- `baseline: []` → list of zero; new session zeros registered active tools.
- Resume without snapshot follows the no-snapshot path above (list clamp or leave alone).

## Active-tool snapshots

- Entry key: `toolbelt-active-set` (versioned schema).
- Written **before** every successful active-set mutation from `manage_tools`, `/toolbelt tools`, and `/toolbelt reset`.
- Newest valid snapshot on the branch is restored on resume.
- Names absent from the current registered catalog are dropped at apply time.
- Establishing a snapshot while config is malformed moves runtime from inactive → session-only without fixing the file.

## Discovery (`query_tools`)

1. Gate on runtime mode (inactive → guidance, no mutation).
2. Eligible catalog: all tools, or only inactive when `includeActive` is false (default hidden-first).
3. Backend:
   - **configured** + BM25 (or default) → local MiniSearch rankings.
   - **configured** + LLM → nested provider call with catalog metadata; advisory raw text; visible BM25 fallback on unavailable model, timeout, or blank output.
   - **session-only** → always BM25 defaults; never invokes LLM.
4. Results are score-free (rank, name, description, active). Receipts attach as tool details:
   - `kind: "ranked"` - structured rankings, backend ids, optional fallback reason, active counts, SHA-256 catalog hash.
   - `kind: "advisory"` - raw LLM text, resolved model, optional usage, active counts, catalog hash.
5. Discovery never activates tools. The model must call `manage_tools` with exact names.

Default parameters used when omitted: `includeActive=false`, `limit=5`, `timeoutMs=30000` (runtime constant; `0` disables the mode timeout).

## Management (`manage_tools`)

1. Gate inactive → throw (no persist, no mutation).
2. Deduplicate requested names; reject any not in the registered catalog.
3. Build target: activate = union with current; deactivate = current minus requested.
4. Persist full target snapshot; only then apply.
5. Persist failure → no active-set change.
6. Deactivation of `query_tools` / `manage_tools` themselves is allowed.

## Reset

See [commands.md](commands.md#toolbelt-reset). Summary:

- List baseline → registered subset of allowlist.
- Unrestricted → all currently registered names (can re-enable tools other extensions expected off).
- Confirm when membership would change; persist-first; no-op short-circuit.

## Trust boundary

| Situation | Effect |
|---|---|
| Project trusted, defines baseline/search | Project values win over global for defined fields |
| Project untrusted | Project file fully ignored; global or defaults apply |
| Project untrusted + malformed project file | Project error ignored; defaults/global still enable configured mode without a snapshot |
| Global LLM + untrusted project | Global LLM remains consent for egress |
| Project LLM + untrusted | Project LLM not selected; no catalog send from that selection |

## What Toolbelt does not do

- Does not unregister tools or commands from the Pi host.
- Does not provide a toolbelt.json “full extension disable” flag - use Pi package/config controls.
- Does not force `query_tools` or `manage_tools` into a list baseline; baseline is the configured allowlist as written.
- Does not silently activate discovery results.
- Does not ship package tarball docs (`docs/` is git/README only).
