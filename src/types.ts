/** Pi Toolbelt type definitions. */

/** User-facing configuration schema for toolbelt.json. */
export interface ToolbeltConfig {
  baseline: string[];
  threshold: number;
  topK: number;
}

/** Resolved configuration combining global + project sources. */
export interface EffectiveConfig {
  baseline: string[];
  threshold: number;
  topK: number;
  source: "global" | "project" | "both" | "none";
  globalPath: string;
  projectPath: string;
  globalValid: boolean;
  projectValid: boolean;
  globalError?: string;
  projectError?: string;
}

/** A single tool match from a search query.
 * Score is a fuse.js Bitap score: 0 = perfect match, 1 = no match.
 * Only results where score <= configured threshold are activated. */
export interface ToolRanking {
  name: string;
  score: number;
}

/** Adapter interface for pluggable search backends.
 * The fuse.js implementation in search.ts is the only v1 backend.
 * Implement this interface to swap backends by replacing one file. */
export interface SearchBackend {
  search(query: string, threshold: number, topK: number): ToolRanking[];
  refresh(tools: Array<{ name: string; description: string }>): boolean;
  getCatalogHash(): string;
}

/** Complete active-set state persisted in custom session entry. */
export interface ActiveToolSnapshot {
  version: 1;
  active: string[];
}

/** Observable result of one persisted active-set replacement. */
export interface ActiveToolChange {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

/** A ranked discovery result annotated with current active membership. */
export interface ToolDiscoveryResult extends ToolRanking {
  active: boolean;
}

/** Discovery-only receipt persisted in query_tools result details. */
export interface DiscoveryReceipt {
  query: string;
  backend: string;
  rankings: ToolDiscoveryResult[];
  activeCounts: { before: number; after: number };
  catalogHash: string;
}

export type ToolManagementAction = "activate" | "deactivate";

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
