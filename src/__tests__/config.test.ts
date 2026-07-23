/**
 * Config unit tests.
 *
 * Uses temp directories for file-based tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readToolbeltConfig, isEnabled, hasConfigError } from "../config.js";
import type { EffectiveConfig } from "../types.js";

const tmpBase = join(tmpdir(), `pi-toolbelt-test-${process.pid}`);

function setupTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });
}

function teardownTmp() {
  rmSync(tmpBase, { recursive: true, force: true });
}

// ── readToolbeltConfig ───────────────────────────────────────────

describe("readToolbeltConfig", () => {
  it("returns undefined config for missing file", () => {
    const result = readToolbeltConfig(join(tmpBase, "nonexistent.json"));
    assert.equal(result.config, undefined);
    assert.equal(result.error, undefined);
  });

  it("returns error for invalid JSON", () => {
    setupTmp();
    const p = join(tmpBase, "bad.json");
    writeFileSync(p, "{ not json ", "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("Invalid JSON"));
    teardownTmp();
  });

  it("returns error for non-object", () => {
    setupTmp();
    const p = join(tmpBase, "arr.json");
    writeFileSync(p, "[1,2,3]", "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("does not contain a JSON object"));
    teardownTmp();
  });

  it("returns error for empty object (no recognized fields)", () => {
    setupTmp();
    const p = join(tmpBase, "empty.json");
    writeFileSync(p, "{}", "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("must contain at least one recognized field"));
    teardownTmp();
  });

  it("rejects non-array baseline", () => {
    setupTmp();
    const p = join(tmpBase, "badbaseline.json");
    writeFileSync(p, JSON.stringify({ baseline: "not-array", threshold: 0.4, topK: 5 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("baseline"));
    teardownTmp();
  });

  it("rejects threshold out of range", () => {
    setupTmp();
    const p = join(tmpBase, "badthreshold.json");
    writeFileSync(p, JSON.stringify({ baseline: ["read"], threshold: 1.5, topK: 5 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("threshold"));
    teardownTmp();
  });

  it("rejects non-integer topK", () => {
    setupTmp();
    const p = join(tmpBase, "badtopk.json");
    writeFileSync(p, JSON.stringify({ baseline: ["read"], threshold: 0.4, topK: 1.5 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.equal(result.config, undefined);
    assert.ok(result.error?.includes("topK"));
    teardownTmp();
  });

  it("accepts valid full config", () => {
    setupTmp();
    const p = join(tmpBase, "valid.json");
    writeFileSync(
      p,
      JSON.stringify({ baseline: ["read", "bash"], threshold: 0.3, topK: 10 }),
      "utf-8",
    );
    const result = readToolbeltConfig(p);
    assert.ok(result.config);
    assert.deepEqual(result.config.baseline, ["read", "bash"]);
    assert.equal(result.config.threshold, 0.3);
    assert.equal(result.config.topK, 10);
    assert.equal(result.error, undefined);
    teardownTmp();
  });

  it("accepts partial config (threshold only)", () => {
    setupTmp();
    const p = join(tmpBase, "partial.json");
    writeFileSync(p, JSON.stringify({ threshold: 0.2 }), "utf-8");
    const result = readToolbeltConfig(p);
    assert.ok(result.config);
    assert.equal(result.config.threshold, 0.2);
    assert.equal(result.config.baseline, undefined);
    assert.equal(result.config.topK, undefined);
    assert.equal(result.error, undefined);
    teardownTmp();
  });
});

// ── isEnabled / hasConfigError ──────────────────────────────────

describe("isEnabled", () => {
  const base: EffectiveConfig = {
    baseline: ["read"],
    threshold: 0.4,
    topK: 5,
    source: "global",
    globalPath: "/tmp/a.json",
    projectPath: "/tmp/b.json",
    globalValid: true,
    projectValid: false,
  };

  it("returns true when source is 'global' with no errors", () => {
    assert.equal(isEnabled(base), true);
  });

  it("returns false when source is 'none'", () => {
    assert.equal(isEnabled({ ...base, source: "none" }), false);
  });

  it("returns false when any source has an error (FR#8)", () => {
    assert.equal(
      isEnabled({ ...base, globalError: "bad json" }),
      false,
    );
  });
});

describe("hasConfigError", () => {
  const base: EffectiveConfig = {
    baseline: ["read"],
    threshold: 0.4,
    topK: 5,
    source: "global",
    globalPath: "/tmp/a.json",
    projectPath: "/tmp/b.json",
    globalValid: true,
    projectValid: false,
  };

  it("returns false when no errors", () => {
    assert.equal(hasConfigError(base), false);
  });

  it("returns true when global has error", () => {
    assert.equal(hasConfigError({ ...base, globalError: "bad" }), true);
  });

  it("returns true when project has error", () => {
    assert.equal(hasConfigError({ ...base, projectError: "bad" }), true);
  });

  it("returns true even when source is 'none' (warn on all errors)", () => {
    assert.equal(
      hasConfigError({ ...base, source: "none", globalError: "bad" }),
      true,
    );
  });
});
