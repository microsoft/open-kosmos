<!-- Last verified: 2026-04-16 -->
# Plugin Backend (`src/main/lib/plugin/`)

> Core plugin lifecycle management — loading, validation, installation, activation, bridge coordination, and per-agent toggling.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `pluginManager.ts` | `PluginManager` singleton — full lifecycle owner: load, install, uninstall, activate, deactivate, enable/disable per agent, restart | medium |
| `pluginLoader.ts` | Discovers and parses plugin packages: manifest reading, `.mcp.json` loading, hooks.json parsing, commands/agents markdown scanning, `installed.json` persistence | medium |
| `pluginValidator.ts` | Validates manifest fields, directory structure, skill paths, MCP config schemas | small |
| `pluginDirectories.ts` | Resolves `{userData}/plugins/` paths: `getPluginDir()`, `getPluginPackagesDir()`, `ensurePluginDirectories()` | tiny |
| `types.ts` | All TypeScript interfaces: `OpenKosmosPluginManifest`, `LoadedPlugin`, `PluginInstallRecord`, `HookCommand`, etc. | small |
| `bridges/mcpBridge.ts` | MCP Bridge — `injectPluginMcpServers()` / `removePluginMcpServers()`. Handles scoped naming (`plugin--{id}--{name}`), transport type mapping, env var substitution | small |
| `bridges/skillBridge.ts` | Skill Bridge — `injectPluginSkills()` / `removePluginSkills()`. Creates symlinks from plugin skill dirs to profile skills folder | small |
| `hooks/hookRegistry.ts` | `HookRegistry` singleton — registers and executes plugin lifecycle hooks as child processes with security validation, timeout, and JSON output parsing | medium |
| `hooks/hookTypes.ts` | TypeScript interfaces for hook execution: `HookContext`, `HookCommandResult`, `HookExecutionResult`, `HookJsonOutput` | tiny |

## Architecture

```
PluginManager.initialize()
  │
  ├─ ensurePluginDirectories()
  ├─ loadAllInstalledPlugins()    → reads installed.json + each plugin dir
  │
  └─ for each enabled plugin:
       activatePlugin()
         ├─ injectPluginMcpServers()  → MCPClientManager.add()
         ├─ injectPluginSkills()      → symlink + ProfileCacheManager
         └─ hookRegistry.registerPluginHooks()
```

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add new bridge type (e.g. command bridge) | New file in `bridges/`, wire in `pluginManager.ts` activate/deactivate | Follow MCP/Skill bridge pattern |
| Add new hook event (e.g. `PreToolCall`) | `types.ts` (`HookEvent` union), `hookRegistry.ts`, caller site | Extend `HookContext` if new context needed |
| Change plugin storage path | `pluginDirectories.ts` | Update `profileSanitizer.ts` if fields change |
| Add manifest field | `types.ts` (`OpenKosmosPluginManifest`), `pluginValidator.ts`, `pluginLoader.ts` | |

## Gotchas
- ⚠️ `MCPClientManager.add()` throws `"Server already exists"` on re-activation — `mcpBridge.ts` catches this and treats as success.
- ⚠️ Plugin MCP server names are scoped (`plugin--{id}--{name}`) — never use raw server names from manifest.
- ⚠️ Skill symlinks (junctions on Windows) must be removed with `unlinkSync`, not `rmSync({ recursive: true })`.
- ⚠️ `profileSanitizer.ts` is the schema gatekeeper — new profile fields (like `enabled_plugins`) must be allow-listed there or they get stripped.
- ⚠️ Hook execution uses `child_process.exec()` — commands are validated against a dangerous-pattern blocklist first.

## Related
- Depends on: [MCP Runtime](../mcpRuntime/ai.prompt.md), [Skills](../skill/ai.prompt.md), [UserDataADO](../userDataADO/ai.prompt.md)
- Depended by: [Plugin IPC](../../startup/ipc/plugin.ts), [Plugin UI](../../../renderer/components/plugin/ai.prompt.md)
- IPC contract: [src/shared/ipc/plugin.ts](../../../shared/ipc/plugin.ts)
