/**
 * Search engine wrapping MiniSearch for local BM25 tool discovery.
 *
 * Builds an in-memory BM25 index from an eligible tool list on construction,
 * supports re-indexing (refresh) with SHA-256 catalog hash to skip rebuilds
 * when the catalog hasn't changed.
 *
 * Name receives a higher field boost than description. Fuzzy and prefix
 * matching are disabled — the calling model provides the vocabulary.
 */

import { createHash } from "node:crypto";
import MiniSearch from "minisearch";
import type { ToolDiscoveryResult } from "./schemas.js";

// ── Eligible tool descriptor ─────────────────────────────────────

export interface IndexedTool {
  name: string;
  description: string;
  active: boolean;
}

// ── SearchEngine ─────────────────────────────────────────────────

export class SearchEngine {
  private ms: MiniSearch<IndexedTool>;
  private catalogHash: string;

  constructor(tools: IndexedTool[]) {
    this.ms = new MiniSearch<IndexedTool>({
      idField: "name",
      fields: ["name", "description"],
      storeFields: ["name", "description", "active"],
      searchOptions: {
        boost: { name: 3, description: 1 },
        fuzzy: false,
        prefix: false,
        combineWith: "OR",
      },
    });

    this.ms.addAll(tools);
    this.catalogHash = computeCatalogHash(tools);
  }

  /** Current SHA-256 catalog hash for receipt and change detection. */
  getCatalogHash(): string {
    return this.catalogHash;
  }

  /**
   * Rebuild the index from a fresh tool list. Returns true if the
   * catalog changed (hash differs), false if the rebuild was skipped.
   */
  refresh(tools: IndexedTool[]): boolean {
    const newHash = computeCatalogHash(tools);
    if (newHash === this.catalogHash) return false;

    this.ms = new MiniSearch<IndexedTool>({
      idField: "name",
      fields: ["name", "description"],
      storeFields: ["name", "description", "active"],
      searchOptions: {
        boost: { name: 3, description: 1 },
        fuzzy: false,
        prefix: false,
        combineWith: "OR",
      },
    });
    this.ms.addAll(tools);
    this.catalogHash = newHash;
    return true;
  }

  /**
   * Search the index for tools matching a natural-language query.
   * Returns score-free ranked results up to the requested limit.
   * Results have one-based ranks, exact name, registered description,
   * and active state.
   */
  search(query: string, limit: number): ToolDiscoveryResult[] {
    const results = this.ms.search(query, { fuzzy: false, prefix: false });

    return results.slice(0, limit).map((result, i) => {
      const stored = this.ms.getStoredFields(result.id) as
        | IndexedTool
        | undefined;
      return {
        rank: i + 1,
        name: stored?.name ?? result.id,
        description: stored?.description ?? "",
        active: stored?.active ?? false,
      };
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 digest over sorted eligible tool
 * names, descriptions, and active states. This bounds receipt size
 * while providing deterministic refresh detection.
 */
function computeCatalogHash(tools: IndexedTool[]): string {
  const sorted = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `${t.name}\x00${t.description}\x00${t.active}`)
    .join("\n");

  return createHash("sha256").update(sorted, "utf-8").digest("hex");
}

/**
 * Build tool index from Pi's live tool catalog and active set.
 * Extracts name + description for indexing.
 */
export function buildToolIndex(
  tools: Array<{ name: string; description?: string }>,
  activeNames: readonly string[],
): IndexedTool[] {
  const active = new Set(activeNames);
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    active: active.has(t.name),
  }));
}
