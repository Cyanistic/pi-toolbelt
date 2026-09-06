# Configuration

Toolbelt configuration is optional. Missing global and project files resolve to **configured defaults**: unrestricted baseline and BM25 search. You do not need a `toolbelt.json` solely to enable discovery or management.

## Paths

| Scope | Path |
|---|---|
| Global | `~/.pi/agent/toolbelt.json` |
| Project | `.pi/toolbelt.json` (cwd-relative under the Pi project) |

Project configuration is read, validated, merged, and applied only when Pi reports the project trusted (`ctx.isProjectTrusted()`). While untrusted, the entire project file is ignored - baseline, search, unknown fields, and validation errors do not participate. Global remains effective. If global is also absent, root defaults apply (unrestricted baseline, BM25).

## File shape

Known fields (both optional):

```json
{
  "baseline": null,
  "search": { "type": "bm25" }
}
```

| Field | Allowed values | Notes |
|---|---|---|
| `baseline` | JSON `null`, `string[]` (including `[]`), or `{ "type": "modify", "add"?: string[], "remove"?: string[] }` | See [Baseline](#baseline) |
| `search` | `{ "type": "bm25" }` or `{ "type": "llm", "model"?: "provider/id" }` | See [Search](#search) |

Rules:

- `{}` and unknown-only objects are **valid** configured scopes.
- Unknown top-level and nested-under-`search` properties are ignored at runtime and **preserved** when settings saves known fields.
- Invalid JSON, a non-object root, or an invalid known field makes that scope **malformed**. Settings leaves the file untouched and shows a path-level error. Config-driven runtime stays disabled until every **participating** scope is valid.
- Present `baseline` must be `null`, a string array, or a valid tagged `modify` object. Other types fail validation.
- A `modify` object is invalid when `type` is not `"modify"`, it has unknown fields, both `add` and `remove` are empty or absent, either list contains an empty name, or one name appears in both lists. Duplicate names in one list are accepted and kept once, first-seen order.
- Legacy fields such as `threshold` and `topK` are not recognized as known search shape.
- An older Toolbelt release that does not know `modify` treats that object as a malformed `baseline`. Downgrade by replacing it with omitted, `null`, or an array.

## Baseline

`baseline` is optional on each scope. Effective policy is **exact** (an ordered tool set, including empty) or **unrestricted** (with optional named additions and removals). Unrestricted is never turned into a synthetic tool list, so empty allowlist and unrestricted stay distinct.

| Present value | Meaning |
|---|---|
| omitted | No operation. Keep inherited state. Full chain omitted → Default **unrestricted**. |
| `null` | Replace inherited state with unrestricted and clear earlier add/remove overlays. |
| non-empty `string[]` | Replace inherited state with that exact set. |
| `[]` | Replace inherited state with an exact set of **zero** tools - not unrestricted. |
| `{ "type": "modify", "add"?: string[], "remove"?: string[] }` | Transform inherited state. At least one of `add` or `remove` must be a non-empty list. |

Resolution starts at Default unrestricted, then applies Global, then trusted Project. A later layer can reverse an earlier add or remove. Omitted layers do not appear in the contribution chain. Replacement (`null` or array) stays visible in the chain as a reset of inherited policy.

Settings and `/toolbelt status` show that ordered chain plus the effective exact or unrestricted result. Search still has a single source (Default, Global, or Project).

Examples:

Global exact clamp:

```json
{ "baseline": ["read", "bash", "edit", "write"] }
```

Global exact, trusted Project replaces with unrestricted:

```json
{ "baseline": null }
```

Trusted Project inherits Global (omit `baseline`):

```json
{}
```

Empty exact set - new session / exact reset → zero registered tools:

```json
{ "baseline": [] }
```

Global modify over Default unrestricted. Startup activates `grep` and deactivates `bash`. Reset still targets every registered tool except `bash`:

```json
{ "baseline": { "type": "modify", "add": ["grep"], "remove": ["bash"] } }
```

Trusted Project reverses a Global removal of `bash`:

```json
{ "baseline": { "type": "modify", "add": ["bash"] } }
```

### Settings write table

`/toolbelt settings` baseline mode picker (both Global and Project):

| Scope | Mode | Disk write |
|---|---|---|
| Global | Inherit | omit `baseline` (uses Default) |
| Project | Inherit | omit `baseline` (uses Global or Default) |
| either | Unrestricted | `"baseline": null` |
| either | Exact | `"baseline": string[]` (empty allowed) |
| either | Modify | `"baseline": { "type": "modify", ... }` |

Global Inherit and Global Unrestricted both resolve unrestricted while the product root default is unrestricted; Unrestricted is an explicit pin if that default ever changes. On project, omit vs `null` is load-bearing (inherit a global exact set vs override to unrestricted).

Exact and Modify pickers: searchable multi-select over registered tools, keep unavailable configured names until deselected, and can add arbitrary exact non-empty tool names from search text. Modify uses separate Add and Remove rows. Selecting a name in one row moves it out of the other. Confirming Modify with both rows empty writes Inherit, not an invalid empty object.

Saving settings refreshes effective config for discovery. It does **not** call `setActiveTools` and does **not** write a session snapshot when only baseline changes. After a baseline save, settings points at `/toolbelt reset` to apply it to the current session.

## Search

| Value | Behavior |
|---|---|
| omitted through full chain | BM25 (`source: default`) |
| `{ "type": "bm25" }` | Local MiniSearch over names and descriptions |
| `{ "type": "llm" }` | Advisory nested ranking call; optional `model` as `provider/id` (omit = inherit active model) |

Project `search`, when present on a trusted project, **replaces** global search as a unit (no field-level merge).

Privacy:

- BM25 never leaves the machine.
- Global LLM is explicit user consent for catalog-metadata egress.
- Project LLM is honored only when the project is trusted. An untrusted project-selected LLM is ignored; if global is BM25 (or absent), discovery stays BM25 without claiming an LLM fallback. Global LLM still applies when the project is untrusted and only the project tried to change search.

## Effective config flags

- `configured`: true when no participating scope is invalid - **including both files missing**.
- Participating scopes: global always; project only when trusted (ignored project never participates, including when its file is malformed).
- Malformed participating scope → config-driven mode off until fixed (see [docs/behavior.md](behavior.md) runtime modes).

## Example full files

Unrestricted pin + LLM:

```json
{
  "baseline": null,
  "search": { "type": "llm", "model": "anthropic/claude-opus-5" }
}
```

Exact baseline + local search:

```json
{
  "baseline": ["read", "bash", "edit", "write", "grep"],
  "search": { "type": "bm25" }
}
```

Layered Project modify + local search:

```json
{
  "baseline": { "type": "modify", "add": ["grep"], "remove": ["bash"] },
  "search": { "type": "bm25" }
}
```

Forward-compatible unknown field:

```json
{
  "baseline": ["read", "bash"],
  "experimentalFlag": true
}
```
