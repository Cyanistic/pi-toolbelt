## Why

Toolbelt's configuration and session-tool workflows are functional but not yet cohesive or polished enough for publication. Users need one clear in-Pi settings surface, a consistent session tool selector, and session-only behavior that remains useful without requiring persistent configuration.

## What Changes

- Add a bottom-anchored `/toolbelt settings` interface with Guardrails-style Global and Project tabs, staged drafts, explicit save/discard behavior, and clear effective-value sources.
- Redesign `/toolbelt tools` with the same visual language while preserving its distinct session-scoped staging and apply semantics.
- Vendor and adapt only the small reusable TUI subset needed by both interfaces instead of depending on the currently NodeNext-incompatible `@aliou/pi-utils-settings` package.
- **BREAKING** Remove `/toolbelt setup`; `/toolbelt settings` becomes the sole persistent configuration entrypoint.
- Support explicit Default, Inherit, and Custom choices for baseline and search settings, including searchable model and tool pickers and arbitrary exact baseline tool names.
- Treat `{}` as a valid configured scope, ignore and preserve unknown fields, and prevent the settings UI from overwriting malformed scope files.
- Ignore the entire Project config while the project is untrusted and expose that state read-only in the settings UI.
- Allow explicit session tool management without a Global or Project config. Persist the resulting session snapshot across resume, and allow explicitly active `query_tools` and `manage_tools` to operate in session-only mode with default BM25 search.
- Keep `/toolbelt reset` config-dependent and add a confirmation preview before it changes the active tool set.
- Reload saved search settings immediately without applying a changed baseline to the current session.

## Capabilities

### New Capabilities

- `interactive-toolbelt-management`: Covers scoped settings editing, shared TUI behavior, session tool selection, draft persistence, config-file safety, and config-less session management.

### Modified Capabilities

- `autonomous-tool-discovery`: Changes project-trust handling to ignore all untrusted Project config and permits explicitly activated discovery and management tools to operate from a persisted session snapshot without persistent config.

## Impact

- Affects command dispatch and completions, configuration loading and writing, session restoration, discovery/management gates, reset behavior, and the existing tool manager.
- Adds an internal vendored TUI module with retained MIT attribution and removes the temporary prototype after its validated decisions are incorporated.
- Changes the public command surface by removing `setup` and adding `settings`.
- Changes config semantics by accepting empty objects, preserving ignored unknown fields, and ignoring Project config until Pi trusts the project.
- Does not add an external runtime UI dependency or an automated test suite; verification remains strict TypeScript, Biome, and repeatable real Pi workflows.
