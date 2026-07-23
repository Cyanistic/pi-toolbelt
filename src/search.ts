/**
 * Search engine wrapping fuse.js for local tool discovery.
 *
 * Builds an in-memory index from pi.getAllTools() on construction,
 * supports re-indexing (refresh) with catalog hash check to skip
 * rebuilds when the catalog hasn't changed. The Fuse instance runs
 * with internal threshold 1.0 (returns all candidates); the
 * configured threshold is applied as a post-filter so that high
 * thresholds (e.g. 0.8) still get all candidates scored.
 *
 * Hash covers name + description so description-only changes
 * trigger a rebuild.
 */

import Fuse from "fuse.js";
import { FUSE_OPTIONS, SEARCH_KEYS } from "./constants.js";
import type { SearchBackend, ToolRanking } from "./types.js";

// ── Minimal tool descriptor ──────────────────────────────────────

export interface IndexedTool {
  name: string;
  description: string;
}

// ── SearchEngine ─────────────────────────────────────────────────

export class SearchEngine implements SearchBackend {
  private fuse: Fuse<IndexedTool>;
  private catalogHash: string;

  constructor(tools: IndexedTool[]) {
    this.fuse = new Fuse(tools, {
      ...FUSE_OPTIONS,
      keys: [...SEARCH_KEYS],
      threshold: 1.0, // return all candidates; post-filter by configured threshold
    });
    this.catalogHash = computeCatalogHash(tools);
  }

  /** Current catalog hash for receipt + change detection. */
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
    this.fuse = new Fuse(tools, {
      ...FUSE_OPTIONS,
      keys: [...SEARCH_KEYS],
      threshold: 1.0,
    });
    this.catalogHash = newHash;
    return true;
  }

  /**
   * Search the index for tools matching a natural-language query.
   * Returns ranked results with fuse.js scores (0 = perfect, 1 = no match),
   * post-filtered by the configured threshold and capped at topK.
   */
  search(
    query: string,
    threshold: number,
    topK: number,
  ): ToolRanking[] {
    // Fuse is initialized with threshold 1.0, so we get all candidates.
    // Post-filter by the configured threshold.
    const results = this.fuse.search(query, { limit: topK * 3 }); // generous pre-filter
    return results
      .filter((r) => {
        const score = r.score ?? 1;
        return score <= threshold;
      })
      .slice(0, topK)
      .map((r) => ({
        name: r.item.name,
        score: r.score ?? 1,
      }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function computeCatalogHash(tools: IndexedTool[]): string {
  // Hash name + description so description-only changes invalidate index.
  const pairs = tools.map((t) => `${t.name}::${t.description}`).sort().join("|");
  return pairs;
}

/**
 * Build tool index from Pi's live tool catalog.
 * Extracts name + description for indexing — descriptions are the
 * primary search surface since model queries use task vocabulary.
 */
export function buildToolIndex(
  tools: Array<{ name: string; description?: string }>,
): IndexedTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
  }));
}
