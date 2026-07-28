## Context

Today `EffectiveConfig.baseline` is always a `string[]`. Omit falls through to `DEFAULT_CONFIG.baseline` (six tools). Schema allows only optional arrays. `configured` is true only when at least one scope file is valid, so a fresh install with no `toolbelt.json` resolves to `inactive` and discovery tools refuse. Settings baseline mode is Default/Custom (global) or Inherit/Custom (project) with no null/unrestricted write path.

The proposal makes hiding opt-in, treats no file as default config, and ships honest docs/package metadata for first public `0.1.0`. No new runtime dependencies. Extension load/unload stays a pi host concern. Release notes do not yet have an owner or repeatable generation path, so this change also establishes a local, script-driven first-release workflow without automating publication.

## Goals / Non-Goals

**Goals:**

- Represent unrestricted vs allowlist baseline end-to-end (schema → effective config → session_start → reset → settings UI → status).
- Make root default and missing config equivalent to unrestricted + BM25 with discovery enabled.
- Keep invalid-config + snapshot session-only fail-soft.
- Align README, `docs/`, `AGENTS.md`, and package metadata with behavior; delete rotting `.rpiv/guidance/`.
- Preserve TypeBox + strict TS as the correctness spine; verify with manual Pi E2E including local `pi install`.
- Make release notes reproducible from committed history and prepare synchronized package/changelog changes through one inspectable local command.

**Non-Goals:**

- Toolbelt-level extension kill switch (use `pi config` / packages).
- Unregistering tools/commands from the host API.
- Automated test suite or CI-for-tests.
- npm shipping of `docs/` (git + README links only).
- Scoped package rename, gallery assets, quality benchmarks.
- Changing BM25/LLM discovery ranking behavior beyond enablement/runtime-mode alignment.
- Release PRs, automatic version selection, automatic publishing, prerelease support, and GitHub Release automation.

## Decisions

### 1. JSON baseline shape: `string[] | null`, omit still means inherit

- **Choice:** Optional field. Present `null` = explicit unrestricted. Present `string[]` (including `[]`) = exact allowlist. Absent = inherit parent / root default.
- **Why:** Matches the locked product language and existing "empty array is real" stance. Avoids a parallel `applyBaseline` flag.
- **Alternatives:** Separate boolean flag (extra concept); treat omit as unrestricted only at root but keep six-tool default (rejected in grill); reject `[]` (rejected - no babysitting).

### 2. Effective baseline as a tagged union, not bare `string[]`

- **Choice:** Resolve to something like:
  ```ts
  type ResolvedBaseline =
    | { kind: "unrestricted"; source: "default" | "global" | "project" }
    | { kind: "list"; tools: string[]; source: "default" | "global" | "project" };
  ```
  Wire this on `EffectiveConfig` (replace `baseline: string[]` + keep/adjust `baselineSource` as `ResolvedBaseline.source` only, or embed source in the union and drop the parallel field if redundant).
- **Why:** Makes "everything" vs "list" unrepresentable as a fake empty meaning; call sites switch on `kind` instead of null checks scattered through session/reset/status. JSON null maps to `unrestricted`; arrays map to `list`.
- **Alternatives:** `baseline: string[] | null` on effective config (simpler, easier to misuse); sentinel magic string (rejected).

### 3. Root default and no-file path

- **Choice:** Root default baseline is `unrestricted`. `DEFAULT_CONFIG` no longer carries a six-tool array (search default remains BM25).
- **Choice:** `configured` is true whenever no participating scope is invalid - including both scopes missing. Missing files are not a disabled state.
- **Why:** "No config = default config" from the grill. Install alone enables discovery without writing JSON.
- **Implications:**
  - `resolveRuntimeMode`: missing files + no snapshot → `configured` (not `inactive`).
  - `inactive` remains only when there is no usable configured path and no snapshot - effectively the invalid-config-without-snapshot case (and any future hard-disable if added later). Re-read call sites that special-case `inactive` for missing-file UX and retarget copy toward "config invalid" vs normal defaults.
  - `isEnabled()` stays `effective.configured` but that now covers the no-file happy path.
- **Alternatives:** Keep `inactive` for no file but soft-enable tools anyway (two sources of truth - rejected); invent a fourth runtime mode (unnecessary).

### 4. session_start and reset

- **session_start (no snapshot / non-resume apply path):**
  - `list` → `setActiveTools(filterRegistered(tools))` as today.
  - `unrestricted` → do not call `setActiveTools` (leave host active set alone).
- **reset:**
  - `list` → confirm, then persist/apply filtered list.
  - `unrestricted` → confirm, then persist/apply **all currently registered** tool names.
  - Invalid config → keep current warnings; no reset.
- **Why:** Startup stays polite to other extensions; reset is the explicit "give me the resolved baseline" hammer. All-registered is the materialization of unrestricted at click time.
- **Alternatives:** session_start also forces all-on for unrestricted (fights host/other extensions); reset no-op on unrestricted (feels broken).

### 5. Settings UI write conventions

| Scope UI choice | Writes |
|---|---|
| Global Default | omit `baseline` |
| Global Unrestricted | `"baseline": null` |
| Global Custom | `"baseline": string[]` (may be empty) |
| Project Inherit | omit `baseline` |
| Project Unrestricted | `"baseline": null` |
| Project Custom | `"baseline": string[]` |

- Labels: Default / Unrestricted / Custom (global); Inherit / Unrestricted / Custom (project). Mirror search's Default vs explicit BM25 clarity.
- On global, Default and Unrestricted both resolve to unrestricted today; Unrestricted is an explicit pin if product default ever changes.
- On project, omit vs null is load-bearing (inherit global list vs override to everything).
- **Implementation:** Extend baseline-mode selector options; draft serialization must round-trip null; raw unknown keys preserved as today.
- Display rows show Unrestricted vs inherited Default vs list membership without pretending null is "Default".

### 6. Schema / validation

- TypeBox: `baseline` optional `Type.Union([Type.Null(), Type.Array(Type.String())])`.
- No min-length on arrays; `[]` valid.
- Invalid types (object, number, etc.) still invalidate the scope.
- Error strings updated so `/baseline` mentions null or array of strings.

### 7. Docs, package delivery, and local release preparation

- **README:** stranger landing - `pi install npm:pi-toolbelt`, `/toolbelt settings|tools|status|reset`, baseline semantics, link to `docs/`. No setup, no roadmap, no benchmarks.
- **`docs/`:** at least `config.md`, `commands.md`, `behavior.md`, and release instructions. Runtime docs cover session_start, snapshots, runtime modes, and trust. Linked from README. **Not** in package.json `files`.
- **Package `files`:** `src/`, `README.md`, `LICENSE`, and generated `CHANGELOG.md` only.
- **Metadata:** MIT `LICENSE` file; `repository` / `homepage` / `bugs`; `engines.node` `>=20`; version `0.1.0` for the first public release.
- **Changelog source:** Conventional Commit history is the unreleased source of truth. git-cliff shows `feat`, `fix`, and breaking changes while excluding routine internal categories. Commit subjects supply normal entries; explicit `BREAKING CHANGE:` footers supply migration detail. Other body content remains Git history rather than automatically becoming release prose.
- **Generated ownership:** Pin git-cliff as a development dependency and configure it through `cliff.toml`. git-cliff exclusively owns `CHANGELOG.md`; humans do not edit it directly. An on-demand preview shows commits since the latest release tag without modifying files. The committed changelog records completed releases and does not maintain a live `Unreleased` section. This pre-publish change establishes the ownership and tooling but does not generate or commit `CHANGELOG.md`; that happens in the subsequent first-publish workflow.
- **Preparation command:** `npm run release:prepare -- <version>` requires a clean working tree, accepts and validates an explicit version, runs `npm run check`, updates `package.json` and `package-lock.json`, generates the versioned changelog, runs `npm pack --dry-run`, then stops with an inspectable working-tree diff. It does not infer versions. When no version tags exist, it may automatically recognize the initial release and accept the package's existing `0.1.0` version; after a release tag exists, the target must increase. The first real `release:prepare -- 0.1.0` invocation occurs after this change is committed and archived, as part of the first-publish workflow.
- **Operator boundary:** Release commit, annotated version tag, push, and `npm publish` remain documented manual steps. The preparation command never commits, tags, pushes, or publishes.
- **AGENTS.md:** point at OpenSpec + `docs/`; fix invariants (no false additive-only; no-file defaults; malformed ≠ always dead) and identify git-cliff as the owner of generated `CHANGELOG.md`.
- **Delete** `.rpiv/guidance/` entirely.
- **Alternatives:** Release Please and Changesets were rejected because release PRs and fragment files add ceremony not needed for this single-package, local-first workflow. A fully custom release orchestrator was rejected because commit/tag/publish automation adds rollback states before repeated need demonstrates value. Manually maintaining `CHANGELOG.md` was rejected because committed history can generate it reproducibly.

### 8. Verification approach

- `npm run check` clean.
- Changelog preview includes public feature/fix/breaking entries from committed history and excludes configured routine internal categories without writing `CHANGELOG.md`.
- Release tooling rejects a dirty tree and invalid/non-increasing versions, supports the initial `0.1.0` no-tag case, generates `CHANGELOG.md` in an isolated clean fixture, and stops without a commit, tag, push, or publish.
- Package boundary checks confirm `LICENSE` ships, `CHANGELOG.md` ships when generated, and repo-only `docs/` and planning files stay excluded. The real first-release changelog and final tarball inspection are deferred to the subsequent first-publish workflow.
- Manual Pi E2E: no config discovery works; explicit list clamps on new session; null unrestricted; `[]` zeros tools; reset list vs all-on; settings round-trip omit/null/list; invalid JSON + snapshot session-only; project inherit vs null override.
- Pre-publish: `pi install <absolute path to package>` (not only `pi -e`), README happy path once.

## Risks / Trade-offs

- **[BREAKING default]** Users who depended on omit → six-tool clamp lose that silently after upgrade. → CHANGELOG + README migration note; settings Default label no longer means "six tools."
- **[inactive semantics shrink]** Call sites and status strings that assume missing file = inactive will lie until updated. → Sweep `inactive` messaging in index/commands/settings in the same change.
- **[reset all-on]** Can re-enable tools another extension expected off. → Accept as user-invoked; document in behavior docs.
- **[Global Default vs Unrestricted redundancy]** Same runtime today. → Keep for explicit pin + symmetry with search; UI copy must not claim different runtime when product default is unrestricted.
- **[Wide change bag]** Behavior + docs + packaging in one change increases diff size. → Single first-publish unit by intent; tasks ordered behavior → docs → package → E2E so verify can stop early if behavior fails.
- **[Type churn]** Many baseline: string[] touch points. → Tagged `ResolvedBaseline` localizes switches; compile errors guide the sweep (`noEmit` typecheck).
- **[Release-note fidelity]** Generated notes are only as useful as commit subjects and breaking footers. → Keep Conventional Commit subjects user-relevant; require `BREAKING CHANGE:` details when migration guidance matters; preview before preparation.
- **[Partial preparation]** A failure after version files change can leave a partial diff. → Never commit or tag inside the command; leave changes inspectable, print the failed stage, and document restoring or rerunning from a clean tree.
- **[Development dependency weight]** Pinning git-cliff adds install weight even though it is not runtime code. → Keep it in devDependencies and confirm package `files` excludes development tooling.

## Migration Plan

1. Land behavior + settings + status/help strings.
2. Land README + `docs/` + AGENTS.md; delete guidance.
3. Land LICENSE + package metadata; configure pinned git-cliff, release preview/preparation scripts, and release documentation.
4. Complete manual E2E through real Pi and the local `pi install` path.
5. Commit and archive this pre-publish change.
6. In the subsequent first-publish workflow, run `release:prepare -- 0.1.0`, inspect the generated changelog and package, commit the release files, create an annotated `v0.1.0` tag, push, and run `npm publish` as separate operator actions.

Rollback: revert the change commit(s). No on-disk config migration script. Users with existing array baselines keep clamping. Users with omit-only configs gain unrestricted (the break).

## Open Questions

None blocking. Deferred to implementer taste within this design:

- Exact field naming on `EffectiveConfig` (`baseline: ResolvedBaseline` vs `resolvedBaseline` + helpers) - prefer single `baseline: ResolvedBaseline`.
- Whether status prints `baseline: unrestricted (default|global|project)` vs `baseline: (all tools)` - pick one phrase and use it in UI + docs consistently.
