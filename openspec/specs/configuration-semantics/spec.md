# configuration-semantics Specification

## Purpose
Define consistent configuration resolution semantics across persisted scope files and equivalent in-memory settings drafts.

## Requirements

### Requirement: Equivalent configuration inputs resolve identically
The system SHALL apply identical configuration semantics to persisted scope files and equivalent in-memory editor drafts. Under the same project trust state, equivalent inputs SHALL produce the same effective baseline value and source, search value and source, scope validity, and Project participation.

#### Scenario: Omitted values use root defaults
- **WHEN** Global and Project both omit baseline and search in persisted files or equivalent editor drafts
- **THEN** both forms resolve to unrestricted baseline from Default and BM25 search from Default

#### Scenario: Null remains distinct from an empty list
- **WHEN** a scope supplies `baseline: null` or `baseline: []` through a persisted file or equivalent editor draft
- **THEN** both forms resolve `null` as unrestricted and `[]` as an exact list of zero tools with the same scope source

#### Scenario: Project baseline inheritance and override
- **WHEN** Global supplies a baseline list and trusted Project either omits baseline or supplies its own value through a persisted file or equivalent editor draft
- **THEN** both forms inherit the Global list when omitted and use the Project value when supplied

#### Scenario: Project search replaces Global search
- **WHEN** Global and trusted Project both supply search values through persisted files or equivalent editor drafts
- **THEN** both forms resolve the complete Project search value and identify Project as its source

#### Scenario: Untrusted Project does not participate
- **WHEN** Project configuration exists but the project is untrusted
- **THEN** persisted-file and editor-draft resolution both ignore Project values and errors and resolve from Global or Default

### Requirement: Settings preview matches saved runtime resolution
For a writable configuration draft, the settings interface SHALL preview the same effective baseline, search, and source values that runtime resolution produces after that unchanged draft is saved. Saving settings MUST NOT change the meaning of omitted values, `null`, empty lists, scope inheritance, or search replacement.

#### Scenario: Global draft preview survives save
- **WHEN** the settings interface previews an unsaved Global configuration draft and the user saves it without further edits
- **THEN** runtime resolution reports the same effective baseline, search, and source values shown immediately before save

#### Scenario: Trusted Project draft preview survives save
- **WHEN** the settings interface previews an unsaved trusted Project configuration draft and the user saves it without further edits
- **THEN** runtime resolution reports the same effective baseline, search, and source values shown immediately before save

#### Scenario: Unknown fields do not change effective values
- **WHEN** a writable scope contains unknown top-level or nested search fields and the user edits and saves a known configuration value
- **THEN** the previewed and saved runtime values remain identical while the unknown fields remain preserved
