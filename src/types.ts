/** Pi Toolbelt type definitions. */

// Schema-derived public types (validated shapes live in schemas.ts).
export type {
  ActiveToolSnapshot,
  AdvisoryReceipt,
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
// Config sources (tagged states)
// ---------------------------------------------------------------------------

/** No file exists at the scope path. */
export interface MissingConfigSource {
  state: "missing";
  path: string;
}

/**
 * File is a JSON object whose present known fields validate.
 * Includes `{}` and unknown-only objects. `raw` is a deep clone for
 * round-trip editing; `config` holds only validated known fields.
 */
export interface ValidConfigSource {
  state: "valid";
  path: string;
  config: Partial<ToolbeltConfig>;
  raw: Record<string, unknown>;
}

/** File exists but JSON parse or known-field validation failed. */
export interface InvalidConfigSource {
  state: "invalid";
  path: string;
  error: string;
}

/**
 * Project file is outside the trust boundary. Path may exist, but the
 * file is not parsed, validated, merged, or written.
 */
export interface IgnoredConfigSource {
  state: "ignored";
  path: string;
}

/** Result from reading a single config scope. */
export type ConfigSource =
  | MissingConfigSource
  | ValidConfigSource
  | InvalidConfigSource
  | IgnoredConfigSource;

/** Resolved configuration combining trusted global + project sources. */
export interface EffectiveConfig {
  baseline: string[];
  search: SearchConfig;
  /** Which scopes contributed known config (valid only). */
  source: "global" | "project" | "both" | "none";
  searchSource: "default" | "global" | "project";
  baselineSource: "default" | "global" | "project";
  globalPath: string;
  projectPath: string;
  global: ConfigSource;
  project: ConfigSource;
  /**
   * True when config-driven behavior is available: at least one
   * participating scope is valid and no participating scope is invalid.
   * Ignored Project never participates.
   */
  configured: boolean;
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
