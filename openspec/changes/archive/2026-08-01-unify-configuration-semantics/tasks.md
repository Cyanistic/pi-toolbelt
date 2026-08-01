## 1. Unify Configuration Semantics

- [x] 1.1 Add configuration-owned editor session types in `src/config.ts`: semantic snapshot, tagged user intent, and per-scope save outcome; keep raw JSON and mutations private.
- [x] 1.2 Route `buildEffectiveConfig` and editor draft previews through one internal inheritance implementation, preserving omit, `null`, `[]`, scope sources, search replacement, trust, and malformed-scope behavior.
- [x] 1.3 Move create, remove, baseline, search, unknown-field preservation, independent Global/Project saves, and post-save reloads into the configuration editor session; enforce Project trust as a fail-closed guard before mutations and writes without unload, retain, or restore transitions.
- [x] 1.4 Refactor `src/settings-ui.ts` to render semantic snapshots and submit typed intents while retaining picker, navigation, cursor, status, and discard state; remove duplicated raw parsing, mutation, and draft-resolution helpers.
- [x] 1.5 Update `openSettingsUi` and `src/commands.ts` integration so retained dirty state survives discard confirmation, successful saves refresh runtime configuration, and settings saves never mutate active tools or session snapshots.
- [x] 1.6 Run `npm run check` and resolve all typecheck, lint, and formatting failures without suppressions.
