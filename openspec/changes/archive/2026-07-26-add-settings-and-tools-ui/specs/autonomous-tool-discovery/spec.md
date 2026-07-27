## ADDED Requirements

### Requirement: Session snapshots enable standalone discovery and management
The system SHALL permit `query_tools` and `manage_tools` to run when either effective configuration is valid or the current session branch contains an explicit valid active-tool snapshot. When only a snapshot enables the session, `query_tools` SHALL use local BM25 defaults and MUST NOT invoke an LLM provider. `manage_tools` SHALL preserve its exact-name validation and persistence-first mutation behavior. Without valid configuration or a valid snapshot, both tools SHALL remain inactive at execution time.

#### Scenario: Config-less discovery from explicit snapshot
- **WHEN** no config exists, the session contains a valid active-tool snapshot, and `query_tools` is invoked
- **THEN** discovery runs through BM25 with default search behavior

#### Scenario: Invalid config with explicit snapshot
- **WHEN** a participating config is malformed, the session contains a valid active-tool snapshot, and `query_tools` is invoked
- **THEN** discovery runs through BM25 without invoking an LLM provider

#### Scenario: Config-less management from explicit snapshot
- **WHEN** no config exists, the session contains a valid active-tool snapshot, and `manage_tools` receives registered exact names
- **THEN** it persists and applies the requested session active-set change

#### Scenario: No activation evidence
- **WHEN** neither valid effective configuration nor a valid session snapshot exists
- **THEN** `query_tools` and `manage_tools` refuse execution without mutating active tools or session state

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Project-selected metadata egress requires trust
**Reason**: Trust now governs the entire Project configuration rather than only project-selected LLM metadata egress.

**Migration**: Use the new `Project configuration requires trust` requirement. Trusted Project config continues to merge normally; untrusted Project config is ignored as a whole.

## ADDED Requirements

### Requirement: Project configuration requires trust
The system SHALL read, validate, merge, and apply Project configuration only when Pi reports the project as trusted. While untrusted, the entire Project configuration SHALL be ignored, including baseline, search, unknown fields, and validation errors. Global configuration SHALL remain effective and a Global LLM selection SHALL continue to represent explicit catalog-metadata egress consent.

#### Scenario: Trusted project selects LLM
- **WHEN** Project selects LLM mode and `ctx.isProjectTrusted()` is true
- **THEN** Project search becomes effective and discovery performs the nested ranking call when requested

#### Scenario: Untrusted project baseline is ignored
- **WHEN** Project defines a baseline and `ctx.isProjectTrusted()` is false
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
- **THEN** the Project error is ignored and does not disable valid Global config

#### Scenario: Untrusted project without Global config
- **WHEN** Project is the only config file and Pi reports the project as untrusted
- **THEN** no effective configured mode exists and only an explicit session snapshot can enable standalone BM25 discovery and management
