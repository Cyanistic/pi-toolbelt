## Why

Tool discovery currently relies on Fuse thresholds and near misses that can spend limited result slots on already-active tools, omit registered descriptions, and provide weak guidance for autonomous recovery. The extension needs a reliable local default plus an explicit semantic option while preserving the existing discovery-versus-mutation safety boundary.

## What Changes

- Replace Fuse-based discovery with local MiniSearch BM25 ranking as the private default.
- Add an explicitly selected LLM search mode that ranks the eligible catalog through Pi's active or configured model and returns the provider's advisory text without parsing it.
- Search inactive tools by default and add an explicit full-catalog option, filtering eligibility before ranking.
- Return registered descriptions and active state with local matches, and provide the same catalog fields to LLM ranking.
- Add per-call `limit` and `timeoutMs` controls with defaults of 5 results and 5000 ms. A timeout of 0 disables only the mode-specific timeout.
- Fall back visibly to BM25 when LLM ranking cannot execute, while propagating parent cancellation immediately.
- Strengthen model-facing guidance so the agent discovers a missing capability, activates an exact selected name through `manage_tools`, and resumes the original task.
- Preserve `query_tools` as observational and `manage_tools` as the persistence-first exact-name mutation boundary.
- Remove threshold, near-miss, and synthetic benchmark behavior.
- **BREAKING**: Replace the legacy root search configuration and Fuse-era scored discovery receipts without compatibility handling.

## Capabilities

### New Capabilities
- `autonomous-tool-discovery`: Defines hidden-first BM25 and opt-in LLM discovery, per-call controls, fallback behavior, receipts, privacy boundaries, and the discover-activate-resume workflow.

### Modified Capabilities

None.

## Impact

- Search, configuration, TypeBox schemas, discovery receipts, session status, tool registration metadata, and documentation under `src/` and `README.md`.
- Runtime dependencies replace `fuse.js` with `minisearch`; Pi AI becomes an explicit host-provided peer for nested model calls.
- Legacy `threshold` and `topK` configuration no longer enables or controls discovery.
- The synthetic benchmark and its package script are removed.
- Verification uses strict TypeScript, Biome, and repeatable real Pi workflows; no automated test suite is introduced.
