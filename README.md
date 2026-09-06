# pi-toolbelt

Progressive tool discovery and explicit session tool management for [Pi](https://github.com/earendil-works/pi-coding-agent).

Toolbelt keeps active-tool membership deliberate. The model discovers inactive tools through `query_tools`, activates or deactivates exact names through `manage_tools`, and resumes the original task with the updated active set. Hiding tools is opt-in: with no config, the baseline is unrestricted and discovery runs under BM25.

## Install

```sh
pi install npm:@cyanism/pi-toolbelt
```

Install alone is enough for discovery and management. No `toolbelt.json` is required for the happy path.

## Commands

| Command | Purpose |
|---|---|
| `/toolbelt settings` | Edit global/project config in TUI |
| `/toolbelt tools` | Inspect and change the session active set |
| `/toolbelt status` | Runtime mode, baseline, search, active names, last discovery receipt |
| `/toolbelt reset` | Restore the resolved baseline: exact set, or all registered tools except removals |

Bare `/toolbelt` lists these subcommands. Settings and tools require TUI mode.

## How it works

### Discovery (`query_tools`)

Score-free ranked results with exact name, registered description, and active state. Searches inactive tools by default (hidden-first). Never mutates the active set.

Per-call controls:

- `includeActive` (default `false`) - include already-active tools
- `limit` (default `5`) - maximum results, no upper bound
- `timeoutMs` (default `30000`) - LLM-ranking timeout in ms; `0` disables the mode timeout

### Search backends

- **BM25 (default, local):** MiniSearch over exact names and descriptions. Private, no metadata egress.
- **LLM (opt-in, advisory):** When `search` is `{ "type": "llm" }`, the eligible catalog is sent to Pi’s active or configured model. Raw model text is returned without parsing. Falls back visibly to BM25 when the model is unavailable, times out, or returns blank output.

### Activation (`manage_tools`)

One direction per call (`activate` or `deactivate`), exact registered names only. The complete final active set is persisted as a session snapshot before every mutation. Any registered tool - including `query_tools` and `manage_tools` - may be deactivated.

### Baseline semantics

`baseline` is optional on each config scope. Layers apply in order: Default → Global → trusted Project.

| Value | Meaning |
|---|---|
| omitted | Keep inherited state; full chain omitted → unrestricted Default |
| `null` | Replace inherited state with unrestricted |
| `string[]` | Replace inherited state with that exact set |
| `[]` | Exact set of zero tools (not unrestricted) |
| `{ "type": "modify", "add"?: string[], "remove"?: string[] }` | Add and/or remove names from inherited state |

On a new session (or resume without a valid snapshot): an **exact** policy clamps to the registered subset; **unrestricted** with no add/remove leaves the host set alone; unrestricted **modify** changes only the named tools. Resume with a valid snapshot restores that snapshot first, even when config is missing or malformed.

`/toolbelt reset` restores the exact set, or every currently registered tool except final unrestricted removals. Confirm + persist-first; no-op when already at the target. Settings save does not apply a new baseline to the current session; use reset for that.

An older Toolbelt release treats `modify` objects as invalid. Replace them with omitted, `null`, or an array before downgrading.

### Runtime modes

- **configured** - no participating scope is invalid (including both files missing: unrestricted + BM25 defaults). Discovery, management, and reset available.
- **session-only** - participating config malformed, but a valid active-tool snapshot exists. Discovery forced to BM25; management works; reset disabled.
- **inactive** - config unusable and no snapshot. Discovery and management refuse until config is fixed or a session set is established via `/toolbelt tools`.

### Trust and privacy

- BM25 is fully local.
- Global LLM search is explicit consent for catalog-metadata egress.
- Project config (baseline, search, unknown fields, validation errors) is ignored while the project is untrusted (`ctx.isProjectTrusted()`). Global remains effective. An untrusted project-selected LLM is not used.
- Extension disable remains a Pi host concern (`pi config` / packages), not a toolbelt.json kill switch.

## Config paths

- Global: `~/.pi/agent/toolbelt.json`
- Project: `.pi/toolbelt.json` (requires trust; `search` replaces global as a unit)

```json
{
  "baseline": ["read", "bash", "edit", "write"],
  "search": { "type": "bm25" }
}
```

```json
{
  "baseline": null,
  "search": { "type": "llm", "model": "openai/gpt-4" }
}
```

```json
{
  "baseline": { "type": "modify", "add": ["grep"], "remove": ["bash"] }
}
```

Empty `{}` is valid and resolves through defaults. Unknown fields are ignored at runtime and preserved by settings saves.

## Docs

| Doc | Contents |
|---|---|
| [docs/config.md](docs/config.md) | File shape, omit / null / array / `modify`, inheritance, trust |
| [docs/commands.md](docs/commands.md) | Slash commands, tools, status, reset |
| [docs/behavior.md](docs/behavior.md) | Session start, snapshots, runtime modes, discovery receipts |

## License

MIT - see [LICENSE](LICENSE).
