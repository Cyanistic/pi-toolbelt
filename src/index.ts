/**
 * pi-toolbelt: discovery and explicit session tool management for Pi.
 *
 * Registers query_tools, manage_tools, and the /toolbelt command family
 * unconditionally. Runtime mode (configured / session-only / inactive) is
 * derived from trust-aware effective config plus the newest valid session
 * snapshot. Active-set mutations stay persistence-first.
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

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
import {
  buildEffectiveConfig,
  configErrorMessages,
  hasConfigError,
  resolveRuntimeMode,
} from "./config.js";
import {
  BACKEND_ID_BM25,
  BACKEND_ID_LLM,
  COMMAND_NAME,
  DEFAULT_LIMIT,
  DEFAULT_LLM_TIMEOUT_MS,
  FLAG_DEBUG,
  LOADER_TOOL_NAME,
  MANAGE_TOOL_NAME,
} from "./constants.js";
import type { LlmSearchError, LlmSearchResult } from "./llm-search.js";
import { llmRank } from "./llm-search.js";
import type { ToolDiscoveryResult } from "./schemas.js";
import { ManageToolsParamsSchema, QueryToolsParamsSchema } from "./schemas.js";
import { buildToolIndex, SearchEngine } from "./search.js";
import {
  filterRegisteredTools,
  hasActiveToolSnapshot,
  persistActiveTools,
  restoreActiveToolSnapshot,
} from "./session.js";
import type { EffectiveConfig, RuntimeMode, SearchConfig } from "./types.js";

/** Completion tree: each node maps a token to the next level. */
interface CompletionNode {
  description?: string;
  /** Null/undefined at leaves - no further completions. */
  children?: Record<string, CompletionNode>;
}

const COMPS: Record<string, CompletionNode> = {
  settings: { description: "Edit persistent configuration" },
  tools: { description: "Inspect and change active session tools" },
  status: { description: "Show current toolbelt state" },
  reset: { description: "Restore baseline or activate all registered tools" },
};

const INACTIVE_GUIDANCE =
  "Toolbelt config is unusable and no session tool snapshot exists. Fix configuration with /toolbelt settings, or establish a session tool set with /toolbelt tools.";

export default function (pi: ExtensionAPI) {
  let searchEngine: SearchEngine | null = null;
  /** Latest resolved runtime mode for this session. */
  let currentRuntime: RuntimeMode | null = null;

  pi.registerFlag(FLAG_DEBUG, {
    description: "Show verbose toolbelt debug output",
    type: "boolean",
    default: false,
  });

  // ── /toolbelt command ──────────────────────────────────────────
  pi.registerCommand(COMMAND_NAME, {
    description: "Toolbelt: settings, tools, status, and reset session tools",
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
        // User finished a token (trailing space) - show next level
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
      await handleToolbeltCommand(args, pi, ctx, {
        onRuntimeInvalidate: () => {
          currentRuntime = refreshRuntime(ctx);
        },
      });

      // Hot-reload runtime mode after every command so settings/tools/reset
      // and external config edits are reflected without a new session.
      currentRuntime = refreshRuntime(ctx);
    },
  });

  // ── Helpers ────────────────────────────────────────────────────

  function projectTrusted(ctx: ExtensionContext): boolean {
    return ctx.isProjectTrusted?.() ?? false;
  }

  function refreshRuntime(ctx: ExtensionContext): RuntimeMode {
    const effective = buildEffectiveConfig(ctx.cwd, projectTrusted(ctx));
    return resolveRuntimeMode(effective, hasActiveToolSnapshot(ctx));
  }

  function ensureRuntime(ctx?: ExtensionContext): RuntimeMode | null {
    if (ctx) {
      currentRuntime = refreshRuntime(ctx);
    }
    return currentRuntime;
  }

  /**
   * Effective search for the current runtime.
   * Session-only always forces default BM25; configured uses config search.
   */
  function runtimeSearch(runtime: RuntimeMode): SearchConfig | null {
    if (runtime.mode === "inactive") return null;
    if (runtime.mode === "session-only") return { type: "bm25" };
    return runtime.effective.search;
  }

  /**
   * Get the eligible tool catalog for indexing.
   * When includeActive is false (default), exclude currently active tools.
   */
  function getEligibleTools(
    includeActive: boolean,
  ): Array<{ name: string; description?: string }> {
    const allTools = pi.getAllTools();
    if (includeActive) return allTools;

    const activeNames = new Set(pi.getActiveTools());
    return allTools.filter((t) => !activeNames.has(t.name));
  }

  /**
   * Ensure the search index is initialized with the current tool catalog.
   * Returns the catalog hash for receipt use.
   */
  function ensureSearchIndex(includeActive: boolean): string {
    const eligible = getEligibleTools(includeActive);
    const activeNames = pi.getActiveTools();
    const indexed = buildToolIndex(eligible, activeNames);

    if (!searchEngine) {
      searchEngine = new SearchEngine(indexed);
    } else {
      searchEngine.refresh(indexed);
    }
    return searchEngine.getCatalogHash();
  }

  /**
   * Perform a BM25 search and return ranked results + receipt details.
   */
  function bm25Search(
    query: string,
    includeActive: boolean,
    limit: number,
  ): {
    rankings: import("./schemas.js").ToolDiscoveryResult[];
    catalogHash: string;
  } {
    const catalogHash = ensureSearchIndex(includeActive);
    const engine = searchEngine;
    const rankings = engine ? engine.search(query, limit) : [];
    return { rankings, catalogHash };
  }

  // ── query_tools tool (discovery-only) ─────────────────────────
  pi.registerTool({
    name: LOADER_TOOL_NAME,
    label: "Query Tools",
    promptSnippet:
      `Use ${LOADER_TOOL_NAME} when the original task needs a fitting registered tool that is not currently active. ` +
      "Describe the concrete capability needed. Results include active state. Do NOT mutate the active set - call " +
      `${MANAGE_TOOL_NAME} with the exact selected name to activate it, then resume the original task.`,
    promptGuidelines: [
      `If the user's request requires a capability that is absent from the active tool set, call ${LOADER_TOOL_NAME} to find a registered tool for the needed capability.`,
      `When ${LOADER_TOOL_NAME} returns a matching inactive tool, call ${MANAGE_TOOL_NAME} with action "activate" and the exact tool name. Then call the newly activated tool to serve the original request.`,
      `Do not guess tool names - always use exact names returned by ${LOADER_TOOL_NAME}.`,
    ],
    description:
      "Discover registered tools by capability without changing the active set. " +
      `Results include current active state. Use ${MANAGE_TOOL_NAME} to activate or deactivate exact names.` +
      "\n\n" +
      "HOW TO USE: describe a concrete capability or task. " +
      "Do not ask to list every tool; search by capability.",
    parameters: QueryToolsParamsSchema,
    async execute(
      _toolCallId: string,
      params: import("./schemas.js").QueryToolsParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const query = params.query;
      const includeActive = params.includeActive ?? false;
      const limit = params.limit ?? DEFAULT_LIMIT;
      const timeoutMs = params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

      const active = pi.getActiveTools();
      const runtime = ensureRuntime(_ctx);

      // ── Inactive ────────────────────────────────────────────────
      if (!runtime || runtime.mode === "inactive") {
        return {
          content: [
            {
              type: "text",
              text: INACTIVE_GUIDANCE,
            },
          ],
          details: {
            kind: "ranked",
            requestedBackend: BACKEND_ID_BM25,
            actualBackend: BACKEND_ID_BM25,
            rankings: [] as Array<ToolDiscoveryResult>,
            activeCounts: { before: active.length, after: active.length },
            catalogHash: "",
          },
        };
      }

      const search = runtimeSearch(runtime);
      if (!search) {
        return {
          content: [{ type: "text", text: INACTIVE_GUIDANCE }],
          details: {
            kind: "ranked",
            requestedBackend: BACKEND_ID_BM25,
            actualBackend: BACKEND_ID_BM25,
            rankings: [] as Array<ToolDiscoveryResult>,
            activeCounts: { before: active.length, after: active.length },
            catalogHash: "",
          },
        };
      }

      const isLLM = search.type === "llm";

      // Collect eligible catalog for LLM mode
      const allTools = pi.getAllTools();
      const activeNamesSet = new Set(active);
      const eligible = includeActive
        ? allTools
        : allTools.filter((t) => !activeNamesSet.has(t.name));

      if (!isLLM) {
        // ── BM25 mode (configured BM25 or any session-only) ────────
        const { rankings, catalogHash } = bm25Search(
          query,
          includeActive,
          limit,
        );

        if (rankings.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No tools matched "${query}". Try a different query.`,
              },
            ],
            details: {
              kind: "ranked" as const,
              requestedBackend: BACKEND_ID_BM25,
              actualBackend: BACKEND_ID_BM25,
              rankings: [] as Array<ToolDiscoveryResult>,
              activeCounts: {
                before: active.length,
                after: active.length,
              },
              catalogHash,
            },
          };
        }

        const resultText = rankings
          .map(
            ({ rank, name, description, active: isActive }) =>
              `${rank}. ${name}${isActive ? "" : " (inactive)"}${description ? ` - ${description}` : ""}`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text:
                `Matching registered tools:\n${resultText}\n\n` +
                `Use ${MANAGE_TOOL_NAME} with an exact tool name to change membership.`,
            },
          ],
          details: {
            kind: "ranked" as const,
            requestedBackend: BACKEND_ID_BM25,
            actualBackend: BACKEND_ID_BM25,
            rankings,
            activeCounts: {
              before: active.length,
              after: active.length,
            },
            catalogHash,
          },
        };
      }

      // ── LLM mode (configured only - session-only never reaches here) ─
      const requestedBackend = BACKEND_ID_LLM;
      const configuredModel = search.model;

      // Attempt LLM ranking
      const catalogWithActive = eligible.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        active: activeNamesSet.has(t.name),
      }));

      const llmResult = await llmRank(
        query,
        limit,
        catalogWithActive,
        _ctx,
        _signal,
        timeoutMs,
        configuredModel,
      );

      const llmError =
        "code" in (llmResult as LlmSearchError)
          ? (llmResult as LlmSearchError)
          : null;

      if (llmError) {
        if (llmError.code === "cancelled") {
          // Parent cancellation - stop without fallback
          return {
            content: [
              {
                type: "text",
                text: "Discovery cancelled.",
              },
            ],
            details: {
              kind: "ranked" as const,
              requestedBackend,
              actualBackend: BACKEND_ID_LLM,
              rankings: [] as Array<ToolDiscoveryResult>,
              activeCounts: {
                before: active.length,
                after: active.length,
              },
              catalogHash: "",
            },
          };
        }

        // Recoverable failure - fall back to BM25
        const { rankings, catalogHash } = bm25Search(
          query,
          includeActive,
          limit,
        );

        const resultText =
          rankings.length > 0
            ? rankings
                .map(
                  ({ rank, name, description, active: isActive }) =>
                    `${rank}. ${name}${isActive ? "" : " (inactive)"}${description ? ` - ${description}` : ""}`,
                )
                .join("\n")
            : `No tools matched "${query}".`;

        return {
          content: [
            {
              type: "text",
              text:
                `[LLM unavailable - ${llmError.message}]\n\n` +
                `BM25 fallback results:\n${resultText}`,
            },
          ],
          details: {
            kind: "ranked" as const,
            requestedBackend,
            actualBackend: BACKEND_ID_BM25,
            fallbackReason: llmError.message,
            rankings,
            activeCounts: {
              before: active.length,
              after: active.length,
            },
            catalogHash,
          },
        };
      }

      const llmSuccess = llmResult as LlmSearchResult;

      // Successful LLM ranking
      return {
        content: [
          {
            type: "text",
            text:
              `LLM advisory results for "${query}":\n${llmSuccess.raw}\n\n` +
              `Use ${MANAGE_TOOL_NAME} with an exact tool name to change membership.`,
          },
        ],
        details: {
          kind: "advisory" as const,
          requestedBackend,
          actualBackend: BACKEND_ID_LLM,
          model: llmSuccess.model,
          raw: llmSuccess.raw,
          ...(llmSuccess.usage !== undefined
            ? { usage: llmSuccess.usage }
            : {}),
          activeCounts: {
            before: active.length,
            after: active.length,
          },
          catalogHash: ensureSearchIndex(includeActive),
        },
      };
    },
  });

  // ── manage_tools tool (explicit model-side mutation) ──────────
  pi.registerTool({
    name: MANAGE_TOOL_NAME,
    label: "Manage Tools",
    promptSnippet:
      `Use ${MANAGE_TOOL_NAME} to activate or deactivate registered Pi tools by exact name after discovering them with ` +
      `${LOADER_TOOL_NAME}. Specify one or more exact registered tool names and the direction (activate or deactivate).`,
    promptGuidelines: [
      `When ${LOADER_TOOL_NAME} returns a matching inactive tool, call ${MANAGE_TOOL_NAME} with action "activate" and the exact tool name from the results.`,
      `After activating a tool through ${MANAGE_TOOL_NAME}, call that newly available tool to carry out the original request.`,
      `Use only exact tool names as shown in the registered catalog - ${MANAGE_TOOL_NAME} rejects unknown names.`,
    ],
    description:
      "Activate or deactivate registered Pi tools by exact name. Performs one direction per call, " +
      "persists the complete final active set before applying it, and never executes the target tools. " +
      "Any registered tool, including query_tools and manage_tools, may be deactivated.",
    parameters: ManageToolsParamsSchema,
    async execute(
      _toolCallId: string,
      params: import("./schemas.js").ManageToolsParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const runtime = ensureRuntime(_ctx);

      // Refuse before any persistence or active-set mutation.
      if (!runtime || runtime.mode === "inactive") {
        throw new Error(INACTIVE_GUIDANCE);
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

      // Successful mutation establishes/refreshes snapshot evidence.
      if (_ctx) {
        currentRuntime = refreshRuntime(_ctx);
      } else if (currentRuntime) {
        currentRuntime = resolveRuntimeMode(currentRuntime.effective, true);
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
        },
      };
    },
  });

  // ── Session lifecycle ──────────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    const effective = buildEffectiveConfig(ctx.cwd, projectTrusted(ctx));
    const debug = !!pi.getFlag(FLAG_DEBUG);

    if (hasConfigError(effective)) {
      const errors = configErrorMessages(effective);
      ctx.ui.notify(`[toolbelt] ${errors.join("; ")}`, "warning");
    }

    if (effective.project.state === "ignored" && debug) {
      ctx.ui.notify(
        `[toolbelt] Project config ignored (untrusted): ${effective.projectPath}`,
        "info",
      );
    }

    const isResume =
      event &&
      typeof event === "object" &&
      "reason" in event &&
      (event as { reason: string }).reason === "resume";

    // Snapshot restores even when config is missing or malformed.
    const restored = isResume ? restoreActiveToolSnapshot(pi, ctx) : undefined;

    if (restored !== undefined) {
      pi.setActiveTools(restored);
      currentRuntime = resolveRuntimeMode(effective, true);
      if (debug) {
        ctx.ui.notify(
          `[toolbelt] resume: ${restored.length} active tools from snapshot` +
            (effective.configured
              ? ` (config: ${effective.source})`
              : " (session-only)"),
          "info",
        );
      }
      return;
    }

    // No snapshot: apply list baseline only; unrestricted leaves host set alone.
    if (effective.configured && effective.baseline.kind === "list") {
      const active = filterRegisteredTools(pi, effective.baseline.tools);
      pi.setActiveTools(active);
      currentRuntime = resolveRuntimeMode(effective, false);
      if (debug) {
        ctx.ui.notify(
          `[toolbelt] list baseline applied: ${active.join(", ") || "(none)"} (source: ${effective.baseline.source})`,
          "info",
        );
      }
      return;
    }

    // Configured unrestricted (or config unusable without snapshot): no mutation.
    currentRuntime = resolveRuntimeMode(effective, false);
    if (debug) {
      if (effective.configured) {
        ctx.ui.notify(
          `[toolbelt] unrestricted baseline - host active set left unchanged (source: ${effective.baseline.source})`,
          "info",
        );
      } else {
        ctx.ui.notify(
          "[toolbelt] config unusable and no session snapshot - tools not mutated",
          "info",
        );
      }
    }
  });
}

// Re-export types used by hot-reload callers / future modules.
export type { EffectiveConfig, RuntimeMode };
