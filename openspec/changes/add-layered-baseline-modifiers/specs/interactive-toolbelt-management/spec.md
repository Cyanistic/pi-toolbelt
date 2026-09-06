## MODIFIED Requirements

### Requirement: Baseline values resolve omit, null, and arrays
The system SHALL treat each scope's `baseline` field as optional. When present, the value MUST be JSON `null`, an array of strings including an empty array, or a tagged modification object with `type` equal to `modify` and optional `add` and `remove` string arrays. `null` SHALL mean unrestricted. A string array SHALL mean an exact set. A modification object SHALL contain at least one non-empty `add` or `remove` list. Empty tool names, unknown modification fields, and a name present in both lists SHALL be invalid. Duplicate names within one list SHALL be accepted and normalized to one set member in first-seen order.

Baseline resolution SHALL start from the unrestricted built-in default and apply Global followed by trusted Project configuration. An omitted value SHALL preserve inherited state. `null` and arrays SHALL replace inherited state. A modification SHALL transform inherited state, and a later layer SHALL be able to reverse an earlier layer's addition or removal. Effective baseline policy SHALL distinguish an exact set from unrestricted state and retain the additions and removals needed to apply an unrestricted modification without synthesizing an exact configured list.

#### Scenario: Root default is unrestricted
- **WHEN** no scope defines `baseline`
- **THEN** the effective baseline is unrestricted with a contribution chain containing Default

#### Scenario: Explicit null is unrestricted
- **WHEN** Global sets `"baseline": null` and Project omits `baseline`
- **THEN** the effective baseline is unrestricted and the contribution chain shows the Global replacement

#### Scenario: Project null overrides Global list
- **WHEN** Global sets a non-empty baseline array and Project sets `"baseline": null`
- **THEN** the effective baseline is unrestricted and the contribution chain shows the Project replacement

#### Scenario: Project inherits Global list
- **WHEN** Global sets a baseline array and Project omits `baseline`
- **THEN** the effective baseline is that exact set and its contribution chain includes Global

#### Scenario: Empty array allowlist
- **WHEN** the effective baseline is `[]`
- **THEN** the resolved baseline is an exact set of zero tools, not unrestricted

#### Scenario: Modify an exact parent
- **WHEN** an inherited exact baseline contains `read` and `bash` and a later layer adds `grep` and removes `bash`
- **THEN** the effective baseline is the exact set containing `read` and `grep`

#### Scenario: Modify an unrestricted parent
- **WHEN** an inherited unrestricted baseline receives a modification that adds `grep` and removes `bash`
- **THEN** the effective policy remains unrestricted with final additions containing `grep` and final removals containing `bash`

#### Scenario: Later layer reverses an earlier layer
- **WHEN** Global removes `bash` and trusted Project adds `bash`
- **THEN** `bash` is not present in the effective removal set

#### Scenario: Duplicate names normalize
- **WHEN** one modification list repeats the same non-empty tool name
- **THEN** the scope remains valid and effective membership contains that name once

#### Scenario: Invalid baseline type
- **WHEN** a scope sets `baseline` to an unsupported value or an invalid modification object
- **THEN** that scope is malformed and its file remains untouched by settings saves for that scope

### Requirement: Settings distinguish scope state and effective source
The settings interface SHALL represent each scope as missing, valid, invalid, or ignored. For valid scopes, each known setting SHALL show whether it inherits or supplies a local value. Baseline output SHALL distinguish unrestricted policy from an exact tool set and SHALL show the ordered Default, Global, and trusted Project operations that contribute to the effective result. Missing values SHALL remain inherited rather than being materialized into the scope draft. Search output SHALL continue to identify its single effective Default, Global, or Project source.

#### Scenario: Project inherits Global baseline list
- **WHEN** Global defines a baseline array and Project omits `baseline`
- **THEN** the Project baseline row shows that exact set and identifies Global in the contribution chain

#### Scenario: Project inherits unrestricted Default
- **WHEN** Global omits `baseline` and Project omits `baseline`
- **THEN** the Project baseline row shows unrestricted and identifies Default in the contribution chain

#### Scenario: Global and Project modify the baseline
- **WHEN** Global and trusted Project both define baseline modifications
- **THEN** settings shows both operations in resolution order and previews their combined effective result

#### Scenario: Replacement remains visible in the chain
- **WHEN** a later scope uses `null` or an exact array after an earlier baseline operation
- **THEN** settings shows that the later operation replaced the inherited policy

#### Scenario: Global uses default search
- **WHEN** Global omits `search`
- **THEN** the Global search row shows BM25 and identifies Default as its source

#### Scenario: Project overrides search atomically
- **WHEN** Project defines a search object
- **THEN** the settings interface shows the complete Project search object as effective rather than merging its fields with Global search

### Requirement: Malformed scopes remain untouched and read-only
A scope SHALL be malformed when its file is invalid JSON, is not a JSON object, or contains an invalid known field. The settings interface SHALL show the exact path and validation error, disable creation, editing, saving, and removal for that scope, and leave its file untouched. Other valid writable scopes SHALL remain editable, while config-driven runtime behavior remains disabled until every participating scope is valid. `baseline` SHALL be invalid when present and not `null`, a string array, or a valid tagged modification. A tagged modification SHALL be invalid when its type is not `modify`, it contains unknown fields, both operation lists are empty or absent, either list contains an empty name, or one name appears in both lists. Duplicate names within one operation list MUST NOT make the scope malformed. `search` remains invalid when it has an unsupported known shape.

#### Scenario: Invalid JSON
- **WHEN** a scope file cannot be parsed as JSON
- **THEN** its tab shows the parse error and path and offers no action that can overwrite the file

#### Scenario: Invalid known field
- **WHEN** `baseline` is a number or `search` has an unsupported known shape
- **THEN** its tab shows the known-field validation error and remains read-only

#### Scenario: Invalid baseline modification
- **WHEN** a modification is empty, contains an empty name, contains an unknown field, or lists one name in both `add` and `remove`
- **THEN** its tab shows the validation error and remains read-only

#### Scenario: Duplicate operation entry
- **WHEN** a modification repeats a non-empty name within only `add` or only `remove`
- **THEN** the scope remains valid and resolves that name once

#### Scenario: Null baseline is valid
- **WHEN** a scope file contains `"baseline": null`
- **THEN** the scope is valid and is not treated as malformed

#### Scenario: Save valid scope beside malformed scope
- **WHEN** Global is valid and dirty while trusted Project is malformed
- **THEN** Ctrl+S can save Global, leaves Project untouched, and does not enable config-driven runtime behavior

### Requirement: Baseline editing supports inheritance, unrestricted, and exact names
The Global and Project baseline settings SHALL each offer Inherit, Unrestricted, Exact, and Modify. Global Inherit SHALL use the built-in default, and Project Inherit SHALL use Global or the built-in default. Inherit SHALL omit `baseline`, Unrestricted SHALL write JSON `null`, and Exact SHALL open a searchable multi-select and write a string array including an empty array.

Modify SHALL expose separate Add and Remove rows that use searchable tool pickers. The editor SHALL retain unavailable configured names, allow arbitrary exact non-empty names, show the inherited operations and effective preview, and prevent a name from remaining in both rows by moving a newly selected name out of the opposing row. Existing modifications SHALL reopen with their normalized saved values. Entering Modify from another mode SHALL begin without inferred operations. Confirming an empty modification SHALL select Inherit rather than write an invalid object.

#### Scenario: Global returns to default
- **WHEN** the user chooses Inherit for Global baseline
- **THEN** `baseline` is removed from the Global draft and the built-in default is displayed as inherited

#### Scenario: Global sets explicit unrestricted
- **WHEN** the user chooses Unrestricted for Global baseline
- **THEN** the Global draft stores `"baseline": null`

#### Scenario: Project returns to inheritance
- **WHEN** the user chooses Inherit for Project baseline
- **THEN** `baseline` is removed from the Project draft and the Global or Default contribution chain is displayed

#### Scenario: Project sets unrestricted override
- **WHEN** Global has an exact baseline and the user chooses Unrestricted for Project baseline
- **THEN** the Project draft stores `"baseline": null` and previews an unrestricted Project replacement

#### Scenario: Configure empty baseline
- **WHEN** the user confirms Exact with no selected names
- **THEN** the scope draft stores an empty baseline array

#### Scenario: Open a new modification
- **WHEN** the user chooses Modify for a scope whose current mode is not Modify
- **THEN** Add and Remove begin empty without deriving operations from the prior mode

#### Scenario: Empty modification becomes inheritance
- **WHEN** the user confirms Modify while both Add and Remove are empty
- **THEN** the scope draft omits `baseline` and displays Inherit

#### Scenario: Move a conflicting selection
- **WHEN** a user selects under Add a tool currently selected under Remove, or selects under Remove a tool currently selected under Add
- **THEN** the tool moves to the newly selected operation and the editor shows a concise status message

#### Scenario: Preview layered result
- **WHEN** the user edits Global or Project modification rows
- **THEN** settings previews the ordered contribution chain and the resulting exact or unrestricted policy from the current drafts

#### Scenario: Preserve unavailable configured tool
- **WHEN** a configured exact baseline or modification contains a name absent from Pi's registered catalog
- **THEN** the applicable picker shows the name as unavailable and preserves it unless the user deselects it

#### Scenario: Add arbitrary exact tool name
- **WHEN** a picker has non-empty search text that matches no registered tool and the user chooses the add action
- **THEN** that exact text is added to the active Exact, Add, or Remove selection

### Requirement: Saving settings does not mutate current session tools
After any successful settings save, the system SHALL reload configuration used by subsequent discovery calls and refresh displayed effective values. It MUST NOT call `setActiveTools()`, append an active-tool snapshot, or apply a newly saved baseline to the current session. Baseline changes SHALL take effect in a new session or through `/toolbelt reset`. After saving a changed baseline, settings SHALL point the user to `/toolbelt reset` as the way to apply it immediately.

#### Scenario: Save search change
- **WHEN** the user saves a valid search change and later invokes discovery in the same session
- **THEN** discovery uses the newly effective search configuration

#### Scenario: Save baseline change
- **WHEN** the user saves a different baseline
- **THEN** the current active tool set and session snapshot remain unchanged and settings identifies `/toolbelt reset` as the immediate apply action

#### Scenario: Save empty configuration
- **WHEN** the user saves a newly created `{}` scope
- **THEN** the scope becomes configured without changing current active tools

### Requirement: New-session baseline apply is list-only
On a new session or resume without a valid snapshot, the system SHALL clamp active tools to the registered subset when the effective baseline policy is exact. When the effective policy is unrestricted without final additions or removals, the system MUST NOT change active tools. When an unrestricted policy has final additions or removals, the system SHALL activate additions, deactivate removals, and leave every unrelated host tool's current membership unchanged. Unavailable configured names SHALL remain in configuration but SHALL NOT appear in the applied active set.

#### Scenario: List baseline clamps new session
- **WHEN** a new session starts with effective exact baseline `["read", "bash"]` and no snapshot
- **THEN** Toolbelt sets the active tools to the registered subset of that exact set

#### Scenario: Modified exact baseline clamps new session
- **WHEN** modifications produce an effective exact baseline and no snapshot exists
- **THEN** Toolbelt sets active tools to the registered subset of the final exact set

#### Scenario: Unrestricted baseline leaves host set
- **WHEN** a new session starts with unmodified unrestricted policy and no snapshot
- **THEN** Toolbelt does not call `setActiveTools()`

#### Scenario: Modified unrestricted baseline changes only named tools
- **WHEN** a new session starts with unrestricted policy that adds `grep` and removes `bash`
- **THEN** Toolbelt makes registered `grep` active, makes registered `bash` inactive, and preserves every other tool's prior membership

#### Scenario: Empty list baseline clears tools
- **WHEN** a new session starts with effective exact baseline `[]` and no snapshot
- **THEN** Toolbelt sets active tools to the empty registered subset

### Requirement: Reset applies resolved baseline with confirmation
`/toolbelt reset` SHALL be disabled when participating config is malformed or config-driven behavior is otherwise unavailable. When enabled with an effective exact policy, reset SHALL filter the final exact set against registered tools and use it as the target. With an effective unrestricted policy, reset SHALL target every currently registered tool except names in the final removal set; a later addition that reversed an earlier removal SHALL remain included. Reset SHALL compute additions, removals, and final count, require confirmation when membership would change, and on confirmation persist the complete target set before applying it. A no-op against the already-active target SHALL report no change without prompting or writing another snapshot.

#### Scenario: Reset without usable config
- **WHEN** participating config is malformed and the user invokes reset
- **THEN** the system reports that reset is disabled and makes no change

#### Scenario: Reset list baseline preview
- **WHEN** the effective exact policy differs from the active set
- **THEN** the confirmation shows tools to add, tools to remove, and the final active count for that set

#### Scenario: Reset unrestricted activates all registered
- **WHEN** the effective policy is unrestricted with no final removals, some registered tools are inactive, and the user confirms reset
- **THEN** the system persists and applies every currently registered tool name

#### Scenario: Reset honors later reversal
- **WHEN** an earlier layer removes a registered tool and a later layer adds it before reset
- **THEN** the reset target includes that tool

#### Scenario: Cancel reset
- **WHEN** the user declines reset confirmation
- **THEN** no snapshot is written and the active set remains unchanged

#### Scenario: No-op reset
- **WHEN** the reset target already equals the active set
- **THEN** the system reports no change without prompting or writing another snapshot

### Requirement: Status distinguishes runtime modes
`/toolbelt status` SHALL distinguish configured, session-only, and config-invalid degraded states while continuing to report active tool membership and the latest valid discovery receipt. When configured, it SHALL identify the effective baseline as exact or unrestricted and display its ordered Default, Global, and trusted Project contribution chain. It SHALL continue to report the single effective search source, Project trust when Project is ignored, and config errors when present. Missing config files with no snapshot SHALL report configured defaults, not inactive-for-missing-file.

#### Scenario: Configured status with list baseline
- **WHEN** effective config is valid with an exact baseline
- **THEN** status reports configured mode, participating paths, the effective exact set, its contribution chain, and search source

#### Scenario: Configured status with layered modifications
- **WHEN** Global and trusted Project modifications contribute to the effective baseline
- **THEN** status reports both named scopes in resolution order with their additions, removals, and final policy

#### Scenario: Configured status with unrestricted default
- **WHEN** neither config file exists
- **THEN** status reports configured mode with unrestricted baseline from Default and BM25 from Default

#### Scenario: Session-only status with invalid config
- **WHEN** config is malformed and a valid session snapshot exists
- **THEN** status reports the config error and that session-only tools remain available

#### Scenario: Invalid config without snapshot
- **WHEN** participating config is malformed and no valid session snapshot exists
- **THEN** status reports that config-driven behavior is unavailable and points to fixing config or using `/toolbelt tools` or `/toolbelt settings`
