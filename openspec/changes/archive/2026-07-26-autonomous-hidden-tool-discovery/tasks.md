## 1. Contracts and configuration

- [x] 1.1 Replace the legacy search, result, and receipt definitions in `src/schemas.ts` with TypeBox schemas for atomic BM25/LLM configuration, `query_tools` controls, ranked local results, native usage metadata, and discriminated ranked/advisory receipts.
- [x] 1.2 Update `src/types.ts` and `src/constants.ts` to derive public types from the schemas, remove Fuse-specific score contracts, define backend and fallback identifiers, and set BM25, limit 5, and timeout 5000 defaults.
- [x] 1.3 Refactor `src/config.ts` to validate and merge atomic search objects, retain conditional optional-property construction under strict TypeScript, and record whether the effective search selection came from default, global, or project config.
- [x] 1.4 Update setup configuration creation and reporting in `src/commands.ts` for the new search object without legacy `threshold` or `topK` fields.

## 2. Local BM25 discovery

- [x] 2.1 Replace `fuse.js` with `minisearch` in `package.json` and regenerate `package-lock.json` through `npm install` without manually editing the generated lockfile.
- [x] 2.2 Replace `src/search.ts` with a MiniSearch BM25 index over name and description, preserve active state, disable fuzzy and prefix matching, and return score-free ranked records up to the requested limit.
- [x] 2.3 Compute a deterministic SHA-256 catalog digest over sorted eligible names, descriptions, and active states, and use it for refresh detection and receipts.
- [x] 2.4 Refactor the local path in `src/index.ts` to use Pi's full five-argument execute signature, filter active tools before indexing by default, support `includeActive`, produce one-based ranked descriptions, and return a clean no-match result without near misses.

## 3. Advisory LLM discovery

- [x] 3.1 Declare `@earendil-works/pi-ai` as a host-provided peer and regenerate the lockfile so nested model APIs resolve through the package contract.
- [x] 3.2 Add an isolated LLM search module that builds the untrusted-data ranking prompt, resolves the active or configured Pi model and authentication, calls `completeSimple()` from `@earendil-works/pi-ai/compat`, combines parent cancellation with the per-call timeout, extracts non-empty text, applies `truncateHead()` with Pi's exported default byte and line limits, and returns raw text plus usage without parsing tool names.
- [x] 3.3 Route LLM mode through the complete eligible catalog in `src/index.ts`, including exact name, registered description, and active state in the nested request.
- [x] 3.4 Enforce project trust before project-selected LLM egress, visibly fall back to BM25 for recoverable model, auth, timeout, provider, and blank-output failures, and propagate parent cancellation without fallback.
- [x] 3.5 Return TypeBox-valid advisory or ranked-fallback receipt details containing requested backend, actual backend, resolved model and nested usage when available, raw output or local rankings, fallback reason when applicable, active counts, and catalog hash.

## 4. Autonomous recovery guidance and status

- [x] 4.1 Add `promptSnippet` and named `promptGuidelines` to `query_tools` and `manage_tools` that teach the model to discover a missing capability, activate the selected exact name, call the newly available tool, and resume the original task.
- [x] 4.2 Preserve `query_tools` as observational and retain `manage_tools` exact-name validation plus append-before-set persistence without adding automatic activation.
- [x] 4.3 Update `src/session.ts` to compile and validate only the new discriminated discovery receipt schema while leaving version-1 active-set snapshot restoration unchanged.
- [x] 4.4 Update `/toolbelt status` to display current search mode and narrow the latest receipt by result kind, showing structured BM25 matches or raw LLM advisory output and metadata.

## 5. Cleanup and documentation

- [x] 5.1 Remove `benchmark/index.ts`, the benchmark package script, and the benchmark path from `tsconfig.json` while keeping all runtime source covered by strict typechecking and Biome.
- [x] 5.2 Update `README.md` with hidden-first discovery, per-call `includeActive`/`limit`/`timeoutMs`, BM25 and LLM configuration, raw advisory semantics, explicit activation, privacy and trust behavior, fallback behavior, and the breaking removal of legacy search fields.
- [x] 5.3 Add a README roadmap note that relevance and latency evaluation will return only after real failed queries and accepted recovery scenarios provide meaningful evidence.
- [x] 5.4 Correct the versioned project `AGENTS.md` command table so it documents the current `npm run check` quality workflow instead of the removed `npm test` script.

## 6. Verification

- [x] 6.1 Run `npm run check` and resolve every Biome or TypeScript failure without suppressing checks or excluding runtime source.
- [x] 6.2 Verify the lockfile contains MiniSearch and the Pi AI peer contract, contains no Fuse package, and verify the obsolete benchmark file and script are absent.
- [x] 6.3 In a real Pi session using BM25 mode, verify hidden-first filtering before the requested limit, `includeActive: true`, registered descriptions and active states, uncapped explicit limits, clean no-match behavior, bounded catalog hashes, unchanged active state after discovery, and ranked status output.
- [x] 6.4 In a real Pi session using LLM mode, verify active-model inheritance, a configured dedicated model, raw formatted advisory output, active-state catalog context, nested usage accounting, advisory status output, and the default and zero timeout behaviors.
- [x] 6.5 In real Pi sessions, verify visible BM25 fallback for an unknown model, unavailable authentication, a forced short timeout, blank provider output when reproducible, and untrusted project-selected LLM mode without metadata egress; verify parent cancellation stops without fallback.
- [x] 6.6 Give Pi a task requiring an inactive registered tool and capture the complete autonomous sequence: `query_tools`, `manage_tools` exact-name activation, invocation of the newly available tool, and continuation of the original task.
