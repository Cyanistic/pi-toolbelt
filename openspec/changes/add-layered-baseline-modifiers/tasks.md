## 1. Layered Baseline Runtime

- [x] 1.1 Extend the TypeBox baseline contract and semantic editor types with normalized `modify` operations, reject empty names, unknown fields, empty modifiers, and cross-list conflicts, then replace source-based baseline selection with the shared ordered Default → Global → trusted Project fold and trace; verify with `npm run check` and real Pi `/toolbelt status` runs covering existing `null` and array files, duplicate modifier entries, layered reversal, and one malformed modifier.
- [x] 1.2 Centralize effective-policy application, then route session startup and `/toolbelt reset` through it so exact policy clamps, plain unrestricted stays untouched, unrestricted modifiers change only named startup tools, and reset targets all registered tools except final removals; verify with `npm run check` and real Pi fresh-session, reset, unavailable-name, and snapshot-resume flows.

## 2. Layered Baseline Settings

- [x] 2.1 Extend both scope mode pickers to Inherit, Unrestricted, Exact, and Modify, and add one UI-owned modifier draft with separate Add and Remove rows that reuse `FuzzyMultiSelector`, preserve unavailable names, move conflicts to the latest operation, reopen saved values, and convert empty confirmation to Inherit; verify with `npm run check` and exercise all four modes in real Pi for both Global and trusted Project.
- [x] 2.2 Update settings rows and save feedback to show modifier values, the ordered effective trace and result, replacement steps, and the `/toolbelt reset` apply-now guidance without mutating current tools; verify with `npm run check` and in real Pi compare an unsaved layered preview with `/toolbelt status` after save while confirming active tools and session history stay unchanged.

## 3. Documentation and End-to-End Proof

- [x] 3.1 Update `README.md`, `docs/config.md`, `docs/behavior.md`, and `docs/commands.md` for the tagged modifier shape, ordered Global and Project semantics, exact terminology, startup versus reset behavior, TUI controls, validation, trust, and downgrade note; verify every documented JSON example parses and read the rendered files back for consistency.
- [x] 3.2 Run `npm run check` and `openspec validate add-layered-baseline-modifiers --type change --strict`, then complete a repeatable real Pi matrix for legacy exact and unrestricted configs, Global modify over Default, Project modify and reversal over Global, invalid modifier refusal, TUI round-trip, startup application, reset, manual reactivation of a removed baseline tool, and snapshot precedence; record the observed commands and outcomes before marking the change complete.
