/** Pi Toolbelt constants. */

/** Pi flag name for verbose output. */
export const FLAG_DEBUG = "toolbelt-debug";

/** Config file name placed in ~/.pi/agent/ and .pi/. */
export const CONFIG_FILE_NAME = "toolbelt.json";

/** Discovery tool name; active membership is controlled by config/session state. */
export const LOADER_TOOL_NAME = "query_tools";

/** Explicit model-facing active-set management tool. */
export const MANAGE_TOOL_NAME = "manage_tools";

/** Custom session entry key for complete active-set snapshots. */
export const ACTIVE_TOOL_SNAPSHOT_ENTRY = "toolbelt-active-set";

/** Current persisted active-set snapshot schema version. */
export const ACTIVE_TOOL_SNAPSHOT_VERSION = 1;

/** Command name for the /toolbelt slash command. Used by index.ts registration. */
export const COMMAND_NAME = "toolbelt";

/** Local BM25 backend identifier embedded in search receipts. */
export const BACKEND_ID_BM25 = "bm25";

/** Advisory LLM backend identifier embedded in search receipts. */
export const BACKEND_ID_LLM = "llm";

/** Default config seeded by /toolbelt setup. */
export const DEFAULT_CONFIG = {
  baseline: ["read", "bash", "edit", "write", "query_tools", "manage_tools"],
  // search defaults are applied at merge time: { type: "bm25" }
};

/** Default limit for query_tools results when caller omits limit. */
export const DEFAULT_LIMIT = 5;

/** Default timeout (ms) for LLM-ranking calls when caller omits timeoutMs. */
export const DEFAULT_LLM_TIMEOUT_MS = 30000;
