# Tech Design: Skill / MCP / Agent Built-in Tools Refactoring

<!-- Last verified: 2026-05-12 -->

## 1. Architecture Overview

### 1.1 Current Architecture

```
AgentChat
  └── AgentChatToolExecutor
        └── mcpClientManager.executeTool(serverName, toolName, input)
              └── BuiltinMcpClient (virtual server: "builtin-tools")
                    └── BuiltinToolsManager.executeTool(toolName, input)
                          ├── searchSkillsTool.execute(input)
                          ├── applySkillToAgentsTool.execute(input)
                          ├── createMcpServerFromConfigTool.execute(input)
                          ├── createAgentFromConfigTool.execute(input)
                          └── ... (18 tools total)
```

### 1.2 Target Architecture

```
AgentChat
  └── AgentChatToolExecutor
        └── mcpClientManager.executeTool(serverName, toolName, input)
              └── BuiltinMcpClient (virtual server: "builtin-tools")
                    └── BuiltinToolsManager.executeTool(toolName, input)
                          ├── manageSkillsFacade.execute(input)     ── NEW
                          │     ├── action=install → installAndActivateSkill()
                          │     ├── action=uninstall → deleteInstalledSkill()
                          │     ├── action=bind → applySkillToAgents()
                          │     └── action=unbind → removeSkillsFromAgents()
                          ├── searchSkillsTool.execute(input)       ── UNCHANGED
                          ├── manageMcpFacade.execute(input)        ── NEW
                          │     ├── action=add, from_library → fetchTemplate() + createMcp()
                          │     ├── action=add              → createMcp()
                          │     ├── action=update           → updateMcp() (auto version)
                          │     ├── action=remove           → removeMcp()
                          │     ├── action=connect/disconnect/reconnect → setConnState()
                          │     └── action=status           → getStatus()
                          ├── searchMcpFacade.execute(input)        ── NEW
                          ├── manageAgentsFacade.execute(input)     ── NEW
                          │     ├── action=create, from_library → fetchTemplate() + createAgent()
                          │     ├── action=create              → createAgent()
                          │     ├── action=update              → updateAgent() (auto version)
                          │     ├── action=remove              → removeAgent()
                          │     ├── action=list                → listAgents()
                          │     ├── action=set_primary         → setPrimaryAgent()
                          │     └── action=status              → getAgentStatus()
                          ├── searchAgentsFacade.execute(input)     ── NEW
                          ├── spawnSubagentTool.execute(input)      ── UNCHANGED
                          ├── spawnSubagentsTool.execute(input)     ── UNCHANGED
                          └── codingAgentTool.execute(input)        ── UNCHANGED
```

### 1.3 File Layout

```
src/main/lib/mcpRuntime/builtinTools/
├── facades/                          ← NEW directory
│   ├── manageSkillsFacade.ts
│   ├── manageMcpFacade.ts
│   ├── manageAgentsFacade.ts
│   ├── searchMcpFacade.ts
│   ├── searchAgentsFacade.ts
│   └── __tests__/
│       ├── manageSkillsFacade.test.ts
│       ├── manageMcpFacade.test.ts
│       ├── manageAgentsFacade.test.ts
│       ├── searchMcpFacade.test.ts
│       ├── searchAgentsFacade.test.ts
│       ├── manageSkillsFacade.integration.test.ts
│       ├── manageMcpFacade.integration.test.ts
│       ├── manageAgentsFacade.integration.test.ts
│       └── __fixtures__/
│           └── golden-snapshots.json
├── // existing tool files remain (deprecated but functional)
├── searchSkillsTool.ts               ← UNCHANGED
├── applySkillToAgentsTool.ts         ← @deprecated, still registered in Phase 1-2
├── ...
└── builtinToolsManager.ts            ← Modified: register new facades
```

---

## 2. Facade Implementation Details

### 2.1 Common Pattern

Each facade follows the same structure:

```typescript
// src/main/lib/mcpRuntime/builtinTools/facades/manageMcpFacade.ts

import type { BuiltinTool, ToolExecuteResult } from '../types';

export const ManageMcpFacade: BuiltinTool = {
  getDefinition() {
    return {
      name: 'manage_mcp',
      description: '...',
      inputSchema: { /* as defined in PRD §3.4 */ },
    };
  },

  async execute(input: ManageMcpInput): Promise<ToolExecuteResult> {
    // 1. Validate required fields per action
    const validation = validateInput(input);
    if (!validation.ok) return errorResult(validation.message);

    // 2. Route by action
    switch (input.action) {
      case 'add':
        return input.from_library
          ? await addFromLibrary(input)
          : await addDirect(input);
      case 'update':
        return await updateMcp(input);
      case 'remove':
        return await removeMcp(input);
      case 'connect':
      case 'disconnect':
      case 'reconnect':
        return await setConnectionState(input);
      case 'status':
        return await getStatus(input);
    }
  },
};
```

### 2.2 Parameter Transformation Rules

#### `manage_mcp` → legacy tools

| Facade Input | Legacy Tool | Transformation |
|---|---|---|
| `{ action:"add", name, from_library:true, env }` | `getMcpTemplateFromLibrary` → `createMcpServerFromConfig` | Fetch template → merge env → wrap in `{ mcp_config: {..., source:"IN-LIBRARY", version: template.version} }` |
| `{ action:"add", name, transport, command, args, env }` | `createMcpServerFromConfig` | Wrap in `{ mcp_config: { name, transport, command, args, env, source:"ON-DEVICE", version:"1.0.0" } }` |
| `{ action:"update", name, ...fields }` | `updateMcpServer` | Read existing config → determine source → auto-manage version → wrap in `{ mcp_config: { name, ...fields, version, source } }` |
| `{ action:"remove", name }` | `profileCacheManager.removeMcpServer` | Direct call (new capability) |
| `{ action:"connect\|disconnect\|reconnect", name }` | `setMcpConnectionState` | `{ name, action }` (direct) |
| `{ action:"status", name }` | `getMcpStatus` | `{ mcp_name: name }` (rename field) |

#### `manage_agents` → legacy tools

| Facade Input | Legacy Tool | Transformation |
|---|---|---|
| `{ action:"create", name, mcp_servers:["a","b"], memory_enabled, ... }` | `createAgentFromConfig` | Convert `mcp_servers` strings → `[{name,tools:[]}]`; merge `mcp_tool_filter`; expand `memory_enabled` → `context_enhancement`; set `source:"ON-DEVICE"`, `version:"1.0.0"` |
| `{ action:"create", name, from_library:true, ...overrides }` | `getAgentTemplateFromLibrary` → `createAgentFromConfig` | Fetch template → apply overrides → create |
| `{ action:"update", name, ...fields }` | `updateAgent` | Same transforms as create + wrap in `{ agent_config: {...} }` + auto version |
| `{ action:"list" }` | `listAgents` | Direct (no params) |
| `{ action:"set_primary", name }` | `setPrimaryAgent` | `{ agent_name: name }` |
| `{ action:"status", name }` | `getAgentStatus` | `{ agent_name: name }` |
| `{ action:"remove", name }` | `profileCacheManager.removeAgent` | Direct call (new capability) |

#### `manage_skills` → legacy tools

| Facade Input | Legacy Tool | Transformation |
|---|---|---|
| `{ action:"install", skill_names, source:"library" }` | `installAndActivateSkill` (per skill) | Loop skill_names, call install for each |
| `{ action:"install", skill_names, source:"device", path }` | `updateSkillFromDevice(path)` | Install from local path |
| `{ action:"uninstall", skill_names }` | `uninstallSkills` | `{ skill_names }` (direct) |
| `{ action:"bind", skill_names, agent_names }` | `applySkillToAgents` (per skill) | `{ skill_name, agent_names }` per skill |
| `{ action:"bind", skill_names, all_agents:true }` | `applySkillToAgents` | `{ skill_name, apply_to_all: true }` |
| `{ action:"unbind", skill_names, agent_names }` | `removeSkillsFromAgents` | `{ skill_names, agent_names }` |

### 2.3 Version Auto-Management Logic (Internal)

```typescript
// Hidden from AI — called internally by facades
function resolveVersionForUpdate(existing: McpConfig | AgentConfig, newSource?: string): { version: string; source: string } {
  const oldSource = existing.source || 'ON-DEVICE';
  const targetSource = newSource || oldSource;

  if (targetSource === 'ON-DEVICE') {
    // Auto-increment patch version
    return { version: incrementPatch(existing.version || '1.0.0'), source: 'ON-DEVICE' };
  }

  if (oldSource === 'IN-LIBRARY' && targetSource === 'IN-LIBRARY') {
    // Must be a library update — use remoteVersion from CDN
    return { version: existing.remoteVersion || existing.version, source: 'IN-LIBRARY' };
  }

  if (oldSource === 'ON-DEVICE' && targetSource === 'IN-LIBRARY') {
    // Migrating to library — error if no remote version available
    throw new Error('Cannot migrate ON-DEVICE to IN-LIBRARY without library template');
  }

  // IN-LIBRARY → ON-DEVICE: not allowed
  throw new Error('Cannot downgrade IN-LIBRARY source to ON-DEVICE');
}
```

### 2.4 Input Validation (Eager, Pre-Dispatch)

```typescript
function validateManageMcpInput(input: ManageMcpInput): ValidationResult {
  if (!input.action) return fail('"action" is required');
  if (!input.name) return fail('"name" is required');

  if (input.action === 'add' && !input.from_library) {
    if (!input.transport) return fail('"transport" is required when from_library is not true');
    if (input.transport === 'stdio' && !input.command) return fail('"command" is required for stdio transport');
    if ((input.transport === 'sse' || input.transport === 'StreamableHttp') && !input.url) {
      return fail('"url" is required for sse/StreamableHttp transport');
    }
  }

  return ok();
}
```

> **Key**: All conditional requirements are validated eagerly with clear error messages. AI gets immediate, actionable feedback instead of cryptic runtime errors.

---

## 3. Registration in BuiltinToolsManager

```typescript
// builtinToolsManager.ts — modification

import { ManageSkillsFacade } from './facades/manageSkillsFacade';
import { ManageMcpFacade } from './facades/manageMcpFacade';
import { ManageAgentsFacade } from './facades/manageAgentsFacade';
import { SearchMcpFacade } from './facades/searchMcpFacade';
import { SearchAgentsFacade } from './facades/searchAgentsFacade';

// Phase 1: Register new facades alongside legacy tools
this.registerTool(ManageSkillsFacade);
this.registerTool(ManageMcpFacade);
this.registerTool(ManageAgentsFacade);
this.registerTool(SearchMcpFacade);
this.registerTool(SearchAgentsFacade);

// Phase 2: Remove legacy tools from getToolDefinitions() list
// (keep execute routing alive for backward compat)

// Phase 3: Delete legacy tool files
```

---

## 4. Deprecation Strategy

### 4.1 Phase 1: Dual Registration

Both old and new tools are registered. The agent system prompt **prioritizes** new tools by listing them first with clear descriptions. Old tools remain functional.

### 4.2 Phase 2: Soft Deprecation

Old tools are removed from `getToolDefinitions()` (invisible to AI) but remain in the execute routing map. If an old tool name is called (e.g., from cached prompts), it executes successfully but logs a deprecation warning:

```typescript
// In builtinToolsManager.executeTool()
if (DEPRECATED_TOOLS.has(toolName)) {
  logger.warn(`Deprecated tool "${toolName}" called. Use "${DEPRECATED_TOOLS.get(toolName)}" instead.`);
  // Still execute normally
}
```

### 4.3 Phase 3: Hard Removal

After 2 sprints of zero telemetry hits on deprecated tools, delete the files.

---

## 5. Error Handling

All facades follow a consistent error response format:

```typescript
interface FacadeErrorResult {
  content: [{
    type: 'text';
    text: string; // JSON: { "error": true, "message": "...", "hint": "..." }
  }];
}
```

| Error Category | Example Message | Hint |
|---|---|---|
| Missing required field | `"name" is required` | `Provide the MCP server name` |
| Invalid action | `Invalid action "fly"` | `Valid actions: add, update, remove, connect, disconnect, reconnect, status` |
| Conditional requirement | `"command" is required for stdio transport` | `Set command to the executable path (e.g., "node", "npx")` |
| Entity not found | `MCP server "xxx" not found` | `Use search_mcp with installed=true to list available servers` |
| State violation | `Cannot update: server is currently connecting` | `Wait for connection to complete or disconnect first` |

---

## 6. Implementation Checklist

```
Phase 1 (1 sprint):
  □ Create src/main/lib/mcpRuntime/builtinTools/facades/ directory
  □ Implement ManageSkillsFacade with input validation + delegation
  □ Implement ManageMcpFacade with input validation + delegation
  □ Implement ManageAgentsFacade with input validation + delegation
  □ Implement SearchMcpFacade
  □ Implement SearchAgentsFacade
  □ Register all 5 facades in builtinToolsManager.ts
  □ Add @deprecated JSDoc to all legacy tool files
  □ Write unit tests (parameter mapping + error cases)
  □ Write integration tests (full lifecycle)
  □ Update builtinToolsManager-capability-parity.test.ts
  □ Verify: npm test && npm run typecheck && npm run build:vite

Phase 2 (1 sprint):
  □ Remove legacy tools from getToolDefinitions() return
  □ Add deprecation logging in executeTool routing
  □ Update agent system prompt templates to use new tool names
  □ Run AI eval suite (50+ prompts)
  □ Shadow mode: enable in dev builds, monitor mismatches
  □ Verify: full regression matrix passes

Phase 3 (1 sprint):
  □ Confirm zero deprecated tool calls in telemetry (2+ weeks)
  □ Delete legacy tool files
  □ Remove deprecation routing code
  □ Final cleanup and documentation update
```

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI still calls deprecated tool names from cached context | Medium | Low | Graceful fallback in Phase 2; deprecation routing executes normally |
| `from_library` fetch fails (CDN down) | Low | Medium | Return clear error with fallback instructions ("provide transport/command/args manually") |
| Version auto-management creates conflicts | Low | High | Always read current config before update; use optimistic locking (version compare) |
| Facade validation too strict, blocks valid use cases | Medium | Medium | Log all validation rejections; review after 1 week to relax over-strict rules |
| New `remove` action (MCP/Agent) causes accidental deletion | Low | High | Require confirmation in tool description; AI should confirm with user before calling remove |
