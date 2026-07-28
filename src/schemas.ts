/**
 * TypeBox schemas — single source of truth for externally validated shapes.
 *
 * Schemas here are pure shape definitions (plus derived Static types).
 * Runtime Compile() validators live at the call sites that need them.
 */

import { type Static, Type } from "typebox";
import { ACTIVE_TOOL_SNAPSHOT_VERSION } from "./constants.js";

// ---------------------------------------------------------------------------
// Search configuration (discriminated on type)
// ---------------------------------------------------------------------------

/** BM25 local search — the default backend. */
export const Bm25SearchSchema = Type.Object({
  type: Type.Literal("bm25"),
});

/** LLM-based advisory search. Optional model in provider/id form. */
export const LlmSearchSchema = Type.Object({
  type: Type.Literal("llm"),
  model: Type.Optional(
    Type.String({
      description: "Model identifier in provider/id form (e.g. openai/gpt-4)",
    }),
  ),
});

/** Discriminated search configuration: bm25 (default) or llm (advisory). */
export const SearchConfigSchema = Type.Union(
  [Bm25SearchSchema, LlmSearchSchema],
  {
    discriminator: "type",
  },
);

export type SearchConfig = Static<typeof SearchConfigSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Scope baseline: JSON null = unrestricted; string[] (including empty) =
 * exact allowlist. Omitted inherits parent / root unrestricted default.
 */
export const BaselineConfigSchema = Type.Union([
  Type.Null(),
  Type.Array(Type.String()),
]);

/** Full validated toolbelt.json shape after defaults are applied. */
export const ToolbeltConfigSchema = Type.Object({
  baseline: BaselineConfigSchema,
  search: SearchConfigSchema,
});

/**
 * Lenient config-file shape: every field optional, unknown properties accepted.
 * Missing fields are filled from defaults at merge time.
 */
export const ToolbeltConfigFileSchema = Type.Object(
  {
    baseline: Type.Optional(BaselineConfigSchema),
    search: Type.Optional(SearchConfigSchema),
  },
  { additionalProperties: true },
);

export type BaselineConfig = Static<typeof BaselineConfigSchema>;
export type ToolbeltConfig = Static<typeof ToolbeltConfigSchema>;
export type ToolbeltConfigFile = Static<typeof ToolbeltConfigFileSchema>;

// ---------------------------------------------------------------------------
// Session snapshots & receipts
// ---------------------------------------------------------------------------

/** Versioned full active-set snapshot persisted in custom session entries. */
export const ActiveToolSnapshotSchema = Type.Object({
  version: Type.Literal(ACTIVE_TOOL_SNAPSHOT_VERSION),
  active: Type.Array(Type.String()),
});

/** Ranked discovery hit annotated with current active membership (score-free). */
export const ToolDiscoveryResultSchema = Type.Object({
  rank: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  description: Type.String(),
  active: Type.Boolean(),
});

export type ToolDiscoveryResult = Static<typeof ToolDiscoveryResultSchema>;
export type ActiveToolSnapshot = Static<typeof ActiveToolSnapshotSchema>;

// ---------------------------------------------------------------------------
// Model usage metadata (from Pi AI nested calls)
// ---------------------------------------------------------------------------

export const ModelUsageSchema = Type.Object({
  inputTokens: Type.Optional(Type.Integer()),
  outputTokens: Type.Optional(Type.Integer()),
  totalTokens: Type.Optional(Type.Integer()),
});

export type ModelUsage = Static<typeof ModelUsageSchema>;

// ---------------------------------------------------------------------------
// Discovery receipts (discriminated on kind)
// ---------------------------------------------------------------------------

/**
 * Ranked receipt — produced by BM25 or BM25 fallback.
 * Contains structured local rankings.
 */
export const RankedReceiptSchema = Type.Object({
  kind: Type.Literal("ranked"),
  requestedBackend: Type.String(),
  actualBackend: Type.String(),
  fallbackReason: Type.Optional(Type.String()),
  rankings: Type.Array(ToolDiscoveryResultSchema),
  activeCounts: Type.Object({
    before: Type.Number(),
    after: Type.Number(),
  }),
  catalogHash: Type.String(),
});

/**
 * Advisory receipt — produced by successful LLM ranking.
 * Contains raw provider text and nested usage metadata.
 */
export const AdvisoryReceiptSchema = Type.Object({
  kind: Type.Literal("advisory"),
  requestedBackend: Type.String(),
  actualBackend: Type.String(),
  fallbackReason: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  raw: Type.String(),
  usage: Type.Optional(ModelUsageSchema),
  activeCounts: Type.Object({
    before: Type.Number(),
    after: Type.Number(),
  }),
  catalogHash: Type.String(),
});

/** Discriminated discovery receipt: ranked (local) or advisory (LLM). */
export const DiscoveryReceiptSchema = Type.Union(
  [RankedReceiptSchema, AdvisoryReceiptSchema],
  { discriminator: "kind" },
);

export type RankedReceipt = Static<typeof RankedReceiptSchema>;
export type AdvisoryReceipt = Static<typeof AdvisoryReceiptSchema>;
export type DiscoveryReceipt = Static<typeof DiscoveryReceiptSchema>;

// ---------------------------------------------------------------------------
// Custom tool parameters
// ---------------------------------------------------------------------------

/**
 * Manage-tools action. Type.Enum emits JSON Schema `enum` (Google-compatible);
 * do not use Type.Union of Type.Literal for provider-facing tool parameters.
 */
export const ToolManagementActionSchema = Type.Enum([
  "activate",
  "deactivate",
] as const);

export type ToolManagementAction = Static<typeof ToolManagementActionSchema>;

/** query_tools parameter schema — includes per-call discovery controls. */
export const QueryToolsParamsSchema = Type.Object({
  query: Type.String({
    description:
      "Concrete capability or task to find a registered tool for, such as web search or PDF reading",
  }),
  includeActive: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "Include already-active tools in results (default: hidden-first discovery)",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      default: 5,
      description: "Maximum number of results (default: 5, no upper bound)",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 0,
      default: 5000,
      description:
        "LLM-ranking timeout in ms (default: 5000, 0 = disable mode timeout)",
    }),
  ),
});

/** manage_tools parameter schema. */
export const ManageToolsParamsSchema = Type.Object({
  action: Type.Options(ToolManagementActionSchema, {
    description: "Whether to activate or deactivate every supplied tool name",
  }),
  tools: Type.Array(Type.String(), {
    minItems: 1,
    description: "One or more exact registered tool names",
  }),
});

export type QueryToolsParams = Static<typeof QueryToolsParamsSchema>;
export type ManageToolsParams = Static<typeof ManageToolsParamsSchema>;
