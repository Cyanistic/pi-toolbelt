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

import type { ToolbeltConfig, ToolManagementAction } from "./schemas.js";

/** Resolved configuration combining global + project sources. */
export interface EffectiveConfig {
  baseline: string[];
  search: import("./schemas.js").SearchConfig;
  source: "global" | "project" | "both" | "none";
  searchSource: "default" | "global" | "project";
  globalPath: string;
  projectPath: string;
  globalValid: boolean;
  projectValid: boolean;
  globalError?: string;
  projectError?: string;
}

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

/** Result from reading a single config file. */
export interface ConfigSource {
  path: string;
  config: Partial<ToolbeltConfig> | undefined;
  error?: string;
}
