<!-- Last verified: 2026-04-16 -->
# Plugin System

> Claude Code-compatible plugin platform for extending Kosmos agents with MCP servers, skills, hooks, commands, and agents from external packages.

## Overview

The plugin system lets users install third-party extension packages (compatible with the Claude Code plugin format) to add MCP tools, prompt skills, lifecycle hooks, slash commands, and agent templates to any Kosmos agent. Plugins are per-user, globally installed, and selectively enabled per agent.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Plugin Package (on disk)                   │
│  ├─ plugin.json  (manifest)                 │
│  ├─ .mcp.json    (MCP server declarations)  │
│  ├─ skills/      (SKILL.md files)           │
│  ├─ hooks/       (hooks.json)               │
│  ├─ commands/    (*.md slash commands)       │
│  └─ agents/      (*.md agent templates)     │
└──────────────┬──────────────────────────────┘
               │ install (copy to packages/)
               ▼
┌─────────────────────────────────────────────┐
│  PluginManager (singleton, main process)    │
│  ├─ loadAllInstalledPlugins()               │
│  ├─ activatePlugin() ──┬── MCP Bridge       │
│  │                     ├── Skill Bridge      │
│  │                     └── Hook Registry     │
│  ├─ enablePluginForAgent()                  │
│  └─ disablePluginForAgent()                 │
└──────────────┬──────────────────────────────┘
               │ IPC (typed, src/shared/ipc/plugin.ts)
               ▼
┌─────────────────────────────────────────────┐
│  Renderer UI                                │
│  ├─ PluginManagementView (global settings)  │
│  ├─ AgentPluginsTab (per-agent toggles)     │
│  └─ AgentMcpServersTab (plugin badge, disabled toggle) │
└─────────────────────────────────────────────┘
```

## Key Flows

### Installation
1. User selects a plugin directory via dialog (or programmatic path).
2. `PluginManager.installPlugin()` validates manifest, copies to `{userData}/plugins/packages/{name}/`.
3. Writes record to `installed.json`. Calls `activatePlugin()`.

### Activation (global)
`activatePlugin()` runs three bridges in sequence:
1. **MCP Bridge** (`mcpBridge.ts`): Registers plugin MCP servers into `MCPClientManager` with scoped names (`plugin--{id}--{server}`). Handles env var substitution and transport type mapping.
2. **Skill Bridge** (`skillBridge.ts`): Symlinks plugin skill directories into the user's profile skills folder. Registers skill configs in `ProfileCacheManager`.
3. **Hook Registry** (`hookRegistry.ts`): Registers lifecycle hooks (currently `SessionStart`). Hooks run as child processes with timeout, security validation, and `additionalContext` extraction.

### Per-Agent Enable/Disable
- `enablePluginForAgent()`: Adds plugin's MCP server names to `chat.agent.mcp_servers` and plugin ID to `chat.agent.enabled_plugins`.
- `disablePluginForAgent()`: Removes them. Both write directly to profile and trigger frontend refresh.
- Plugin MCP servers in the agent MCP tab show a "Plugin" badge and cannot be individually toggled — they follow the plugin toggle.

### Hook Execution
Hooks run via `child_process.exec()` with:
- Command validation (dangerous pattern blocklist, path checks)
- Timeout enforcement (default 10s)
- Max output buffer (256 KB)
- Environment injection: `CLAUDE_PLUGIN_ROOT`, `OpenKosmos_PLUGIN_ROOT`, etc.
- JSON stdout parsing for `additionalContext` (Claude Code / Copilot CLI / Cursor formats)
- Extracted context injected into system prompt via `AgentChatPromptService.setHookAdditionalContexts()`

## Plugin Manifest Format

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": { "name": "Author" },
  "mcpServers": { "server-name": { "type": "stdio", "command": "node", "args": ["server.js"] } },
  "skills": ["skills/my-skill"],
  "hooks": { "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "..." }] }] }
}
```

## MCP Server Naming Convention
Plugin MCP servers are scoped: `plugin--{plugin.id}--{logicalServerName}`. This prevents name collisions and enables bulk cleanup on uninstall.

## Storage Layout
```
{userData}/
  plugins/
    installed.json          ← plugin registry
    packages/
      {plugin-name}/        ← copied plugin files
  profiles/{alias}/
    skills/{skill-name}/    ← symlinked from plugin
```

## Security Considerations
- Hook commands are validated against a dangerous-pattern blocklist before execution
- Hook processes run with bounded timeout and output limits
- Plugin skill paths are symlinked (not copied) — `lstatSync` guards prevent recursive deletion through junctions
- All hook failures are non-fatal (logged, never block main flow)

## Related
- Depends on: [MCP Runtime](../src/main/lib/mcpRuntime/ai.prompt.md), [Skills](../src/main/lib/skill/ai.prompt.md), [UserDataADO](../src/main/lib/userDataADO/ai.prompt.md)
- IPC contract: [src/shared/ipc/plugin.ts](../src/shared/ipc/plugin.ts)
- Backend: [src/main/lib/plugin/](../src/main/lib/plugin/ai.prompt.md)
- UI: [src/renderer/components/plugin/](../src/renderer/components/plugin/ai.prompt.md)
