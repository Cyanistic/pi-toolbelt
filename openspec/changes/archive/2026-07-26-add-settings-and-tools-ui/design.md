## Context

Toolbelt currently has three related flows implemented through different interfaces:

- `src/index.ts` loads effective configuration at session start, gates `query_tools` and `manage_tools`, and applies either a configured baseline or a resumed active-tool snapshot.
- `src/commands.ts` owns `/toolbelt setup`, status, reset, and the handoff to the tool manager.
- `src/tool-manager.ts` presents a centered overlay with staged session changes, but disables editing without valid configuration.

The throwaway `src/settings-ui.prototype.ts` established the desired interaction model: a non-overlay panel replacing Pi's bottom composer, Global and Project tabs, Scope Focus organization with effective-value source labels, in-place pickers, and a separate session-scoped Tools Manager using the same visual language.

Directly depending on `@aliou/pi-utils-settings@0.17.0` is not viable under this repository's required NodeNext typecheck because its published TypeScript contains extensionless internal imports. Its config loader also does not match Toolbelt's trust, inheritance, and file-preservation semantics. The existing `src/panel.ts` demonstrates the accepted alternative: selectively adapt the small MIT-licensed UI implementation needed locally and retain attribution.

Configuration and session state must remain distinct. Configuration controls automatic baseline application, search selection, and reset. An explicitly persisted active-tool snapshot controls only one session and must be sufficient for session-only tool discovery and management.

## Goals / Non-Goals

**Goals:**

- Provide production settings and session-tool interfaces matching the validated prototype.
- Put config reading, validation, trust, merging, and writing behind one coherent module interface.
- Preserve unknown JSON fields while editing known settings and distinguish missing, valid empty, invalid, and ignored sources in the type system.
- Keep every config-file write atomic per scope and preserve successful writes if another scope fails.
- Make session-only operation explicit, resumable, and independent from persistent configuration.
- Keep active-tool mutation persistence-first and ensure settings saves never apply a baseline to the current session.
- Reuse a small attributed TUI implementation without adding a runtime UI dependency.

**Non-Goals:**

- Publishing work such as package metadata, documentation restructuring, a generated JSON Schema, CI, or release automation.
- A raw JSON recovery editor, automatic repair, or reset workflow for malformed files.
- Detecting concurrent external edits. Settings use deliberate last-writer-wins behavior.
- Changing BM25 ranking, LLM request contents, discovery receipt formats, or model-provider behavior beyond selecting the effective search configuration.
- Adding automated tests. Verification uses strict types, Biome, and real interactive Pi workflows.
- Shipping prototype variants, prototype switching keys, or a production dependency on `@aliou/pi-utils-settings`.

## Decisions

### 1. Model config sources as tagged states

`src/config.ts` will replace the current ambiguous `config: undefined` representation with source states that distinguish:

- `missing`: no file exists
- `valid`: the file contains a JSON object, including `{}`
- `invalid`: parsing or known-field validation failed, with the exact path and error
- `ignored`: a Project file may exist, but Pi does not trust the project

A valid source retains both its validated known fields and a deep-cloned raw JSON object. Runtime merging consumes only `baseline` and `search`; the settings editor starts from the raw object so ignored unknown fields round-trip unchanged. Editing a known nested search field replaces or removes only known search keys and preserves unknown siblings.

Unknown fields remain accepted. A file containing only unknown fields is consequently a valid configured scope whose known settings inherit or use defaults, just like `{}`. This follows the chosen forward-compatible behavior rather than the current "at least one recognized field" rule.

The effective configuration result will retain source metadata and expose whether config-driven behavior is available. Any malformed participating scope disables config-driven baseline application and reset, even if another scope is valid. A malformed scope remains independently visible and read-only in settings while valid scopes remain editable.

Alternative considered: keep `ConfigSource` as optional data plus booleans. Rejected because missing, empty, malformed, and untrusted states drive different behavior and are too easy to conflate.

### 2. Apply project trust before reading or merging Project config

Configuration loading will receive Pi's project-trust result explicitly. Global config is always read. Project config is read and merged only when trusted. While untrusted, Toolbelt may check whether the path exists for display, but it will not parse, validate, display values from, merge, or write that file.

The Project settings tab remains visible but inactive and read-only with a clear "ignored until this project is trusted" explanation. Global remains editable. A malformed untrusted Project file does not disable a valid Global config because the entire Project source is outside the active trust boundary.

Alternative considered: merge non-LLM Project fields and reject only project-selected LLM search. Rejected because it lets an untrusted repository control the active tool surface and makes trust behavior field-dependent.

### 3. Keep settings drafts as explicit per-scope mutations

Each scope uses a tagged draft mutation rather than truthy/null checks:

- unchanged
- write a raw JSON object, where `{}` is meaningful
- remove the scope file

This prevents an empty draft from being mistaken for no draft and allows `Remove scope configuration` to participate in the same staged save/discard workflow. Opening settings does not create a draft. With no files, the UI opens on Global and presents `Create global configuration`; choosing it stages `{}`. Only the explicit remove action stages deletion.

Global baseline offers Default or Custom. Project baseline offers Inherit or Custom. Search offers Default or Inherit as appropriate, explicit BM25, or explicit LLM. Choosing LLM opens the model picker before committing the search draft.

The baseline picker is searchable and seeded from registered tools plus any unavailable names already configured. It supports adding the exact current query as a custom tool name, so unknown or temporarily unavailable tools are preserved and remain editable. The model picker uses `ctx.modelRegistry.getAvailable()`, includes `Active model` as the omitted-model choice, and retains an unavailable configured `provider/id` as a clearly marked option.

Alternative considered: edit the resolved config and always serialize all fields. Rejected because it destroys inheritance, turns defaults into accidental overrides, and loses unknown fields.

### 4. Save dirty scopes independently with atomic replacement

Ctrl+S attempts every dirty writable scope in deterministic Global then Project order. A write will:

1. Create the parent directory.
2. Serialize the complete raw draft with two-space indentation and a trailing newline.
3. Write a uniquely named temporary file in the target directory.
4. Rename the temporary file over the target.
5. Remove the temporary file after a failed write or rename when possible.

Deletion unlinks only the selected scope file. Each successful scope clears its draft and reloads its source. Each failed scope remains dirty, preserves its in-memory draft, and reports the exact scope, path, and filesystem error. A successful Global save is not rolled back if Project fails.

Writes may remain synchronous because these files are tiny and settings input is already serialized through the TUI. Atomic same-directory rename matters more than introducing asynchronous storage machinery. The editor deliberately does not hash or re-read files to detect concurrent changes; saving overwrites external edits according to the chosen last-writer-wins behavior.

Malformed and untrusted scopes cannot create write or removal drafts, so Ctrl+S cannot overwrite them. Saving reloads the effective search configuration and refreshes source labels, but never calls `setActiveTools()` or persists an active-tool snapshot.

Alternative considered: one transaction across both files. Rejected because no portable atomic transaction spans both paths and rollback could overwrite a valid external state.

### 5. Adapt a narrow shared TUI module

The production interfaces will use one non-overlay frame that renders:

- title and stable border
- top scope or session tab treatment
- body supplied by the active list or picker
- status text
- context-sensitive bottom controls

The selectively adapted UI code will cover the frame/tabs/footer, sectioned settings list, single selector, and fuzzy multi-selector. Each adapted file will retain the upstream package version or commit, MIT attribution, and source link. Imports will use NodeNext-compatible `.js` specifiers. Toolbelt will not copy the upstream config loader or generic command registration layer.

`src/settings-ui.ts` will own Toolbelt-specific drafts, source labels, row construction, picker transitions, saving, and close intents. `src/tool-manager.ts` will keep its existing pure row/filter/state behavior but render through the shared frame as a non-overlay session screen. Both remain deep modules with small command-facing interfaces such as opening the editor and returning an explicit result; command handlers do not manipulate cursor or picker state.

Escape from a clean top-level view closes immediately. Escape with dirty settings or staged tool changes requests confirmation before discarding. Submenu Escape only returns to its owning view without modifying the draft. Ctrl+S saves settings and keeps the editor open. Enter applies staged session tools and keeps the Tools Manager open, updating its applied snapshot so subsequent changes can again be detected.

Asynchronous confirmations are orchestrated outside the TUI input handler: the custom view returns a close or destructive-action intent, the command invokes `ctx.ui.confirm`, and a cancelled confirmation reopens the same retained editor state. This avoids nesting an asynchronous Pi prompt inside synchronous component input handling.

Alternative considered: vendor `registerSettingsCommand` and adapt Toolbelt to its generic `ConfigStore`. Rejected because its enabled-scope, null-draft, close, and save assumptions conflict with valid `{}`, ignored Project config, staged deletion, and partial-failure reporting.

### 6. Resolve runtime mode from configuration plus session evidence

Runtime availability becomes a tagged decision derived from the current config state and the newest valid session snapshot:

- configured: valid effective config exists; use its effective search setting
- session-only: no usable config exists, but the session has an explicit snapshot; use BM25
- inactive: neither usable config nor an explicit snapshot exists

The snapshot is the durable evidence of explicit session intent. `/toolbelt tools` is always editable. Applying it persists the complete active set before changing Pi, even when the set is unchanged, thereby establishing session-only mode. `manage_tools` continues using the same persistence-first path, and every successful mutation appends a new complete snapshot.

On resume, the newest valid snapshot is restored before considering config validity. This allows config-less and config-invalid session state to survive. If no snapshot exists, a valid configured baseline is applied; malformed or absent config causes no active-set mutation. New sessions never inherit another session's snapshot.

`query_tools` and `manage_tools` run in configured or session-only mode. In session-only mode, discovery uses default local BM25 and never invokes an LLM. In inactive mode they return concise guidance to use `/toolbelt tools` or `/toolbelt settings`. This gate remains necessary even if Pi has registered Toolbelt's tool definitions in the active catalog.

Alternative considered: treat config presence as the only enablement gate. Rejected because explicitly selected session tools logically work without persistent defaults and their snapshot is isolated from other sessions.

### 7. Keep reset strictly config-driven and confirm destructive changes

`/toolbelt reset` is available only when effective configuration is valid. Session-only mode has no configured baseline and therefore cannot reset.

The command filters the effective baseline against registered tools and computes the add/remove/final preview before mutation. If nothing changes, it reports that result without prompting or writing another snapshot. Otherwise it asks for confirmation, then persists the target snapshot before calling `setActiveTools()`. Cancellation leaves the active set untouched.

Alternative considered: reset config-less sessions to Toolbelt's built-in defaults. Rejected because defaults have not been adopted as a baseline until a config scope exists.

### 8. Simplify and align the command surface

The completion and dispatch tree becomes:

- `/toolbelt tools`
- `/toolbelt settings`
- `/toolbelt status`
- `/toolbelt reset`

Bare `/toolbelt` remains concise help. `/toolbelt setup` and its immediate baseline mutation are removed. Settings creation is deliberately staged and does not alter current tools.

Status distinguishes configured, session-only, inactive, and config-invalid-with-session-snapshot states. It reports ignored Project trust, participating config errors, effective baseline/search sources, active tools, and the existing latest discovery receipt without turning status into another editor.

### 9. Consolidate the validated prototype and remove it

Production modules will incorporate only Scope Focus organization, effective source clarity, the separate Tools Manager, and the validated picker interactions. Prototype screen switching, hard-coded sample data, automatic opening on session start, and in-memory simulation status do not move into production.

After equivalent production flows have been exercised, `src/settings-ui.prototype.ts`, the import-check prototype, and the `prototype:settings` script are removed. The existing npm exclusion remains harmless but can be removed when no prototype files remain.

## Risks / Trade-offs

- **[Snapshot gate drifts from active state]** -> Use the newest TypeBox-validated branch snapshot as the single evidence of session-only intent and keep all active-set mutations on `persistActiveTools()`.
- **[Trusted and untrusted loaders diverge]** -> Pass trust into one config-loading interface used by session start, commands, settings, status, and hot reload.
- **[Unknown fields are lost during known-field edits]** -> Retain raw JSON for valid scopes and update only known keys at their existing object level.
- **[One scope saves while another fails]** -> Clear only successful drafts, leave failed drafts dirty, and report each outcome with its path.
- **[Temporary files remain after interruption]** -> Use unique names, clean up on handled failures, and never treat temporary files as config sources.
- **[Non-overlay view and confirmation transitions flicker]** -> Retain editor state outside each custom-view invocation and reopen the same state after cancelled confirmation.
- **[Model list changes while settings are open]** -> Snapshot available models when opening the picker and preserve the configured unavailable value explicitly.
- **[Configured baseline contains unavailable tools]** -> Preserve names in config, label unavailable entries, and continue filtering only at active-set application time.
- **[Last-writer-wins can overwrite external edits]** -> Document the behavior in the UI status after save; concurrent-edit detection is intentionally out of scope.
- **[Vendored code becomes stale]** -> Keep the copied surface narrow, attributed, and locally adapted rather than mirroring the upstream package architecture.

## Migration Plan

1. Introduce tagged config-source and runtime-mode types while preserving existing paths, defaults, and config filenames.
2. Make trust-aware loading and valid-empty config behavior the only path used by session lifecycle and commands.
3. Add the attributed shared TUI module and production settings interface.
4. Move the session tools interface onto the shared frame and enable config-less snapshots.
5. Replace setup with settings, add reset confirmation, and update status/completions.
6. Exercise fresh, configured, malformed, untrusted, partial-save, session-only, resume, and reset flows through real Pi sessions while keeping `npm run check` passing.
7. Remove prototype-only files and script after production parity is confirmed.

Rollback is code-only: restore the prior extension version. Existing non-empty config files and versioned session snapshots remain compatible. Empty config files accepted by the new version will appear disabled under the old version, but they are not corrupted.

## Open Questions

None. Product behavior required for implementation has been decided; implementation-discovered platform constraints should be raised before changing these semantics.
