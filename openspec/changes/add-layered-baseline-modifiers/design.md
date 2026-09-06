## Context

See `proposal.md` for motivation and the delta specs for required behavior.

Today `baseline` resolves by choosing the most specific present value. `ResolvedBaseline` stores either unrestricted or an exact list with one source. Startup, reset, settings previews, and status all depend on that result. The settings editor already decodes persisted JSON into a semantic draft and uses the same resolver as runtime configuration.

The new modifier shape makes baseline resolution cumulative. It also exposes a distinction that an ordinary set cannot retain: adding a tool to an unrestricted policy is redundant for reset membership, but must still activate that named tool at startup without activating every registered tool. The resolved form must therefore retain explicit unrestricted additions and removals.

## Goals / Non-Goals

**Goals:**

- Use one baseline operation model for Default, Global, and trusted Project layers.
- Make invalid modifier states unrepresentable after the configuration boundary.
- Keep persisted-file resolution and settings-draft previews on the same path.
- Reuse the existing searchable multi-selector and current persistence-first session mutation paths.
- Keep startup polite to active-tool choices made by the host or other extensions.

**Non-Goals:**

- Add configurable scopes beyond Global and Project.
- Build a scope registry, plugin mechanism, or public hierarchy API.
- Turn baseline removals into permanent deny rules.
- Change search inheritance, project trust, snapshot precedence, or save timing.
- Migrate existing `null` or array baseline values to object forms.

## Decisions

### 1. Add one tagged modifier without duplicating exact-set syntax

The persisted baseline type becomes:

```ts
type BaselineConfig =
  | null
  | string[]
  | {
      type: "modify";
      add?: string[];
      remove?: string[];
    };
```

Omission remains a property-level state and is represented only by an optional `baseline` field. Arrays remain the sole exact-set form. We will not add a redundant `{ type: "set" }` form.

The TypeBox schema will reject unknown modifier properties and empty strings. Shape validation will require at least one non-empty operation list. A semantic boundary check will reject overlap between `add` and `remove`. Each list will be normalized once by removing duplicates while preserving first-seen order.

Alternative considered: require uniqueness in JSON. Rejected because membership is set-like and duplicate entries carry no conflicting meaning.

### 2. Resolve baseline through an ordered fold

A private resolver will accept an ordered sequence of named layers and fold them over the unrestricted Default state. Runtime and editor previews will each provide the same concrete sequence: Default, Global, then trusted Project. Scope loading and project trust remain outside the fold.

Each layer operation has one meaning:

- omitted: no operation
- `null`: replace with unrestricted and clear prior explicit additions and removals
- array: replace with an exact ordered set
- `modify`: transform inherited state

For an exact inherited set, a modifier removes named members and then adds named members. For unrestricted inherited state, the resolver retains ordered explicit `add` and `remove` sets. A later addition removes the same name from inherited removals; a later removal removes it from inherited additions. Same-layer overlap never reaches the resolver because validation rejects it.

The resolver is generic only at the function boundary. It receives ordered layer records instead of hard-coding separate Global and Project branches. No registry or generalized scope framework will be added.

Alternative considered: special-case Project modifiers over Global. Rejected because it duplicates semantics, prevents Global from modifying Default, and makes future resolution harder to reason about.

### 3. Represent effective policy and resolution trace separately

`ResolvedBaseline` will remain a tagged union, expanded to carry the information required by application:

```ts
type ResolvedBaseline =
  | {
      kind: "exact";
      tools: readonly string[];
      trace: readonly BaselineTraceStep[];
    }
  | {
      kind: "unrestricted";
      add: readonly string[];
      remove: readonly string[];
      trace: readonly BaselineTraceStep[];
    };
```

A trace step records its outward-facing scope label and operation summary. The trace starts with Default and includes each present Global or trusted Project operation in resolution order. Replacement steps remain visible, but formatting makes clear that they reset inherited policy. Omitted layers do not add trace steps.

This replaces the single baseline `source`, which cannot truthfully describe a composed result. Search keeps its existing single source.

Alternative considered: keep only the final policy and reconstruct provenance from source documents in each UI. Rejected because runtime status and editor previews could drift, repeating the inconsistency the shared resolver currently avoids.

### 4. Centralize conversion from effective policy to active tools

A shared baseline application helper will own both target calculation and startup behavior.

For an exact policy, startup filters the exact set to registered tools and replaces active membership, as today. For unmodified unrestricted policy, startup makes no call. For modified unrestricted policy, startup starts from `getActiveTools()`, adds registered names in `add`, removes registered names in `remove`, and calls `setActiveTools()` only when the resulting membership differs. This preserves every unrelated host decision.

Reset remains an explicit full restoration. Its target is the filtered exact set for exact policy, or all currently registered names except final unrestricted removals. Explicit unrestricted additions need no special reset handling because they are already members of the full registered target unless a later operation removed them.

Unavailable configured names remain in policy and trace data but are filtered only when active membership is calculated.

Alternative considered: materialize unrestricted as all registered names during resolution. Rejected because it would lose the distinction between a polite startup delta and an explicit reset, and it would tie configuration resolution to the current catalog.

### 5. Extend semantic editor state before changing TUI behavior

`BaselineSelection` gains a `modify` variant with normalized `add` and `remove` arrays. Decode, clone, encode, scope edits, and preview resolution will continue through `config.ts`; raw JSON will not enter the TUI.

Both Global and Project mode pickers show Inherit, Unrestricted, Exact, and Modify. The label under Global explains that Inherit uses Default; Project explains that it uses Global or Default. “Exact” replaces the current “Custom” label without changing array behavior.

Choosing Modify opens a UI-owned modifier draft instead of immediately writing an invalid empty semantic selection. That draft exposes separate Add and Remove rows. Each row opens the existing `FuzzyMultiSelector`, seeded with registered tools and unavailable configured names. Selecting a name in one operation removes it from the opposite operation. Existing modifiers seed both rows; entering from another mode starts both empty.

Confirming the modifier draft applies one semantic edit. If both rows are empty, it applies Inherit. Cancelling leaves the scope draft unchanged. The settings body shows Add and Remove rows for an existing modifier and displays the effective policy plus trace as its preview.

This adds only the small coordination view needed for two existing multi-select pickers. It does not add a new general form framework.

Alternative considered: a three-state tool picker. Rejected because its controls and conflict behavior are less clear, and it cannot reuse the existing picker directly.

### 6. Keep baseline saves observational

Saving settings continues to reload effective configuration without mutating active tools or appending a snapshot. When a baseline value was saved, the status line will point to `/toolbelt reset` for immediate application. New sessions and resumes without snapshots use the new startup application rules. Resume snapshots still take precedence over all baseline configuration.

Manual activation through `manage_tools` and `/toolbelt tools` remains allowed for names removed by a baseline policy.

## Risks / Trade-offs

- **[Unrestricted policy is more than a mathematical set]** The resolver must retain explicit additions that do not affect full reset membership. → Encode unrestricted overlays directly in the tagged result and keep catalog-dependent application outside configuration resolution.
- **[Provenance output can become noisy]** Default, Global, and Project operations may exceed one line. → Use concise operation summaries and existing TUI width truncation; show exact names only where space permits.
- **[Schema validation cannot express every set relation cleanly]** Cross-list overlap is semantic rather than simple shape validation. → Perform one post-schema refinement at the untrusted configuration boundary, then expose only normalized semantic values.
- **[Modifier editing introduces nested draft state]** Applying each row directly could temporarily create an invalid empty or conflicting config. → Keep both operation rows in one UI-owned modifier draft and commit one validated semantic edit on confirmation.
- **[Renaming list to exact touches user-facing text]** Mixed terminology could confuse users. → Update settings, status, reset previews, README, and authoritative docs together while preserving array compatibility.

## Migration Plan

No file migration is required. Existing omitted, `null`, and array values decode with unchanged meaning. New modifier objects are opt-in.

Implement the schema and semantic resolver first, then route startup and reset through the resolved policy, then extend settings and status presentation, and finally update documentation. Run the existing static checks and validate the real Pi flows for exact, unrestricted, Global modify, layered Global/Project modify, reset, and snapshot resume.

Rollback is a normal code revert. Config files containing the new modifier shape will be reported as invalid by an older Toolbelt release, so users who downgrade must replace that value with an omitted, `null`, or array baseline.
