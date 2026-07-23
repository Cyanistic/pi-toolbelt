# pi-toolbelt

Pi extension for progressive tool discovery. TypeScript/ESM, loaded by pi-coding-agent host.

See:
- [`.rpiv/guidance/architecture.md`](.rpiv/guidance/architecture.md) — Project overview, commands, package config, tsconfig conventions
- [`.rpiv/guidance/src/architecture.md`](.rpiv/guidance/src/architecture.md) — Source layer patterns (extension registration, config loading, session lifecycle, additive activation)

## Key invariants

- **Gate-gated activation**: `session_start` and `query_tools` both check `isEnabled()` before mutating active tools. Installing the package alone never alters tools.
- **Config drives behavior**: Config at `~/.pi/agent/toolbelt.json` (global) or `.pi/toolbelt.json` (project). Malformed config = disabled.
- **Additive-only**: Tools are added, never removed. `/toolbelt reset` is the sole removal path.
- **No compile step**: `tsc` for type-checking only (`noEmit: true`). Source runs via `tsx`.

## Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check all source |
| `npm test` | Run all tests (node:test + tsx) |
| `npm run benchmark` | Search performance benchmarks |

## Tests

`node:test` + `node:assert/strict`. No external test runner.
