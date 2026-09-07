<div align="center">
<img src="https://raw.githubusercontent.com/Cyanistic/pi-toolbelt/main/assets/pi-toolbelt.png" width="192" height="192" alt="pi-toolbelt: the Pi symbol wearing a belt with one wrench clipped on">

**pi-toolbelt**

Keep the tools you need. Leave the rest in a catalog the model can search.

[What](#what-this-is) ·
[Why](#why-use-it) ·
[Install](#install) ·
[Use](#how-to-use-it) ·
[Docs](#docs)
</div>

## What this is

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension. It gives the model two extra abilities:

1. Search tools that are not currently on (`query_tools`)
2. Turn exact tools on or off for this session (`manage_tools`)

You can do the same from the keyboard with `/toolbelt tools`. Settings live in `/toolbelt settings`.

Install does **not** hide anything. Your current tools stay as they are until you choose a smaller set.

Requires Pi `0.80.7` or newer.

## Why use it

Pi can load a lot of tools. A long list wastes context and makes the model worse at picking.

Toolbelt keeps most tools in a catalog. The model searches, then clips on only what this task needs. You can also clip tools on and off yourself, live, without restarting.

Do not install this if you wanted:

- fewer tools with zero extra workflow (install leaves everything on)
- search hits that turn themselves on (discovery never activates)
- a `toolbelt.json` switch that unloads the extension (use `pi config` / packages for that)

## See it

The model finds a hidden tool and turns it on:

https://github.com/user-attachments/assets/c3dc5dea-916a-4584-9567-eb76e7ec2e94

You change the live set. The model’s next answer matches:

https://github.com/user-attachments/assets/1bb004e2-3cb0-469d-9c06-0ee51b2788e2

Settings: baseline, search backend, global vs project:

https://github.com/user-attachments/assets/fce8efbe-e67a-4175-a7ee-736801a4241e

## Install

```sh
pi install npm:@cyanism/pi-toolbelt
```

No config file is required. Check that it loaded:

```
/toolbelt status
```

You should see `Toolbelt: configured` and two extra tools, `query_tools` and `manage_tools`.

Update with `pi update npm:@cyanism/pi-toolbelt`. Remove with `pi remove npm:@cyanism/pi-toolbelt`.

## How to use it

### You

| Command | What it does |
|---|---|
| `/toolbelt tools` | See every registered tool. Filter, Space to stage, Enter to apply. |
| `/toolbelt settings` | Edit global and project config in the TUI. |
| `/toolbelt status` | Mode, baseline, search, active names. |
| `/toolbelt reset` | Put this session back to the configured baseline. |

Bare `/toolbelt` lists these. Settings and tools need TUI mode.

A typical first session: ask the model what tools it has, open `/toolbelt tools`, turn one off, ask again.

### The model

When a needed tool is missing, it should:

1. Call `query_tools` with the job to do (not a tool name)
2. Call `manage_tools` with the exact name to activate
3. Use that tool

It should not guess names, and it should not expect search results to turn themselves on.

### Optional config

Only if you want a smaller default set. Files:

- Global: `~/.pi/agent/toolbelt.json`
- Project: `.pi/toolbelt.json` (Pi must trust the project)

```json
{
  "baseline": ["read", "bash", "edit", "write"],
  "search": { "type": "bm25" }
}
```

Saving settings does not change the current session. Use `/toolbelt reset` for that.

Search stays local (BM25) unless you opt into LLM search, which sends tool names and descriptions to a model.

## Docs

Full rules live in the repo, not on npm:

- [Config](https://github.com/Cyanistic/pi-toolbelt/blob/main/docs/config.md) — file shape, inheritance, trust
- [Commands](https://github.com/Cyanistic/pi-toolbelt/blob/main/docs/commands.md) — slash commands and model tools
- [Behavior](https://github.com/Cyanistic/pi-toolbelt/blob/main/docs/behavior.md) — session start, snapshots, runtime modes

## License

MIT. See [LICENSE](LICENSE).
