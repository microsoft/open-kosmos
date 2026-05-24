# PRD: Skill / MCP / Agent Built-in Tools Refactoring

<!-- Last verified: 2026-05-12 -->

## 1. Background & Problem Statement

OpenKosmos AI Studio exposes 18 built-in tools for managing Skills, MCP Servers, and Agents. The current design has critical issues that cause frequent AI tool-call failures:

### 1.1 Pain Points

| # | Pain Point | Severity | Affected Tools |
|---|---|---|---|
| 1 | **Tool count too high (18)** — AI has high probability of selecting wrong tool | Critical | All |
| 2 | **AI must construct full nested config from scratch** — `mcp_config: { ... }` wrapper, deeply nested `context_enhancement` | Critical | `create_mcp_server_from_config`, `create_agent_from_config`, `update_agent` |
| 3 | **Create vs Update interface inconsistency** — agent create uses flat params, update wraps in `agent_config` | High | `create_agent_from_config` vs `update_agent` |
| 4 | **Invisible conditional required fields** — `command` (stdio), `url` (sse) only enforced at runtime | High | `create_mcp_server_from_config`, `update_mcp_server` |
| 5 | **Source/version state machine hidden in code** — 5-case transition logic invisible to AI | Critical | `update_mcp_server`, `update_agent` |
| 6 | **Inconsistent naming** — `name` vs `mcp_name` vs `agent_name` | Medium | `set_mcp_connection_state` vs `get_mcp_status` |
| 7 | **Dual knowledgeBase paths** — `knowledgeBase` and `knowledge.knowledgeBase` coexist | Medium | `update_agent` |
| 8 | **Merge vs replace semantics invisible** — IN-LIBRARY merges, ON-DEVICE replaces | Medium | `update_agent` |

### 1.2 Current Tool Inventory (18 tools)

**Skills (4):** `search_skills`, `apply_skill_to_agents`, `uninstall_skills`, `remove_skills_from_agents`

**MCP (3):** `create_mcp_server_from_config`, `update_mcp_server`, `get_mcp_status`, `set_mcp_connection_state`

**Agent (8):** `create_agent_from_config`, `update_agent`, `get_agent_status`, `list_agents`, `set_primary_agent`, `spawn_subagent`, `spawn_subagents`, `coding_agent`

---

## 2. Design Principles

```
┌─────────────────────────────────────────────────────────────┐
│  AI should NOT be a config editor.                          │
│  AI should express INTENT; the system generates config.     │
└─────────────────────────────────────────────────────────────┘
```

1. **Search → Pick → Tweak**: Search/browse templates, reference by name, only override diffs
2. **Flat params over nested objects**: AI passes `model: "gpt-4o"` not `{ agent_config: { model: "gpt-4o" } }`
3. **Intent-based tools over CRUD tools**: Merge related operations into one tool with `action` enum
4. **System manages internal state**: `source`, `version`, `remoteVersion` are internal — never exposed to AI

---

## 3. Target Tool Design

### 3.1 Tool Count Reduction: 18 → 9

```
┌──────────────────────────────────────────────────────────────────┐
│                     BEFORE (18 tools)                             │
├──────────────────┬──────────────────┬────────────────────────────┤
│  Skill (4)       │  MCP (5)         │  Agent (9)                 │
│  search          │  get_template    │  get_template              │
│  apply           │  create_from_cfg │  create_from_config        │
│  uninstall       │  update          │  update                    │
│  remove_from_agt │  get_status      │  get_status                │
│                  │  set_conn_state  │  list                      │
│                  │                  │  set_primary               │
│                  │                  │  spawn_subagent            │
│                  │                  │  spawn_subagents           │
│                  │                  │  coding_agent              │
└──────────────────┴──────────────────┴────────────────────────────┘

                              ▼

┌──────────────────────────────────────────────────────────────────┐
│                     AFTER (9 tools)                               │
├──────────────────┬──────────────────┬────────────────────────────┤
│  Skill (2)       │  MCP (2)         │  Agent (2 + 3 runtime)     │
│  manage_skills   │  manage_mcp      │  manage_agents             │
│  search_skills   │  search_mcp      │  search_agents             │
│                  │                  │  spawn_subagent  (kept)    │
│                  │                  │  spawn_subagents (kept)    │
│                  │                  │  coding_agent    (kept)    │
└──────────────────┴──────────────────┴────────────────────────────┘
```

> `spawn_subagent`, `spawn_subagents`, `coding_agent` are **runtime orchestration tools**, not config management. They remain independent.

### 3.2 `manage_skills`

**Merges:** `apply_skill_to_agents` + `uninstall_skills` + `remove_skills_from_agents`

```jsonc
{
  "name": "manage_skills",
  "description": "Install, uninstall, bind, or unbind skills. Use 'install' to download a skill to the device, 'bind' to attach an installed skill to agents, 'unbind' to detach without uninstalling, 'uninstall' to remove from device.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["install", "uninstall", "bind", "unbind"],
        "description": "install=download to device; uninstall=remove from device; bind=attach to agent(s); unbind=detach from agent(s)"
      },
      "skill_names": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Target skill name(s)"
      },
      "source": {
        "type": "string",
        "enum": ["library", "device", "clawhub", "github"],
        "description": "Install source (only for action=install, default=library)"
      },
      "path": {
        "type": "string",
        "description": "Local absolute path to skill artifact (required when source=device)"
      },
      "agent_names": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Target agent(s) for bind/unbind. Omit = current agent in active chat."
      },
      "all_agents": {
        "type": "boolean",
        "description": "Apply bind/unbind to all agents in profile"
      }
    },
    "required": ["action", "skill_names"]
  }
}
```

### 3.3 `search_skills` — Unchanged

Existing interface is already simple and effective. No changes needed.

### 3.4 `manage_mcp`

**Merges:** `create_mcp_server_from_config` + `update_mcp_server` + `set_mcp_connection_state` + `get_mcp_status`

```jsonc
{
  "name": "manage_mcp",
  "description": "Add, update, remove, connect, disconnect, reconnect, or check status of MCP servers. Use 'from_library: true' to auto-fetch config from MCP Library — only env overrides needed.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add", "update", "remove", "connect", "disconnect", "reconnect", "status"],
        "description": "The operation to perform"
      },
      "name": {
        "type": "string",
        "description": "MCP server name (unique identifier)"
      },
      "transport": {
        "type": "string",
        "enum": ["stdio", "sse", "StreamableHttp"],
        "description": "Transport type (required for action=add when from_library=false)"
      },
      "command": {
        "type": "string",
        "description": "Command to execute (required when transport=stdio)"
      },
      "args": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Command line arguments (for stdio transport)"
      },
      "env": {
        "type": "object",
        "additionalProperties": { "type": "string" },
        "description": "Environment variables. For from_library=true, these override library defaults."
      },
      "url": {
        "type": "string",
        "description": "Server URL (required when transport=sse or StreamableHttp)"
      },
      "from_library": {
        "type": "boolean",
        "description": "true = auto-fetch config from MCP Library by name; only env overrides needed"
      }
    },
    "required": ["action", "name"]
  }
}
```

**Key behaviors:**
- `from_library: true` → system fetches library template, merges provided `env`, sets `source=IN-LIBRARY` and version automatically
- `from_library: false/omitted` → system sets `source=ON-DEVICE`, auto-increments version
- `action=update` → system handles version state machine internally (no AI involvement)
- `source`, `version`, `remoteVersion` fields are **never exposed** to AI

### 3.5 `search_mcp`

**Merges:** `get_mcp_template_from_library` (lookup) + `get_mcp_status` (list/query)

```jsonc
{
  "name": "search_mcp",
  "description": "Search MCP library for available servers, or list installed servers with their connection status.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search MCP library by name or keyword. Returns matching templates with config details."
      },
      "installed": {
        "type": "boolean",
        "description": "true = list all installed MCP servers with their current connection status"
      }
    }
  }
}
```

### 3.6 `manage_agents`

**Merges:** `create_agent_from_config` + `update_agent` + `get_agent_status` + `list_agents` + `set_primary_agent`

```jsonc
{
  "name": "manage_agents",
  "description": "Create, update, remove, list, set_primary, or check status of agents. Use 'from_library: true' with a library agent name to auto-fetch base config.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["create", "update", "remove", "list", "set_primary", "status"],
        "description": "The operation to perform"
      },
      "name": {
        "type": "string",
        "description": "Agent name (required for all actions except 'list')"
      },
      "emoji": {
        "type": "string",
        "description": "Emoji icon for the agent (default: robot emoji)"
      },
      "role": {
        "type": "string",
        "description": "Role description (default: Assistant)"
      },
      "model": {
        "type": "string",
        "description": "AI model identifier (uses system default if omitted)"
      },
      "system_prompt": {
        "type": "string",
        "description": "Custom system prompt for the agent"
      },
      "workspace": {
        "type": "string",
        "description": "Workspace directory path"
      },
      "knowledge_base": {
        "type": "string",
        "description": "Knowledge base directory path"
      },
      "mcp_servers": {
        "type": "array",
        "items": { "type": "string" },
        "description": "MCP server names to bind (all tools enabled by default)"
      },
      "mcp_tool_filter": {
        "type": "object",
        "additionalProperties": {
          "type": "array",
          "items": { "type": "string" }
        },
        "description": "Optional fine-grained tool filter: { server_name: [tool1, tool2] }. Only needed when limiting specific tools."
      },
      "skills": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Skill names to attach to this agent"
      },
      "memory_enabled": {
        "type": "boolean",
        "description": "Enable/disable memory (search + generation). Default: true."
      },
      "from_library": {
        "type": "boolean",
        "description": "true = fetch base config from Agent Library by name, then apply overrides"
      },
      "greeting": {
        "type": "string",
        "description": "Welcome message shown when chat starts"
      },
      "quick_starts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "description": { "type": "string" },
            "prompt": { "type": "string" }
          },
          "required": ["title", "description", "prompt"]
        },
        "description": "Quick start cards for the chat zero state"
      }
    },
    "required": ["action"]
  }
}
```

**Key behaviors:**
- `action=list` → no other params needed, returns all agent names
- `action=create` with `from_library: true` → fetches library template, applies provided overrides
- `mcp_servers: ["name"]` → internally converted to `[{name, tools:[]}]`
- `mcp_tool_filter: {server: [tools]}` → merged into `mcp_servers` objects
- `memory_enabled: true/false` → internally converted to full `context_enhancement` structure
- `knowledge_base` → unified single field (replaces dual `knowledgeBase` / `knowledge.knowledgeBase`)
- `source`, `version`, `remoteVersion` → managed by system, never exposed

### 3.7 `search_agents`

**Merges:** `get_agent_template_from_library` + `list_agents`

```jsonc
{
  "name": "search_agents",
  "description": "Search agent library for available agent templates, or list installed agents.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search agent library by name or keyword"
      },
      "installed": {
        "type": "boolean",
        "description": "true = list all installed/configured agents"
      }
    }
  }
}
```

---

## 4. Before / After Comparison

### Scenario 1: "Add a GitHub MCP server with my token"

**Before (2 tool calls, nested config):**
```json
// Call 1: Lookup template
{ "tool": "get_mcp_template_from_library", "input": { "mcp_name": "github" } }
// Call 2: Construct full config
{ "tool": "create_mcp_server_from_config", "input": {
    "mcp_config": {
      "name": "github", "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" },
      "source": "IN-LIBRARY", "version": "1.0.0", "remoteVersion": "1.0.0"
    }
  }
}
```

**After (1 tool call, flat params):**
```json
{ "tool": "manage_mcp", "input": {
    "action": "add", "name": "github", "from_library": true,
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" }
  }
}
```

### Scenario 2: "Create a Research Agent with gpt-4o, bind bing and github"

**Before (deep nesting):**
```json
{ "tool": "create_agent_from_config", "input": {
    "name": "Research Agent", "role": "Research Assistant", "model": "gpt-4o",
    "mcp_servers": [
      { "name": "bing-web-search", "tools": [] },
      { "name": "github", "tools": [] }
    ],
    "context_enhancement": {
      "search_memory": { "enabled": true, "semantic_similarity_threshold": 0.7, "semantic_top_n": 5 },
      "generate_memory": { "enabled": true }
    },
    "source": "ON-DEVICE", "version": "1.0.0"
  }
}
```

**After (flat, minimal):**
```json
{ "tool": "manage_agents", "input": {
    "action": "create", "name": "Research Agent", "role": "Research Assistant",
    "model": "gpt-4o", "mcp_servers": ["bing-web-search", "github"]
  }
}
```

### Scenario 3: "Disconnect the filesystem MCP server"

**Before:**
```json
{ "tool": "set_mcp_connection_state", "input": { "name": "filesystem", "action": "disconnect" } }
```

**After:**
```json
{ "tool": "manage_mcp", "input": { "action": "disconnect", "name": "filesystem" } }
```

---

## 5. Migration & Backward Compatibility

### 5.1 Three-Phase Rollout

| Phase | Description | Duration | Risk |
|---|---|---|---|
| **Phase 1: Facade Layer** | New tools registered alongside old ones. New tools delegate to existing implementations. Old tools marked `@deprecated` but still functional. | 1 sprint | Zero — additive only |
| **Phase 2: Prompt Switch** | Agent system prompts updated to expose only new tool names. Old tools removed from tool list but remain executable (graceful fallback). | 1 sprint | Low — requires regression testing |
| **Phase 3: Cleanup** | Old tool files deleted after confirming zero usage in telemetry. | 1 sprint | Low |

### 5.2 Facade Architecture

```
manage_mcp (new facade)
  ├── action=add, from_library=true
  │     → getMcpTemplateFromLibrary() → createMcpServerFromConfig()
  ├── action=add, from_library=false
  │     → createMcpServerFromConfig()
  ├── action=update
  │     → updateMcpServer() (auto-manages version/source)
  ├── action=remove
  │     → removeMcpServer() (new internal method)
  ├── action=connect/disconnect/reconnect
  │     → setMcpConnectionState()
  └── action=status
        → getMcpStatus()
```

---

## 6. Success Metrics

| Metric | Baseline (Current) | Target |
|---|---|---|
| AI tool-call accuracy (config tools) | ~70% (estimated) | ≥ 95% |
| Average tool calls per config task | 2.1 | ≤ 1.2 |
| Tool-call validation errors (runtime) | ~15% of calls | < 3% |
| Schema fields AI must construct | 8-12 (nested) | 3-5 (flat) |
| Total config management tools | 18 | 9 |

---

## 7. Non-Goals

- Changing `spawn_subagent`, `spawn_subagents`, `coding_agent` interfaces (runtime orchestration, not config)
- Changing internal persistence format (`profiles/*.json`)
- Modifying MCP protocol or transport layer
- Changing skill package format (`.skill` / ZIP)

---

## 8. Open Questions

| # | Question | Decision |
|---|---|---|
| 1 | Should `manage_skills` support `install + bind` as a single action? | Recommend: No. Keep actions atomic. AI can call twice. Simpler to reason about. |
| 2 | Should `search_mcp` / `search_agents` be merged into `manage_mcp` / `manage_agents` as `action=search`? | Recommend: Keep separate. Search is read-only, manage is write. Separation prevents accidental mutations. |
| 3 | Should deprecated tools return a deprecation warning pointing to the new tool? | Yes, during Phase 2. |
