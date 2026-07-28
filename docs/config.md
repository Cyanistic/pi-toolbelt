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
| `baseline` | JSON `null`, or `string[]` (including `[]`) | See [Baseline](#baseline) |
| `search` | `{ "type": "bm25" }` or `{ "type": "llm", "model"?: "provider/id" }` | See [Search](#search) |

Rules:

- `{}` and unknown-only objects are **valid** configured scopes.
- Unknown top-level and nested-under-`search` properties are ignored at runtime and **preserved** when settings saves known fields.
- Invalid JSON, a non-object root, or an invalid known field makes that scope **malformed**. Settings leaves the file untouched and shows a path-level error. Config-driven runtime stays disabled until every **participating** scope is valid.
- Invalid `baseline` types (number, object, etc.) fail validation. Present values must be `null` or an array of strings.
- Legacy fields such as `threshold` and `topK` are not recognized as known search shape.

## Baseline

`baseline` is optional on each scope. Effective baseline is a tagged value: **unrestricted** or **list** (with tool names). Unrestricted is never represented as a synthetic tool list, so empty allowlist and unrestricted stay distinct.

| Present value | Meaning |
|---|---|
| omitted | Inherit parent scope. Omitted through the full chain → root default **unrestricted** (`source: default`). |
| `null` | Explicit **unrestricted**. Source is the scope that wrote `null` (global or project). |
| non-empty `string[]` | Exact allowlist. Source is that scope. |
| `[]` | Exact allowlist of **zero** tools - not unrestricted. |

Resolution order: project (if trusted and defines `baseline`) → global (if defines `baseline`) → default unrestricted.

Examples:

```json
// Global only - explicit clamp
{ "baseline": ["read", "bash", "edit", "write"] }
```

```json
// Global list + project override to everything
// Global: { "baseline": ["read", "bash"] }
// Project (trusted):
{ "baseline": null }
```

```json
// Global list + project inherits (omit key)
// Project file may be {} or omit baseline entirely
{}
```

```json
// Empty allowlist - new session / list reset → zero registered tools
{ "baseline": [] }
```

### Settings write table

`/toolbelt settings` baseline mode picker:

| Scope | Mode | Disk write |
|---|---|---|
| Global | Default | omit `baseline` |
| Global | Unrestricted | `"baseline": null` |
| Global | Custom | `"baseline": string[]` (empty allowed) |
| Project | Inherit | omit `baseline` |
| Project | Unrestricted | `"baseline": null` |
| Project | Custom | `"baseline": string[]` (empty allowed) |

Global Default and Global Unrestricted both resolve unrestricted while the product root default is unrestricted; Unrestricted is an explicit pin if that default ever changes. On project, omit vs `null` is load-bearing (inherit a global list vs override to everything).

Custom picker: searchable multi-select over registered tools, keeps unavailable configured names until deselected, and can add arbitrary exact non-empty tool names from search text.

Saving settings refreshes effective config for discovery. It does **not** call `setActiveTools` and does **not** write a session snapshot when only baseline changes.

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

List baseline + local search:

```json
{
  "baseline": ["read", "bash", "edit", "write", "grep"],
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
