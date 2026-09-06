## Why

A Project baseline can currently only inherit or replace Global, so projects cannot make small local adjustments without copying and maintaining the complete Global tool list. Baseline configuration should compose through its scope hierarchy so each layer can add or remove tools while preserving broader defaults.

## What Changes

- Extend `baseline` with a tagged `{ "type": "modify", "add"?: string[], "remove"?: string[] }` form at every configuration scope while preserving omitted, `null`, and exact-array behavior.
- Resolve baseline layers in order from the built-in default through Global and trusted Project configuration. Omission keeps inherited state, `null` and arrays replace it, and a modification transforms it. Later layers can reverse earlier changes.
- Normalize duplicate names within each modification list. Reject empty modifications, empty names, unknown modifier fields, and names present in both `add` and `remove`.
- Preserve unavailable configured names for future or optional tools.
- Apply modifications over unrestricted startup state without changing unrelated host tool membership. Keep reset behavior explicit by targeting all registered tools except final removals.
- Expose Inherit, Unrestricted, Exact, and Modify baseline modes for both Global and Project settings. Modify uses separate Add and Remove pickers, prevents conflicts, previews the effective result, and converts an empty edit to Inherit.
- Show the contributing baseline chain in settings and status output instead of attributing a composed result to only one source.
- Preserve current settings-save, project-trust, session-snapshot, and manual tool-activation behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-semantics`: Resolve baseline configuration as an ordered composition of equivalent persisted scope values and settings drafts, with accurate contribution metadata.
- `interactive-toolbelt-management`: Accept, apply, display, edit, preview, reset, and report layered baseline modifications across Global and Project scopes.

## Impact

- Configuration schema and public baseline types gain the tagged modification form.
- Baseline resolution, startup application, reset targeting, and provenance reporting change to support composed layers.
- `/toolbelt settings` gains Modify controls and effective-chain previews; `/toolbelt status` reports composed provenance.
- Configuration and behavior documentation must describe the new shape and layer rules.
- Existing omitted, `null`, and array configurations remain valid with their current meanings. No new dependency is required.
