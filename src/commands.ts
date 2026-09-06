/**
 * /toolbelt command dispatcher.
 *
 * Subcommands: settings, tools, status, reset.
 * All paths load config through the trust-aware builder and share the
 * runtime-mode resolver with session_start and tool gates.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  computeResetTarget,
  formatBaselineTrace,
  formatResolvedBaseline,
} from "./baseline.js";
import {
  buildEffectiveConfig,
  configErrorMessages,
  hasConfigError,
  isEnabled,
  resolveRuntimeMode,
} from "./config.js";
import { LOADER_TOOL_NAME } from "./constants.js";
import {
  hasActiveToolSnapshot,
  isDiscoveryReceipt,
  persistActiveTools,
} from "./session.js";
import {
  openSettingsUi,
  type SettingsEditorState,
  type SettingsUiResult,
} from "./settings-ui.js";
import {
  openToolManager,
  type ToolManagerResult,
  type ToolManagerState,
} from "./tool-manager.js";
import type { RuntimeMode } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────

type CommandContext = ExtensionCommandContext;

/** Hooks from the extension entry so long-lived UIs can refresh runtime. */
export interface ToolbeltCommandHooks {
  /** Re-resolve configured/session-only/inactive after config or snapshot changes. */
  onRuntimeInvalidate?: () => void;
}

function projectTrusted(ctx: CommandContext): boolean {
  return ctx.isProjectTrusted?.() ?? false;
}

function loadRuntime(ctx: CommandContext): RuntimeMode {
  const effective = buildEffectiveConfig(ctx.cwd, projectTrusted(ctx));
  return resolveRuntimeMode(effective, hasActiveToolSnapshot(ctx));
}

// ── Top-level dispatch ────────────────────────────────────────────

export async function handleToolbeltCommand(
  args: string,
  pi: ExtensionAPI,
  ctx: CommandContext,
  hooks: ToolbeltCommandHooks = {},
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
          "  /toolbelt settings  - edit persistent configuration\n" +
          "  /toolbelt tools     - inspect and change session tools\n" +
          "  /toolbelt status    - show current state\n" +
          "  /toolbelt reset     - restore the resolved baseline (exact set, or all registered except removals)",
        "info",
      );
      break;
    case "settings":
      await handleSettings(pi, ctx, hooks);
      break;
    case "tools":
      await handleTools(pi, ctx, hooks);
      break;
    case "status":
      await handleStatus(pi, ctx);
      break;
    case "reset":
      await handleReset(pi, ctx);
      break;
    default:
      ctx.ui.notify(
        `Unknown subcommand: ${subcommand}. Valid subcommands: settings, tools, status, reset`,
        "warning",
      );
  }
}

// ── Settings ──────────────────────────────────────────────────────

async function handleSettings(
  pi: ExtensionAPI,
  ctx: CommandContext,
  hooks: ToolbeltCommandHooks,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/toolbelt settings requires TUI mode", "error");
    return;
  }

  let initialState: SettingsEditorState | undefined;

  for (;;) {
    const openOptions: {
      initialState?: SettingsEditorState;
      tools: ReturnType<ExtensionAPI["getAllTools"]>;
      onConfigSaved: () => void;
    } = {
      tools: pi.getAllTools(),
      onConfigSaved: () => {
        // Refresh effective search/runtime immediately. Never mutates tools.
        hooks.onRuntimeInvalidate?.();
      },
    };
    if (initialState !== undefined) openOptions.initialState = initialState;

    const result: SettingsUiResult = await openSettingsUi(ctx, openOptions);

    if (result.kind === "close") {
      return;
    }

    // discard-request: confirm outside the TUI input handler.
    const discard = await ctx.ui.confirm(
      "Discard settings changes?",
      "You have unsaved configuration drafts. Discard them and close settings?",
    );
    if (discard) return;
    initialState = result.editor;
    // Ensure nested view is main so reopen is usable.
    initialState.view = { kind: "main" };
  }
}

// ── Tools modal ───────────────────────────────────────────────────

async function handleTools(
  pi: ExtensionAPI,
  ctx: CommandContext,
  hooks: ToolbeltCommandHooks,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/toolbelt tools requires TUI mode", "error");
    return;
  }

  let initialState: ToolManagerState | undefined;

  for (;;) {
    const managerOptions: {
      initialState?: ToolManagerState;
      onApply: (
        active: string[],
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
    } = {
      onApply: async (active) => {
        try {
          persistActiveTools(pi, active);
          // Snapshot evidence may enable session-only mode immediately.
          hooks.onRuntimeInvalidate?.();
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
    if (initialState !== undefined) managerOptions.initialState = initialState;

    const result: ToolManagerResult = await openToolManager(
      ctx,
      pi.getAllTools(),
      pi.getActiveTools(),
      managerOptions,
    );

    if (result.kind === "close") return;

    const discard = await ctx.ui.confirm(
      "Discard tool changes?",
      "You have unapplied staged tool changes. Discard them and close?",
    );
    if (discard) return;
    initialState = result.state;
  }
}

// ── Status ────────────────────────────────────────────────────────

async function handleStatus(
  pi: ExtensionAPI,
  ctx: CommandContext,
): Promise<void> {
  const runtime = loadRuntime(ctx);
  const { effective } = runtime;
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

  if (runtime.mode === "configured") {
    const configPaths: string[] = [];
    if (effective.global.state === "valid")
      configPaths.push(effective.globalPath);
    if (effective.project.state === "valid")
      configPaths.push(effective.projectPath);

    const searchDesc =
      effective.search.type === "llm"
        ? `LLM (model: ${effective.search.model ?? "inherit active"})`
        : "BM25 (local)";

    lines.push("Toolbelt: configured");
    if (configPaths.length > 0) {
      lines.push(`Config: ${configPaths.join(", ")}`);
      lines.push(`Source: ${effective.source}`);
    } else {
      lines.push("Config: (none - using defaults)");
      lines.push("Source: none");
    }
    lines.push(`Baseline: ${formatResolvedBaseline(effective.baseline)}`);
    lines.push(`Baseline chain: ${formatBaselineTrace(effective.baseline)}`);
    lines.push(`Search: ${searchDesc} (source: ${effective.searchSource})`);
    if (runtime.hasSnapshot) {
      lines.push("Session snapshot: present");
    }
  } else if (runtime.mode === "session-only") {
    // Session-only only when config is unusable but a snapshot exists.
    lines.push("Toolbelt: session-only (config invalid)");
    const errors = configErrorMessages(effective);
    if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
    lines.push(
      "Session tools remain available via the explicit active-tool snapshot.",
    );
    lines.push("Search: BM25 (local) (source: session-only)");
  } else {
    // Inactive: config unusable and no snapshot.
    lines.push("Toolbelt: inactive (config invalid)");
    const errors = configErrorMessages(effective);
    if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
    lines.push(
      "Config-driven behavior unavailable. Fix config with /toolbelt settings, or establish a session tool set with /toolbelt tools.",
    );
  }

  if (effective.project.state === "ignored") {
    lines.push(
      `Project config ignored until this project is trusted (${effective.projectPath}).`,
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
                ({ rank, name, description, active: isActive }) =>
                  `${rank}. ${name} (${isActive ? "active" : "inactive"})${description ? ` - ${description}` : ""}`,
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
  const runtime = loadRuntime(ctx);
  const { effective } = runtime;

  if (!isEnabled(effective)) {
    if (runtime.mode === "session-only") {
      ctx.ui.notify(
        "Toolbelt reset requires usable config. Session-only mode has no baseline to restore.",
        "warning",
      );
      return;
    }
    if (hasConfigError(effective)) {
      ctx.ui.notify(
        "Toolbelt reset is disabled while config has errors.",
        "warning",
      );
      return;
    }
    ctx.ui.notify(
      "Toolbelt reset is disabled: config-driven behavior unavailable.",
      "warning",
    );
    return;
  }

  const registeredNames = pi.getAllTools().map((tool) => tool.name);
  const target = computeResetTarget(effective.baseline, registeredNames);
  const before = pi.getActiveTools();
  const beforeSet = new Set(before);
  const afterSet = new Set(target);
  const added = target.filter((name) => !beforeSet.has(name));
  const removed = before.filter((name) => !afterSet.has(name));

  if (added.length === 0 && removed.length === 0) {
    ctx.ui.notify(
      `Toolbelt reset: nothing to change. Active: ${before.length} tools unchanged.`,
      "info",
    );
    return;
  }

  const targetLabel =
    effective.baseline.kind === "exact"
      ? "configured exact baseline"
      : effective.baseline.remove.length > 0
        ? "all currently registered tools except baseline removals"
        : "all currently registered tools (unrestricted baseline)";
  const previewLines = [
    `Reset active tools to ${targetLabel}?`,
    "",
    added.length > 0 ? `Add: ${added.join(", ")}` : "Add: (none)",
    removed.length > 0 ? `Remove: ${removed.join(", ")}` : "Remove: (none)",
    `Final active count: ${target.length}`,
    "",
    `Baseline: ${formatResolvedBaseline(effective.baseline)}`,
    `Baseline chain: ${formatBaselineTrace(effective.baseline)}`,
  ];

  const confirmed = await ctx.ui.confirm(
    "Reset Toolbelt baseline?",
    previewLines.join("\n"),
  );
  if (!confirmed) {
    ctx.ui.notify("Toolbelt reset cancelled", "info");
    return;
  }

  let change: ReturnType<typeof persistActiveTools>;
  try {
    change = persistActiveTools(pi, target);
  } catch (error) {
    ctx.ui.notify(
      `Toolbelt reset aborted; active tools were not changed because the session snapshot could not be persisted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
    return;
  }

  const lines = ["Toolbelt reset complete"];
  if (change.added.length > 0) lines.push(`Added: ${change.added.join(", ")}`);
  if (change.removed.length > 0)
    lines.push(`Removed: ${change.removed.join(", ")}`);
  lines.push(
    `Active: ${change.after.length} tools (${change.after.join(", ") || "none"})`,
  );
  ctx.ui.notify(lines.join("\n"), "warning");
}
