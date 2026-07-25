---
date: 2026-07-23T15:11:17-0400
author: Cyanism
commit: d18893c
branch: main
repository: pi-toolbelt
topic: "Session Tool Manager"
tags: [intent, frd, session-tools, tool-activation, tui]
status: ready
last_updated: 2026-07-23T15:11:17-0400
last_updated_by: Cyanism
---

# FRD: Session Tool Manager

## Summary
The core v1 lifecycle is complete: Toolbelt is opt-in, `query_tools` searches registered tools and activates close matches additively, `/toolbelt status` reports counts, `/toolbelt reset` removes all search-added tools, and receipts restore activations on resume. The next functionality slice is a session tool manager that separates discovery from activation, makes the full active set visible, and gives the user explicit per-tool control through an interactive modal while leaving visual config editing on the roadmap.

## Problem & Intent
The target is a “Mixed workflow” across session use, activation, and configuration. In the developer's words, the main problem is “control and visibility. config friction isn't huge right now, but it should definitely be documented somewhere as like a rodadmap thing”.

Today a close-enough `query_tools` match becomes active automatically, the user cannot inspect the full active set through status, and removal is limited to a bulk reset. Success means the agent can discover candidates without silently activating them, while the user can inspect and deliberately change the current session's tools on the fly.

## Goals
- Separate tool discovery from active-set mutation.
- Make all registered tools and the exact active subset inspectable during a session.
- Let the user add or remove individual tools through a keyboard-driven interactive modal.
- Let the agent explicitly activate or deactivate tools after discovery, with the exact model-facing API shape decided by research.
- Restore the exact user-selected active set when the same session resumes.
- Preserve Toolbelt's explicit setup gate and Pi's registered-tool trust boundary.

## Non-Goals
- Visual editing of global or project `toolbelt.json` configuration in this slice.
- Saving transient modal choices back into global or project baseline configuration.
- Automatic pruning or configurable removal policies.
- A persistent footer or always-visible panel.
- Tool allowlists, denylists, execution, schema repair, or a second execution path.

## Functional Requirements
1. The system SHALL add `/toolbelt tools` as the entry point for the session tool manager.
2. With a valid Toolbelt config, `/toolbelt tools` SHALL open an interactive modal containing every currently registered Pi tool.
3. Each modal row SHALL show active state, tool name, label or description metadata, and SHALL participate in text filtering.
4. The modal SHALL let the user stage individual additions and removals before applying them.
5. Confirming the modal SHALL apply the staged final active set atomically; cancelling SHALL leave `pi.getActiveTools()` unchanged.
6. `query_tools` SHALL remain protected from removal so the session retains a model-side discovery and recovery path.
7. Configured baseline tools SHALL be removable for the current session without changing either config file.
8. The modal SHALL display the full set in read-only mode when Toolbelt has no valid config, SHALL direct the user to setup, and SHALL not mutate the active set.
9. `/toolbelt status` SHALL expose the active tool names rather than only active and registered counts.
10. `query_tools` SHALL rank and return candidates without changing the active set.
11. Discovery results SHALL include each matched tool's name, score, and current active state, and SHALL report unchanged before and after active counts.
12. The system SHALL provide an explicit model-facing way to activate and deactivate registered tools after discovery; research SHALL decide whether this is one action-oriented tool or a separate management tool.
13. Model-facing and user-facing mutation SHALL only operate on tools currently registered with Pi and SHALL never execute those tools.
14. User additions and removals SHALL be recorded durably enough to restore the exact chosen active set when the same session resumes.
15. State-recording failure SHALL be surfaced rather than swallowed, and the implementation SHALL replace or harden the current best-effort reset-marker seam.
16. `/toolbelt reset` SHALL continue to restore the effective configured baseline plus protected `query_tools` and SHALL clear later session choices from resume state.

## Non-Functional Requirements
- **Performance**: Opening and filtering the modal at the existing deterministic 100-tool benchmark scale SHALL remain under 100 ms p95.
- **Security**: Pi registration remains the trust boundary. Toolbelt may list or activate registered definitions but SHALL not execute tools or bypass Pi's schemas and validation.
- **UX / Accessibility**: The modal SHALL support keyboard-only navigation, SHALL not communicate active state by color alone, SHALL support text filtering, and SHALL make confirm versus cancel behavior explicit.
- **Reliability**: Modal application SHALL be atomic; cancellation and discovery-only search SHALL not mutate active tools; exact additions and removals SHALL survive same-session resume; persistence failures SHALL produce an actionable warning.

## Constraints & Assumptions
- The extension remains config-gated: installation without valid global or project config must not alter active tools.
- Active-set changes continue through Pi's public `getAllTools`, `getActiveTools`, and `setActiveTools` APIs.
- `query_tools` remains active as the protected loader and recovery path.
- Session choices are transient session state, not configuration edits.
- The implementation remains TypeScript/ESM with NodeNext `.js` relative imports and no compile output.
- The model-facing single-tool versus separate-tool control contract is intentionally deferred to research.

## Acceptance Criteria
- [ ] Running `npm run typecheck` exits 0.
- [ ] Running `npm test` exits 0 with automated coverage for discovery-only search, staged add/remove, protected-loader behavior, cancellation, disabled read-only mode, reset, durable state recording, and exact resume restoration.
- [ ] Running `/toolbelt tools` with valid config visibly opens a keyboard-navigable modal listing every registered tool with text active markers, names, metadata, and a working text filter.
- [ ] Staging at least one addition and one removal, then cancelling, leaves the before and after output of `pi.getActiveTools()` identical.
- [ ] Staging multiple changes and confirming performs one final active-set application, preserves `query_tools`, and makes the resulting names visible through `/toolbelt status`.
- [ ] Removing a configured baseline tool through the modal removes it only from the current session and leaves both global and project `toolbelt.json` files byte-for-byte unchanged.
- [ ] Running `/toolbelt tools` without valid config shows the registered and active tools read-only, displays setup guidance, and leaves `pi.getActiveTools()` unchanged.
- [ ] Calling `query_tools` returns ranked names, scores, and active-state markers while its receipt reports equal before and after counts and the active names remain unchanged.
- [ ] After confirming modal additions and removals, resuming the same recorded session restores exactly that chosen active set plus protected `query_tools`, without resurrecting removed tools.
- [ ] A test that forces session-state persistence failure observes an actionable warning or explicit error instead of a successful-but-stale result.
- [ ] Running `/toolbelt reset`, then resuming the session, leaves exactly the effective configured baseline plus `query_tools` active.
- [ ] Running `npm run benchmark` exits 0 and reports modal filtering at the 100-tool fixture below 100 ms p95.
- [ ] A documented interactive check verifies keyboard navigation, filtering, text active markers, cancel, confirm, protected-loader behavior, and disabled read-only behavior.

## Recommended Approach
Add a `/toolbelt tools` custom terminal modal over `pi.getAllTools()` and `pi.getActiveTools()`, stage edits locally, and apply one protected-loader final set on confirmation. Refactor `query_tools` into discovery-only ranked output and introduce reliable ordered session-state recording for exact resume; research should decide whether explicit model mutation belongs in the same tool contract or a separate small management tool.

## Decisions

### Target workflow
**Question**: For the next functionality slice, who is hitting the main problem today, and what should feel meaningfully better for them when it is solved?
**Recommended**: n/a — `intent` question
**Chosen**: “Mixed workflow”.
**Rationale**: The feature should improve session use, activation control, and the path toward better configuration management together.

### Primary friction
**Question**: Within that mixed workflow, what is the main failure you want to fix first for the person using Toolbelt?
**Recommended**: n/a — `intent` question
**Chosen**: “control and visibility. config friction isn't huge right now, but it should definitely be documented somewhere as like a rodadmap thing”.
**Rationale**: Session control and visibility are the immediate problem; visual configuration belongs on the roadmap.

### Discovery and activation coupling
**Question**: From the probe I inferred that `query_tools` currently couples discovery and activation: every threshold-clearing match is added immediately (`src/index.ts:218`). Keep that coupling, or change it as part of this work?
**Recommended**: Change coupling.
**Chosen**: Change coupling.
**Rationale**: Evidence: `src/index.ts:218` + confirmed; a close-enough match should not silently mutate the active set.

### Per-tool control
**Question**: From the probe I inferred that removal is currently bulk-only through `/toolbelt reset` (`src/commands.ts:305-309`), matching the earlier v1 deferral (`.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md:92`). Keep that limit, or add per-tool control now?
**Recommended**: Add per-tool control.
**Chosen**: Add per-tool control.
**Rationale**: Evidence: `src/commands.ts:305-309` and prior deferral + confirmed; bulk reset does not satisfy on-the-fly session control.

### Full active-set visibility
**Question**: From the probe I inferred that `/toolbelt status` exposes only active and registered counts, not the active tool names (`src/commands.ts:248-250`). Keep count-only status, or make the current set inspectable now?
**Recommended**: Show full set.
**Chosen**: Show full set.
**Rationale**: Evidence: `src/commands.ts:248-250` + confirmed; control requires knowing the exact current set.

### Next complete slice
**Question**: What should count as the next complete functionality slice?
**Recommended**: Session tool manager.
**Chosen**: Session tool manager.
**Rationale**: Inspect, search, explicit add/remove, and visibility form one useful session workflow without pulling config editing into scope.

### Session-only boundary
**Question**: Which boundary should keep this session tool manager focused?
**Recommended**: Session state only.
**Chosen**: Session state only.
**Rationale**: Runtime choices should not silently become persistent baseline configuration or automatic policy.

### Protected loader
**Question**: The tradeoff is full session control versus preserving a recovery path. Which tools may the user remove from the active set?
**Recommended**: Protect loader only.
**Chosen**: Protect loader only.
**Rationale**: Users retain control over baseline tools while `query_tools` remains available for model-side recovery.

### Model-control contract deferred
**Question**: The tradeoff is a compact always-active schema versus clear separation between finding and changing tools. How should the agent explicitly act on search results?
**Recommended**: Separate manage tool.
**Chosen**: Defer to research; the developer likes the single-tool option but sees its downsides and does not want to lock the contract without more evidence.
**Rationale**: The capability is in scope, but one action tool versus separate search and management tools needs codebase and Pi interaction research.

### Interactive modal
**Question**: The tradeoff is direct interactive control versus implementation and screen-space cost. What should the user-facing session manager be?
**Recommended**: Interactive modal.
**Chosen**: Interactive modal.
**Rationale**: A temporary modal gives the desired browse-and-toggle flow without persistent footer space.

### Exact resume
**Question**: The tradeoff is session continuity versus simpler transient state. What should happen to modal add/remove choices when the same session resumes?
**Recommended**: Restore exact choices.
**Chosen**: Restore exact choices.
**Rationale**: A resumed session should not resurrect explicitly removed tools or lose deliberate additions.

### Modal row content
**Question**: What must each modal row expose?
**Recommended**: State + metadata.
**Chosen**: State + metadata.
**Rationale**: Active state, names, descriptions, and filtering provide enough context to make deliberate choices.

### Atomic apply
**Question**: When should modal toggles change the active set?
**Recommended**: Apply on confirm.
**Chosen**: Apply on confirm.
**Rationale**: Staging allows review and cancellation and avoids repeated active-set mutation while navigating.

### Modal entry point
**Question**: How should the user open the session tool manager?
**Recommended**: `/toolbelt tools`.
**Chosen**: `/toolbelt tools`.
**Rationale**: It extends the existing command family without changing bare `/toolbelt` help behavior.

### Disabled-mode manager
**Question**: The tradeoff is useful inspection before setup versus preserving Toolbelt's strict opt-in gate. What should `/toolbelt tools` do without a valid config?
**Recommended**: Read-only + setup.
**Chosen**: Read-only + setup.
**Rationale**: Visibility is safe before setup, while mutation remains behind the explicit config gate.

### Modal quality bar
**Question**: What non-functional bar should the first modal release meet?
**Recommended**: Keyboard-fast + atomic.
**Chosen**: Keyboard-fast + atomic.
**Rationale**: The control surface must remain usable without a mouse, avoid color-only state, cancel safely, and stay responsive at normal catalog size.

### Reliable session-state recording
**Question**: A new evidence-based dependency surfaced: exact resume currently relies on a reset marker whose persistence is optional and failures are swallowed (`src/commands.ts:330-334`), while restore depends on that marker (`src/session.ts:78-84`). Should this feature replace or harden that state-recording seam?
**Recommended**: Fix in this slice.
**Chosen**: Fix in this slice.
**Rationale**: Evidence: `src/commands.ts:330-334` and `src/session.ts:78-84` + confirmed; exact resume cannot rest on a known best-effort marker.

### Release evidence
**Question**: What evidence should gate this slice as complete?
**Recommended**: Tests + UI check.
**Chosen**: Tests + UI check.
**Rationale**: State and resume logic need automated coverage, while the keyboard interaction needs visible end-to-end verification.

### Discovery-only receipt
**Question**: Once `query_tools` becomes discovery-only, what should its result expose?
**Recommended**: Ranked stateful results.
**Chosen**: Ranked stateful results.
**Rationale**: Names, scores, and active markers preserve ranking diagnostics and tell the agent which candidates still need activation.

### Registered-tool trust boundary
**Question**: From the existing architecture, Toolbelt only lists or activates tools already registered with Pi and never executes them itself (`.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md:94-95`). Keep that security boundary for the session manager?
**Recommended**: Keep boundary.
**Chosen**: Keep boundary.
**Rationale**: Evidence: `.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md:94-95` + confirmed; authorization policy and execution remain outside Toolbelt.

## Open Questions
- Should explicit model-side activation and deactivation use one action-oriented `query_tools` contract or a separate small management tool? Research should compare schema/context cost, naming clarity, recovery behavior, and how naturally models perform the search-then-activate sequence.

## Suggested Follow-ups
- Add a visual global/project config editor after the session manager proves its interaction model; the developer explicitly wants this documented as roadmap work.
- Revisit automatic pruning only after manual per-tool removal produces usage evidence; it was explicitly deferred in `.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md:92`.
- Reconsider a persistent footer or panel only if modal and command visibility prove insufficient; footer work was deferred in `.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md:91-96`.
- Reconcile the command hot-reload mutation of `currentEffectiveConfig` with the documented `session_start` gate if command-side state management expands (`src/index.ts:114-121`).

## References
- `.rpiv/artifacts/discover/2026-07-22_21-00-47_pi-toolbelt-progressive-tool-search.md`
- `.rpiv/artifacts/plans/2026-07-22_22-25-38_pi-toolbelt-extension.md`
- `src/index.ts`
- `src/commands.ts`
- `src/session.ts`
