/**
 * Toolbelt config loading and validation.
 *
 * Follows rpiv-core/utils.ts:45-75 fail-soft pattern: missing file, invalid
 * JSON, or wrong shape all return ConfigSource (never throw). The session_start
 * handler is the sole consumer; its validate-then-activate-or-warn gate is the
 * only path to active-set mutation.
 *
 * Validation accepts partial configs: a project file that sets only
 * `search` is valid; missing fields are filled from defaults
 * at merge time.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Compile } from "typebox/compile";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG } from "./constants.js";
import { SearchConfigSchema, ToolbeltConfigFileSchema } from "./schemas.js";
import type {
  ConfigSource,
  EffectiveConfig,
  SearchConfig,
  ToolbeltConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Global config path: ~/.pi/agent/toolbelt.json */
export function getGlobalConfigPath(): string {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}

/** Project config path: .pi/toolbelt.json */
export function getProjectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Reader (fail-soft — never throws)
// ---------------------------------------------------------------------------

/**
 * Read, parse, and validate a single toolbelt config file.
 * Returns ConfigSource with either partial config or error — never throws.
 *
 * Validation is lenient: any subset of fields is accepted. Missing fields
 * are filled from defaults at merge time (buildEffectiveConfig). Each
 * present field is independently validated.
 */
export function readToolbeltConfig(path: string): ConfigSource {
  if (!existsSync(path)) {
    return { path, config: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    return {
      path,
      config: undefined,
      error: `Invalid JSON in ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      path,
      config: undefined,
      error: `${path} does not contain a JSON object`,
    };
  }

  return validateConfig(parsed, path);
}

// ---------------------------------------------------------------------------
// Validator (lenient — partial configs accepted)
// ---------------------------------------------------------------------------

const toolbeltConfigFileValidator = Compile(ToolbeltConfigFileSchema);
const searchConfigValidator = Compile(SearchConfigSchema);

/**
 * Map TypeBox validation errors onto the existing user-facing wording.
 * Field order in the schema matches the expected fields priority.
 */
function mapToolbeltConfigError(
  errors: readonly { instancePath: string; message?: string }[],
): string {
  const error = errors[0];
  if (error === undefined) {
    return "toolbelt.json: must contain at least one recognized field (baseline, search)";
  }

  const { instancePath } = error;

  if (instancePath === "/baseline") {
    return "toolbelt.json: 'baseline' must be an array of tool names";
  }
  if (instancePath.startsWith("/baseline/")) {
    return "toolbelt.json: 'baseline' entries must be strings";
  }
  if (instancePath === "/search" || instancePath.startsWith("/search/")) {
    return `toolbelt.json: 'search' must be { "type": "bm25" } or { "type": "llm" } with optional model`;
  }

  return "toolbelt.json: must contain at least one recognized field (baseline, search)";
}

/**
 * Validate present fields against the ToolbeltConfig schema.
 * Missing fields are fine — the merge layer fills from defaults.
 * At least one recognized field must be present.
 * Unknown fields are tolerated but not copied into the result.
 */
function validateConfig(
  raw: Record<string, unknown>,
  path: string,
): ConfigSource {
  if (!toolbeltConfigFileValidator.Check(raw)) {
    return {
      path,
      config: undefined,
      error: mapToolbeltConfigError(toolbeltConfigFileValidator.Errors(raw)),
    };
  }

  // Copy only recognized fields — unknown keys stay out of the validated config.
  const config: Partial<ToolbeltConfig> = {};
  if (raw.baseline !== undefined) {
    config.baseline = raw.baseline;
  }
  if (raw.search !== undefined) {
    if (!searchConfigValidator.Check(raw.search)) {
      return {
        path,
        config: undefined,
        error:
          'toolbelt.json: \'search\' must be { "type": "bm25" } or { "type": "llm", "model"?: "provider/id" }',
      };
    }
    config.search = raw.search as SearchConfig;
  }

  if (config.baseline === undefined && config.search === undefined) {
    return {
      path,
      config: undefined,
      error:
        "toolbelt.json: must contain at least one recognized field (baseline, search)",
    };
  }

  return { path, config };
}

// ---------------------------------------------------------------------------
// Merge — project arrays replace, scalars override, search object replaces
// ---------------------------------------------------------------------------

/**
 * Build effective config by loading global first, then overlaying project.
 * Each source is independently validated. Project fields override global;
 * project arrays replace global arrays (not concatenate). Missing fields
 * in either source fall through to the DEFAULT_CONFIG.
 *
 * The search object is atomic: a project search replaces the global search
 * as a unit. searchSource records where the effective search came from.
 *
 * Enabled only when at least one source is valid AND neither source has
 * an error (FRD FR#8: if either config is malformed -> disable).
 */
export function buildEffectiveConfig(cwd: string): EffectiveConfig {
  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath(cwd);

  const global = readToolbeltConfig(globalPath);
  const project = readToolbeltConfig(projectPath);

  const globalValid = global.config !== undefined && global.error === undefined;
  const projectValid =
    project.config !== undefined && project.error === undefined;

  // Neither config exists or is valid
  if (!globalValid && !projectValid) {
    return {
      baseline: [...DEFAULT_CONFIG.baseline],
      search: { type: "bm25" },
      source: "none",
      searchSource: "default",
      globalPath,
      projectPath,
      globalValid,
      projectValid,
      ...(global.error !== undefined ? { globalError: global.error } : {}),
      ...(project.error !== undefined ? { projectError: project.error } : {}),
    };
  }

  // Merge: DEFAULT -> global -> project (each layer fills gaps in the prior)
  const base = global.config !== undefined ? global.config : {};

  const merged: ToolbeltConfig = {
    baseline: project.config?.baseline ??
      base.baseline ?? [...DEFAULT_CONFIG.baseline],
    search: project.config?.search ?? base.search ?? { type: "bm25" },
  };

  const source = projectValid ? (globalValid ? "both" : "project") : "global";

  // Determine search source
  let searchSource: EffectiveConfig["searchSource"] = "default";
  if (project.config?.search !== undefined) {
    searchSource = "project";
  } else if (base.search !== undefined) {
    searchSource = "global";
  }

  return {
    ...merged,
    source,
    searchSource,
    globalPath,
    projectPath,
    globalValid,
    projectValid,
    ...(global.error !== undefined ? { globalError: global.error } : {}),
    ...(project.error !== undefined ? { projectError: project.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write a toolbelt config file, creating parent directories as needed.
 * Throws on filesystem errors (handled by caller's try/catch).
 */
export function writeToolbeltConfig(
  path: string,
  config: ToolbeltConfig,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// Enabled / error checks
// ---------------------------------------------------------------------------

/**
 * True when at least one config source exists and is valid AND
 * neither source has an error (FRD FR#8: malformed config -> disable).
 */
export function isEnabled(effective: EffectiveConfig): boolean {
  if (
    effective.globalError !== undefined ||
    effective.projectError !== undefined
  )
    return false;
  return effective.source !== "none";
}

/**
 * True when any config file exists but failed validation.
 * Independent of isEnabled — a broken project file with a valid
 * global config should still warn.
 */
export function hasConfigError(effective: EffectiveConfig): boolean {
  return (
    effective.globalError !== undefined || effective.projectError !== undefined
  );
}
