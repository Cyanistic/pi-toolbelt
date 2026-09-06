/**
 * Layered baseline resolution and catalog-dependent application.
 *
 * Configuration resolution stays catalog-free. Startup and reset consume the
 * resolved policy plus the current registered/active names.
 */

import type { BaselineConfig } from "./schemas.js";
import type { ResolvedBaseline } from "./types.js";

export interface BaselineLayer {
  readonly label: string;
  readonly value?: BaselineConfig;
}

export function uniquePreserveOrder(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  return unique;
}

export function isBaselineModify(
  value: BaselineConfig,
): value is Extract<BaselineConfig, { type: "modify" }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function overlappingModifyNames(
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const removeSet = new Set(remove);
  return uniquePreserveOrder(add.filter((name) => removeSet.has(name)));
}

function formatNameList(names: readonly string[]): string {
  if (names.length === 0) return "(none)";
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

export function formatModifyLists(
  add: readonly string[],
  remove: readonly string[],
): string {
  const parts: string[] = [];
  if (add.length > 0) parts.push(`add ${formatNameList(add)}`);
  if (remove.length > 0) parts.push(`remove ${formatNameList(remove)}`);
  return parts.length > 0 ? parts.join(", ") : "(empty)";
}

export function formatResolvedBaseline(baseline: ResolvedBaseline): string {
  if (baseline.kind === "exact") {
    return baseline.tools.length === 0
      ? "exact (none)"
      : `exact ${formatNameList(baseline.tools)}`;
  }
  if (baseline.add.length === 0 && baseline.remove.length === 0) {
    return "unrestricted";
  }
  return `unrestricted (${formatModifyLists(baseline.add, baseline.remove)})`;
}

export function formatBaselineTrace(baseline: ResolvedBaseline): string {
  return baseline.trace
    .map((step) => `${step.scope}: ${step.summary}`)
    .join(" → ");
}

export function resolvedPolicyEqual(
  left: ResolvedBaseline,
  right: ResolvedBaseline,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "exact" && right.kind === "exact") {
    return sameStringList(left.tools, right.tools);
  }
  if (left.kind === "unrestricted" && right.kind === "unrestricted") {
    return (
      sameStringList(left.add, right.add) &&
      sameStringList(left.remove, right.remove)
    );
  }
  return false;
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameMembership(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((name) => rightSet.has(name));
}

function modifyLists(value: Extract<BaselineConfig, { type: "modify" }>): {
  add: string[];
  remove: string[];
} {
  return {
    add: uniquePreserveOrder(value.add ?? []),
    remove: uniquePreserveOrder(value.remove ?? []),
  };
}

function modifySummary(
  add: readonly string[],
  remove: readonly string[],
): string {
  return formatModifyLists(add, remove);
}

function exactSummary(tools: readonly string[]): string {
  return tools.length === 0
    ? "exact (none) (replaced)"
    : `exact ${formatNameList(tools)} (replaced)`;
}

function applyModifyExact(
  tools: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const removeSet = new Set(remove);
  const remaining = tools.filter((name) => !removeSet.has(name));
  return uniquePreserveOrder([...remaining, ...add]);
}

function applyModifyUnrestricted(
  inheritedAdd: readonly string[],
  inheritedRemove: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): { add: string[]; remove: string[] } {
  let nextAdd = inheritedAdd.filter((name) => !remove.includes(name));
  let nextRemove = uniquePreserveOrder([...inheritedRemove, ...remove]);
  nextRemove = nextRemove.filter((name) => !add.includes(name));
  nextAdd = uniquePreserveOrder([...nextAdd, ...add]);
  return { add: nextAdd, remove: nextRemove };
}

/**
 * Fold named layers over the unrestricted Default state.
 * Omitted layers do not contribute a trace step.
 */
export function resolveBaselineLayers(
  layers: readonly BaselineLayer[],
): ResolvedBaseline {
  let state: ResolvedBaseline = {
    kind: "unrestricted",
    add: [],
    remove: [],
    trace: [{ scope: "Default", summary: "unrestricted" }],
  };

  for (const layer of layers) {
    if (layer.value === undefined) continue;

    if (layer.value === null) {
      state = {
        kind: "unrestricted",
        add: [],
        remove: [],
        trace: [
          ...state.trace,
          { scope: layer.label, summary: "unrestricted (replaced)" },
        ],
      };
      continue;
    }

    if (Array.isArray(layer.value)) {
      const tools = uniquePreserveOrder(layer.value);
      state = {
        kind: "exact",
        tools,
        trace: [
          ...state.trace,
          { scope: layer.label, summary: exactSummary(tools) },
        ],
      };
      continue;
    }

    const { add, remove } = modifyLists(layer.value);
    const summary = modifySummary(add, remove);
    if (state.kind === "exact") {
      state = {
        kind: "exact",
        tools: applyModifyExact(state.tools, add, remove),
        trace: [...state.trace, { scope: layer.label, summary }],
      };
      continue;
    }

    const next = applyModifyUnrestricted(state.add, state.remove, add, remove);
    state = {
      kind: "unrestricted",
      add: next.add,
      remove: next.remove,
      trace: [...state.trace, { scope: layer.label, summary }],
    };
  }

  return state;
}

/**
 * Startup target. `undefined` means do not call `setActiveTools`.
 * Exact policy always returns the registered subset (possibly empty).
 * Unmodified unrestricted returns undefined. Modified unrestricted returns
 * current membership with named additions/removals applied, or undefined
 * when membership is already equal.
 */
export function computeStartupActiveTools(
  policy: ResolvedBaseline,
  registeredNames: readonly string[],
  currentActive: readonly string[],
): string[] | undefined {
  const registered = new Set(registeredNames);

  if (policy.kind === "exact") {
    return uniquePreserveOrder(policy.tools).filter((name) =>
      registered.has(name),
    );
  }

  if (policy.add.length === 0 && policy.remove.length === 0) {
    return undefined;
  }

  const active = new Set(currentActive.filter((name) => registered.has(name)));
  for (const name of policy.add) {
    if (registered.has(name)) active.add(name);
  }
  for (const name of policy.remove) {
    active.delete(name);
  }

  const next: string[] = [];
  for (const name of currentActive) {
    if (active.has(name) && !next.includes(name)) next.push(name);
  }
  for (const name of policy.add) {
    if (active.has(name) && !next.includes(name)) next.push(name);
  }

  if (
    sameMembership(
      currentActive.filter((name) => registered.has(name)),
      next,
    )
  ) {
    return undefined;
  }
  return next;
}

/** Reset target: exact subset, or every registered name except final removals. */
export function computeResetTarget(
  policy: ResolvedBaseline,
  registeredNames: readonly string[],
): string[] {
  const registered = new Set(registeredNames);
  if (policy.kind === "exact") {
    return uniquePreserveOrder(policy.tools).filter((name) =>
      registered.has(name),
    );
  }
  const remove = new Set(policy.remove);
  return registeredNames.filter((name) => !remove.has(name));
}
