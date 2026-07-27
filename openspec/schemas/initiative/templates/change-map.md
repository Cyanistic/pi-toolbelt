## Decomposition Principles

<!-- State the criteria used to draw child-change and commit boundaries. -->

## Dependency Graph

```text
<!-- Show child changes and their dependency relationships. -->
```

## Child Changes

### `<kebab-case-change-name>`

- **Outcome:** <!-- One observable, independently mergeable result -->
- **Depends on:** <!-- Child change names, or "none" -->
- **Scope:** <!-- Behavior and code included -->
- **Non-goals:** <!-- Work intentionally deferred elsewhere -->
- **Acceptance evidence:** <!-- Checks and real workflows proving completion -->
- **Likely code surfaces:** <!-- Expected files, modules, or interfaces -->
- **Parallel safety:** <!-- Shared files, contracts, or reasons to serialize integration -->
- **Commit boundary:** <!-- The cohesive reviewable state this change should leave -->

## Execution Waves

### Wave 1

<!-- List changes whose dependencies are satisfied. Waves indicate eligibility, not required concurrency. -->

## Coverage

| Initiative outcome | Owning child change |
|---|---|
| <!-- outcome from brief --> | <!-- exactly one child change --> |

## Serialized Integration Points

<!-- Identify shared manifests, exports, schemas, or interfaces that one change must integrate at a time. -->

## Blocked Decisions

| Decision | Blocks | Resolution needed |
|---|---|---|
| <!-- unresolved decision --> | <!-- child changes --> | <!-- evidence or owner choice --> |
