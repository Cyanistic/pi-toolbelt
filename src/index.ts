/**
 * pi-toolbelt: discovery and explicit session tool management for Pi.
 *
 * Registers query_tools, manage_tools, and the /toolbelt command family
 * unconditionally. Config validity gates every active-set mutation, while the
 * tools command remains available read-only before setup. Session start applies
 * the registered configured baseline or the newest exact active-set snapshot.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Matching pi-tui AutocompleteItem for tab completions. */
interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
}

function autocompleteItem(
  value: string,
  label: string,
  description: string | undefined,
): AutocompleteItem {
  return description === undefined
    ? { value, label }
    : { value, label, description };
}

import { handleToolbeltCommand } from "./commands.js";
import { buildEffectiveConfig, hasConfigError, isEnabled } from "./config.js";
import {
  BACKEND_ID,
  COMMAND_NAME,
  FLAG_DEBUG,
  LOADER_TOOL_NAME,
  MANAGE_TOOL_NAME,
} from "./constants.js";
import { ManageToolsParamsSchema, QueryToolsParamsSchema } from "./schemas.js";
import { buildToolIndex, SearchEngine } from "./search.js";
import {
  filterRegisteredTools,
  persistActiveTools,
  restoreActiveToolSnapshot,
} from "./session.js";
import type {
  DiscoveryReceipt,
  ToolDiscoveryResult,
  ToolManagementReceipt,
  ToolRanking,
} from "./types.js";

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
  tools: { description: "Inspect and change active session tools" },
  status: { description: "Show current toolbelt state" },
  reset: { description: "Restore configured baseline" },
};

export default function (pi: ExtensionAPI) {
  let searchEngine: SearchEngine | null = null;
  let currentEffectiveConfig: ReturnType<typeof buildEffectiveConfig> | null =
    null;

  pi.registerFlag(FLAG_DEBUG, {
    description: "Show verbose toolbelt debug output",
    type: "boolean",
    default: false,
  });

  // ── /toolbelt command ──────────────────────────────────────────
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Toolbelt: setup, inspect, manage, status, and reset session tools",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();
      const tokens = trimmed.split(/\s+/);

      // Empty arg: show all top-level completions
      if (trimmed.length === 0) {
        return Object.entries(COMPS).map(([value, node]) =>
          autocompleteItem(value, value, node.description),
        );
      }

      // Walk the tree: navigate parents of the last (partial) token.
      // Both endsWithSpace and not-endsWithSpace need to go through
      // tokens.length - 1 nodes (the last token is either empty from
      // trailing space or is the partial completion).
      const endsWithSpace = /\s$/.test(trimmed);
      const lastToken = tokens[tokens.length - 1] ?? "";

      let root: Record<string, CompletionNode> = COMPS;
      for (let i = 0; i < tokens.length - 1; i++) {
        const token = tokens[i];
        if (token === undefined) return null;
        const child = root[token];
        if (!child) return null;
        root = child.children ?? {};
      }

      if (endsWithSpace) {
        // User finished a token (trailing space) — show next level
        const entries = Object.entries(root);
        if (entries.length === 0) return null;
        return entries.map(([value, child]) =>
          autocompleteItem(trimmed + value, value, child.description),
        );
      }

      // Filter parent's children by the last token prefix
      const entries = Object.entries(root).filter(([value]) =>
        value.startsWith(lastToken),
      );
      if (entries.length === 0) return null;
      return entries.map(([value, child]) =>
        autocompleteItem(
          trimmed.slice(0, trimmed.lastIndexOf(lastToken)) + value,
          value,
          child.description,
        ),
      );
    },
    handler: async (args, ctx) => {
      await handleToolbeltCommand(args, pi, ctx);

      // Hot-reload: always re-evaluate config after command so manual
      // edits and setup/reset are reflected immediately without a new
      // session. This is the only place currentEffectiveConfig is
      // updated outside of session_start. If session_start gating
      // logic evolves, this path must be updated in lockstep.
      const fresh = buildEffectiveConfig(ctx.cwd);
      currentEffectiveConfig = isEnabled(fresh) ? fresh : null;
    },
  });

  function annotateActiveState(
    rankings: ToolRanking[],
    activeNames: readonly string[],
  ): ToolDiscoveryResult[] {
    const active = new Set(activeNames);
    return rankings.map((ranking) => ({
      ...ranking,
      active: active.has(ranking.name),
    }));
  }

  function formatDiscoveryResults(rankings: ToolDiscoveryResult[]): string {
    return rankings
      .map(
        ({ name, score, active }) =>
          `${name} (${active ? "active" : "inactive"}, ${score.toFixed(3)})`,
      )
      .join(", ");
  }

  // ── query_tools tool (discovery-only) ─────────────────────────
  pi.registerTool({
    name: LOADER_TOOL_NAME,
    label: "Query Tools",
    description:
      "Discover registered tools by capability without changing the active set. " +
      `Results include current active state. Use ${MANAGE_TOOL_NAME} to activate or deactivate exact names.\n\n` +
      "HOW TO USE: describe a concrete capability or task. Do not ask to list every tool; " +
      "search by capability and broaden the query if no result clears the configured threshold.",
    parameters: QueryToolsParamsSchema,
    async execute(_toolCallId, params) {
      const query = params.query;
      const active = pi.getActiveTools();

      if (!currentEffectiveConfig) {
        return {
          content: [
            {
              type: "text",
              text:
                "Toolbelt is not yet configured. " +
                "Run /toolbelt setup to enable tool discovery.",
            },
          ],
          details: {
            query,
            backend: BACKEND_ID,
            rankings: [],
            activeCounts: { before: active.length, after: active.length },
            catalogHash: "",
          } satisfies DiscoveryReceipt,
        };
      }

      const { threshold, topK } = currentEffectiveConfig;
      const indexed = buildToolIndex(pi.getAllTools());
      if (!searchEngine) {
        searchEngine = new SearchEngine(indexed);
      } else {
        searchEngine.refresh(indexed);
      }

      const ranked = searchEngine.search(query, threshold, topK);
      if (ranked.length === 0) {
        const nearMisses = annotateActiveState(
          searchEngine.search(query, 1.0, topK),
          active,
        );
        return {
          content: [
            {
              type: "text",
              text:
                `No tools matched "${query}" above threshold ${threshold}. ` +
                (nearMisses.length > 0
                  ? `Near misses: ${formatDiscoveryResults(nearMisses)}`
                  : "No ranking results found."),
            },
          ],
          details: {
            query,
            backend: BACKEND_ID,
            rankings: nearMisses,
            activeCounts: { before: active.length, after: active.length },
            catalogHash: searchEngine.getCatalogHash(),
          } satisfies DiscoveryReceipt,
        };
      }

      const rankings = annotateActiveState(ranked, active);
      return {
        content: [
          {
            type: "text",
            text:
              `Matching registered tools: ${formatDiscoveryResults(rankings)}. ` +
              `Use ${MANAGE_TOOL_NAME} with an exact tool name to change membership.`,
          },
        ],
        details: {
          query,
          backend: BACKEND_ID,
          rankings,
          activeCounts: { before: active.length, after: active.length },
          catalogHash: searchEngine.getCatalogHash(),
        } satisfies DiscoveryReceipt,
      };
    },
  });

  // ── manage_tools tool (explicit model-side mutation) ──────────
  pi.registerTool({
    name: MANAGE_TOOL_NAME,
    label: "Manage Tools",
    description:
      "Activate or deactivate registered Pi tools by exact name. Performs one direction per call, " +
      "persists the complete final active set before applying it, and never executes the target tools. " +
      "Any registered tool, including query_tools and manage_tools, may be deactivated.",
    parameters: ManageToolsParamsSchema,
    async execute(_toolCallId, params) {
      if (!currentEffectiveConfig) {
        throw new Error(
          "Toolbelt is not configured. Run /toolbelt setup before changing active tools.",
        );
      }

      const { action } = params;
      const requested = [...new Set(params.tools)];

      const registered = new Set(pi.getAllTools().map((tool) => tool.name));
      const unknown = requested.filter((name) => !registered.has(name));
      if (unknown.length > 0) {
        throw new Error(`Unknown registered tool names: ${unknown.join(", ")}`);
      }

      const before = pi.getActiveTools();
      const requestedSet = new Set(requested);
      const target =
        action === "activate"
          ? [...new Set([...before, ...requested])]
          : before.filter((name) => !requestedSet.has(name));

      let change: ReturnType<typeof persistActiveTools>;
      try {
        change = persistActiveTools(pi, target);
      } catch (error) {
        throw new Error(
          `Failed to persist active-tool snapshot; no tools were changed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const changed = action === "activate" ? change.added : change.removed;
      return {
        content: [
          {
            type: "text",
            text:
              changed.length > 0
                ? `${action === "activate" ? "Activated" : "Deactivated"}: ${changed.join(", ")}. ` +
                  `Active tools: ${change.after.join(", ") || "(none)"}.`
                : `No tools changed. Active tools: ${change.after.join(", ") || "(none)"}.`,
          },
        ],
        details: {
          action,
          requested,
          ...change,
        } satisfies ToolManagementReceipt,
      };
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    const effective = buildEffectiveConfig(ctx.cwd);
    const debug = !!pi.getFlag(FLAG_DEBUG);

    if (hasConfigError(effective)) {
      const errors = [effective.globalError, effective.projectError].filter(
        (error): error is string => typeof error === "string",
      );
      ctx.ui.notify(`[toolbelt] ${errors.join("; ")}`, "warning");
    }

    if (!isEnabled(effective)) {
      currentEffectiveConfig = null;
      if (debug) {
        ctx.ui.notify("[toolbelt] disabled - no valid config found", "info");
      }
      return;
    }

    currentEffectiveConfig = effective;
    const isResume =
      event &&
      typeof event === "object" &&
      "reason" in event &&
      (event as { reason: string }).reason === "resume";
    const configuredBaseline = filterRegisteredTools(pi, effective.baseline);
    const restored = isResume ? restoreActiveToolSnapshot(pi, ctx) : undefined;
    const active = restored ?? configuredBaseline;
    pi.setActiveTools(active);

    if (debug) {
      ctx.ui.notify(
        isResume
          ? `[toolbelt] resume: ${active.length} active tools from ${restored ? "snapshot" : "configured baseline"}`
          : `[toolbelt] configured baseline active: ${active.join(", ")} (source: ${effective.source})`,
        "info",
      );
    }
  });
}
