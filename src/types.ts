/** Pi Toolbelt type definitions. */

// Schema-derived public types (validated shapes live in schemas.ts).
export type {
  ActiveToolSnapshot,
  AdvisoryReceipt,
  BaselineConfig,
  DiscoveryReceipt,
  ManageToolsParams,
  ModelUsage,
  QueryToolsParams,
  RankedReceipt,
  SearchConfig,
  ToolbeltConfig,
  ToolDiscoveryResult,
  ToolManagementAction,
} from "./schemas.js";

import type {
  SearchConfig,
  ToolbeltConfig,
  ToolManagementAction,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Resolved baseline (effective config)
// ---------------------------------------------------------------------------

/** Which scope (or root default) contributed the effective baseline. */
export type BaselineSource = "default" | "global" | "project";

/**
 * Effective baseline as a tagged union so unrestricted cannot be confused
 * with an empty allowlist.
 */
export type ResolvedBaseline =
  | { readonly kind: "unrestricted"; readonly source: BaselineSource }
  | {
      readonly kind: "list";
      readonly tools: readonly string[];
      readonly source: BaselineSource;
    };

// ---------------------------------------------------------------------------
// Config sources (tagged states — no raw JSON on the public surface)
// ---------------------------------------------------------------------------

/** No file exists at the scope path. */
export interface MissingConfigSource {
  readonly state: "missing";
  readonly path: string;
}

/**
 * File is a JSON object whose present known fields validate.
 * Includes `{}` and unknown-only objects. `config` holds only validated
 * known fields; raw round-trip data stays private to the configuration module.
 */
export interface ValidConfigSource {
  readonly state: "valid";
  readonly path: string;
  readonly config: Partial<ToolbeltConfig>;
}

/** File exists but JSON parse or known-field validation failed. */
export interface InvalidConfigSource {
  readonly state: "invalid";
  readonly path: string;
  readonly error: string;
}

/**
 * Project file is outside the trust boundary. Path may exist, but the
 * file is not parsed, validated, merged, or written.
 */
export interface IgnoredConfigSource {
  readonly state: "ignored";
  readonly path: string;
}

/** Result from reading a single config scope. */
export type ConfigSource =
  | MissingConfigSource
  | ValidConfigSource
  | InvalidConfigSource
  | IgnoredConfigSource;

/** Resolved configuration combining trusted global + project sources. */
export interface EffectiveConfig {
  /** Effective baseline: unrestricted or exact allowlist, with source. */
  readonly baseline: ResolvedBaseline;
  readonly search: SearchConfig;
  /** Which scopes contributed known config (valid only). */
  readonly source: "global" | "project" | "both" | "none";
  readonly searchSource: "default" | "global" | "project";
  readonly globalPath: string;
  readonly projectPath: string;
  readonly global: ConfigSource;
  readonly project: ConfigSource;
  /**
   * True when no participating scope is invalid — including when both
   * scopes are missing (default configuration). Ignored Project never
   * participates. Malformed participating scopes disable config-driven mode.
   */
  readonly configured: boolean;
}

// ---------------------------------------------------------------------------
// Runtime mode (config + session snapshot evidence)
// ---------------------------------------------------------------------------

/** Valid effective config drives baseline, search, and reset. */
export interface ConfiguredRuntime {
  mode: "configured";
  effective: EffectiveConfig;
  hasSnapshot: boolean;
}

/**
 * No usable config, but the session branch has an explicit active-tool
 * snapshot. Discovery uses default BM25; management remains available.
 */
export interface SessionOnlyRuntime {
  mode: "session-only";
  effective: EffectiveConfig;
  hasSnapshot: true;
  /** Distinguishes missing config from malformed participating config. */
  configInvalid: boolean;
}

/** Neither usable config nor an explicit session snapshot. */
export interface InactiveRuntime {
  mode: "inactive";
  effective: EffectiveConfig;
  hasSnapshot: false;
}

/** Tagged decision for discovery, management, status, and session gates. */
export type RuntimeMode =
  | ConfiguredRuntime
  | SessionOnlyRuntime
  | InactiveRuntime;

// ---------------------------------------------------------------------------
// Active-set mutation results
// ---------------------------------------------------------------------------

/** Observable result of one persisted active-set replacement. */
export interface ActiveToolChange {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

/** Details returned by one explicit model-side active-set mutation. */
export interface ToolManagementReceipt extends ActiveToolChange {
  action: ToolManagementAction;
  requested: string[];
}
