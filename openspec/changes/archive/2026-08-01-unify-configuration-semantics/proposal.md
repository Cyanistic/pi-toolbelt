## Why

`src/config.ts` and `src/settings-ui.ts` independently interpret scope inheritance, omitted values, `null`, empty lists, and effective sources. These parallel rulebooks can drift silently, causing the settings editor to preview different configuration behavior from the runtime that consumes the saved files.

## What Changes

- Deepen `src/config.ts` into the single module that owns configuration parsing, trust-aware scope loading, inheritance, raw-field preservation, typed drafts, staged mutations, independent scope saves, and reloads.
- Make `src/settings-ui.ts` consume typed semantic state and submit user choices instead of interpreting or mutating raw JSON.
- Keep runtime configuration loading on demand through the same module without introducing shared cache invalidation.
- Preserve current configuration behavior and settings UX, including omit versus `null` versus `[]`, Global and Project inheritance, malformed-scope protection, unknown-field preservation, last-write-wins saves, independent scope recovery, and no active-tool mutation when settings are saved.
- Verify the behavior-preserving refactor with existing typecheck, lint, formatting, and implementation review; do not introduce a new automated or manual end-to-end test suite.

## Capabilities

### New Capabilities

- `configuration-semantics`: Defines authoritative, consistent configuration interpretation across persisted scope files and in-memory editor drafts without changing existing configuration behavior.

### Modified Capabilities

- None. Existing `interactive-toolbelt-management` and `autonomous-tool-discovery` requirements remain unchanged.

## Impact

- **Code**: `src/config.ts` and `src/settings-ui.ts`, with possible supporting type ownership changes in `src/types.ts` and `src/schemas.ts`.
- **External behavior**: No changes to configuration files, commands, model tools, settings UX, runtime modes, or session tool behavior.
- **Dependencies**: No new dependencies.
- **Verification**: Existing typecheck, lint, and formatting checks plus implementation and artifact review of inheritance, trust guards, malformed scopes, independent save outcomes, and unknown-field preservation.
