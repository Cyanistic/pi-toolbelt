# pi-toolbelt

Progressive tool discovery for [Pi](https://github.com/earendil-works/pi-coding-agent).

Carry a small baseline. Ask for more when you need it. The model describes what it wants to do, toolbelt finds matching tools and adds them on the fly.

## How it works

Pi comes with a ton of tools. Most sessions only use a handful. Toolbelt lets you start with just the essentials, then the model can pull in whatever else it needs — browse, fetch, analyze — by saying what it's trying to do.

```
User: "scrape this docs page and summarize the API changes"
Model: calls query_tools("fetch and extract webpage content")
       → agent_browser gets activated automatically
       → proceeds to use it
```

No "you don't have that tool" errors. No bloated baseline.

## Getting started

### 1. Install

```sh
npm install pi-toolbelt
```

### 2. Configure

Create a config to pick your baseline tools:

```sh
# Global config (all projects)
pi toolbelt setup global

# Or per-project
pi toolbelt setup project
```

Default baseline: `read`, `bash`, `edit`, `write`.

### 3. Use it

The model will discover tools on its own when you describe tasks. You can also check what's active:

```sh
pi toolbelt status
```

Reset search-added tools without losing your baseline:

```sh
pi toolbelt reset
```

## How the model sees it

The model has a tool called `query_tools`. It takes a query describing a capability — "fetch a URL", "search the web", "generate an image" — and toolbelt fuzzy-matches against Pi's full tool catalog. Matches get added to the active set immediately.

The model just describes what it needs and gets on with it. No prompts, no hunting through tool lists.

## Config

Config lives in `~/.pi/agent/toolbelt.json` (global) or `.pi/toolbelt.json` (per-project). Project config overrides global.

```json
{
  "baseline": ["read", "bash", "edit", "write"],
  "threshold": 0.4,
  "topK": 5
}
```

- `baseline` — tools always active
- `threshold` — match strictness (0 = exact, 1 = anything)
- `topK` — max tools to activate per query

## License

MIT
