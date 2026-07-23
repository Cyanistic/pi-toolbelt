/**
 * Session lifecycle handler — baseline activation and resume restoration.
 *
 * Follows extensions.md:1827-1835 (state reconstruction via tool result details)
 * and pi-powerline-footer/index.ts:2070-2100 (branch scanning pattern).
 *
 * Tool results in the session branch use role "toolResult" (not "tool"),
 * with the `toolName` field on the message identifying the tool. We scan
 * for entries where `toolName === "query_tools"` and read their `details`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOADER_TOOL_NAME } from "./constants.js";
import type { EffectiveConfig, SearchReceipt } from "./types.js";

// ── Branch entry shape (what Pi actually persists) ───────────────

interface BranchEntry {
  type: string;
  message?: {
    role: string;
    toolName?: string;
    details?: unknown;
  };
}

// ── Baseline activation ──────────────────────────────────────────

/**
 * Apply the baseline active tool set.
 * Used by new-session start and /toolbelt reset.
 */
export function applyBaseline(
  pi: ExtensionAPI,
  effective: EffectiveConfig,
): string[] {
  const active = [...new Set([...effective.baseline, LOADER_TOOL_NAME])];
  pi.setActiveTools(active);
  return active;
}

// ── Resume restoration ───────────────────────────────────────────

/**
 * Scan the current session branch backwards for query_tools receipts.
 * Stops at the most recent reset marker (activated: [], query === "/toolbelt reset").
 * Returns tool names to restore, filtered to currently registered tools only.
 *
 * Per extensions.md:2310: "Names passed to pi.setActiveTools() must already
 * be registered; unknown names are ignored." We filter here to avoid passing
 * names for tools that were unregistered since the receipt was created.
 */
export function restoreFromBranch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string[] {
  const branch: BranchEntry[] =
    (ctx.sessionManager?.getBranch?.() as BranchEntry[]) ?? [];
  const restored = new Set<string>();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];

    // Pi persists tool results with message.role === "toolResult"
    // and message.toolName identifying the tool.
    if (
      entry.type !== "message" ||
      !entry.message ||
      entry.message.role !== "toolResult" ||
      entry.message.toolName !== LOADER_TOOL_NAME
    ) {
      continue;
    }

    const details = entry.message.details as SearchReceipt | undefined;
    if (!isSearchReceipt(details)) continue;

    // Reset marker: stop scanning at this boundary
    if (
      details.activated.length === 0 &&
      details.query === "/toolbelt reset"
    ) {
      break;
    }

    // Accumulate activated tools from this receipt
    for (const name of details.activated) {
      restored.add(name);
    }
  }

  // Filter to currently registered tools only
  const registered = new Set(pi.getAllTools().map((t) => t.name));
  return [...restored].filter((name) => registered.has(name));
}

// ── Receipt validation ───────────────────────────────────────────

/** Validate that an unknown value is a SearchReceipt. */
export function isSearchReceipt(
  details: unknown,
): details is SearchReceipt {
  if (typeof details !== "object" || details === null) return false;
  const d = details as Record<string, unknown>;
  return (
    typeof d.query === "string" &&
    typeof d.backend === "string" &&
    Array.isArray(d.rankings) &&
    Array.isArray(d.activated) &&
    typeof d.activeCounts === "object" &&
    d.activeCounts !== null &&
    typeof (d.activeCounts as Record<string, unknown>).before === "number" &&
    typeof (d.activeCounts as Record<string, unknown>).after === "number" &&
    typeof d.catalogHash === "string"
  );
}
