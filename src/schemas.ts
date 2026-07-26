/**
 * TypeBox schemas — single source of truth for externally validated shapes.
 *
 * Schemas here are pure shape definitions (plus derived Static types).
 * Runtime Compile() validators live at the call sites that need them.
 */

import { type Static, Type } from "typebox";
import { ACTIVE_TOOL_SNAPSHOT_VERSION } from "./constants.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Full validated toolbelt.json shape after defaults are applied. */
export const ToolbeltConfigSchema = Type.Object({
  baseline: Type.Array(Type.String()),
  threshold: Type.Number({ minimum: 0, maximum: 1 }),
  topK: Type.Integer({ minimum: 1 }),
});

/**
 * Lenient config-file shape: every field optional, unknown properties accepted.
 * Missing fields are filled from defaults at merge time.
 */
export const ToolbeltConfigFileSchema = Type.Object(
  {
    baseline: Type.Optional(Type.Array(Type.String())),
    threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    topK: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: true },
);

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

/** Ranked discovery hit annotated with current active membership. */
export const ToolDiscoveryResultSchema = Type.Object({
  name: Type.String(),
  score: Type.Number(),
  active: Type.Boolean(),
});

/** Discovery-only receipt persisted in query_tools result details. */
export const DiscoveryReceiptSchema = Type.Object({
  query: Type.String(),
  backend: Type.String(),
  rankings: Type.Array(ToolDiscoveryResultSchema),
  activeCounts: Type.Object({
    before: Type.Number(),
    after: Type.Number(),
  }),
  catalogHash: Type.String(),
});

export type ActiveToolSnapshot = Static<typeof ActiveToolSnapshotSchema>;
export type ToolDiscoveryResult = Static<typeof ToolDiscoveryResultSchema>;
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

/** query_tools parameter schema. */
export const QueryToolsParamsSchema = Type.Object({
  query: Type.String({
    description:
      "Concrete capability or task to find a registered tool for, such as web search or PDF reading",
  }),
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
