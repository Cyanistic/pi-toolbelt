# interactive-toolbelt-management Specification

## Purpose
Interactive Toolbelt management: scoped settings editing, shared TUI chrome, session tool selection, draft persistence, config-file safety, and config-less session operation.

## Requirements

### Requirement: Management commands expose distinct persistent and session scopes
The system SHALL expose `/toolbelt settings`, `/toolbelt tools`, `/toolbelt status`, and `/toolbelt reset` with argument completions and concise bare `/toolbelt` help. `/toolbelt settings` SHALL be the only interactive entrypoint for persistent configuration. `/toolbelt tools` SHALL manage only the current session's active tool set. The system MUST NOT expose `/toolbelt setup`.

#### Scenario: Bare command help
- **WHEN** the user runs `/toolbelt` without a subcommand
- **THEN** the system lists settings, tools, status, and reset with concise descriptions

#### Scenario: Persistent settings entrypoint
- **WHEN** the user runs `/toolbelt settings` in TUI mode
- **THEN** the system opens the persistent configuration editor

#### Scenario: Removed setup command
- **WHEN** the user runs `/toolbelt setup`
- **THEN** the system treats `setup` as an unknown subcommand and directs the user to the supported command set

### Requirement: Management interfaces share a bottom-anchored frame
The settings and tools interfaces SHALL use the same title, border, status, and context-sensitive footer language. Each SHALL open as a non-overlay custom view that replaces Pi's bottom composer and grows upward. Production interfaces MUST NOT expose prototype variants or screen-switching controls.

#### Scenario: Open settings interface
- **WHEN** the user opens `/toolbelt settings`
- **THEN** a bottom-anchored Toolbelt Settings frame appears with Global and Project tabs and settings-specific controls

#### Scenario: Open tools interface
- **WHEN** the user opens `/toolbelt tools`
- **THEN** a bottom-anchored Toolbelt Tools frame appears with a Session scope label and tools-specific controls

#### Scenario: Stable nested picker frame
- **WHEN** the user opens a baseline, backend, or model picker
- **THEN** the picker replaces only the frame body while the outer title, border, scope context, and footer remain stable

### Requirement: Settings distinguish scope state and effective source
The settings interface SHALL represent each scope as missing, valid, invalid, or ignored. For valid scopes, each known setting SHALL show whether its effective value comes from Default, Global, or Project. Missing values SHALL remain inherited rather than being materialized into the scope draft.

#### Scenario: Project inherits Global baseline
- **WHEN** Global defines `baseline` and Project omits `baseline`
- **THEN** the Project baseline row shows the Global value and identifies Global as its source

#### Scenario: Global uses default search
- **WHEN** Global omits `search`
- **THEN** the Global search row shows BM25 and identifies Default as its source

#### Scenario: Project overrides search atomically
- **WHEN** Project defines a search object
- **THEN** the settings interface shows the complete Project search object as effective rather than merging its fields with Global search

### Requirement: Project settings require project trust
The system SHALL display the Project tab whether or not Pi trusts the project. While untrusted, the Project tab SHALL be inactive and read-only, SHALL explain that Project configuration is ignored until trust is granted, and MUST NOT parse, display values from, modify, or remove the Project file. Global SHALL remain editable.

#### Scenario: Untrusted Project tab
- **WHEN** Pi reports the project as untrusted and the user selects the Project tab
- **THEN** the tab shows its ignored read-only state and no editing action is available

#### Scenario: Global editing remains available
- **WHEN** Pi reports the project as untrusted
- **THEN** the user can create, edit, remove, and save valid Global configuration

#### Scenario: Trusted Project tab
- **WHEN** Pi reports the project as trusted
- **THEN** the Project source is loaded and its valid settings become editable

### Requirement: Configuration creation and removal are explicit drafts
Opening settings SHALL NOT create or dirty a configuration. When no config exists, the interface SHALL open on Global with an explicit `Create global configuration` action. Creating a scope SHALL stage `{}`. Only an explicit `Remove scope configuration` action SHALL stage file deletion, and both creation and deletion SHALL remain drafts until Ctrl+S.

#### Scenario: Open with no config
- **WHEN** neither config file exists and the user opens settings
- **THEN** Global is selected, no tab is dirty, and no file is created

#### Scenario: Create empty Global scope
- **WHEN** the user activates `Create global configuration`
- **THEN** the Global draft becomes `{}`, the Global tab becomes dirty, and the file remains absent until save

#### Scenario: Stage scope removal
- **WHEN** the user activates `Remove scope configuration` for a valid writable scope
- **THEN** that scope becomes dirty and its file remains present until save

#### Scenario: Discard staged removal
- **WHEN** the user discards a staged scope removal
- **THEN** the original file remains untouched

### Requirement: Valid empty and forward-compatible configuration are preserved
A JSON object SHALL be a valid configured scope when known fields are absent, including `{}` and objects containing only unknown fields. Unknown fields SHALL be ignored by runtime resolution and preserved when settings updates known fields. Unknown nested properties alongside known search fields SHALL also be preserved.

#### Scenario: Empty object enables scope defaults
- **WHEN** a scope file contains `{}`
- **THEN** the scope is valid and its baseline and search values resolve through inheritance or defaults

#### Scenario: Unknown-only object
- **WHEN** a scope file contains only unknown properties
- **THEN** the scope is valid and those properties do not alter effective baseline or search behavior

#### Scenario: Edit known field with unknown sibling
- **WHEN** the user changes `baseline` in a valid scope containing an unknown top-level property and saves
- **THEN** the new baseline and the unknown property are both written

#### Scenario: Edit search with unknown nested sibling
- **WHEN** the user changes a known search field in a valid search object containing an unknown property and saves
- **THEN** the known search value changes and the unknown nested property remains present

### Requirement: Malformed scopes remain untouched and read-only
A scope SHALL be malformed when its file is invalid JSON, is not a JSON object, or contains an invalid known field. The settings interface SHALL show the exact path and validation error, disable creation, editing, saving, and removal for that scope, and leave its file untouched. Other valid writable scopes SHALL remain editable, while config-driven runtime behavior remains disabled until every participating scope is valid.

#### Scenario: Invalid JSON
- **WHEN** a scope file cannot be parsed as JSON
- **THEN** its tab shows the parse error and path and offers no action that can overwrite the file

#### Scenario: Invalid known field
- **WHEN** `baseline` is not an array of strings or `search` has an unsupported known shape
- **THEN** its tab shows the known-field validation error and remains read-only

#### Scenario: Save valid scope beside malformed scope
- **WHEN** Global is valid and dirty while trusted Project is malformed
- **THEN** Ctrl+S can save Global, leaves Project untouched, and does not enable config-driven runtime behavior

### Requirement: Baseline editing supports inheritance and exact names
The Global baseline setting SHALL offer Default or Custom. The Project baseline setting SHALL offer Inherit or Custom. Custom SHALL open a searchable multi-select containing registered tools and unavailable configured names. The user SHALL be able to add the exact non-empty search text as a custom tool name. An empty custom selection SHALL be valid.

#### Scenario: Global returns to default
- **WHEN** the user chooses Default for Global baseline
- **THEN** `baseline` is removed from the Global draft and the built-in default is displayed as effective

#### Scenario: Project returns to inheritance
- **WHEN** the user chooses Inherit for Project baseline
- **THEN** `baseline` is removed from the Project draft and the Global or Default source is displayed

#### Scenario: Preserve unavailable configured tool
- **WHEN** a configured baseline contains a name absent from Pi's registered catalog
- **THEN** the picker shows the name as unavailable and preserves it unless the user deselects it

#### Scenario: Add arbitrary exact tool name
- **WHEN** the picker has non-empty search text that matches no registered tool and the user chooses the add action
- **THEN** that exact text is added to the custom baseline selection

#### Scenario: Configure empty baseline
- **WHEN** the user confirms a custom baseline with no selected names
- **THEN** the scope draft stores an empty baseline array

### Requirement: Search editing supports backend and model selection
The Global search setting SHALL offer Default, explicit BM25, and explicit LLM. The Project search setting SHALL offer Inherit, explicit BM25, and explicit LLM. Choosing LLM SHALL require confirming a searchable model choice. The model picker SHALL include Active model, every currently available Pi model as `provider/id`, and any unavailable configured model.

#### Scenario: Active model selection
- **WHEN** the user chooses Active model for LLM search
- **THEN** the scope draft stores `{ "type": "llm" }` without a `model` field

#### Scenario: Available model selection
- **WHEN** the user chooses an available Pi model
- **THEN** the scope draft stores its exact `provider/id` in the LLM search object

#### Scenario: Unavailable configured model
- **WHEN** the scope contains an LLM model absent from Pi's available model list
- **THEN** the picker retains and labels that configured value as unavailable

#### Scenario: Cancel model selection
- **WHEN** the user cancels the model picker opened from the backend picker
- **THEN** the search draft remains unchanged and focus returns to the backend picker

### Requirement: Settings changes remain drafts until explicit save
Every settings edit SHALL modify only an in-memory per-scope draft. Dirty scope tabs SHALL display `*`. Ctrl+S SHALL attempt all dirty writable scopes and keep the interface open. Escape from a clean top-level view SHALL close immediately. Escape with any dirty scope SHALL require confirmation before discarding all remaining drafts.

#### Scenario: Stage settings change
- **WHEN** the user confirms a baseline, backend, model, create, or remove edit
- **THEN** only the affected scope draft changes and its tab displays `*`

#### Scenario: Cancel nested editor
- **WHEN** the user presses Escape within a baseline, backend, or model picker
- **THEN** the picker closes or returns to its parent without changing the scope draft

#### Scenario: Cancel dirty close
- **WHEN** the user declines the discard confirmation
- **THEN** the settings interface reopens with every draft intact

#### Scenario: Confirm dirty close
- **WHEN** the user accepts the discard confirmation
- **THEN** the interface closes without writing any remaining draft

### Requirement: Scope saves are atomic and independently recoverable
Each dirty scope write SHALL use a temporary file and same-directory rename so the target is never partially written. Ctrl+S SHALL attempt Global before Project. A successful scope SHALL clear its draft and reload from disk. A failed scope SHALL remain dirty with its draft intact. Success in one scope MUST NOT be rolled back because another scope fails.

#### Scenario: Both scopes save successfully
- **WHEN** Global and Project are dirty and both filesystem operations succeed
- **THEN** both target files contain their complete drafts and both dirty markers clear

#### Scenario: Project save fails after Global succeeds
- **WHEN** Global saves successfully and Project write or rename fails
- **THEN** Global remains saved and clean, Project remains dirty, and the interface reports the failed scope, path, and error

#### Scenario: Atomic replacement fails
- **WHEN** a temporary file is written but its rename fails
- **THEN** the prior target file remains intact and Toolbelt attempts to remove the temporary file

#### Scenario: External edit while open
- **WHEN** a writable config file changes outside Toolbelt after settings opened and the user later saves that scope
- **THEN** Toolbelt writes the complete retained draft without requiring conflict resolution

### Requirement: Saving settings does not mutate current session tools
After any successful settings save, the system SHALL reload configuration used by subsequent discovery calls and refresh displayed effective values. It MUST NOT call `setActiveTools()`, append an active-tool snapshot, or apply a newly saved baseline to the current session. Baseline changes SHALL take effect in a new session or through `/toolbelt reset`.

#### Scenario: Save search change
- **WHEN** the user saves a valid search change and later invokes discovery in the same session
- **THEN** discovery uses the newly effective search configuration

#### Scenario: Save baseline change
- **WHEN** the user saves a different baseline
- **THEN** the current active tool set and session snapshot remain unchanged

#### Scenario: Save empty configuration
- **WHEN** the user saves a newly created `{}` scope
- **THEN** the scope becomes configured without changing current active tools

### Requirement: Session tools are staged and config-independent
`/toolbelt tools` SHALL show registered tools and the current session's applied active set regardless of config availability or validity. Filtering and toggling SHALL affect only a staged set. The interface SHALL visibly distinguish additions, removals, applied count, staged count, and whether unapplied changes exist.

#### Scenario: Open tools without config
- **WHEN** no valid config exists and the user opens `/toolbelt tools`
- **THEN** every registered tool remains inspectable and toggleable

#### Scenario: Stage tool changes
- **WHEN** the user toggles a registered tool
- **THEN** the staged set changes while Pi's active set and persisted snapshot remain unchanged

#### Scenario: Filter tool catalog
- **WHEN** the user types filter text
- **THEN** rows are filtered by tool name and description without removing hidden selections from the staged set

#### Scenario: Stage zero active tools
- **WHEN** the user clears every tool selection
- **THEN** an empty staged active set remains valid and can be applied

### Requirement: Applying session tools persists before mutation
Enter in `/toolbelt tools` SHALL append a versioned complete active-set snapshot before calling `setActiveTools()`. Applying SHALL remain available when config is absent or malformed. The interface SHALL stay open after success and treat the applied set as its new clean state. Applying an unchanged set SHALL still persist a snapshot to establish explicit session-only intent.

#### Scenario: Apply staged tools
- **WHEN** the user presses Enter with staged changes and snapshot persistence succeeds
- **THEN** the complete staged set is persisted, then becomes Pi's active set, and the interface remains open in sync

#### Scenario: Snapshot persistence fails
- **WHEN** appending the snapshot throws
- **THEN** Pi's active set remains unchanged and the staged draft remains available

#### Scenario: Apply unchanged set without config
- **WHEN** no valid config exists and the user presses Enter with staged tools equal to the current active set
- **THEN** the system persists the complete set and establishes session-only mode without changing membership

### Requirement: Closing tools protects unapplied changes
Escape from `/toolbelt tools` SHALL close immediately when staged and applied sets match. When they differ, Escape SHALL require confirmation before discarding staged changes. Cancelling the confirmation SHALL reopen the same retained staged state.

#### Scenario: Close synchronized tools
- **WHEN** staged and applied sets match and the user presses Escape
- **THEN** the interface closes without prompting

#### Scenario: Cancel staged discard
- **WHEN** staged and applied sets differ and the user declines the discard confirmation
- **THEN** the interface reopens with the same filter, cursor, and staged set

#### Scenario: Confirm staged discard
- **WHEN** staged and applied sets differ and the user accepts the discard confirmation
- **THEN** the interface closes without persisting or applying the staged set

### Requirement: Session snapshots restore independently of config
On session resume, the system SHALL restore the newest valid active-tool snapshot before considering config-driven baseline behavior. Snapshot names absent from the current registered catalog SHALL be filtered at application time. A valid snapshot SHALL restore when config is missing or malformed. Without a snapshot, only a valid effective config SHALL apply a baseline.

#### Scenario: Resume config-less session
- **WHEN** a session with an explicit snapshot resumes without config
- **THEN** the filtered snapshot becomes the active tool set

#### Scenario: Resume session with malformed config
- **WHEN** a session with an explicit snapshot resumes while a participating config is malformed
- **THEN** the filtered snapshot becomes active and config-driven behavior remains disabled

#### Scenario: Resume configured session without snapshot
- **WHEN** a configured session resumes without a valid snapshot
- **THEN** the filtered effective baseline becomes active

#### Scenario: Start unconfigured session without snapshot
- **WHEN** a new session starts with no valid config and no snapshot
- **THEN** Toolbelt does not call `setActiveTools()`

### Requirement: Reset requires a configured baseline and confirmation
`/toolbelt reset` SHALL be disabled unless effective configuration is valid. When enabled, it SHALL filter the effective baseline against registered tools and compute additions, removals, and the final count before mutation. A non-empty change SHALL require confirmation. Confirmed reset SHALL persist the complete baseline snapshot before applying it.

#### Scenario: Reset without config
- **WHEN** the session is session-only and the user invokes reset
- **THEN** the system reports that no configured baseline exists and makes no change

#### Scenario: Reset with malformed config
- **WHEN** a participating config is malformed and the user invokes reset
- **THEN** the system reports that reset is disabled and makes no change

#### Scenario: Reset preview
- **WHEN** the effective baseline differs from the active set
- **THEN** the confirmation shows tools to add, tools to remove, and the final active count

#### Scenario: Cancel reset
- **WHEN** the user declines reset confirmation
- **THEN** no snapshot is written and the active set remains unchanged

#### Scenario: No-op reset
- **WHEN** the effective baseline already equals the active set
- **THEN** the system reports no change without prompting or writing another snapshot

### Requirement: Status distinguishes runtime modes
`/toolbelt status` SHALL distinguish configured, session-only, inactive, and config-invalid states while continuing to report active tool membership and the latest valid discovery receipt. It SHALL identify effective baseline and search sources when configured, Project trust when Project is ignored, and config errors when present.

#### Scenario: Configured status
- **WHEN** effective config is valid
- **THEN** status reports configured mode, participating paths, effective source, baseline, and search source

#### Scenario: Session-only status
- **WHEN** no usable config exists and a valid session snapshot exists
- **THEN** status reports session-only mode and default BM25 discovery

#### Scenario: Invalid config with session snapshot
- **WHEN** config is malformed and a valid session snapshot exists
- **THEN** status reports the config error and that session-only tools remain available

#### Scenario: Inactive status
- **WHEN** no usable config and no valid session snapshot exist
- **THEN** status reports inactive mode and points to `/toolbelt tools` or `/toolbelt settings`
