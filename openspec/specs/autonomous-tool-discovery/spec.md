# autonomous-tool-discovery Specification

## Purpose
TBD - created by archiving change autonomous-hidden-tool-discovery. Update Purpose after archive.
## Requirements
### Requirement: Default configuration enables discovery without files
When no participating config scope is malformed, the system SHALL treat missing Global and Project files as valid default configuration (unrestricted baseline, BM25 search). `query_tools` and `manage_tools` SHALL run under that default configuration without requiring a session snapshot. The system MUST NOT require a user-written `toolbelt.json` solely to enable discovery or management tools.

#### Scenario: Fresh install discovery
- **WHEN** neither config file exists, no session snapshot exists, and `query_tools` is invoked
- **THEN** discovery runs through BM25 with default search behavior

#### Scenario: Fresh install management
- **WHEN** neither config file exists, no session snapshot exists, and `manage_tools` receives registered exact names
- **THEN** it persists and applies the requested session active-set change

#### Scenario: Empty object config discovery
- **WHEN** a valid `{}` config exists and `query_tools` is invoked
- **THEN** discovery runs with effective search defaults (BM25 unless a parent supplies otherwise)

### Requirement: Session snapshots enable standalone discovery and management
The system SHALL permit `query_tools` and `manage_tools` to run when effective configuration is usable (including default configuration with no files) or when the current session branch contains an explicit valid active-tool snapshot while config-driven mode is unavailable. When only a snapshot enables the session because participating config is malformed, `query_tools` SHALL use local BM25 defaults and MUST NOT invoke an LLM provider. `manage_tools` SHALL preserve its exact-name validation and persistence-first mutation behavior. When participating config is malformed and no valid snapshot exists, both tools SHALL refuse execution without mutating active tools or session state.

#### Scenario: Default config discovery without snapshot
- **WHEN** no config files exist, no session snapshot exists, and `query_tools` is invoked
- **THEN** discovery runs through BM25 with default search behavior

#### Scenario: Invalid config with explicit snapshot
- **WHEN** a participating config is malformed, the session contains a valid active-tool snapshot, and `query_tools` is invoked
- **THEN** discovery runs through BM25 without invoking an LLM provider

#### Scenario: Invalid config management with explicit snapshot
- **WHEN** a participating config is malformed, the session contains a valid active-tool snapshot, and `manage_tools` receives registered exact names
- **THEN** it persists and applies the requested session active-set change

#### Scenario: Malformed config without activation evidence
- **WHEN** a participating config is malformed and no valid session snapshot exists
- **THEN** `query_tools` and `manage_tools` refuse execution without mutating active tools or session state

### Requirement: Search configuration selects one backend
The system SHALL accept an atomic `search` configuration object with `type` equal to `bm25` or `llm`. The `llm` object SHALL permit an optional `model` in `provider/id` form. BM25 SHALL be the default when no configured search object is present in an otherwise valid configuration. A JSON object with no recognized fields SHALL remain valid, and unknown fields SHALL NOT affect backend selection.

#### Scenario: Default local mode
- **WHEN** a valid toolbelt configuration omits `search`
- **THEN** the effective search mode is `{ "type": "bm25" }`

#### Scenario: Dedicated LLM model
- **WHEN** the selected search object is `{ "type": "llm", "model": "provider/id" }`
- **THEN** discovery resolves that exact model through Pi's model registry

#### Scenario: Atomic project override
- **WHEN** trusted global and project configurations both provide a search object
- **THEN** the project search object replaces the global search object as a unit

#### Scenario: Legacy-only search fields
- **WHEN** a configuration contains only legacy `threshold` or `topK` fields
- **THEN** the configuration remains valid, those unknown fields are ignored, and effective search defaults to BM25

#### Scenario: Empty configured scope
- **WHEN** a configuration file contains `{}`
- **THEN** the scope is valid and effective search is inherited or defaults to BM25

### Requirement: Discovery accepts query-specific controls
The `query_tools` call SHALL accept a required capability query and optional `includeActive`, `limit`, and `timeoutMs` values. Omitted `includeActive` SHALL behave as false, omitted `limit` SHALL default to 5, and omitted `timeoutMs` SHALL default to 5000 milliseconds. `limit` MUST be a positive integer without a configured maximum. `timeoutMs` MUST be a non-negative integer, and zero SHALL disable only the toolbelt-specific LLM timeout.

#### Scenario: Default controls
- **WHEN** the calling model supplies only a capability query
- **THEN** discovery searches inactive tools with a result limit of 5 and an LLM timeout of 5000 milliseconds

#### Scenario: Uncapped explicit limit
- **WHEN** the calling model supplies any positive integer as `limit`
- **THEN** the system accepts that value without applying a schema maximum

#### Scenario: No mode-specific timeout
- **WHEN** the calling model supplies `timeoutMs: 0` in LLM mode
- **THEN** the nested call runs without a toolbelt-specific timer while remaining cancellable by the parent signal

### Requirement: Discovery filters eligibility before ranking
The system SHALL exclude currently active tools before indexing or ranking when `includeActive` is false or omitted. The system SHALL use the complete registered catalog when `includeActive` is true. `query_tools` SHALL NOT persist active-set state or call `setActiveTools()`.

#### Scenario: Hidden-first result limit
- **WHEN** an active tool and an inactive tool both match a query and `includeActive` is omitted
- **THEN** only the inactive tool is eligible to consume the requested result limit

#### Scenario: Full-catalog lookup
- **WHEN** `includeActive` is true
- **THEN** active and inactive registered tools are both eligible and retain their active state

#### Scenario: Observational discovery
- **WHEN** either search backend completes or falls back
- **THEN** the active tool names and persisted active-set snapshots remain unchanged

### Requirement: Local discovery uses BM25
The BM25 backend SHALL index exact registered names and registered descriptions with a higher boost for names. It SHALL disable fuzzy and prefix matching, return at most the requested limit, and SHALL NOT expose backend-specific relevance scores. Each local match SHALL contain its one-based rank, exact name, registered description, and active state.

#### Scenario: Ranked local matches
- **WHEN** MiniSearch returns matching eligible records
- **THEN** `query_tools` returns them in backend order with consecutive one-based ranks and no score field

#### Scenario: Clean local no-match
- **WHEN** MiniSearch returns no matching eligible record
- **THEN** `query_tools` returns a clean no-match result without a threshold or near-miss pass

#### Scenario: Description preserved
- **WHEN** a registered tool has a description
- **THEN** the exact registered description appears in its local discovery result

### Requirement: Catalog identity is bounded and deterministic
The system SHALL compute `catalogHash` as a SHA-256 digest over a deterministic ordering of eligible tool names, descriptions, and active states. The receipt SHALL store only the digest rather than the concatenated catalog.

#### Scenario: Catalog order changes
- **WHEN** the same eligible records are supplied in a different registration order
- **THEN** the catalog hash remains unchanged

#### Scenario: Search-relevant data changes
- **WHEN** an eligible tool's name, description, or active state changes
- **THEN** the catalog hash changes and the local index is refreshed

### Requirement: LLM discovery returns raw advisory text
In LLM mode, the system SHALL send the capability query plus every eligible tool's exact name, registered description, and active state to one nested model call. The system SHALL request at most the caller's limit using the format `exact_tool_name (active|inactive) - registered description`, while treating the query and catalog as untrusted data. The system SHALL return and store non-empty textual model output without parsing names, validating the format, or converting it into structured rankings.

#### Scenario: Successful advisory response
- **WHEN** the nested model returns non-empty textual output
- **THEN** the same text is returned to the calling model and stored in the advisory receipt

#### Scenario: Formatting deviation
- **WHEN** the nested model returns non-empty text that does not follow the requested line template
- **THEN** the extension passes the text through without treating the deviation as a backend failure

#### Scenario: Output exceeds Pi limits
- **WHEN** the nested model returns more text than Pi's standard tool-output limits
- **THEN** the system truncates the text with Pi's `truncateHead()` utility and exported default byte and line limits before returning and storing it

### Requirement: LLM mode resolves models through Pi
The system SHALL use Pi's active model when LLM mode omits `model`. It SHALL resolve an explicitly configured `provider/id` through Pi's model registry and SHALL obtain authentication through that registry. Nested model usage SHALL be stored in the advisory receipt details.

#### Scenario: Inherit active model
- **WHEN** LLM mode omits `model` and Pi has an active model
- **THEN** the nested ranking call uses that active model

#### Scenario: Use configured model
- **WHEN** LLM mode names a model that exists in Pi's registry
- **THEN** the nested ranking call uses the configured model and its resolved authentication

#### Scenario: Account for nested usage
- **WHEN** a nested ranking call returns usage
- **THEN** the advisory receipt details retain that usage

### Requirement: Project configuration requires trust
The system SHALL read, validate, merge, and apply Project configuration only when Pi reports the project as trusted. While untrusted, the entire Project configuration SHALL be ignored, including baseline, search, unknown fields, and validation errors. Global configuration SHALL remain effective and a Global LLM selection SHALL continue to represent explicit catalog-metadata egress consent. When Project is untrusted and Global is absent, effective configuration SHALL fall through to root defaults (unrestricted baseline, BM25) rather than disabling discovery.

#### Scenario: Trusted project selects LLM
- **WHEN** Project selects LLM mode and `ctx.isProjectTrusted()` is true
- **THEN** Project search becomes effective and discovery performs the nested ranking call when requested

#### Scenario: Untrusted project baseline is ignored
- **WHEN** Project defines a baseline list and `ctx.isProjectTrusted()` is false
- **THEN** the Project baseline does not affect session start, reset, or effective config

#### Scenario: Untrusted project search is ignored
- **WHEN** Project selects LLM mode and `ctx.isProjectTrusted()` is false
- **THEN** Project search does not select an LLM, invoke a provider, or send catalog metadata

#### Scenario: Global BM25 with untrusted project
- **WHEN** Global selects BM25 and an untrusted Project selects LLM
- **THEN** discovery uses Global BM25 without reporting an LLM fallback

#### Scenario: Global LLM with untrusted project
- **WHEN** Global selects LLM and Project is untrusted
- **THEN** discovery may use the Global LLM selection because Global expresses user consent

#### Scenario: Malformed untrusted project
- **WHEN** the Project file is malformed but the project is untrusted
- **THEN** the Project error is ignored and does not disable valid Global config or root defaults

#### Scenario: Untrusted project without Global config
- **WHEN** Project is the only config file and Pi reports the project as untrusted
- **THEN** effective configuration uses root defaults and discovery and management remain available without requiring a session snapshot

### Requirement: LLM execution failures fall back locally
The system SHALL visibly fall back to BM25 when LLM ranking cannot execute because the active model is missing, a configured model is unknown, authentication is unavailable, the per-call timer expires, the provider fails, or the textual output is blank. The result SHALL record the requested backend, actual backend, and a concise fallback reason. Parent cancellation SHALL stop discovery immediately and MUST NOT start fallback work.

#### Scenario: Timeout fallback
- **WHEN** the nested ranking call exceeds a positive `timeoutMs`
- **THEN** the nested call is aborted and BM25 results are returned with a timeout fallback reason

#### Scenario: Blank response fallback
- **WHEN** the nested model completes without non-whitespace text
- **THEN** BM25 results are returned with a blank-response fallback reason

#### Scenario: Parent cancellation
- **WHEN** the parent tool signal is aborted during LLM ranking
- **THEN** discovery stops immediately without invoking BM25 fallback

#### Scenario: Visible local fallback
- **WHEN** any recoverable LLM execution failure occurs
- **THEN** the calling model can distinguish that BM25 produced the returned result

### Requirement: Discovery receipts are discriminated by result kind
The system SHALL persist only the new TypeBox-validated discovery receipt formats. A ranked receipt SHALL contain structured BM25 matches and SHALL include LLM fallback metadata only when LLM was requested but BM25 produced the result. An advisory receipt SHALL contain the raw LLM response, resolved model, usage when available, active counts, and catalog hash. `/toolbelt status` SHALL display the latest valid receipt according to its result kind.

#### Scenario: Direct BM25 receipt
- **WHEN** configured BM25 discovery completes
- **THEN** details contain a ranked receipt with requested and actual backend set to BM25

#### Scenario: LLM fallback receipt
- **WHEN** configured LLM discovery falls back successfully
- **THEN** details contain a ranked receipt with requested backend LLM, actual backend BM25, and a fallback reason

#### Scenario: Advisory status
- **WHEN** the latest valid receipt is advisory
- **THEN** `/toolbelt status` displays its raw response and nested-model metadata without expecting rankings

#### Scenario: Legacy receipt
- **WHEN** session history contains a Fuse-era scored discovery receipt
- **THEN** the new receipt validator does not treat it as a current discovery receipt

### Requirement: Model guidance drives explicit autonomous recovery
The active `query_tools` and `manage_tools` definitions SHALL use Pi prompt metadata that names each tool and teaches the calling model to discover a fitting missing capability, activate a selected inactive exact name through `manage_tools`, and resume the original task with the newly available tool. Discovery itself SHALL NOT activate the result.

#### Scenario: Missing capability recovery
- **WHEN** the original task requires a fitting registered tool that is absent from the active list
- **THEN** the model is instructed to call `query_tools`, select a result, call `manage_tools` with the exact name, invoke the activated tool, and continue the original task

#### Scenario: Exact-name mutation boundary
- **WHEN** the calling model attempts to activate a name not present in the registered catalog
- **THEN** `manage_tools` rejects the name before persistence or active-set mutation

#### Scenario: Persistence-first activation
- **WHEN** the calling model activates a valid discovered tool
- **THEN** `manage_tools` persists the complete target active set before calling `setActiveTools()`
