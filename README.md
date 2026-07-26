# pi-toolbelt

Progressive tool discovery and explicit session tool management for [Pi](https://github.com/earendil-works/pi-coding-agent).

Toolbelt keeps active-tool membership visible and deliberate. The model discovers inactive tools through autonomous hidden-first discovery, activates a selected exact name through a dedicated mutation tool, and resumes the original task with the newly available capability.

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

Use `/toolbelt status` to inspect exact active names, search mode, and the latest discovery receipt. Use `/toolbelt reset` to restore the registered configured baseline.

## Model workflow

### Autonomous tool discovery (hidden-first)

`query_tools` returns score-free ranked results with exact name, registered description, and active state. It searches inactive tools by default (hidden-first) and never changes active tools.

Per-call controls:

- `includeActive` (default `false`) — include already-active tools in results
- `limit` (default `5`) — maximum results, no upper bound
- `timeoutMs` (default `5000`) — LLM-ranking timeout in ms; `0` disables mode timeout

Example:

```json
{ "query": "web scraping", "includeActive": false, "limit": 3 }
```

### Two backends

**BM25 (default, local):** Private deterministic local search using MiniSearch over exact names and descriptions. Returns one-based ranked matches without scores.

**LLM (opt-in, advisory):** When `search` is `{ "type": "llm" }`, the eligible catalog is sent to Pi's active or configured model. The raw model output is returned as advisory text without parsing. Falls back visibly to BM25 when the model is unavailable, times out, or returns blank output.

### Activation boundary

`manage_tools` performs one direction per call with exact-name validation. Persistence happens before every mutation.

```json
{ "action": "activate", "tools": ["agent_browser"] }
```

```json
{ "action": "deactivate", "tools": ["query_tools", "manage_tools"] }
```

Discovery never silently activates results. The calling model discovers, selects an exact name, activates through `manage_tools`, and calls the newly available tool.

### Privacy and trust

- BM25 runs entirely locally with no metadata egress.
- LLM mode in **global** config is explicit user consent for catalog-metadata egress.
- LLM mode in **project** config is honored only when the project is trusted (`ctx.isProjectTrusted()`). An untrusted project-selected LLM falls back visibly to BM25 without sending metadata.

### Receipts

Results are persisted as discriminated receipts on the session branch:

- `kind: "ranked"` — structured BM25 rankings (or fallback from LLM) with one-based rank, name, description, active state, active counts, and SHA-256 catalog hash.
- `kind: "advisory"` — raw LLM output with resolved model, nested usage when available, active counts, and catalog hash.

`/toolbelt status` displays the latest receipt according to its kind.

## Session restoration

Each confirmed model, modal, setup, or reset mutation persists the complete final active-name set before applying it. Resume uses the newest valid snapshot and filters unregistered names. An older session without a snapshot starts from configured baseline instead of replaying legacy activations.

## Config

Global: `~/.pi/agent/toolbelt.json`. Project: `.pi/toolbelt.json` (search object replaces global as a unit).

```json
{ "baseline": ["read", "bash", "edit", "write"], "search": { "type": "bm25" } }
```

- `baseline`: exact new-session/reset active names
- `search.search.type`: `"bm25"` (local) or `"llm"` (advisory)
- `search.model`: optional `provider/id` for LLM mode (omitted = inherit active model)

Legacy `threshold` and `topK` fields are no longer recognized.

## Roadmap

- A visual global/project config editor is intentionally deferred.
- Relevance and latency evaluation will return only after real failed queries and accepted recovery scenarios provide meaningful evidence.

## License

MIT
