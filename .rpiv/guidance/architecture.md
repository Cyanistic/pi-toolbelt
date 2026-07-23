# Project Overview

Pi extension for progressive tool discovery. TypeScript/ESM single-package extension loaded by `@earendil-works/pi-coding-agent` host.

## Project Map

```
pi-toolbelt/
├── package.json           # pi.extensions: ["./src/index.ts"]
├── tsconfig.json          # NodeNext/noEmit — source runs via tsx
├── src/                   # Core extension — see .rpiv/guidance/src/architecture.md
├── benchmark/             # Search performance benchmarking
└── .rpiv/                 # Design/planning artifacts
```

## Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | tsc --noEmit |
| `npm test` | Run all tests via node:test + tsx |
| `npm run benchmark` | Run search benchmarks |

<important if="you are adding or modifying Pi extension configuration">

<ul>
<li>Entry point registered in <code>package.json#pi.extensions</code> as <code>"./src/index.ts"</code></li>
<li>Config (<code>toolbelt.json</code>) read from global (<code>~/.pi/agent/</code>) and project (<code>.pi/</code>) — see <code>.rpiv/guidance/src/architecture.md</code> for layering rules</li>
</ul>
</important>

<important if="you are adding or modifying the TypeScript build configuration">

<ul>
<li><code>module: NodeNext</code> + <code>moduleResolution: NodeNext</code> — mandatory for Pi extensions</li>
<li><code>noEmit: true</code> — Pi runs source directly via tsx; no compile step</li>
<li>All relative imports must use <code>.js</code> extension (ESM/NodeNext convention)</li>
</ul>
</important>
