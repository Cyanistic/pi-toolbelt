## ADDED Requirements

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

## MODIFIED Requirements

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
