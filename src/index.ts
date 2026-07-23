/**
 * pi-toolbelt — Progressive tool discovery extension for Pi.
 *
 * Registers one model-facing tool (query_tools) and one slash command
 * family (/toolbelt) unconditionally at module load. The session_start
 * handler gates all active-set management behind config-file presence
 * and validity — installing the package alone never alters active tools.
 *
 * Follows rpiv-core/index.ts:46-48 unconditional-registration pattern
 * and pi-powerline-footer standalone package structure.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Matching pi-tui AutocompleteItem for tab completions. */
interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
}
import { BACKEND_ID, FLAG_DEBUG, LOADER_TOOL_NAME } from "./constants.js";
import { buildEffectiveConfig, hasConfigError, isEnabled } from "./config.js";
import { getGlobalConfigPath, getProjectConfigPath } from "./config.js";
import { handleToolbeltCommand } from "./commands.js";
import type { SearchReceipt } from "./types.js";
import { SearchEngine, buildToolIndex } from "./search.js";
import { applyBaseline, restoreFromBranch } from "./session.js";

/** Completion tree: each node maps a token to the next level. */
interface CompletionNode {
  description?: string;
  /** Null/undefined at leaves — no further completions. */
  children?: Record<string, CompletionNode>;
}

const COMPS: Record<string, CompletionNode> = {
  setup: {
    description: "Create config and apply baseline",
    children: {
      global: { description: "Write ~/.pi/agent/toolbelt.json" },
      project: { description: "Write .pi/toolbelt.json" },
    },
  },
  status: { description: "Show current toolbelt state" },
  reset: { description: "Clear search-activated tools" },
};

export default function (pi: ExtensionAPI) {
  let searchEngine: SearchEngine | null = null;
  let currentEffectiveConfig: ReturnType<typeof buildEffectiveConfig> | null = null;

  pi.registerFlag(FLAG_DEBUG, {
    description: "Show verbose toolbelt debug output",
    type: "boolean",
    default: false,
  });

  // ── /toolbelt command ──────────────────────────────────────────
  pi.registerCommand("toolbelt", {
    description: "Toolbelt: setup, status, and reset progressive tool discovery",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();
      const tokens = trimmed.split(/\s+/);

      // Empty arg: show all top-level completions
      if (trimmed.length === 0) {
        return Object.entries(COMPS).map(([value, node]) => ({
          value,
          label: value,
          description: node.description,
        }));
      }

      // Walk the tree: navigate parents of the last (partial) token.
      // Both endsWithSpace and not-endsWithSpace need to go through
      // tokens.length - 1 nodes (the last token is either empty from
      // trailing space or is the partial completion).
      const endsWithSpace = /\s$/.test(trimmed);
      const lastToken = tokens[tokens.length - 1];

      let root: Record<string, CompletionNode> = COMPS;
      for (let i = 0; i < tokens.length - 1; i++) {
        const child = root[tokens[i]];
        if (!child) return null;
        root = child.children ?? {};
      }

      if (endsWithSpace) {
        // User finished a token (trailing space) — show next level
        const entries = Object.entries(root);
        if (entries.length === 0) return null;
        return entries.map(([value, child]) => ({
          value: trimmed + value,
          label: value,
          description: child.description,
        }));
      }

      // Filter parent's children by the last token prefix
      const entries = Object.entries(root).filter(([value]) =>
        value.startsWith(lastToken),
      );
      if (entries.length === 0) return null;
      return entries.map(([value, child]) => ({
        value: trimmed.slice(0, trimmed.lastIndexOf(lastToken)) + value,
        label: value,
        description: child.description,
      }));
    },
    handler: async (args, ctx) => {
      await handleToolbeltCommand(args, pi, ctx);

      // Hot-reload: always re-evaluate config after command so manual
      // edits and setup/reset are reflected immediately without a new
      // session. This is the only place currentEffectiveConfig is
      // updated outside of session_start.
      const fresh = buildEffectiveConfig(ctx.cwd);
      currentEffectiveConfig = isEnabled(fresh) ? fresh : null;
    },
  });

  // ── query_tools tool ──────────────────────────────────────────
  pi.registerTool({
    name: LOADER_TOOL_NAME,
    label: "Query Tools",
    description:
      "Discover and activate additional tools beyond your current set. " +
      "Describe a concrete capability you need (e.g. \"fetch a URL\", \"search the web\", " +
      "\"generate an image\") and matching tools are automatically added to your available " +
      "toolset. Activated tools are callable immediately.\n\n" +
      "HOW TO USE: think of a task you want to do, then describe that task or capability. " +
      "Do NOT ask to \"list\" or \"show all\" tools — the system searches by capability, " +
      "not by enumeration. If a search returns no matches, broaden the capability description.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Concrete capability or task you need a tool for (e.g. \"search the web\", " +
            "\"read a PDF\", \"execute code\"). Do NOT ask to list or enumerate tools.",
        },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params) {
      const query = String(params.query ?? "");

      // Disabled mode: no valid config → return empty receipt, no activation
      if (!currentEffectiveConfig) {
        const active = pi.getActiveTools();
        return {
          content: [
            {
              type: "text",
              text:
                "Toolbelt is not yet configured. " +
                "Run /toolbelt setup to enable progressive tool discovery.",
            },
          ],
          details: {
            query,
            backend: BACKEND_ID,
            rankings: [],
            activated: [],
            activeCounts: { before: active.length, after: active.length },
            catalogHash: "",
          },
        };
      }

      const { threshold, topK } = currentEffectiveConfig;

      // Build or refresh tool index
      const allTools = pi.getAllTools();
      const indexed = buildToolIndex(allTools);
      if (!searchEngine) {
        searchEngine = new SearchEngine(indexed);
      } else {
        searchEngine.refresh(indexed);
      }

      // Search
      const rankings = searchEngine.search(query, threshold, topK);

      // No matches above threshold — return near-misses for debugging
      if (rankings.length === 0) {
        const active = pi.getActiveTools();
        // Re-search with threshold 1.0 for near-misses
        const allRanked = searchEngine.search(query, 1.0, topK);
        return {
          content: [
            {
              type: "text",
              text:
                `No tools matched "${query}" above threshold ${threshold}. ` +
                (allRanked.length > 0
                  ? `Near misses: ${allRanked.map((r) => r.name).join(", ")}`
                  : "No ranking results found."),
            },
          ],
          details: {
            query,
            backend: BACKEND_ID,
            rankings: allRanked,
            activated: [],
            activeCounts: { before: active.length, after: active.length },
            catalogHash: searchEngine.getCatalogHash(),
          },
        };
      }

      // Additive activation: merge matched names with current active set.
      const activeBefore = pi.getActiveTools();
      const matched = rankings.map((r) => r.name);
      const newSet = [...new Set([...activeBefore, ...matched])];
      pi.setActiveTools(newSet);

      const activeAfter = pi.getActiveTools();
      const activated = matched.filter((n) => !activeBefore.includes(n));

      return {
        content: [
          {
            type: "text",
            text:
              activated.length > 0
                ? `Activated tools: ${activated.join(", ")}. ` +
                  `Now ${activeAfter.length} tools active (was ${activeBefore.length}).`
                : `Matching tools already active: ${matched.join(", ")}`,
          },
        ],
        details: {
          query,
          backend: BACKEND_ID,
          rankings,
          activated,
          activeCounts: {
            before: activeBefore.length,
            after: activeAfter.length,
          },
          catalogHash: searchEngine.getCatalogHash(),
        },
      } satisfies { content: Array<{ type: "text"; text: string }>; details: SearchReceipt };
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    const effective = buildEffectiveConfig(ctx.cwd);
    const debug = !!pi.getFlag(FLAG_DEBUG);

    // ── Check for config errors (always warn) ──
    if (hasConfigError(effective)) {
      const errors: string[] = [];
      if (effective.globalError) errors.push(effective.globalError);
      if (effective.projectError) errors.push(effective.projectError);
      ctx.ui.notify(`[toolbelt] ${errors.join("; ")}`, "warning");
      // isEnabled returns false when errors exist (FRD FR#8).
    }

    // ── Disabled mode ──
    if (!isEnabled(effective)) {
      currentEffectiveConfig = null; // block query_tools
      if (debug) {
        ctx.ui.notify(
          "[toolbelt] disabled — no valid config found",
          "info",
        );
      }
      return;
    }

    // ── Enabled mode ──
    currentEffectiveConfig = effective;

    // Detect resume: session_start event with reason === "resume"
    const isResume =
      event &&
      typeof event === "object" &&
      "reason" in event &&
      (event as { reason: string }).reason === "resume";

    if (isResume) {
      // Restore baseline + previously activated tools from branch
      const restored = restoreFromBranch(pi, ctx);
      const active = [
        ...new Set([
          ...effective.baseline,
          LOADER_TOOL_NAME,
          ...restored,
        ]),
      ];
      pi.setActiveTools(active);

      if (debug) {
        ctx.ui.notify(
          `[toolbelt] resume: baseline (${effective.baseline.length}) + ` +
            `restored (${restored.length}) = ${active.length} active tools`,
          "info",
        );
      }
    } else {
      // New session: baseline only
      applyBaseline(pi, effective);

      if (debug) {
        ctx.ui.notify(
          `[toolbelt] activated baseline: ${effective.baseline.join(", ")} ` +
            `(source: ${effective.source})`,
          "info",
        );
      }
    }
  });
}
