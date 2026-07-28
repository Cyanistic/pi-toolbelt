## 1. Baseline model and default configuration

- [x] 1.1 Update TypeBox schemas so optional `baseline` accepts JSON `null` or `string[]` (including empty); reject other types with clear path errors. Drop the six-tool array from `DEFAULT_CONFIG` so root baseline default is unrestricted and search default remains BM25.
- [x] 1.2 Introduce `ResolvedBaseline` (`unrestricted` | `list` with `tools` and `source`) on `EffectiveConfig`. Resolve omit → parent → root unrestricted; map JSON `null` → unrestricted; map arrays → list. Set `configured` true whenever no participating scope is invalid, including both files missing.
- [x] 1.3 Update `resolveRuntimeMode` / `isEnabled` and all callers so missing files are configured defaults (not inactive). Keep session-only only for malformed participating config with a valid snapshot; refuse discovery/management only when config is unusable and no snapshot exists.
- [x] 1.4 Change `session_start` baseline apply: list → `setActiveTools(filterRegistered(tools))`; unrestricted → do not call `setActiveTools`. Keep snapshot-first resume behavior.
- [x] 1.5 Change `/toolbelt reset` and status/help strings: list reset restores filtered list; unrestricted reset targets all currently registered tools with confirm/diff/persist-first; status shows unrestricted vs list and reports configured defaults when no files exist.
- [x] 1.6 Run `npm run check`. In real Pi (`pi -e ./src/index.ts`): no config → status configured + unrestricted + BM25, `query_tools`/`manage_tools` work, new session does not clamp; explicit list baseline clamps new session; `baseline: null` unrestricted; `baseline: []` zeros tools; reset list vs reset-all-registered; malformed config without snapshot refuses tools; malformed + snapshot stays session-only BM25.

## 2. Settings UI for unrestricted baseline

- [x] 2.1 Extend baseline mode picker: Global Default | Unrestricted | Custom; Project Inherit | Unrestricted | Custom. Writes: Default/Inherit omit key; Unrestricted writes `null`; Custom writes `string[]` (empty allowed). Round-trip null through draft/save/reload and preserve unknown sibling fields.
- [x] 2.2 Update effective baseline rows and labels so unrestricted vs list vs inherited Default/Global/Project are distinct (same clarity as search Default vs explicit BM25). Project Unrestricted must override a Global list.
- [x] 2.3 Ensure settings save still refreshes effective config for discovery without calling `setActiveTools` or writing a session snapshot when baseline changes.
- [x] 2.4 Run `npm run check`. In real Pi: set Global Default/Unrestricted/Custom (including empty list), Project Inherit/Unrestricted override of Global list, discard dirty drafts, save without mutating current active tools, confirm files on disk match the write table.

## 3. User docs aligned with behavior

- [x] 3.1 Rewrite `README.md` as stranger landing: `pi install npm:pi-toolbelt`, current commands (`settings`, `tools`, `status`, `reset`), honest baseline/search semantics, trust/privacy, links into `docs/`. Remove `/toolbelt setup`, roadmap, and any quality/benchmark promises.
- [x] 3.2 Add repo `docs/config.md`, `docs/commands.md`, and `docs/behavior.md` covering omit/null/array/`[]`, session_start, reset, snapshots, runtime modes, and project trust. Do not add `docs/` to package.json `files`.
- [x] 3.3 Delete `.rpiv/guidance/` entirely. Rewrite `AGENTS.md` to point at OpenSpec + `docs/`, real scripts (`npm run check`), and corrected invariants (no false additive-only; no-file defaults; deactivate paths exist).
- [x] 3.4 Skim README/`docs/` against the delta specs and fix any remaining stale command or baseline claims. Confirm `npm run check` still passes (docs-only slice should not break types).

## 4. Package publish surface and install gate

- [x] 4.1 Add real MIT `LICENSE`. Update `package.json` with `repository`, `homepage`, `bugs`, `engines.node` `>=20`, and a `files` list that only includes paths that exist (`src/`, `README.md`, `LICENSE`, and `CHANGELOG.md` if present). Keep version `0.1.0`.
- [x] 4.2 Pin git-cliff as a development dependency, add `cliff.toml`, and add a non-writing `changelog:preview` command. Configure public output for `feat`, `fix`, and breaking changes while hiding routine internal categories; verify committed history produces the expected preview without modifying `CHANGELOG.md`.
- [x] 4.3 Add `release:prepare -- <version>`: require a clean working tree; validate an explicit version without inferring one; allow the package's existing version only for an automatically detected initial release with no version tags; run `npm run check`; update `package.json` and `package-lock.json`; generate versioned `CHANGELOG.md`; run `npm pack --dry-run`; then stop without committing, tagging, pushing, or publishing.
- [x] 4.4 Add release instructions under `docs/` and update `AGENTS.md` so git-cliff exclusively owns generated `CHANGELOG.md`. Document manual release commit, annotated tag, push, and `npm publish` steps. Update package `files` so generated `CHANGELOG.md` ships while repo-only docs, configuration, and release tooling do not.
- [x] 4.5 Verify release boundaries: dirty tree is rejected before mutation; invalid and non-increasing versions are rejected; changelog preview writes no files; failed preparation creates no commit or tag and leaves any file changes inspectable. Keep `npm run check` passing.
- [x] 4.6 Pre-publish E2E: `pi install` the local package path (not only `pi -e`), follow README only for status/discovery happy path, then exercise one list baseline clamp and one unrestricted reset. Fix any packaging or doc gaps found before calling the change done.
