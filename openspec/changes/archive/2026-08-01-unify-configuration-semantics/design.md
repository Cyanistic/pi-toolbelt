## Context

Toolbelt has two implementations of the same configuration semantics. `src/config.ts` parses files and resolves effective runtime configuration, while `src/settings-ui.ts` separately interprets raw drafts and resolves the values shown during editing. Both implementations understand Global and Project inheritance, omitted values, explicit `null`, empty lists, search replacement, trust, and effective-value sources.

The runtime implementation is authoritative after a file is saved, but the settings implementation controls what the user sees before saving. Any future rule change can update one path without the other and silently make the preview disagree with runtime behavior.

This is a behavior-preserving architectural change. Existing configuration files, settings interactions, runtime modes, and save behavior remain the contract.

## Goals / Non-Goals

**Goals:**

- Make `src/config.ts` the single deep module that owns configuration meaning across files and in-memory drafts.
- Route runtime and draft resolution through one inheritance implementation.
- Hide raw JSON, unknown-field preservation, and scope mutation details from `src/settings-ui.ts`.
- Give the settings UI typed semantic state, typed user intents, and explicit per-scope save outcomes.
- Preserve the existing settings flow, independent scope saves, trust rules, and runtime loading behavior.
- Make the configuration module's interface the verification surface for configuration semantics.

**Non-Goals:**

- Change any config-file shape, default, inheritance rule, command, model tool, runtime mode, or settings UX.
- Add a shared runtime cache or a cache invalidation protocol.
- Synchronize external file or Project trust changes while the settings editor remains open; reopen settings to observe environment changes.
- Add cross-file transactions, external-edit conflict detection, rollback machinery, or migration tooling.
- Move picker, navigation, rendering, or status-copy decisions out of `src/settings-ui.ts`.
- Relocate unrelated existing types or restructure other modules.
- Add dependencies or a new automated or manual end-to-end test suite.

## Decisions

### 1. Deepen the existing configuration module

`src/config.ts` remains the external configuration seam. It will own file parsing, validation, trust-aware scope loading, effective resolution, raw-field preservation, editor drafts, staged mutations, independent saves, and post-save reloads.

The implementation may use private helpers inside `src/config.ts`. A private implementation file should be introduced only if implementation pressure proves that one file harms locality. Callers will still cross the same `src/config.ts` seam.

**Alternative considered:** Add a new public module above `config.ts`. Rejected because callers would need to understand another seam while `config.ts` continued exposing lower-level configuration knowledge.

### 2. Keep runtime loading on demand

`buildEffectiveConfig(cwd, projectTrusted)` remains the runtime entry. Runtime callers continue reading the small configuration files when they need current state.

Runtime file resolution and settings draft resolution will feed one internal inheritance implementation. The two paths may obtain scope values differently, but project-over-global-over-default selection, omitted-value behavior, resolved sources, and search replacement will exist in one place.

**Alternative considered:** Share one live configuration instance between runtime and the settings editor. Rejected because it would require synchronization for saves, external file edits, trust changes, and session lifecycle events without solving a demonstrated performance problem.

### 3. Put editor configuration state behind the seam

The configuration module will own a configuration editor session. Its private implementation retains each scope's source data, raw JSON, and staged mutation.

The settings UI receives semantic snapshots containing only facts it needs to render and navigate, including:

- scope state: missing, valid, invalid, or ignored
- whether the scope is writable and dirty
- effective baseline and search values with their sources
- scope-local draft selections
- paths and user-facing validation errors
- per-scope save outcomes

The UI sends typed user intents for existing actions such as create, remove, baseline selection, search selection, and save. A single tagged intent path keeps the interface smaller than exposing one method for every edit. Raw `Record<string, unknown>` values and unknown-field merge rules do not cross the seam.

Picker instances, active scope, cursor position, nested view, footer text, and rendered settings rows remain UI-owned state.

**Alternatives considered:**

- Share raw draft objects and only centralize inheritance. Rejected because the UI would still own raw interpretation and unknown-field preservation, leaving the main leakage intact.
- Return presentation-ready rows from the configuration module. Rejected because terminal rendering knowledge would leak into configuration semantics.

### 4. Preserve independent, last-write-wins saves

Saving attempts dirty Global and Project scopes independently in the current order. Each successful scope uses the existing temporary-file and same-directory rename path, clears its mutation, and reloads its source. A failed scope keeps its draft and returns an explicit failure outcome. Success in one scope is not rolled back because another scope fails.

The retained raw object remains the basis for a saved draft, so existing last-write-wins behavior and unknown top-level and nested-field preservation remain unchanged. The change does not add external-edit detection or merging.

A successful settings save refreshes subsequent configuration reads but does not call `setActiveTools`, append a session snapshot, or apply the saved baseline to the current session.

### 5. Enforce trust as an operation-time guard

Pi resolves Project trust before constructing an extension runtime and tears down custom extension UI before trust can be resolved again. The configuration editor therefore loads Project source state once when settings opens and does not model trust transitions during the view's lifetime.

The editor still receives a trust dependency and rechecks it immediately before every Project mutation and disk write as a fail-closed security guard. If the guard reports untrusted, the operation is rejected without unloading, cloning, restoring, or otherwise transforming the retained editor state; Global remains editable. Reopening settings loads the current trust and Project source state.

This enforces the existing requirement that untrusted Project configuration must not be parsed, displayed, modified, or removed without inventing an environmental synchronization lifecycle that Pi does not expose.

**Alternatives considered:**

- Capture trust only when the editor opens and never recheck it. Rejected because the operation-time guard is cheap defense in depth if host lifecycle behavior changes.
- Unload Project state on trust revocation, retain dirty drafts separately, and restore them when trust returns. Rejected because Pi custom UI cannot outlive an in-process trust change, so this adds unreachable state transitions and maintenance cost.

### 6. Preserve existing type ownership unless the new seam requires otherwise

New semantic snapshot, intent, and save-outcome types belong to the configuration module because they define its interface. Existing schema-derived and runtime types remain where they are unless a move is required to remove a dependency cycle. This keeps the change focused on duplicated configuration knowledge rather than unrelated file organization.

## Risks / Trade-offs

- **The editor interface becomes shallow or too wide** -> Use one tagged intent path, semantic snapshots, and per-scope save outcomes instead of exposing raw helpers or a method for every field.
- **Behavior changes during extraction** -> Compare the new flow against the existing requirements, inspect persisted and draft resolution through the shared interface, and run `npm run check`.
- **`config.ts` becomes large** -> Preserve one external seam and split private implementation only if concrete implementation pressure harms locality.
- **Semantic snapshots accidentally absorb presentation decisions** -> Keep labels, row construction, picker state, navigation, and terminal rendering in `settings-ui.ts`.
- **The operation-time trust guard rejects Project work** -> Leave editor state unchanged, refuse the Project mutation or persistence, allow Global work to continue, and reopen settings to reload environment state.

## Migration Plan

1. Introduce the configuration-owned editor state and semantic snapshot while retaining current runtime loading.
2. Move draft parsing, inheritance, raw updates, and save/reload behavior from `src/settings-ui.ts` behind the configuration seam.
3. Replace settings UI raw-state access with semantic snapshots and typed intents.
4. Remove the duplicated draft resolution and raw mutation helpers from `src/settings-ui.ts`.
5. Run existing checks and review the shared persisted/draft resolution flow before merging.

Rollback is a source revert. No data migration, compatibility shim, or staged deployment is required because persisted configuration shapes and external behavior do not change.

## Open Questions

None. The module depth, UI seam, save semantics, trust enforcement, runtime loading, scope, and verification approach were resolved before this design.
