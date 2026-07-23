/** Pi Toolbelt constants. */

/** Pi flag name for verbose output. */
export const FLAG_DEBUG = "toolbelt-debug";

/** Config file name placed in ~/.pi/agent/ and .pi/. */
export const CONFIG_FILE_NAME = "toolbelt.json";

/** The loader tool that must always remain active when Toolbelt is enabled. */
export const LOADER_TOOL_NAME = "query_tools";

/** Command name for the /toolbelt slash command. Used by index.ts registration. */
export const COMMAND_NAME = "toolbelt";

/** Backend identifier embedded in search receipts. */
export const BACKEND_ID = "fuse.js";

/** Minimum number of characters for a search query token match. */
export const MIN_MATCH_CHAR_LENGTH = 2;

/** fuse.js search keys: which tool fields to index. */
export const SEARCH_KEYS = ["name", "description"];

/** fuse.js options beyond threshold (set at search time from config). */
export const FUSE_OPTIONS = {
  includeScore: true,
  shouldSort: true,
  minMatchCharLength: MIN_MATCH_CHAR_LENGTH,
  keys: SEARCH_KEYS,
} as const;

/** Default config seeded by /toolbelt setup. */
export const DEFAULT_CONFIG = {
  baseline: ["read", "bash", "edit", "write"],
  threshold: 0.4,
  topK: 5,
};
