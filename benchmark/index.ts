/**
 * pi-toolbelt search benchmark. Measures p95 latency. Passes when < 100ms.
 */

import { SearchEngine, buildToolIndex } from "../src/search.js";
import { BACKEND_ID } from "../src/constants.js";

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
];

const FIXTURE_TOOLS = Array.from({ length: 100 }, (_, i) => ({
  name: `tool_${String(i).padStart(3, "0")}`,
  description: DESCRIPTIONS[i % DESCRIPTIONS.length],
}));

const QUERIES = [
  "browser automation", "edit files", "search my notes",
  "ask user questions", "run a command", "file operations",
  "web lookup", "delegate to agent", "manage todo list",
  "read file contents",
];

const ITERATIONS = 1000;
const P95_INDEX = Math.ceil(ITERATIONS * 0.95);

console.log(`pi-toolbelt benchmark — backend: ${BACKEND_ID}`);

const indexed = buildToolIndex(FIXTURE_TOOLS);
const engine = new SearchEngine(indexed);
for (let i = 0; i < 50; i++) engine.search(QUERIES[i % QUERIES.length], 0.4, 5);

const latencies: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  engine.search(QUERIES[i % QUERIES.length], 0.4, 5);
  latencies.push(performance.now() - t0);
}

latencies.sort((a, b) => a - b);
const p95 = latencies[P95_INDEX];
console.log(`p95: ${p95.toFixed(3)} ms — ${p95 < 100 ? "PASS" : "FAIL"}`);
if (p95 >= 100) process.exit(1);
