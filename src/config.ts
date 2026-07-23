/**
 * Toolbelt config loading and validation.
 *
 * Follows rpiv-core/utils.ts:45-75 fail-soft pattern: missing file, invalid
 * JSON, or wrong shape all return ConfigSource (never throw). The session_start
 * handler is the sole consumer; its validate-then-activate-or-warn gate is the
 * only path to active-set mutation.
 *
 * Validation accepts partial configs: a project file that sets only
 * `threshold` is valid; missing fields are filled from global defaults
 * at merge time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { ConfigSource, EffectiveConfig, ToolbeltConfig } from "./types.js";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG } from "./constants.js";

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

/**
 * Validate present fields against the ToolbeltConfig schema.
 * Missing fields are fine — the merge layer fills from defaults.
 * At least one recognized field must be present.
 */
function validateConfig(raw: Record<string, unknown>, path: string): ConfigSource {
  const config: Partial<ToolbeltConfig> = {};

  if (raw.baseline !== undefined) {
    if (!Array.isArray(raw.baseline)) {
      return { path, config: undefined, error: `toolbelt.json: 'baseline' must be an array of tool names` };
    }
    for (const name of raw.baseline) {
      if (typeof name !== "string") {
        return { path, config: undefined, error: `toolbelt.json: 'baseline' entries must be strings` };
      }
    }
    config.baseline = raw.baseline as string[];
  }

  if (raw.threshold !== undefined) {
    if (typeof raw.threshold !== "number" || raw.threshold < 0 || raw.threshold > 1) {
      return { path, config: undefined, error: `toolbelt.json: 'threshold' must be a number between 0 and 1` };
    }
    config.threshold = raw.threshold;
  }

  if (raw.topK !== undefined) {
    if (typeof raw.topK !== "number" || raw.topK < 1 || !Number.isInteger(raw.topK)) {
      return { path, config: undefined, error: `toolbelt.json: 'topK' must be a positive integer` };
    }
    config.topK = raw.topK;
  }

  // Must contain at least one recognized field
  if (config.baseline === undefined && config.threshold === undefined && config.topK === undefined) {
    return { path, config: undefined, error: `toolbelt.json: must contain at least one recognized field (baseline, threshold, topK)` };
  }

  return { path, config };
}

// ---------------------------------------------------------------------------
// Merge — project arrays replace, scalars override
// ---------------------------------------------------------------------------

/**
 * Build effective config by loading global first, then overlaying project.
 * Each source is independently validated. Project fields override global;
 * project arrays replace global arrays (not concatenate). Missing fields
 * in either source fall through to the DEFAULT_CONFIG.
 *
 * Enabled only when at least one source is valid AND neither source has
 * an error (FRD FR#8: if either config is malformed → disable).
 */
export function buildEffectiveConfig(cwd: string): EffectiveConfig {
  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath(cwd);

  const global = readToolbeltConfig(globalPath);
  const project = readToolbeltConfig(projectPath);

  const globalValid = global.config !== undefined && global.error === undefined;
  const projectValid = project.config !== undefined && project.error === undefined;

  // Neither config exists or is valid
  if (!globalValid && !projectValid) {
    return {
      ...DEFAULT_CONFIG,
      source: "none",
      globalPath,
      projectPath,
      globalValid,
      projectValid,
      globalError: global.error,
      projectError: project.error,
    };
  }

  // Merge: DEFAULT → global → project (each layer fills gaps in the prior)
  const base = global.config !== undefined ? global.config : {};
  const merged: ToolbeltConfig = {
    baseline:
      project.config?.baseline ??
      base.baseline ??
      DEFAULT_CONFIG.baseline,
    threshold:
      project.config?.threshold ??
      base.threshold ??
      DEFAULT_CONFIG.threshold,
    topK: project.config?.topK ?? base.topK ?? DEFAULT_CONFIG.topK,
  };

  const source = projectValid ? (globalValid ? "both" : "project") : "global";

  return {
    ...merged,
    source,
    globalPath,
    projectPath,
    globalValid,
    projectValid,
    globalError: global.error,
    projectError: project.error,
  };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write a toolbelt config file, creating parent directories as needed.
 * Throws on filesystem errors (handled by caller's try/catch).
 */
export function writeToolbeltConfig(path: string, config: ToolbeltConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Enabled / error checks
// ---------------------------------------------------------------------------

/**
 * True when at least one config source exists and is valid AND
 * neither source has an error (FRD FR#8: malformed config → disable).
 */
export function isEnabled(effective: EffectiveConfig): boolean {
  if (effective.globalError !== undefined || effective.projectError !== undefined) return false;
  return effective.source !== "none";
}

/**
 * True when any config file exists but failed validation.
 * Independent of isEnabled — a broken project file with a valid
 * global config should still warn.
 */
export function hasConfigError(effective: EffectiveConfig): boolean {
  return effective.globalError !== undefined || effective.projectError !== undefined;
}
