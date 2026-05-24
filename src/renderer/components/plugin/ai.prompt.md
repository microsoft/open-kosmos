<!-- Last verified: 2026-04-24 -->
# Plugin UI (`src/renderer/components/plugin/`)

> React components for plugin management — global settings view with install/uninstall/enable/disable and per-agent plugin toggling in the agent editor.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `PluginManagementView.tsx` | Global plugin settings page: lists all installed plugins, install/uninstall buttons, enable/disable/restart controls, detail panel | medium |
| `PluginHeaderView.tsx` | Header bar for the plugin settings page: title + "Install Plugin" button | tiny |
| `PluginContentView.tsx` | Detail panel for a selected plugin: shows manifest info (version, author, description), MCP servers, skills, hooks, and action buttons (enable/disable, restart, uninstall) | small |

## Related Agent Editor Components
| File | Location | Responsibility |
|------|----------|---------------|
| `AgentPluginsTab.tsx` | `src/renderer/components/chat/agent-editor/` | Per-agent plugin toggle checkboxes with gear icon linking to global plugin settings |
| `AgentMcpServersTab.tsx` | `src/renderer/components/chat/agent-editor/` | Shows plugin MCP servers with "Plugin" badge; plugin servers are non-interactive (follow plugin toggle) |

## Architecture

```
Settings Page                          Agent Editor
┌──────────────────────┐     ┌─────────────────────────┐
│ PluginManagementView │     │ AgentChatEditingView     │
│ ├─ PluginHeaderView  │     │ ├─ AgentPluginsTab       │
│ └─ PluginContentView │     │ └─ AgentMcpServersTab    │
└──────────┬───────────┘     └────────────┬────────────┘
           │                              │
           └──────── pluginApi ───────────┘
                        │
              src/renderer/ipc/plugin.ts
              (typed IPC via shared/ipc/plugin.ts)
```

## Data Flow
1. Components call `pluginApi.*` (typed IPC binding from `src/renderer/ipc/plugin.ts`)
2. IPC routes through `src/shared/ipc/plugin.ts` contract → `src/main/startup/ipc/plugin.ts` handler
3. Handler delegates to `PluginManager` singleton
4. After mutation, `profileCacheManager.refresh()` is called → triggers `profile:cacheUpdated` IPC → React state updates

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add new plugin action (e.g. update) | `PluginContentView.tsx` (button), `PluginManagementView.tsx` (handler), `src/shared/ipc/plugin.ts` (contract), `src/main/startup/ipc/plugin.ts` (handler), `src/preload/plugin/invoke.ts` (whitelist) | Follow existing install/uninstall pattern |
| Show new plugin metadata | `PluginContentView.tsx` | Data comes from `LoadedPlugin` via IPC |
| Change plugin badge in MCP tab | `AgentMcpServersTab.tsx` | Look for `PLUGIN_MCP_PREFIX` detection logic |

## Gotchas
- ⚠️ Plugin MCP servers in `AgentMcpServersTab` are identified by the `plugin--` prefix and rendered with a disabled checkbox + "Plugin" badge.
- ⚠️ `AgentPluginsTab` toggle writes directly to backend (no pending-changes / save flow) — changes are immediate.
- ⚠️ After plugin toggle, `AgentChatEditingView` detects `enabledPlugins` change via `useRef` + `useEffect` and bumps `tabResetKey` to force MCP/Skills tabs to re-mount with fresh data.
- ⚠️ `PluginContentView` has a search filter (`ListSearchBox`) that filters the plugin list. When the filtered list changes, a `useEffect` auto-selects the first matching item, or deselects (`onSelectPlugin(null)`) when zero results match. This keeps the detail panel in sync with the visible list.
- ⚠️ `AgentPluginsTab` also has a search filter. Its search query is persisted at module level in a `Map<string, string>` keyed by `agentId` to survive parent remounts caused by plugin toggle → `refresh()`. The persistence is scoped per-agent so switching agents does not leak stale filters.

## Related
- Backend: [src/main/lib/plugin/](../../main/lib/plugin/ai.prompt.md)
- IPC contract: [src/shared/ipc/plugin.ts](../../shared/ipc/plugin.ts)
- Styles: `src/renderer/styles/PluginContentView.css`
