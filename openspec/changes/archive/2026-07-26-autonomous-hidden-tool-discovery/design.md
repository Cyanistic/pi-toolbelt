## Context

`query_tools` currently indexes the complete registered catalog with Fuse, applies a configured score threshold, and performs a second near-miss search when nothing clears that threshold. Active tools are filtered only after ranking, so they can displace hidden candidates. Search results and receipts contain Fuse scores but omit registered descriptions.

The discovery and mutation boundary is already correct. `query_tools` is observational, while `manage_tools` validates exact registered names and persists a complete active-set snapshot before calling `setActiveTools()`. That boundary remains unchanged.

The repository now uses TypeBox schemas as the source of truth for externally validated data, strict TypeScript options, and Biome. The earlier research plan predates that architecture and must not reintroduce handwritten schema validation or exclude source from quality checks.

Pi provides the remaining host contracts needed by this change: active and registered tool catalogs, `promptSnippet` and `promptGuidelines`, project trust, the active model and model registry, abort signals, output truncation utilities, and additive dynamic-tool activation. Pi AI returns nested model usage, which the extension can preserve in receipt details.

## Goals / Non-Goals

**Goals:**

- Make discovery search inactive tools by default and filter eligibility before ranking.
- Provide a private deterministic BM25 default and an explicitly selected LLM ranking mode.
- Give the calling model enough information to select, activate, and use a hidden tool without mutating state during discovery.
- Keep configuration and receipt contracts machine-readable through TypeBox-derived types.
- Keep LLM ranking advisory and simple, with exact-name validation concentrated in `manage_tools`.
- Preserve local availability and prevent untrusted project configuration from causing metadata egress.
- Verify the real discover-activate-resume workflow through Pi rather than adding an automated test suite.

**Non-Goals:**

- Automatic activation inside `query_tools`.
- Legacy configuration or Fuse-era receipt compatibility.
- Fuzzy near misses, thresholds, relevance scores, confidence bands, or generated rationales.
- Embeddings, rerankers, reciprocal-rank fusion, learned retrieval, or an automated live-model harness.
- Changes to tool deactivation, the tool-manager modal, active-set snapshot format, or persistence ordering.

## Decisions

### Preserve TypeBox as the contract source

`src/schemas.ts` will define the search configuration, `query_tools` parameters, local ranked results, and discriminated discovery receipt variants. `src/types.ts` will continue re-exporting schema-derived public types and contain only internal interfaces that cannot be represented usefully as externally validated JSON.

Compiled TypeBox validators remain at the config and session boundaries. Optional properties will be constructed with conditional spreads so the implementation remains correct under `exactOptionalPropertyTypes`.

Alternative considered: follow the older plan's handwritten validators and interfaces. Rejected because it would undo the repository's current machine-readable contract architecture and duplicate runtime and compile-time definitions.

### Use one discriminated search object

The user-facing search configuration is atomic:

```json
{ "search": { "type": "bm25" } }
```

or:

```json
{ "search": { "type": "llm", "model": "provider/id" } }
```

The `model` field is optional. Global and project configuration continue to layer independently for `baseline`, while a project `search` object replaces the global `search` object as a unit. Effective configuration records whether the selected search object came from the default, global config, or project config so the execution path can enforce project trust.

Legacy root `threshold` and `topK` fields are unknown fields and are not migrated or rewritten. A config containing no recognized current field remains invalid.

Alternative considered: retain nested `search.mode` and shared `search.topK`. Rejected because per-call limits remove the only shared control that justified the extra nesting.

### Put query-specific controls on `query_tools`

The provider-facing TypeBox parameter schema adds:

- `includeActive?: boolean`, default false.
- `limit?: number`, a positive integer with no maximum, default 5.
- `timeoutMs?: number`, a non-negative integer, default 5000. Zero disables the toolbelt-specific timeout.

`limit` is enforced exactly by BM25 and included as advisory output guidance in the LLM prompt. Raw LLM output is passed through `truncateHead()` with Pi's exported `DEFAULT_MAX_BYTES` and `DEFAULT_MAX_LINES` so an unexpectedly large provider response cannot overflow the calling model's context.

`timeoutMs` only affects LLM mode. BM25 ignores it. The parent tool signal always remains authoritative and can cancel either mode immediately.

Alternative considered: persistent `topK` and LLM timeout configuration. Rejected because query importance and ambiguity belong to the caller, not a persistent user policy.

### Filter the eligible catalog before ranking

With `includeActive` omitted or false, `query_tools` removes every currently active name before building or refreshing the search index. With `includeActive: true`, it uses the complete registered catalog. Each indexed record retains exact name, registered description, and active state.

Filtering before ranking prevents active tools from spending the caller's result limit. `query_tools` does not persist snapshots or call `setActiveTools()` in either mode.

### Replace Fuse with MiniSearch BM25

`src/search.ts` will own an in-memory MiniSearch index over exact name and registered description. Name receives a higher field boost, while fuzzy and prefix matching remain disabled. Search returns exact name, registered description, and active state without exposing backend-specific scores.

The catalog identity becomes a real SHA-256 digest over sorted name, description, and active-state records using `node:crypto`, rather than persisting the full concatenated catalog under a `catalogHash` field. This bounds receipt size while retaining deterministic refresh detection.

Alternative considered: keep Fuse as a typo layer or add BM25 plus reciprocal-rank fusion. Rejected because the caller is another model rather than a human typist, and no observed failures justify a second local backend.

### Treat LLM ranking as raw advisory output

LLM mode sends the capability query and every eligible record's exact name, registered description, and active state to one nested completion. No tool schema, handler, session transcript, or active-set mutation is sent.

The system prompt establishes that the query and catalog are untrusted data, asks for no more than the requested limit, and requests one concise line per result:

```text
exact_tool_name (active|inactive) - registered description
```

It asks the nested model to use only supplied names, omit preamble and rationale, and return a clear no-match line when nothing is relevant. This is formatting guidance only. Any non-empty usable provider text is returned unchanged to the calling model and stored in the receipt. The extension does not parse names, validate formatting, truncate the requested count itself, or convert the response into rankings.

Exact-name correctness remains centralized in `manage_tools`. A hallucinated name is rejected there without mutating state, allowing the calling model to recover.

Alternative considered: strict JSON output with parsing, duplicate handling, and unknown-name fallback. Rejected because the consumer is already a model and the added parser would duplicate the stronger exact-name boundary.

### Resolve models through Pi

When LLM mode omits `model`, the nested call uses `ctx.model`. When a `provider/id` is configured, it resolves through `ctx.modelRegistry`. Authentication comes from `getApiKeyAndHeaders()`, and the completion uses `completeSimple()` from `@earendil-works/pi-ai/compat`.

The `query_tools` execute handler adopts Pi's full five-argument signature so it can use the tool execution signal and context. The signal is combined with a per-call timer. Parent cancellation stops immediately and does not run fallback work. A mode timeout aborts only the nested ranking call and remains eligible for local fallback. Nested usage is stored in the typed receipt details because the installed `AgentToolResult` contract has no top-level usage field.

### Gate project-selected egress and fall back visibly

Selecting LLM mode in global config is explicit user consent. A project-selected LLM mode is honored only when `ctx.isProjectTrusted()` is true. An untrusted project-selected mode does not send catalog metadata and visibly falls back to BM25.

Missing active model, unknown configured model, unavailable auth, mode timeout, provider failure, and blank textual output also fall back to BM25. The result and receipt record the requested backend, actual backend, concise fallback reason, and resolved or configured model when available. Parent cancellation is not converted into fallback.

Alternative considered: fail the discovery tool when LLM mode is unavailable. Rejected because the private local backend can preserve the user's original workflow without weakening the egress boundary.

### Use discriminated discovery receipts

New receipts make the actual result shape explicit:

- A local receipt contains `kind: "ranked"`, requested and actual backend, optional fallback metadata, structured rankings, active counts, and catalog hash.
- A successful LLM receipt contains `kind: "advisory"`, requested and actual backend, model, raw response, usage, active counts, and catalog hash.

`/toolbelt status` narrows on `kind`: ranked receipts display local matches, while advisory receipts display the stored raw response and nested-model metadata. No legacy scored receipt union or argument preparation shim is added.

### Teach autonomous recovery through native prompt metadata

`query_tools` receives a concise `promptSnippet` and named `promptGuidelines` that tell the active model to call it when a fitting capability is absent, search by concrete task, and use inactive-first discovery. `manage_tools` guidance tells the model to activate the selected exact name before calling it and then resume the original user task.

The loader and manager remain separate tools. Discovery never silently activates results.

### Remove evidence-free benchmark machinery

The synthetic latency benchmark and `benchmark` package script are removed. It does not contain relevance judgments and therefore cannot establish whether the correct tool was found. `tsconfig.json` stops including the deleted benchmark path but continues checking all runtime source. README records that evaluation should return after real failed queries and accepted recovery cases exist.

## Risks / Trade-offs

- [Raw LLM output may hallucinate or ignore formatting] -> Keep `manage_tools` exact-name validation as the mutation boundary and make the nested prompt explicit without adding a second parser.
- [Uncapped requested limits may produce excessive output] -> Default to 5, describe narrow queries as preferred, and apply Pi's standard output truncation to provider text.
- [A 5000 ms default may still be too short or too long for some providers] -> Let the calling agent choose a non-negative per-call timeout and preserve parent cancellation.
- [BM25 may miss paraphrases] -> Offer explicitly selected LLM ranking and collect real failed queries before adding further retrieval infrastructure.
- [LLM mode sends catalog metadata to a provider] -> Require explicit mode selection, gate project-selected mode on Pi trust, and retain BM25 as the zero-egress default and fallback.
- [Breaking config and receipts can disrupt old sessions] -> Accept the clean break intentionally; active-set snapshots use a separate unchanged schema and remain restorable.
- [No automated tests cover provider failure branches] -> Use TypeBox and strict TypeScript for structural guarantees, then run repeatable Pi scenarios for BM25, LLM success, fallback, trust, cancellation, and autonomous recovery.

## Migration Plan

1. Replace schema and config contracts first so invalid intermediate states fail typechecking.
2. Replace Fuse with MiniSearch and update local discovery, receipts, commands, dependencies, and documentation.
3. Add the isolated nested LLM search module and route the same eligible catalog through it with trust, timeout, cancellation, usage, and fallback handling.
4. Add prompt metadata and manually exercise the full discover-activate-resume workflow in Pi.
5. Remove the synthetic benchmark and legacy configuration documentation.

Rollback is a normal source rollback plus `npm install` to restore the previous dependency lock. Existing version-1 active-set snapshots remain valid in either direction.

## Open Questions

None. The implementation decisions required for apply are resolved.
