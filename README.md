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
