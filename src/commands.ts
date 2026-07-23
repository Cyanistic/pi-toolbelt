/**
 * /toolbelt command dispatcher.
 *
 * Follows setup-command.ts:57-140 pattern: guard → confirm → write → apply → report.
 * Each subcommand is a named handler dispatched from the top-level command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  writeToolbeltConfig,
  buildEffectiveConfig,
  hasConfigError,
  isEnabled,
} from "./config.js";
import { BACKEND_ID, COMMAND_NAME, DEFAULT_CONFIG, FLAG_DEBUG, LOADER_TOOL_NAME } from "./constants.js";
import type { SearchReceipt, ToolbeltConfig } from "./types.js";
import { isSearchReceipt } from "./session.js";

// ── Types ─────────────────────────────────────────────────────────

interface CommandContext {
  cwd: string;
  hasUI: boolean;
  ui: {
    notify(msg: string, sev: "info" | "warning" | "error"): void;
    confirm(title: string, body: string): Promise<boolean>;
  };
}

// ── Top-level dispatch ────────────────────────────────────────────

export async function handleToolbeltCommand(
  args: string,
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/toolbelt requires interactive mode", "error");
    return;
  }

  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";

  switch (subcommand) {
    case "":
      ctx.ui.notify(
        "Toolbelt commands:\n" +
          "  /toolbelt setup [global|project]  — create config and apply baseline\n" +
          "  /toolbelt status                    — show current state\n" +
          "  /toolbelt reset                     — clear search-activated tools",
        "info",
      );
      break;
    case "setup":
      await handleSetup(parts.slice(1), pi, ctx);
      break;
    case "status":
      await handleStatus(pi, ctx as Parameters<typeof handleStatus>[1]);
      break;
    case "reset":
      await handleReset(pi, ctx);
      break;
    default:
      ctx.ui.notify(
        `Unknown subcommand: ${subcommand}. Valid subcommands: setup, status, reset`,
        "warning",
      );
  }
}

// ── Setup ─────────────────────────────────────────────────────────

async function handleSetup(
  args: string[],
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  // Resolve target scope
  const scope = args[0]?.toLowerCase() ?? "";
  const targetPath: string | null =
    scope === "project"
      ? getProjectConfigPath(ctx.cwd)
      : scope === "global"
        ? getGlobalConfigPath()
        : null;

  if (!targetPath) {
    ctx.ui.notify(
      "Usage: /toolbelt setup [global|project]\n\n" +
        "  global   — write config to ~/.pi/agent/toolbelt.json (applies to all projects)\n" +
        "  project  — write config to .pi/toolbelt.json (overrides global per-project)",
      "info",
    );
    return;
  }

  // Check for existing config errors before proceeding
  const effective = buildEffectiveConfig(ctx.cwd);
  if (hasConfigError(effective)) {
    ctx.ui.notify(
      "Cannot run setup: existing config has errors. Fix or remove it first.",
      "error",
    );
    return;
  }

  // Build config from defaults
  const config: ToolbeltConfig = {
    baseline: [...DEFAULT_CONFIG.baseline],
    threshold: DEFAULT_CONFIG.threshold,
    topK: DEFAULT_CONFIG.topK,
  };

  // Confirm before writing
  const confirmed = await ctx.ui.confirm(
    "Apply Toolbelt setup?",
    buildSetupConfirm(targetPath, config),
  );

  if (!confirmed) {
    ctx.ui.notify("Toolbelt setup cancelled", "info");
    return;
  }

  // Write config file
  try {
    writeToolbeltConfig(targetPath, config);
  } catch (e) {
    ctx.ui.notify(
      `Failed to write config: ${e instanceof Error ? e.message : String(e)}`,
      "error",
    );
    return;
  }

  // Apply immediately: re-read effective config (includes what was just written)
  const newEffective = buildEffectiveConfig(ctx.cwd);
  const active = [...new Set([...newEffective.baseline, LOADER_TOOL_NAME])];
  pi.setActiveTools(active);

  const debug = !!pi.getFlag(FLAG_DEBUG);
  ctx.ui.notify(buildSetupReport(targetPath, newEffective, active, debug), "info");
}

// ── Confirm message builder ───────────────────────────────────────

function buildSetupConfirm(
  targetPath: string,
  config: ToolbeltConfig,
): string {
  const lines: string[] = [
    "Toolbelt will apply the following changes:",
    "",
    `Config file: ${targetPath}`,
    `Baseline tools: ${config.baseline.join(", ")}`,
    `Search tool: ${LOADER_TOOL_NAME} (always active)`,
    `Threshold: ${config.threshold}  |  Top-K: ${config.topK}`,
    "",
    "Baseline tools + query_tools will be activated immediately.",
    "Proceed?",
  ];
  return lines.join("\n");
}

// ── Success report builder ────────────────────────────────────────

function buildSetupReport(
  targetPath: string,
  effective: ReturnType<typeof buildEffectiveConfig>,
  active: string[],
  debug: boolean,
): string {
  const lines: string[] = [
    "✓ Toolbelt setup complete",
    "",
    `Config written: ${targetPath}`,
    `Source: ${effective.source}`,
    `Baseline: ${effective.baseline.join(", ")}`,
    `Active tools now: ${active.length} (${active.join(", ")})`,
  ];
  if (debug) {
    lines.push(`Threshold: ${effective.threshold}  |  Top-K: ${effective.topK}`);
  }
  return lines.join("\n");
}

// ── Status ────────────────────────────────────────────────────────

async function handleStatus(
  pi: ExtensionAPI,
  ctx: {
    cwd: string;
    ui: {
      notify(msg: string, sev: "info" | "warning" | "error"): void;
    };
    sessionManager?: {
      getBranch(): Array<{
        type: string;
        message?: { role: string; toolName?: string; details?: unknown };
      }>;
    };
  },
): Promise<void> {
  const effective = buildEffectiveConfig(ctx.cwd);

  if (!isEnabled(effective) && !hasConfigError(effective)) {
    ctx.ui.notify(
      "Toolbelt: disabled — no config files found. Run /toolbelt setup to enable.",
      "info",
    );
    return;
  }

  const active = pi.getActiveTools();
  const registered = pi.getAllTools();

  // Find last query_tools receipt on branch
  let lastReceipt: SearchReceipt | undefined;
  const branch =
    ctx.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (
      entry.type === "message" &&
      entry.message?.role === "toolResult" &&
      entry.message?.toolName === LOADER_TOOL_NAME
    ) {
      const d = entry.message.details as SearchReceipt | undefined;
      if (isSearchReceipt(d)) {
        lastReceipt = d;
        break;
      }
    }
  }

  const lines: string[] = [];
  if (isEnabled(effective)) {
    const configPaths: string[] = [];
    if (effective.globalValid) configPaths.push(effective.globalPath);
    if (effective.projectValid) configPaths.push(effective.projectPath);

    lines.push("Toolbelt: enabled");
    lines.push(`Config: ${configPaths.join(", ")}`);
    lines.push(`Source: ${effective.source}`);
    lines.push(`Baseline: ${effective.baseline.join(", ")}`);
    lines.push(
      `Active: ${active.length} / ${registered.length} registered`,
    );
    lines.push(
      `Backend: ${BACKEND_ID}  |  threshold: ${effective.threshold}  |  topK: ${effective.topK}`,
    );
  } else {
    lines.push("Toolbelt: disabled (config has errors)");
    const errors: string[] = [];
    if (effective.globalError) errors.push(effective.globalError);
    if (effective.projectError) errors.push(effective.projectError);
    if (errors.length > 0)
      lines.push(`Errors: ${errors.join("; ")}`);
    lines.push(
      `Active: ${active.length} / ${registered.length} registered`,
    );
  }

  if (lastReceipt) {
    lines.push("");
    lines.push(`Last search: "${lastReceipt.query}"`);
    if (lastReceipt.activated.length > 0) {
      const scores = lastReceipt.rankings
        .filter((r) => lastReceipt!.activated.includes(r.name))
        .map((r) => `${r.name} (${r.score.toFixed(3)})`)
        .join(", ");
      lines.push(`  → activated: ${scores}`);
    } else {
      lines.push(`  → no tools activated`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

// ── Reset ────────────────────────────────────────────────────────

async function handleReset(
  pi: ExtensionAPI,
  ctx: {
    cwd: string;
    ui: {
      notify(msg: string, sev: "info" | "warning" | "error"): void;
    };
  },
): Promise<void> {
  const effective = buildEffectiveConfig(ctx.cwd);

  if (!isEnabled(effective)) {
    ctx.ui.notify(
      "Toolbelt: disabled (no valid config). Nothing to reset.",
      "warning",
    );
    return;
  }

  const beforeNames = pi.getActiveTools();
  const newSet = [...new Set([...effective.baseline, LOADER_TOOL_NAME])];
  const removed = beforeNames.filter((n) => !newSet.includes(n));

  pi.setActiveTools(newSet);

  // Persist reset-marker receipt: record a custom entry on the session
  // that restoreFromBranch detects. The next query_tools call would
  // also generate a receipt, but reset must leave a durable marker
  // regardless. Use pi.appendEntry if available (ExtensionAPI method).
  try {
    (pi as { appendEntry?: (type: string, payload: Record<string, unknown>) => void }).appendEntry?.(
      "tool_result",
      {
        toolName: LOADER_TOOL_NAME,
        role: "toolResult",
        details: {
          query: "/toolbelt reset",
          backend: BACKEND_ID,
          rankings: [],
          activated: [],
          activeCounts: { before: beforeNames.length, after: newSet.length },
          catalogHash: "",
        } satisfies SearchReceipt,
      },
    );
  } catch {
    ctx.ui.notify(
      "[toolbelt] reset marker not persisted — pre-reset tools may restore on resume",
      "warning",
    );
  }

  if (removed.length > 0) {
    ctx.ui.notify(
      `✓ Toolbelt reset\n\n` +
        `Removed: ${removed.join(", ")}\n` +
        `Active: ${newSet.length} tools (${newSet.join(", ")})`,
      "warning",
    );
  } else {
    ctx.ui.notify(
      `Toolbelt reset: nothing to remove. ` +
        `Active: ${newSet.length} tools unchanged.`,
      "info",
    );
  }
}
