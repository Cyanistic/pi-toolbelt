/**
 * Search engine unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchEngine, buildToolIndex } from "../search.js";

const SAMPLE_TOOLS = [
  { name: "read", description: "Read file contents" },
  { name: "bash", description: "Execute bash commands" },
  { name: "edit", description: "Edit files with text replacement" },
  { name: "write", description: "Create or overwrite files" },
  { name: "agent_browser", description: "Browse and interact with websites using a headful browser" },
  { name: "web_search", description: "Search the web for current information" },
  { name: "ask_user_question", description: "Ask the user structured questions" },
  { name: "Agent", description: "Launch autonomous sub-agents for complex multi-step tasks" },
];

const indexed = buildToolIndex(SAMPLE_TOOLS);

describe("buildToolIndex", () => {
  it("maps name + description", () => {
    assert.equal(indexed.length, SAMPLE_TOOLS.length);
    assert.equal(indexed[0].name, "read");
    assert.equal(indexed[0].description, "Read file contents");
  });

  it("handles missing description", () => {
    const result = buildToolIndex([{ name: "foo" }]);
    assert.equal(result[0].description, "");
  });
});

describe("SearchEngine", () => {
  it("builds index and returns catalog hash", () => {
    const engine = new SearchEngine(indexed);
    const hash = engine.getCatalogHash();
    assert.ok(hash.length > 0);
  });

  it("ranks browser-related tools high for 'browse' query", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("browse", 0.6, 5);
    assert.ok(results.length > 0);
    const names = results.map((r) => r.name);
    assert.ok(names.includes("agent_browser"));
  });

  it("filters by threshold — high threshold admits none", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("browser automation", 0.01, 5);
    assert.equal(results.length, 0);
  });

  it("caps results at topK", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("file", 0.8, 2);
    assert.ok(results.length <= 2);
  });

  it("no-match query returns empty", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("zzz_no_match_xyz", 0.8, 5);
    assert.equal(results.length, 0);
  });

  it("refresh detects catalog change", () => {
    const engine = new SearchEngine(indexed);
    assert.equal(engine.refresh(indexed), false);
    const modified = buildToolIndex([
      ...SAMPLE_TOOLS,
      { name: "new_tool", description: "A new tool" },
    ]);
    assert.equal(engine.refresh(modified), true);
  });

  it("refresh detects description change", () => {
    const engine = new SearchEngine(indexed);
    const changed = buildToolIndex(
      SAMPLE_TOOLS.map((t) =>
        t.name === "read" ? { ...t, description: "Changed" } : t,
      ),
    );
    assert.equal(engine.refresh(changed), true);
  });

  it("scores are between 0 and 1", () => {
    const engine = new SearchEngine(indexed);
    const results = engine.search("browser", 1.0, 5);
    for (const r of results) {
      assert.ok(r.score >= 0 && r.score <= 1, `score ${r.score} out of range`);
    }
  });
});
