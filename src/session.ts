/** Active-set persistence and session restoration. */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Compile } from "typebox/compile";
import {
  ACTIVE_TOOL_SNAPSHOT_ENTRY,
  ACTIVE_TOOL_SNAPSHOT_VERSION,
} from "./constants.js";
import { ActiveToolSnapshotSchema, DiscoveryReceiptSchema } from "./schemas.js";
import type {
  ActiveToolChange,
  ActiveToolSnapshot,
  DiscoveryReceipt,
} from "./types.js";

// ── Compiled validators (module scope) ───────────────────────────

const activeToolSnapshotValidator = Compile(ActiveToolSnapshotSchema);
const discoveryReceiptValidator = Compile(DiscoveryReceiptSchema);

// ── Registered-tool filtering ────────────────────────────────────

/**
 * Keep requested order, remove duplicates, and enforce Pi's registration
 * boundary. Names absent from getAllTools() are silently removed.
 */
export function filterRegisteredTools(
  pi: Pick<ExtensionAPI, "getAllTools">,
  names: readonly string[],
): string[] {
  const registered = new Set(pi.getAllTools().map((tool) => tool.name));
  return [...new Set(names)].filter((name) => registered.has(name));
}

// ── Persistence-first mutation ──────────────────────────────────

/**
 * Persist the complete final set before replacing Pi's active tools.
 * appendEntry is synchronous; a thrown write aborts before setActiveTools.
 */
export function persistActiveTools(
  pi: ExtensionAPI,
  requested: readonly string[],
): ActiveToolChange {
  const before = pi.getActiveTools();
  const after = filterRegisteredTools(pi, requested);
  const snapshot: ActiveToolSnapshot = {
    version: ACTIVE_TOOL_SNAPSHOT_VERSION,
    active: after,
  };

  pi.appendEntry(ACTIVE_TOOL_SNAPSHOT_ENTRY, snapshot);
  pi.setActiveTools(after);

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    before,
    after,
    added: after.filter((name) => !beforeSet.has(name)),
    removed: before.filter((name) => !afterSet.has(name)),
  };
}

// ── Snapshot presence / restoration ──────────────────────────────

/**
 * Return the newest TypeBox-valid active-tool snapshot on the session
 * branch without filtering or mutating tools. Undefined when none exists.
 */
export function findActiveToolSnapshot(
  ctx: Pick<ExtensionContext, "sessionManager">,
): ActiveToolSnapshot | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry === undefined || entry.type !== "custom") {
      continue;
    }
    if (
      entry.customType !== ACTIVE_TOOL_SNAPSHOT_ENTRY ||
      !isActiveToolSnapshot(entry.data)
    ) {
      continue;
    }
    return entry.data;
  }

  return undefined;
}

/** True when the session branch holds at least one valid snapshot. */
export function hasActiveToolSnapshot(
  ctx: Pick<ExtensionContext, "sessionManager">,
): boolean {
  return findActiveToolSnapshot(ctx) !== undefined;
}

/**
 * Return the newest valid snapshot from the session branch, filtering
 * unregistered names. Returns undefined when no valid snapshot exists.
 */
export function restoreActiveToolSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string[] | undefined {
  const snapshot = findActiveToolSnapshot(ctx);
  if (snapshot === undefined) return undefined;
  return filterRegisteredTools(pi, snapshot.active);
}

// ── Type guards ──────────────────────────────────────────────────

/** Validate a versioned full active-set snapshot. */
export function isActiveToolSnapshot(
  value: unknown,
): value is ActiveToolSnapshot {
  return activeToolSnapshotValidator.Check(value);
}

/** Validate a discovery-only query_tools receipt. */
export function isDiscoveryReceipt(value: unknown): value is DiscoveryReceipt {
  return discoveryReceiptValidator.Check(value);
}
