# Source Layer Architecture

## Responsibility
Progressive tool discovery for Pi — registers query_tools tool, /toolbelt command, manages session lifecycle. All active-set mutation gated by config validity.

## Dependencies
- **@earendil-works/pi-coding-agent**: Host ExtensionAPI (registerTool, registerCommand, session_start, get/setActiveTools)
- **fuse.js**: Fuzzy search over Pi's tool catalog (wrapped in SearchEngine)

## Consumers
- **Pi host**: Loads entry point via package.json pi.extensions
- **Model**: Calls query_tools to discover and activate tools
- **User**: Runs /toolbelt for setup/status/reset

## Module Structure
```
src/
├── index.ts         # [ENTRY] Default export, registrations, session_start
├── commands.ts      # [CMD] /toolbelt subcommand dispatch
├── config.ts        # [CONFIG] Load/validate/merge (fail-soft)
├── constants.ts     # [CONSTS] Magic strings, defaults (zero deps)
├── search.ts        # [SEARCH] Fuse.js wrapper (SearchEngine)
├── session.ts       # [SESSION] Branch scanning, restore, type guard
├── types.ts         # [TYPES] All interfaces (zero deps)
└── __tests__/       # [TESTS] Unit + integration (node:test)
```

## Extension Registration (Default Export, Closure State, Session Gate)

```typescript
export default function (pi: ExtensionAPI) {
  let searchEngine: SearchEngine | null = null;
  let currentConfig: EffectiveConfig | null = null;
  // Registrations unconditional at module load
  pi.registerFlag(FLAG_DEBUG, { ... });
  pi.registerCommand("toolbelt", { ... });
  pi.registerTool({ name: LOADER_TOOL_NAME, ... });
  // Active-set mutation ONLY inside session_start
  pi.on("session_start", async (event, ctx) => {
    const effective = buildEffectiveConfig(ctx.cwd);
    if (!isEnabled(effective)) return;   // disabled → gate closed
    const isResume = (event as any)?.reason === "resume";
    isResume ? restoreFromBranch(pi, ctx) : applyBaseline(pi, effective);
  });
}
```

## Config Loading (Fail-Soft, Layered Merge)

```typescript
export function readToolbeltConfig(path: string): ConfigSource {
  if (!existsSync(path)) return { path, config: undefined };  // missing ≠ error
  try { parsed = JSON.parse(readFileSync(path, "utf-8")); }
  catch (e) { return { path, error: `Invalid JSON: ...` }; }  // never throws
  return validateConfig(parsed, path);   // lenient, partial OK
}
export function buildEffectiveConfig(cwd: string): EffectiveConfig {
  // DEFAULT_CONFIG → global → project (project arrays REPLACE, not concat)
  return mergeLayers(DEFAULT_CONFIG, readToolbeltConfig(globalPath).config,
    readToolbeltConfig(projectPath).config);
}
export function isEnabled(effective: EffectiveConfig): boolean {
  if (effective.globalError || effective.projectError) return false;  // FR#8
  return effective.source !== "none";
}
```

## Architectural Boundaries
- **NO throwing from config**: readToolbeltConfig always returns ConfigSource
- **NO activation without config**: session_start and query_tools gate on isEnabled
- **NO removing tools**: additive only; /toolbelt reset is sole removal path
- **NO raw fuse.js calls**: always through SearchEngine wrapper
- **NO cross-module circular deps**: constants.ts and types.ts are dependency-free

<important if="you are adding a new tool or command to this layer">

<ol>
<li>Add name constant to <code>constants.ts</code></li>
<li>Register in <code>index.ts</code> via <code>pi.registerTool()</code> or <code>pi.registerCommand()</code></li>
<li>For commands: add handler in <code>commands.ts</code> (guard → confirm → write → apply → report)</li>
<li>For commands: add to <code>COMPS</code> completion tree in <code>index.ts</code></li>
</ol>
</important>

<important if="you are adding a new config field or module to this layer">

<ol>
<li>Add field to <code>ToolbeltConfig</code> in <code>types.ts</code> and default to <code>constants.ts</code></li>
<li>Add validation in <code>validateConfig()</code> in <code>config.ts</code></li>
<li>Add merge logic in <code>buildEffectiveConfig()</code></li>
<li>Wire up in <code>index.ts</code></li>
</ol>
</important>

<important if="you are writing or modifying tests for this layer">

<ul>
<li>Use <code>node:test</code> + <code>node:assert/strict</code> (no external test runner)</li>
<li>Temp dirs with <code>tmpdir()</code> + PID suffix for file-based tests</li>
<li>Mock ExtensionAPI objects typed <code>as any</code></li>
<li>Cross-module pipelines in <code>integration.test.ts</code></li>
</ul>
</important>
