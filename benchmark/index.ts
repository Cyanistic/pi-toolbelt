/**
 * pi-toolbelt search benchmark. Measures p95 latency. Passes when < 100ms.
 */

import { SearchEngine, buildToolIndex } from "../src/search.js";
import { BACKEND_ID } from "../src/constants.js";
import {
  filterToolRows,
  type ToolManagerRow,
} from "../src/tool-manager.js";

const DESCRIPTIONS = [
  "Read file contents from disk", "Execute bash commands",
  "Edit files with text replacement", "Create or overwrite files",
  "Browse websites with a browser", "Search the web for information",
  "Ask the user structured questions", "Launch autonomous sub-agents",
  "Manage a task list", "Search file contents with patterns",
  "Find files matching a glob", "List directory contents",
  "Fetch content from a URL", "Delete files or directories",
  "Take screenshots of web pages", "Click elements on web pages",
  "Fill form fields on web pages", "Read and parse JSON files",
  "Execute Python code", "Write content to a file",
] as const;

function sampleDescription(index: number): string {
  return DESCRIPTIONS[index % DESCRIPTIONS.length] ?? DESCRIPTIONS[0];
}

const FIXTURE_TOOLS = Array.from({ length: 100 }, (_, i) => ({
  name: `tool_${String(i).padStart(3, "0")}`,
  description: sampleDescription(i),
}));

const QUERIES = [
  "browser automation", "edit files", "search my notes",
  "ask user questions", "run a command", "file operations",
  "web lookup", "delegate to agent", "manage todo list",
  "read file contents",
] as const;

function sampleQuery(index: number): string {
  return QUERIES[index % QUERIES.length] ?? QUERIES[0];
}

const ITERATIONS = 1000;
const P95_INDEX = Math.min(
  Math.ceil(ITERATIONS * 0.95),
  Math.max(0, ITERATIONS - 1),
);

function percentile(sorted: readonly number[], index: number): number {
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

console.log(`pi-toolbelt benchmark — backend: ${BACKEND_ID}`);

const indexed = buildToolIndex(FIXTURE_TOOLS);
const engine = new SearchEngine(indexed);
for (let i = 0; i < 50; i++) engine.search(sampleQuery(i), 0.4, 5);

const latencies: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  engine.search(sampleQuery(i), 0.4, 5);
  latencies.push(performance.now() - t0);
}

latencies.sort((a, b) => a - b);
const p95 = percentile(latencies, P95_INDEX);
console.log(`search p95: ${p95.toFixed(3)} ms - ${p95 < 100 ? "PASS" : "FAIL"}`);
if (p95 >= 100) process.exitCode = 1;

// ── Modal filter benchmark ──────────────────────────────────────

const MODAL_ROWS: ToolManagerRow[] = FIXTURE_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
}));
const FILTERS = [
  "browser",
  "files",
  "web",
  "agent",
  "questions",
  "tool_09",
  "no-match",
] as const;

function sampleFilter(index: number): string {
  return FILTERS[index % FILTERS.length] ?? FILTERS[0];
}

for (let i = 0; i < 50; i++) {
  filterToolRows(MODAL_ROWS, sampleFilter(i));
}

const filterLatencies: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  filterToolRows(MODAL_ROWS, sampleFilter(i));
  filterLatencies.push(performance.now() - t0);
}
filterLatencies.sort((a, b) => a - b);
const filterP95 = percentile(filterLatencies, P95_INDEX);
console.log(
  `modal filter p95: ${filterP95.toFixed(3)} ms - ${
    filterP95 < 100 ? "PASS" : "FAIL"
  }`,
);
if (filterP95 >= 100) process.exitCode = 1;
