/**
 * /toolbelt command dispatcher.
 *
 * Follows setup-command.ts:57-140 pattern: guard -> confirm -> write -> apply -> report.
 * Each subcommand is a named handler dispatched from the top-level command.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  buildEffectiveConfig,
  getGlobalConfigPath,
  getProjectConfigPath,
  hasConfigError,
  isEnabled,
  writeToolbeltConfig,
} from "./config.js";
import { DEFAULT_CONFIG, FLAG_DEBUG, LOADER_TOOL_NAME } from "./constants.js";
import {
  filterRegisteredTools,
  isDiscoveryReceipt,
  persistActiveTools,
} from "./session.js";
import { openToolManager } from "./tool-manager.js";
import type { ToolbeltConfig } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────

type CommandContext = ExtensionCommandContext;

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
          "  /toolbelt tools                   — inspect and change session tools\n" +
          "  /toolbelt status                  — show current state\n" +
          "  /toolbelt reset                   — restore configured baseline",
        "info",
      );
      break;
    case "setup":
      await handleSetup(parts.slice(1), pi, ctx);
      break;
    case "tools":
      await handleTools(pi, ctx);
      break;
    case "status":
      await handleStatus(pi, ctx);
      break;
    case "reset":
      await handleReset(pi, ctx);
      break;
    default:
      ctx.ui.notify(
        `Unknown subcommand: ${subcommand}. Valid subcommands: setup, tools, status, reset`,
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
    search: { type: "bm25" },
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
  const requested = filterRegisteredTools(pi, newEffective.baseline);
  let active: string[];
  try {
    active = persistActiveTools(pi, requested).after;
  } catch (error) {
    ctx.ui.notify(
      `Config was written, but active tools were not changed because the session snapshot could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
    return;
  }

  const debug = !!pi.getFlag(FLAG_DEBUG);
  ctx.ui.notify(
    buildSetupReport(targetPath, newEffective, active, debug),
    "info",
  );
}

// ── Confirm message builder ───────────────────────────────────────

function buildSetupConfirm(targetPath: string, config: ToolbeltConfig): string {
  const searchDesc =
    config.search.type === "llm"
      ? `LLM (model: ${config.search.model ?? "inherit active"})`
      : "BM25 (local)";

  const lines: string[] = [
    "Toolbelt will apply the following changes:",
    "",
    `Config file: ${targetPath}`,
    `Baseline tools: ${config.baseline.join(", ")}`,
    `Discovery tool: ${LOADER_TOOL_NAME} (active only when included in baseline or enabled for the session)`,
    `Search mode: ${searchDesc}`,
    "",
    "The configured baseline will be activated immediately.",
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
  const searchDesc =
    effective.search.type === "llm"
      ? `LLM (model: ${effective.search.model ?? "inherit active"})`
      : "BM25 (local)";

  const lines: string[] = [
    "✓ Toolbelt setup complete",
    "",
    `Config written: ${targetPath}`,
    `Source: ${effective.source}`,
    `Baseline: ${effective.baseline.join(", ")}`,
    `Active tools now: ${active.length} (${active.join(", ")})`,
  ];
  if (debug) {
    lines.push(
      `Search mode: ${searchDesc} (source: ${effective.searchSource})`,
    );
  }
  return lines.join("\n");
}

// ── Tools modal ───────────────────────────────────────────────────

async function handleTools(
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/toolbelt tools requires TUI mode", "error");
    return;
  }

  const effective = buildEffectiveConfig(ctx.cwd);
  const result = await openToolManager(
    ctx,
    pi.getAllTools(),
    pi.getActiveTools(),
    !isEnabled(effective),
  );
  if (result.kind === "cancel") return;

  try {
    const change = persistActiveTools(pi, result.active);
    ctx.ui.notify(
      change.added.length === 0 && change.removed.length === 0
        ? `Toolbelt tools: active set unchanged (${change.after.length} tools).`
        : `Toolbelt tools applied. Active: ${change.after.join(", ") || "none"}.`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify(
      `Toolbelt tools not applied; active tools were unchanged because the session snapshot could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
  }
}

// ── Status ────────────────────────────────────────────────────────

async function handleStatus(
  pi: ExtensionAPI,
  ctx: CommandContext,
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

  // Find last query_tools discovery receipt on branch
  let lastReceipt: unknown | undefined;
  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry === undefined || entry.type !== "message") {
      continue;
    }
    if (
      entry.message.role === "toolResult" &&
      entry.message.toolName === LOADER_TOOL_NAME &&
      entry.message.details !== undefined
    ) {
      lastReceipt = entry.message.details;
      break;
    }
  }

  const lines: string[] = [];
  if (isEnabled(effective)) {
    const configPaths: string[] = [];
    if (effective.globalValid) configPaths.push(effective.globalPath);
    if (effective.projectValid) configPaths.push(effective.projectPath);

    const searchDesc =
      effective.search.type === "llm"
        ? `LLM (model: ${effective.search.model ?? "inherit active"})`
        : "BM25 (local)";

    lines.push("Toolbelt: enabled");
    lines.push(`Config: ${configPaths.join(", ")}`);
    lines.push(`Source: ${effective.source}`);
    lines.push(`Baseline: ${effective.baseline.join(", ") || "(none)"}`);
    lines.push(`Search: ${searchDesc} (source: ${effective.searchSource})`);
  } else if (hasConfigError(effective)) {
    lines.push("Toolbelt: disabled (config has errors)");
    const errors: string[] = [];
    if (effective.globalError) errors.push(effective.globalError);
    if (effective.projectError) errors.push(effective.projectError);
    if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
  } else {
    lines.push(
      "Toolbelt: disabled - no config files found. Run /toolbelt setup to enable changes.",
    );
  }

  lines.push(`Active: ${active.length} / ${registered.length} registered`);
  lines.push(`Active names: ${active.join(", ") || "(none)"}`);

  if (lastReceipt !== undefined && isDiscoveryReceipt(lastReceipt)) {
    const receipt = lastReceipt;
    lines.push("");
    lines.push(
      `Last search: "${(receipt as { query?: string }).query ?? "unknown"}"`,
    );

    if (receipt.kind === "ranked") {
      lines.push(
        receipt.rankings.length > 0
          ? `  matches (${receipt.requestedBackend}): ${receipt.rankings
              .map(
                ({ rank, name, description, active }) =>
                  `${rank}. ${name} (${active ? "active" : "inactive"})${description ? ` - ${description}` : ""}`,
              )
              .join(" | ")}`
          : "  no matching tools",
      );
    } else if (receipt.kind === "advisory") {
      lines.push(`  backend: ${receipt.actualBackend}`);
      if (receipt.model) lines.push(`  model: ${receipt.model}`);
      if (receipt.usage) {
        const parts: string[] = [];
        if (receipt.usage.inputTokens !== undefined)
          parts.push(`in: ${receipt.usage.inputTokens}`);
        if (receipt.usage.outputTokens !== undefined)
          parts.push(`out: ${receipt.usage.outputTokens}`);
        if (receipt.usage.totalTokens !== undefined)
          parts.push(`total: ${receipt.usage.totalTokens}`);
        if (parts.length > 0) lines.push(`  usage: ${parts.join(", ")}`);
      }
      // Show preview of raw output (first 200 chars)
      const preview =
        receipt.raw.length > 200
          ? `${receipt.raw.slice(0, 200)}...`
          : receipt.raw;
      lines.push(`  raw: ${preview}`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

// ── Reset ────────────────────────────────────────────────────────

async function handleReset(
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  const effective = buildEffectiveConfig(ctx.cwd);
  if (!isEnabled(effective)) {
    ctx.ui.notify(
      "Toolbelt: disabled (no valid config). Nothing to reset.",
      "warning",
    );
    return;
  }

  const requested = filterRegisteredTools(pi, effective.baseline);
  let change: ReturnType<typeof persistActiveTools>;
  try {
    change = persistActiveTools(pi, requested);
  } catch (error) {
    ctx.ui.notify(
      `Toolbelt reset aborted; active tools were not changed because the session snapshot could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
    return;
  }

  if (change.removed.length > 0 || change.added.length > 0) {
    const lines = ["✓ Toolbelt reset"];
    if (change.added.length > 0)
      lines.push(`Added: ${change.added.join(", ")}`);
    if (change.removed.length > 0)
      lines.push(`Removed: ${change.removed.join(", ")}`);
    lines.push(
      `Active: ${change.after.length} tools (${change.after.join(", ") || "none"})`,
    );
    ctx.ui.notify(lines.join("\n"), "warning");
  } else {
    ctx.ui.notify(
      `Toolbelt reset: nothing to change. ` +
        `Active: ${change.after.length} tools unchanged.`,
      "info",
    );
  }
}
