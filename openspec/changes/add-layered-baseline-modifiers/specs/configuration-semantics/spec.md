## MODIFIED Requirements

### Requirement: Equivalent configuration inputs resolve identically
The system SHALL apply identical configuration semantics to persisted scope files and equivalent in-memory editor drafts. Under the same project trust state, equivalent inputs SHALL produce the same effective baseline policy and ordered contribution chain, search value and source, scope validity, and Project participation.

Baseline resolution SHALL start from the built-in default and apply Global followed by trusted Project configuration. An omitted baseline SHALL preserve inherited state, `null` SHALL replace inherited state with unrestricted, a string array SHALL replace inherited state with an exact set, and a tagged modification SHALL add and remove names from inherited state. A later layer SHALL be able to reverse an earlier layer's addition or removal.

#### Scenario: Omitted values use root defaults
- **WHEN** Global and Project both omit baseline and search in persisted files or equivalent editor drafts
- **THEN** both forms resolve to unrestricted baseline from Default and BM25 search from Default

#### Scenario: Null remains distinct from an empty list
- **WHEN** a scope supplies `baseline: null` or `baseline: []` through a persisted file or equivalent editor draft
- **THEN** both forms resolve `null` as unrestricted and `[]` as an exact set of zero tools with the same contribution chain

#### Scenario: Project baseline inheritance and override
- **WHEN** Global supplies an exact baseline and trusted Project either omits baseline or supplies `null` or an exact baseline through a persisted file or equivalent editor draft
- **THEN** both forms inherit the Global baseline when omitted and replace it with the Project value when supplied

#### Scenario: Layered baseline modifications
- **WHEN** Global and trusted Project supply equivalent tagged baseline modifications through persisted files or editor drafts
- **THEN** both forms apply the modifications in scope order and report the same effective policy and contribution chain

#### Scenario: Later layer reverses an earlier modification
- **WHEN** Global removes a tool and trusted Project adds that same tool
- **THEN** the effective baseline includes the tool because Project is the later, more specific layer

#### Scenario: Duplicate modification names normalize as set membership
- **WHEN** a persisted file or equivalent editor draft repeats a tool name within one `add` or `remove` list
- **THEN** both forms accept the input and resolve that name once while preserving first-seen display order

#### Scenario: Project search replaces Global search
- **WHEN** Global and trusted Project both supply search values through persisted files or equivalent editor drafts
- **THEN** both forms resolve the complete Project search value and identify Project as its source

#### Scenario: Untrusted Project does not participate
- **WHEN** Project configuration exists but the project is untrusted
- **THEN** persisted-file and editor-draft resolution both ignore Project values and errors and resolve from Global or Default

### Requirement: Settings preview matches saved runtime resolution
For a writable configuration draft, the settings interface SHALL preview the same effective baseline policy and contribution chain, search value and source, and scope participation that runtime resolution produces after that unchanged draft is saved. Saving settings MUST NOT change the meaning of omitted values, `null`, exact arrays, tagged modifications, scope inheritance, or search replacement.

#### Scenario: Global draft preview survives save
- **WHEN** the settings interface previews an unsaved Global configuration draft and the user saves it without further edits
- **THEN** runtime resolution reports the same effective baseline policy, contribution chain, search value, and search source shown immediately before save

#### Scenario: Trusted Project draft preview survives save
- **WHEN** the settings interface previews an unsaved trusted Project configuration draft and the user saves it without further edits
- **THEN** runtime resolution reports the same effective baseline policy, contribution chain, search value, and search source shown immediately before save

#### Scenario: Layered modification preview survives save
- **WHEN** the settings interface previews Global and trusted Project baseline modifications and the user saves them without further edits
- **THEN** runtime resolution applies the same ordered modifications and reports the same effective result shown immediately before save

#### Scenario: Unknown fields do not change effective values
- **WHEN** a writable scope contains unknown top-level or nested search fields and the user edits and saves a known configuration value
- **THEN** the previewed and saved runtime values remain identical while the unknown fields remain preserved
