## ADDED Requirements

### Requirement: Baseline values resolve omit, null, and arrays
The system SHALL treat a scope `baseline` field as optional. When present, the value MUST be JSON `null` or an array of strings (including an empty array). `null` SHALL mean unrestricted (all tools). A string array SHALL mean an exact allowlist, and an empty array SHALL mean zero tools. When `baseline` is omitted from a scope, that scope SHALL inherit the parent scope's baseline; when omitted through the full chain, the root default SHALL be unrestricted. Effective baseline SHALL distinguish unrestricted from list so callers can switch on kind rather than treating unrestricted as a synthetic tool list.

#### Scenario: Root default is unrestricted
- **WHEN** no scope defines `baseline`
- **THEN** the effective baseline is unrestricted with source Default

#### Scenario: Explicit null is unrestricted
- **WHEN** Global sets `"baseline": null` and Project omits `baseline`
- **THEN** the effective baseline is unrestricted with source Global

#### Scenario: Project null overrides Global list
- **WHEN** Global sets a non-empty baseline array and Project sets `"baseline": null`
- **THEN** the effective baseline is unrestricted with source Project

#### Scenario: Project inherits Global list
- **WHEN** Global sets a baseline array and Project omits `baseline`
- **THEN** the effective baseline is that list with source Global

#### Scenario: Empty array allowlist
- **WHEN** the effective baseline is `[]`
- **THEN** the resolved baseline is a list of zero tools, not unrestricted

#### Scenario: Invalid baseline type
- **WHEN** a scope sets `baseline` to a non-null non-array value
- **THEN** that scope is malformed and its file remains untouched by settings saves for that scope

### Requirement: New-session baseline apply is list-only
On a new session or resume without a valid snapshot, the system SHALL call `setActiveTools` with the filtered allowlist only when the effective baseline is a list. When the effective baseline is unrestricted, the system MUST NOT call `setActiveTools` for baseline application.

#### Scenario: List baseline clamps new session
- **WHEN** a new session starts with effective list baseline `["read", "bash"]` and no snapshot
- **THEN** Toolbelt sets the active tools to the registered subset of that list

#### Scenario: Unrestricted baseline leaves host set
- **WHEN** a new session starts with effective unrestricted baseline and no snapshot
- **THEN** Toolbelt does not call `setActiveTools()`

#### Scenario: Empty list baseline clears tools
- **WHEN** a new session starts with effective baseline `[]` and no snapshot
- **THEN** Toolbelt sets the active tools to the empty registered subset

### Requirement: Missing config files use default configuration
Absence of both Global and Project config files SHALL NOT disable config-driven behavior. The system SHALL treat that state as valid default configuration: unrestricted baseline and BM25 search. Runtime mode SHALL be configured unless a participating scope is malformed.

#### Scenario: Fresh install status
- **WHEN** neither config file exists and no session snapshot exists
- **THEN** `/toolbelt status` reports configured mode with Default baseline unrestricted and Default BM25 search

#### Scenario: Fresh install does not clamp
- **WHEN** a new session starts with neither config file present
- **THEN** Toolbelt does not call `setActiveTools()`

## MODIFIED Requirements

### Requirement: Settings distinguish scope state and effective source
The settings interface SHALL represent each scope as missing, valid, invalid, or ignored. For valid scopes, each known setting SHALL show whether its effective value comes from Default, Global, or Project, and SHALL show unrestricted baseline distinctly from a tool list. Missing values SHALL remain inherited rather than being materialized into the scope draft.

#### Scenario: Project inherits Global baseline list
- **WHEN** Global defines a baseline array and Project omits `baseline`
- **THEN** the Project baseline row shows that list and identifies Global as its source

#### Scenario: Project inherits unrestricted Default
- **WHEN** Global omits `baseline` and Project omits `baseline`
- **THEN** the Project baseline row shows unrestricted and identifies Default as its source

#### Scenario: Global uses default search
- **WHEN** Global omits `search`
- **THEN** the Global search row shows BM25 and identifies Default as its source

#### Scenario: Project overrides search atomically
- **WHEN** Project defines a search object
- **THEN** the settings interface shows the complete Project search object as effective rather than merging its fields with Global search

### Requirement: Valid empty and forward-compatible configuration are preserved
A JSON object SHALL be a valid configured scope when known fields are absent, including `{}` and objects containing only unknown fields. Unknown fields SHALL be ignored by runtime resolution and preserved when settings updates known fields. Unknown nested properties alongside known search fields SHALL also be preserved. A scope that is only `{}` SHALL resolve baseline to unrestricted through inheritance or root default and search to BM25 unless a parent supplies otherwise.

#### Scenario: Empty object enables scope defaults
- **WHEN** a scope file contains `{}`
- **THEN** the scope is valid and its baseline and search values resolve through inheritance or defaults (root baseline default unrestricted, search default BM25)

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
A scope SHALL be malformed when its file is invalid JSON, is not a JSON object, or contains an invalid known field. The settings interface SHALL show the exact path and validation error, disable creation, editing, saving, and removal for that scope, and leave its file untouched. Other valid writable scopes SHALL remain editable, while config-driven runtime behavior remains disabled until every participating scope is valid. `baseline` is invalid when present and neither JSON `null` nor an array of strings. `search` remains invalid when it has an unsupported known shape.

#### Scenario: Invalid JSON
- **WHEN** a scope file cannot be parsed as JSON
- **THEN** its tab shows the parse error and path and offers no action that can overwrite the file

#### Scenario: Invalid known field
- **WHEN** `baseline` is a number or `search` has an unsupported known shape
- **THEN** its tab shows the known-field validation error and remains read-only

#### Scenario: Null baseline is valid
- **WHEN** a scope file contains `"baseline": null`
- **THEN** the scope is valid and is not treated as malformed

#### Scenario: Save valid scope beside malformed scope
- **WHEN** Global is valid and dirty while trusted Project is malformed
- **THEN** Ctrl+S can save Global, leaves Project untouched, and does not enable config-driven runtime behavior

### Requirement: Baseline editing supports inheritance, unrestricted, and exact names
The Global baseline setting SHALL offer Default, Unrestricted, and Custom. The Project baseline setting SHALL offer Inherit, Unrestricted, and Custom. Default (Global) and Inherit (Project) SHALL omit `baseline` from the draft. Unrestricted SHALL write JSON `null`. Custom SHALL open a searchable multi-select containing registered tools and unavailable configured names and SHALL write a string array (including empty). The user SHALL be able to add the exact non-empty search text as a custom tool name.

#### Scenario: Global returns to default
- **WHEN** the user chooses Default for Global baseline
- **THEN** `baseline` is removed from the Global draft and unrestricted Default is displayed as effective

#### Scenario: Global sets explicit unrestricted
- **WHEN** the user chooses Unrestricted for Global baseline
- **THEN** the Global draft stores `"baseline": null`

#### Scenario: Project returns to inheritance
- **WHEN** the user chooses Inherit for Project baseline
- **THEN** `baseline` is removed from the Project draft and the Global or Default source is displayed

#### Scenario: Project sets unrestricted override
- **WHEN** Global has a list baseline and the user chooses Unrestricted for Project baseline
- **THEN** the Project draft stores `"baseline": null` and effective baseline is unrestricted from Project

#### Scenario: Preserve unavailable configured tool
- **WHEN** a configured baseline list contains a name absent from Pi's registered catalog
- **THEN** the picker shows the name as unavailable and preserves it unless the user deselects it

#### Scenario: Add arbitrary exact tool name
- **WHEN** the picker has non-empty search text that matches no registered tool and the user chooses the add action
- **THEN** that exact text is added to the custom baseline selection

#### Scenario: Configure empty baseline
- **WHEN** the user confirms a custom baseline with no selected names
- **THEN** the scope draft stores an empty baseline array

### Requirement: Session snapshots restore independently of config
On session resume, the system SHALL restore the newest valid active-tool snapshot before considering config-driven baseline behavior. Snapshot names absent from the current registered catalog SHALL be filtered at application time. A valid snapshot SHALL restore when config is missing or malformed. Without a snapshot, the system SHALL apply a list baseline when effective configuration is usable and the baseline is a list, and MUST NOT call `setActiveTools` when the effective baseline is unrestricted or when config-driven behavior is disabled by malformed participating config.

#### Scenario: Resume config-less session
- **WHEN** a session with an explicit snapshot resumes without config files
- **THEN** the filtered snapshot becomes the active tool set

#### Scenario: Resume session with malformed config
- **WHEN** a session with an explicit snapshot resumes while a participating config is malformed
- **THEN** the filtered snapshot becomes active and config-driven behavior remains disabled

#### Scenario: Resume list-baseline session without snapshot
- **WHEN** a session with usable effective list baseline resumes without a valid snapshot
- **THEN** the filtered list baseline becomes active

#### Scenario: Resume unrestricted session without snapshot
- **WHEN** a session with usable effective unrestricted baseline resumes without a valid snapshot
- **THEN** Toolbelt does not call `setActiveTools()`

#### Scenario: Start default session without snapshot
- **WHEN** a new session starts with no config files and no snapshot
- **THEN** Toolbelt does not call `setActiveTools()`

### Requirement: Reset applies resolved baseline with confirmation
`/toolbelt reset` SHALL be disabled when participating config is malformed or config-driven behavior is otherwise unavailable. When enabled, if the effective baseline is a list, reset SHALL filter that list against registered tools, compute additions, removals, and final count, require confirmation when membership would change, and on confirm persist the complete target set before applying it. When the effective baseline is unrestricted, reset SHALL target all currently registered tool names, compute additions, removals, and final count against that full registered set, require confirmation when membership would change, and on confirm persist then apply that full registered set. A no-op against the already-active target SHALL report no change without prompting or writing another snapshot.

#### Scenario: Reset without usable config
- **WHEN** participating config is malformed and the user invokes reset
- **THEN** the system reports that reset is disabled and makes no change

#### Scenario: Reset list baseline preview
- **WHEN** the effective baseline is a list that differs from the active set
- **THEN** the confirmation shows tools to add, tools to remove, and the final active count for that list

#### Scenario: Reset unrestricted activates all registered
- **WHEN** the effective baseline is unrestricted, some registered tools are inactive, and the user confirms reset
- **THEN** the system persists and applies every currently registered tool name

#### Scenario: Cancel reset
- **WHEN** the user declines reset confirmation
- **THEN** no snapshot is written and the active set remains unchanged

#### Scenario: No-op reset
- **WHEN** the reset target already equals the active set
- **THEN** the system reports no change without prompting or writing another snapshot

### Requirement: Status distinguishes runtime modes
`/toolbelt status` SHALL distinguish configured, session-only, and config-invalid degraded states while continuing to report active tool membership and the latest valid discovery receipt. It SHALL identify effective baseline (unrestricted or list) and search sources when configured, Project trust when Project is ignored, and config errors when present. Missing config files with no snapshot SHALL report configured defaults, not inactive-for-missing-file.

#### Scenario: Configured status with list baseline
- **WHEN** effective config is valid with a list baseline
- **THEN** status reports configured mode, participating paths, effective source, the baseline list, and search source

#### Scenario: Configured status with unrestricted default
- **WHEN** neither config file exists
- **THEN** status reports configured mode with unrestricted baseline from Default and BM25 from Default

#### Scenario: Session-only status with invalid config
- **WHEN** config is malformed and a valid session snapshot exists
- **THEN** status reports the config error and that session-only tools remain available

#### Scenario: Invalid config without snapshot
- **WHEN** participating config is malformed and no valid session snapshot exists
- **THEN** status reports that config-driven behavior is unavailable and points to fixing config or using `/toolbelt tools` / `/toolbelt settings`
