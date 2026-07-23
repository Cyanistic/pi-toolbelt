---
date: 2026-07-22T21:00:47-0400
author: Cyanism
commit: no-commit
branch: main
repository: pi-toolbelt
topic: "Pi Toolbelt Progressive Tool Search"
tags: [intent, frd, pi-toolbelt, tool-search, dynamic-tools]
status: ready
last_updated: 2026-07-22T21:00:47-0400
last_updated_by: Cyanism
---

# FRD: Pi Toolbelt Progressive Tool Search

## Summary
Build `pi-toolbelt` as a standalone Pi extension and npm package for Pi users who want smaller initial tool-schema context and reliable, low-friction discovery of registered tools. After explicit setup, Toolbelt applies a configurable baseline, exposes the query-only `search_tools` loader, activates threshold-clearing matches additively, restores session activations, and provides setup, status, and manual reset through one `/toolbelt` command.

## Problem & Intent
The person hitting the problem is the “Pi user.” Success means “Both together”: more of the context window remains available for the task, while the model still finds the right registered tool without seeing every schema up front.

The context reduction should work “the way you'd expect it”; how effective it is “depends on your existing tools and specific configs.” Toolbelt therefore must enforce the configured active set correctly and report the resulting context change rather than promise one fixed reduction percentage for every installation.

## Goals
- Give Pi users both a smaller initial tool-schema context and reliable tool selection.
- Ship the complete core lifecycle: explicit setup, global/project configuration, baseline activation, query-only discovery, additive activation, resume restoration, status, and manual reset.
- Keep search local, fast, measurable, and configurable through threshold and top-K semantics.
- Publish a standalone, installable npm package with a strict TypeScript and pnpm workflow.

## Non-Goals
- Remote embeddings, model reranking, or other remote intelligence in v1.
- Executing, wrapping, repairing, or weakening validation of matched tools; Pi remains the executor and validator.
- Automatic pruning in v1.
- A persistent footer or other always-visible UI in v1.
- A fixed ranking-accuracy promise or a fixed context-reduction percentage across arbitrary catalogs and configurations.

## Functional Requirements
1. The package SHALL register one model-facing tool named `search_tools` with exactly one input field, `query: string`.
2. The package SHALL register one slash command, `/toolbelt`, with at least `setup`, `status`, and `reset` subcommands; bare `/toolbelt` SHALL show status and usage.
3. When neither `~/.pi/agent/toolbelt.json` nor `.pi/toolbelt.json` exists, Toolbelt SHALL remain disabled, register its command and loader, and leave Pi's active-tool set unchanged.
4. `/toolbelt setup global` SHALL write `~/.pi/agent/toolbelt.json`; `/toolbelt setup project` SHALL write `.pi/toolbelt.json`.
5. A newly seeded config SHALL use `read`, `bash`, `edit`, and `write` as its baseline and SHALL keep `search_tools` available.
6. Setup SHALL preview/confirm the write and apply the effective baseline immediately after a successful write without requiring reload or restart.
7. Toolbelt SHALL load global config first and overlay project config by field; project arrays SHALL replace corresponding global arrays rather than concatenate.
8. If either present config file is malformed or fails validation, Toolbelt SHALL disable active-set management, leave Pi's active tools untouched, and show one actionable warning.
9. On an enabled new session, Toolbelt SHALL activate the effective configured baseline plus `search_tools`.
10. On resume, Toolbelt SHALL restore tools previously activated by `search_tools` on the active session branch, in addition to the effective baseline.
11. Each `search_tools` call SHALL refresh or hash-check the current `pi.getAllTools()` catalog before ranking so tools registered after startup are searchable.
12. Search SHALL use a local backend selected through a package benchmark; it SHALL not make remote model, embedding, or search calls.
13. Search SHALL activate only results that clear the effective configured threshold, capped by effective configured top-K.
14. Any currently registered Pi tool SHALL be eligible for matching without requiring an explicit allowlist; Toolbelt SHALL only select definitions and SHALL never execute the matched tool.
15. Search activation SHALL merge matched names with `pi.getActiveTools()` and SHALL not remove any active tool during `search_tools` execution.
16. If no result clears the threshold, `search_tools` SHALL activate nothing and SHALL return ranked near-misses with scores.
17. Every search SHALL return and durably persist a structured receipt containing the query, backend, ranked names and scores, activated names, active counts, and a catalog hash.
18. `/toolbelt status` SHALL report whether Toolbelt is enabled, the config files in effect, baseline names, current active/registered counts, backend, top-K, threshold, and the latest search receipt summary.
19. `/toolbelt reset` SHALL make the active set equal to `search_tools` plus the effective configured baseline; reset SHALL be the only v1 removal path.
20. Ranking configuration SHALL at minimum enforce configurable threshold and top-K behavior; the final public ranking fields beyond those are deferred pending search-backend research.

## Non-Functional Requirements
- **Performance**: For a catalog of 100 registered tools, local catalog refresh plus ranking SHALL complete below 100 ms at p95 in the package benchmark.
- **Security**: Toolbelt may activate any tool already trusted and registered by Pi, but SHALL not execute tools, bypass their schemas, or add a separate execution path. Search and receipts SHALL not send catalog metadata remotely.
- **UX / Accessibility**: V1 SHALL use only the single `/toolbelt` command family and normal tool results. It SHALL not install a footer or emit setup warnings on every valid disabled session.
- **Reliability**: Invalid configuration and no-match searches SHALL fail without changing the active-tool set. Search activation SHALL be additive. Resume SHALL reconstruct activated names from durable structured search receipts.
- **Compatibility**: V1 SHALL support Pi 0.80.7 and newer and SHALL be verified against at least one real model endpoint.

## Constraints & Assumptions
- The repository is greenfield: no package manifest or implementation exists yet.
- Use pnpm, strict TypeScript, and compiled npm package output.
- Use only Pi's public `registerTool`, `registerCommand`, `getAllTools`, `getActiveTools`, `setActiveTools`, and session APIs.
- Global config lives at `~/.pi/agent/toolbelt.json`; project config lives at `.pi/toolbelt.json`.
- Toolbelt is opt-in after installation: no config means no active-set management.
- Pi 0.80.7 is the minimum supported version because it introduced dynamic tool loading.
- One maintained local search dependency is acceptable; the exact package and algorithm must be selected by benchmark rather than implemented from scratch by default.
- The user's npm environment enforces a seven-day minimum release age for dependencies.

## Acceptance Criteria
- [ ] Running `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm test` exits 0.
- [ ] Running `pnpm pack` exits 0 and produces an npm tarball containing the compiled Pi extension entry point and package metadata.
- [ ] Running `pnpm benchmark` against a deterministic 100-tool fixture exits 0, identifies the selected local backend, and reports p95 refresh-plus-ranking latency below 100 ms.
- [ ] With no Toolbelt config present, running the integration test for disabled mode shows the active-tool names before and after extension startup are identical.
- [ ] Running `/toolbelt setup global` after confirmation writes `~/.pi/agent/toolbelt.json` and immediately leaves only `read`, `bash`, `edit`, `write`, and `search_tools` active under the seeded config.
- [ ] Running `/toolbelt setup project` after confirmation writes `.pi/toolbelt.json`; a project field overrides its global counterpart and a project array replaces the global array in the effective config.
- [ ] Starting with malformed global or project Toolbelt config produces one actionable warning and leaves the pre-start active-tool names unchanged.
- [ ] In an integration fixture with configured `topK: 2`, only threshold-clearing results are activated and no more than two new tools are added.
- [ ] A no-match integration query returns scored near-misses, reports zero activated names, and leaves `pi.getActiveTools()` unchanged.
- [ ] After two successful searches, each subsequent active set is a superset of the preceding set until `/toolbelt reset` is run.
- [ ] After resuming a recorded session branch, the active set contains the effective baseline plus names from prior `search_tools` receipts on that branch.
- [ ] Running `/toolbelt status` visibly reports enabled state, effective config paths, baseline, active/registered counts, backend, top-K, threshold, and latest receipt summary.
- [ ] Running `/toolbelt reset` visibly reports removed names and leaves exactly the effective baseline plus `search_tools` active.
- [ ] Running `pnpm test:live` with credentials for any supported real model endpoint exits 0 after the model calls `search_tools` and can call a newly activated tool on the next model request.
- [ ] The prompt/context audit command documented by the package reports before/after active names, active count, and tool-schema character totals without enforcing a catalog-independent reduction percentage.

## Recommended Approach
Create a compiled TypeScript Pi extension package with dedicated global/project JSON config, one `/toolbelt` command dispatcher, and a query-only `search_tools` loader that ranks the live registered catalog locally and applies matches additively. Keep state reconstructable from structured tool-result receipts, use explicit setup and reset for non-additive changes, and select the local search dependency through a focused benchmark before locking the public ranking config.

## Decisions

### Target user
**Question**: Who is hitting the tool-schema overload today, and what should using Pi Toolbelt feel like when the problem is solved?
**Recommended**: n/a — `intent` question
**Chosen**: “Pi user.”
**Rationale**: The feature is for the person using Pi during normal coding sessions, not primarily extension authors or package maintainers.

### Core success outcome
**Question**: For the Pi user, which current pain matters most, and what observable change would make Pi Toolbelt successful?
**Recommended**: n/a — `intent` question
**Chosen**: “Both together” — smaller context and better selection.
**Rationale**: Context savings are not useful if the model cannot reliably recover the tools it needs.

### Seeded baseline, not unconditional startup
**Question**: From the probe I inferred: start sessions with a configurable baseline whose default is `read`, `bash`, `edit`, `write`, plus `search_tools`. Keep this, or change it?
**Recommended**: Keep the baseline.
**Chosen**: Use that set as the sensible seed written by setup, not as an unconditional baseline before setup.
**Rationale**: Evidence: `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md:87`; corrected so installation alone does not alter the user's active tools.

### Query-only loader schema
**Question**: From the probe I inferred: `search_tools` accepts only a natural-language `query` and automatically activates safe top matches. Keep this, or change it?
**Recommended**: Keep query-only.
**Chosen**: Keep `query` as the only model-facing input.
**Rationale**: Evidence: `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md:79-89` + confirmed; no additional model-facing control has a demonstrated need.

### Additive search with separate removal
**Question**: From the probe I inferred: every search activation merges matches with `pi.getActiveTools()` and never removes active tools during search. Keep this, or change it?
**Recommended**: Keep search activation additive.
**Chosen**: Searches remain additive; removal exists through explicit manual reset in v1, with configurable pruning deferred.
**Rationale**: Evidence: `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md:90`; corrected to include a separate, predictable removal lifecycle without breaking additive loader behavior.

### Resume restoration
**Question**: From the probe I inferred: resumed sessions restore tools previously activated by `search_tools` from saved result details. Keep this, or change it?
**Recommended**: Keep restore.
**Chosen**: Restore prior session-branch activations.
**Rationale**: Evidence: `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md:92` + confirmed; resumed work should retain its accumulated tool context.

### V1 scope
**Question**: What should count as the first complete release of Pi Toolbelt?
**Recommended**: Core lifecycle.
**Chosen**: Core lifecycle.
**Rationale**: Setup, configuration, discovery, additive activation, restoration, status, and reset together cover the stated Pi-user outcome without optional backend or UI expansion.

### No remote intelligence
**Question**: Which boundary should v1 hold most firmly?
**Recommended**: No remote intelligence.
**Chosen**: No remote intelligence.
**Rationale**: Local search avoids latency, cost, credentials, catalog disclosure, and another runtime failure surface.

### Dedicated global and project config
**Question**: Configuration integration vs package isolation: where should the seeded baseline and runtime options live?
**Recommended**: Pi `settings.json` key.
**Chosen**: Dedicated Toolbelt files at both global and project scope.
**Rationale**: Dedicated files keep Toolbelt's schema isolated while still allowing per-project overrides.

### One slash command family
**Question**: In-Pi convenience vs standalone package control: how should users create global or project config files?
**Recommended**: Slash setup.
**Chosen**: Use a single `/toolbelt` slash command with `setup` as a subcommand.
**Rationale**: Setup remains discoverable in Pi without adding a second package CLI surface.

### Benchmark-selected local backend
**Question**: Given off-the-shelf local search packages are acceptable, should v1 lock an algorithm now or select one through a small ranking benchmark?
**Recommended**: Benchmark then choose.
**Chosen**: Benchmark maintained local packages, then ship one through an internal adapter.
**Rationale**: The algorithm should be selected using measured complexity, latency, and behavior rather than reimplemented or guessed.

### Manual reset for v1
**Question**: Predictable accumulated context vs automatic context bounds: when should activated tools be removed?
**Recommended**: Manual reset only.
**Chosen**: Manual reset only in v1; configurable pruning may come later.
**Rationale**: Explicit reset is sufficient initially and avoids hidden removals or premature lifecycle policy.

### Thresholded top matches
**Question**: Discovery recall vs schema exposure: what should one `search_tools` call activate?
**Recommended**: Thresholded top matches.
**Chosen**: Activate every threshold-clearing result up to top-K.
**Rationale**: This preserves recall for tasks needing related tools while bounding schema growth.

### Command-only UI
**Question**: For v1, should the user-facing surface stop at one slash command, or also show persistent tool state?
**Recommended**: Command only.
**Chosen**: Command only for v1.
**Rationale**: A footer adds integration and coexistence complexity without being required for the core outcome.

### Config merge semantics
**Question**: How should the dedicated global and project config files combine?
**Recommended**: Project overrides.
**Chosen**: Project fields override global fields; project arrays replace global arrays.
**Rationale**: Project behavior stays predictable and can remove inherited list values without special syntax.

### Explicit setup gate
**Question**: What should happen when neither config file exists?
**Recommended**: Use in-memory defaults.
**Chosen**: Toolbelt remains disabled until explicit setup creates config.
**Rationale**: Installing the package must not silently change the user's active-tool set.

### Effective-baseline reset
**Question**: What exactly should `/toolbelt reset` leave active?
**Recommended**: Effective baseline.
**Chosen**: Effective merged baseline plus `search_tools`.
**Rationale**: Reset must honor customization rather than revert to hardcoded seed values.

### No-match behavior
**Question**: How should `search_tools` behave when no result clears the activation threshold?
**Recommended**: Activate none.
**Chosen**: Activate none and return scored near-misses.
**Rationale**: Failing without active-set mutation is safer and makes threshold tuning observable.

### Disabled-mode behavior
**Question**: Before explicit setup, what should the loaded extension do?
**Recommended**: Leave tools untouched.
**Chosen**: Register `/toolbelt` and `search_tools`, but make no active-set changes.
**Rationale**: Disabled mode preserves Pi's existing behavior while keeping setup discoverable.

### Immediate setup application
**Question**: After `/toolbelt setup` writes config, when should its baseline take effect?
**Recommended**: Apply immediately.
**Chosen**: Apply immediately in the setup command.
**Rationale**: The user gets visible confirmation without an avoidable reload or new-session step.

### Invalid-config failure mode
**Question**: What should happen if either Toolbelt config file is malformed or fails validation?
**Recommended**: Disable and warn.
**Chosen**: Disable active-set management, leave tools untouched, and show one actionable warning.
**Rationale**: Toolbelt must not prune tools using guessed or partial intent.

### Catalog refresh timing
**Question**: When should newly registered tools become searchable?
**Recommended**: Each search.
**Chosen**: Refresh or hash-check the catalog on every search.
**Rationale**: Late registrations and reloads become searchable without a manual refresh command.

### Minimum Pi version
**Question**: What minimum Pi version should v1 support?
**Recommended**: Pi 0.80.7+.
**Chosen**: Pi 0.80.7+.
**Rationale**: `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md:41` identifies 0.80.7 as the first release with dynamic tool loading.

### Local search latency
**Question**: You wrote “under 100s” for local search. Which threshold did you mean?
**Recommended**: Under 100 ms.
**Chosen**: Under 100 ms at p95 for 100 tools.
**Rationale**: Local ranking should remain effectively immediate even if a future remote backend would tolerate seconds.

### Registered-tool trust boundary
**Question**: What should define a safe activatable match?
**Recommended**: Registered and allowed through deny patterns.
**Chosen**: Any currently registered Pi tool may match; no Toolbelt allowlist or denylist is required in v1.
**Rationale**: Pi registration is the trust boundary, and Toolbelt activates definitions without executing them.

### Structured search receipts
**Question**: What durable result data should `search_tools` record for status, debugging, and resume?
**Recommended**: Structured receipt.
**Chosen**: Persist query, backend, rankings/scores, activated names, active counts, and catalog hash.
**Rationale**: One receipt supports session restoration, status, reproducibility, and ranking diagnostics without storing raw schemas.

### Repository tooling
**Question**: Which package workflow should the repository standardize on?
**Recommended**: pnpm and TypeScript.
**Chosen**: pnpm, strict TypeScript, and compiled package output.
**Rationale**: This provides explicit build, test, typecheck, benchmark, and packaging surfaces for the standalone npm package.

### Ranking acceptance semantics
**Question**: Should release acceptance test ranking mechanics rather than promise a fixed tool rank?
**Recommended**: Test config semantics.
**Chosen**: Test threshold and top-K semantics and report benchmark scores without a fixed accuracy guarantee.
**Rationale**: Runtime behavior is configurable, so a universal expected rank would overfit one catalog and one tuning.

### Context acceptance semantics
**Question**: Should context acceptance verify effective configuration rather than a fixed reduction percentage?
**Recommended**: Verify active set.
**Chosen**: Verify active names against effective config and report schema-size change without a fixed target.
**Rationale**: Actual reduction depends on the user's catalog and baseline configuration.

### Live compatibility check
**Question**: Which live compatibility checks should be required before v1 release?
**Recommended**: One fallback and one native deferred-loading model.
**Chosen**: Require at least one real model endpoint; provider does not matter.
**Rationale**: A real endpoint proves the loader-to-next-request behavior while avoiding a mandatory multi-provider test matrix.

### Ranking config breadth deferred
**Question**: How much ranking configuration should v1 expose in the dedicated config files?
**Recommended**: Baseline plus limits.
**Chosen**: Deferred pending research into local search engines and their useful tuning surfaces.
**Rationale**: The developer does not yet have enough evidence about mini-search-engine behavior to lock the public schema.

### Config file paths
**Question**: Which exact dedicated config paths should v1 standardize?
**Recommended**: Agent and `.pi`.
**Chosen**: `~/.pi/agent/toolbelt.json` globally and `.pi/toolbelt.json` per project.
**Rationale**: Each file sits beside the Pi scope it affects and keeps package settings out of the general Pi settings document.

## Open Questions
- Which maintained local npm package and algorithm wins a benchmark comparing ranking behavior, package complexity, maintenance, and p95 latency on representative Pi tool catalogs?
- Beyond `baseline`, `threshold`, and `topK`, which ranking fields, aliases, weights, or backend options have enough demonstrated value to expose in the v1 public config schema?

## Suggested Follow-ups
- Explore configurable pruning policies after manual reset behavior has real usage evidence; automatic removal is explicitly out of v1 scope.
- Reconsider the optional `belt 5/37` footer only if command-based status proves insufficient (`.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md:70`).

## References
- `.rpiv/artifacts/handoffs/2026-07-22_20-09-04_progressive-tool-search-package.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/Users/cyan/.pi/agent/npm/node_modules/@juicesharp/rpiv-pi/extensions/rpiv-core/setup-command.ts`
- `/Users/cyan/.pi/agent/npm/node_modules/pi-powerline-footer/index.ts`
