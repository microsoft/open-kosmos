# Sub-Agent Feature Flag Technical Proposal

> Version: 1.0.0 | Date: 2026-03-03 | Based on OpenKosmos v1.21.8 Architecture

---

## Table of Contents

1. [Background and Motivation](#1-background-and-motivation)
2. [Feature Flag Definition](#2-feature-flag-definition)
3. [Impact Scope Analysis](#3-impact-scope-analysis)
4. [Main Process Changes](#4-main-process-changes)
5. [Renderer Process Changes](#5-renderer-process-changes)
6. [IPC Layer Changes](#6-ipc-layer-changes)
7. [Startup Update Service Changes](#7-startup-update-service-changes)
8. [Behavior Matrix](#8-behavior-matrix)
9. [Implementation Plan](#9-implementation-plan)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Background and Motivation

### 1.1 Current Issues

Currently, the Sub-Agent feature in OpenKosmos is **always enabled** without Feature Flag control. Compared to other feature modules:

| Feature | Feature Flag | Default |
|---------|-------------|---------|
| Memory | `kosmosFeatureMemory` | dev only (excluding win32-arm64) |
| Screenshot | `kosmosFeatureScreenshot` | Always enabled |
| Voice Input | `kosmosFeatureVoiceInput` | dev only |
| Browser Control | `browserControl` | dev + win32 only |
| Toolbar Settings | `kosmosFeatureToolbarSettings` | dev + kosmos brand |
| **Sub-Agent** | **None** | **Always enabled** |

All components of the Sub-Agent feature (Built-in Tools, Settings UI, System Prompt, CDN Updates) are unconditionally exposed, lacking flexible toggle control.

### 1.2 Goals

Introduce the `kosmosFeatureSubAgent` Feature Flag to achieve:

- **Built-in Tools control**: When the Feature Flag is disabled, `spawn_subagent` and `spawn_subagents` tools are not registered in the tool list
- **Settings UI control**: When the Feature Flag is disabled, hide the Sub-Agent settings entry and Agent Editor Tab
- **System Prompt control**: When the Feature Flag is disabled, do not inject Sub-Agent related System Prompt sections
- **Startup update control**: When the Feature Flag is disabled, skip the Sub-Agent CDN check and update installation steps
- **Data migration control**: When the Feature Flag is disabled, skip the Sub-Agent file-based migration

---

## 2. Feature Flag Definition

### 2.1 Flag Name and Default Value

```typescript
// src/main/lib/featureFlags/types.ts
export type FeatureFlagName =
  | 'kosmosFeatureToolbarSettings'
  | 'kosmosFeatureMemory'
  | 'kosmosFeatureScreenshot'
  | 'kosmosFeatureVoiceInput'
  | 'browserControl'
  | 'kosmosFeatureSubAgent';  // ← New
```

```typescript
// src/main/lib/featureFlags/featureFlagDefinitions.ts
{
  name: 'kosmosFeatureSubAgent',
  description: 'Sub-Agent system — spawn tools, settings UI, system prompt injection',
  defaultValue: true,  // Always enabled; can be adjusted later to (ctx) => ctx.isDev, etc.
}
```

**Rationale for choosing `true` (always enabled) as the default value**:
- Sub-Agent is currently fully deployed; disabling it would cause feature degradation for users
- The primary purpose of the flag is to lay groundwork for future gradual rollout / A/B testing / brand differentiation
- To restrict, use CLI `--disable-features=kosmosFeatureSubAgent` or adjust the default value later

### 2.2 CLI Override

Following the existing mechanism, automatically supports:

```bash
# Disable Sub-Agent
OpenKosmos.exe --disable-features=kosmosFeatureSubAgent

# Enable Sub-Agent (when the default value is false)
OpenKosmos.exe --enable-features=kosmosFeatureSubAgent
```

---

## 3. Impact Scope Analysis

### 3.1 Complete Impact Checklist

Organized by module dimension, all code paths that need Feature Flag control:

| # | Module | File | Change Point | Description |
|---|--------|------|--------------|-------------|
| **A** | **Built-in Tools Registration** | `builtinToolsManager.ts` | Registration of `spawn_subagent` / `spawn_subagents` in `initialize()` | Do not register tool definitions when flag is disabled |
| **B** | **Built-in Tools Execution** | `builtinToolsManager.ts` | Dispatch branch in `executeTool()` | Return error message when flag is disabled (defensive; normally unreachable) |
| **C** | **System Prompt Injection** | `agentChat.ts` | `buildSubAgentsSystemPrompt()` call in `getAgentSpecificSystemPrompt()` | Skip Sub-Agent prompt section when flag is disabled |
| **D** | **Settings Navigation Entry** | `SettingsNavigation.tsx` | "Sub-Agents" NavItem rendering | Hide navigation item when flag is disabled |
| **E** | **Settings Route** | `AppRoutes.tsx` | `/settings/sub-agents` and sub-routes | Do not register route when flag is disabled |
| **F** | **Agent Editor Tab** | `AgentChatEditingView.tsx` | "Sub-Agents" Tab button and content rendering | Hide Tab when flag is disabled |
| **G** | **IPC Handlers** | `main.ts` | `subAgent:*` series IPC handlers | Return empty results or errors when flag is disabled |
| **H** | **Startup Update** | `startupUpdateService.ts` | Step 7 (checkSubAgentUpdates) and Step 8 (installSubAgentUpdates) | Skip these two steps when flag is disabled |
| **I** | **Data Migration** | `main.ts` | `SubAgentMigration` call in `startup:checkAndInstallUpdates` | Skip migration when flag is disabled |
| **J** | **SettingsPage State** | `SettingsPage.tsx` | Sub-Agent menus, dialogs, event listeners, and other state management | Do not initialize related state when flag is disabled |
| **K** | **Preload Whitelist** | `preload.ts` | `subAgent` / `subAgentLibrary` IPC channels | No changes needed (keep registration; behavior controlled by main handler) |

### 3.2 Unaffected Parts

The following parts **do not require** Feature Flag control:

| Part | Reason |
|------|--------|
| `SubAgentManager` class | Lazy-loaded; only initialized when a tool is invoked. Tools not registered → won't be called → won't be initialized |
| `SubAgentChat` class | Created by `SubAgentManager.spawnSubAgent()`; similarly won't be triggered |
| `SubAgentFileManager` class | Read/write operations are called by upper-layer CRUD methods; IPC handlers already intercept |
| `SubAgentMigration` class | Called directly at startup; already handled at change point I |
| `SubAgentLibraryFetcher` class | Called by IPC handlers and StartupUpdateService; already handled at change points G and H |
| `ProfileCacheManager.sub_agents` data | Data layer remains unchanged; only upper-layer feature entries are controlled |
| `ChatAgent.sub_agents` field | Data structure unchanged; only controls whether prompt injection / tool registration occurs |
| `Preload.ts` channel registration | Preload is just whitelist registration; actual behavior controlled by main handlers |

---

## 4. Main Process Changes

### 4.1 Feature Flag Definition File

**File**: `src/main/lib/featureFlags/types.ts`

```typescript
// Add new member to FeatureFlagName union type
export type FeatureFlagName =
  | 'kosmosFeatureToolbarSettings'
  | 'kosmosFeatureMemory'
  | 'kosmosFeatureScreenshot'
  | 'kosmosFeatureVoiceInput'
  | 'browserControl'
  | 'kosmosFeatureSubAgent';  // ← New
```

**File**: `src/main/lib/featureFlags/featureFlagDefinitions.ts`

```typescript
// Add to FEATURE_FLAG_DEFINITIONS array:
{
  name: 'kosmosFeatureSubAgent' as FeatureFlagName,
  description: 'Sub-Agent system — spawn tools, settings UI, system prompt injection',
  defaultValue: true,
}
```

### 4.2 Built-in Tools Registration (Change Point A)

**File**: `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts`

Add Feature Flag check to the registration of `spawn_subagent` and `spawn_subagents` in the `initialize()` method:

```typescript
// Before: unconditional registration
this.tools.set('spawn_subagent', { ... });
this.tools.set('spawn_subagents', { ... });

// After: conditional registration
if (isFeatureEnabled('kosmosFeatureSubAgent')) {
  this.tools.set('spawn_subagent', { ... });
  this.tools.set('spawn_subagents', { ... });
}
```

Reference pattern: `browserControl` conditional registration for browser control tools (same file L204).

### 4.3 Built-in Tools Execution (Change Point B)

**File**: `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts`

Add defensive check in the `executeTool()` method:

```typescript
// In the dispatch branch for spawn_subagent / spawn_subagents
else if (name === 'spawn_subagent' || name === 'spawn_subagents') {
  if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
    result = { content: [{ type: 'text', text: 'Sub-Agent feature is disabled.' }], isError: true };
  } else {
    // Original lazy import + execute logic
  }
}
```

> **Note**: This is defensive code. Under normal flow, tools won't be called by the LLM if not registered, but this safety fallback is still necessary.

### 4.4 System Prompt Injection (Change Point C)

**File**: `src/main/lib/chat/agentChat.ts`

Wrap the Sub-Agent prompt injection inside a Feature Flag check in the `getAgentSpecificSystemPrompt()` method:

```typescript
// Before
const subAgentNames = chatConfig?.agent?.sub_agents || [];
if (subAgentNames.length > 0) {
  subAgentsInfo = this.buildSubAgentsSystemPrompt(subAgentNames);
}

// After
const subAgentNames = chatConfig?.agent?.sub_agents || [];
if (subAgentNames.length > 0 && isFeatureEnabled('kosmosFeatureSubAgent')) {
  subAgentsInfo = this.buildSubAgentsSystemPrompt(subAgentNames);
}
```

**Effect**: When the Feature Flag is disabled, even if an Agent has `sub_agents` configured, the Sub-Agent usage guide will not be injected into the LLM, and the LLM will not attempt to call spawn tools.

### 4.5 IPC Handlers (Change Point G)

**File**: `src/main/main.ts`

Add unified Feature Flag checks to all `subAgent:*` series IPC handlers. It is recommended to add a guard at the entry of each handler:

```typescript
// Read operations (getAll, syncFromDisk) → return empty array
ipcMain.handle('subAgent:getAll', async (_event, alias: string) => {
  if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
    return { success: true, data: [] };
  }
  // Original logic
});

// Write operations (add, update, delete, importFromFile) → return feature disabled error
ipcMain.handle('subAgent:add', async (_event, alias: string, config: SubAgentConfig) => {
  if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
    return { success: false, error: 'Sub-Agent feature is disabled' };
  }
  // Original logic
});

// Library operations (getList, install, checkUpdates) → similar handling
ipcMain.handle('subAgentLibrary:getList', async () => {
  if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
    return { success: true, data: [] };
  }
  // Original logic
});
```

> **Design choice**: IPC handler registrations are not removed (Preload static declarations cannot be deleted); instead, guards are placed at handler entry points. This is consistent with the `browserControl` implementation pattern.

### 4.6 Startup Update Service (Change Point H)

**File**: `src/main/lib/startupUpdate/startupUpdateService.ts`

Add Feature Flag checks at the entry of Step 7 and Step 8:

```typescript
// Step 7: checkSubAgentUpdates
private async checkSubAgentUpdates(): Promise<void> {
  if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
    this.logger.info('[StartupUpdate] Sub-Agent feature disabled, skipping sub-agent update check');
    return;
  }
  // Original logic
}

// Step 8: installSubAgentUpdates
private async installSubAgentUpdates(): Promise<void> {
  if (!isFeatureEnabled('kosmosFeatureSubAgent')) {
    this.logger.info('[StartupUpdate] Sub-Agent feature disabled, skipping sub-agent update install');
    return;
  }
  // Original logic
}
```

### 4.7 Data Migration (Change Point I)

**File**: `src/main/main.ts`

Add a guard at the migration logic in the `startup:checkAndInstallUpdates` handler:

```typescript
// Before
if (SubAgentMigration.needsMigration(profile)) {
  await migration.migrate(profileDir, profile);
}
await pcManager.syncSubAgentIndex(alias);

// After
if (isFeatureEnabled('kosmosFeatureSubAgent')) {
  if (SubAgentMigration.needsMigration(profile)) {
    await migration.migrate(profileDir, profile);
  }
  await pcManager.syncSubAgentIndex(alias);
}
```

> **Note**: If a user disables the Feature Flag first, the migration will still execute correctly when later re-enabled (`needsMigration` checks the `_migrationFlags` marker), and no data will be lost.

---

## 5. Renderer Process Changes

### 5.1 Settings Navigation Entry (Change Point D)

**File**: `src/renderer/components/settings/SettingsNavigation.tsx`

Wrap the Sub-Agents NavItem with the `useFeatureFlag` hook:

```tsx
// Before: unconditional rendering
<NavItem
  icon={<SubAgentIcon />}
  label="Sub-Agents"
  isActive={activeView === 'sub-agents'}
  onClick={() => navigate('/settings/sub-agents')}
  ariaLabel="Sub-Agent Management"
/>

// After: conditional rendering
const subAgentEnabled = useFeatureFlag('kosmosFeatureSubAgent');
// ...
{subAgentEnabled && (
  <NavItem
    icon={<SubAgentIcon />}
    label="Sub-Agents"
    isActive={activeView === 'sub-agents'}
    onClick={() => navigate('/settings/sub-agents')}
    ariaLabel="Sub-Agent Management"
  />
)}
```

Reference pattern: conditional rendering of the Memory NavItem using `kosmosFeatureMemory` in the same file.

### 5.2 Settings Route (Change Point E)

**File**: `src/renderer/routes/AppRoutes.tsx`

Wrap Sub-Agent related routes with Feature Flag condition:

```tsx
// Before: unconditional registration
<Route path="sub-agents" element={<SubAgentsView />} />
<Route path="sub-agents/sub-agent-library" element={<SubAgentLibraryView />} />
<Route path="sub-agents/new" element={<CreateSubAgentView />} />
<Route path="sub-agents/edit/:subAgentName" element={<EditSubAgentView />} />

// After: conditional registration
const subAgentEnabled = useFeatureFlag('kosmosFeatureSubAgent');
// ...
{subAgentEnabled && (
  <>
    <Route path="sub-agents" element={<SubAgentsView />} />
    <Route path="sub-agents/sub-agent-library" element={<SubAgentLibraryView />} />
    <Route path="sub-agents/new" element={<CreateSubAgentView />} />
    <Route path="sub-agents/edit/:subAgentName" element={<EditSubAgentView />} />
  </>
)}
```

Reference pattern: conditional rendering of the browser-control route using `browserControlEnabled` in the same file.

### 5.3 Agent Editor Tab (Change Point F)

**File**: `src/renderer/components/chat/agent-area/AgentChatEditingView.tsx`

Hide the Sub-Agents tab button and content:

```tsx
const subAgentEnabled = useFeatureFlag('kosmosFeatureSubAgent');

// Tab button: conditional rendering
{subAgentEnabled && (
  <div
    className={`nav-tab ${tabState.activeTab === 'sub_agents' ? 'active' : ''} ...`}
    onClick={() => handleTabSwitch('sub_agents')}
  >
    Sub-Agents
    {pendingChanges.sub_agents && <span className="change-indicator">●</span>}
  </div>
)}

// Tab content: conditional rendering
{subAgentEnabled && tabState.activeTab === 'sub_agents' && tabState.tabsEnabled.sub_agents && (
  <AgentSubAgentsTab ... />
)}
```

### 5.4 SettingsPage State Management (Change Point J)

**File**: `src/renderer/components/pages/SettingsPage.tsx`

Sub-Agent related menus, dialogs, and event listeners can be optionally wrapped with the Feature Flag. Since the Sub-Agent state in SettingsPage (`subAgentsAddMenuState`, `subAgentMenuState`, `deleteSubAgentDialog`, `applySubAgentDialogState`) is lazy (only activated on user interaction), and routes are already guarded, they will not actually be triggered. The following two strategies are available:

**Strategy A — Concise approach (recommended)**: Do not modify SettingsPage state initialization. Routes and NavItem are already guarded, so users cannot navigate to the Sub-Agent page, and related state will not be activated.

**Strategy B — Full isolation approach**: Wrap Sub-Agent related rendered elements in SettingsPage with the Feature Flag:

```tsx
// SubAgentsAddMenuDropdown — conditional rendering
{subAgentEnabled && subAgentsAddMenuState.isOpen && (
  <SubAgentsAddMenuDropdown ... />
)}

// SubAgentDropdownMenu — conditional rendering
{subAgentEnabled && subAgentMenuState.isOpen && (
  <SubAgentDropdownMenu ... />
)}

// ApplySubAgentToAgentsDialog — conditional rendering
{subAgentEnabled && applySubAgentDialogState.isOpen && (
  <ApplySubAgentToAgentsDialog ... />
)}

// Delete Sub-Agent Dialog — conditional rendering
{subAgentEnabled && deleteSubAgentDialog.isOpen && (
  <DeleteConfirmDialog ... />
)}
```

> **Recommendation: Choose Strategy A**: More concise, fewer changes, and route-level guards provide sufficient isolation.

---

## 6. IPC Layer Changes

### 6.1 Preload Layer

**File**: `src/preload/main.ts`

**No modifications needed**. The `subAgent` and `subAgentLibrary` IPC channels continue to be registered; actual behavior is controlled by the Feature Flag guard in the main handler. This is consistent with the `browserControl` implementation pattern — Preload is a static declaration and does not contain runtime logic.

### 6.2 IPC Behavior Change Summary

| IPC Channel | Flag Enabled | Flag Disabled |
|-------------|-------------|---------------|
| `subAgent:getAll` | Returns full `SubAgentConfig[]` | Returns `{ success: true, data: [] }` |
| `subAgent:add` | Normal add | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgent:update` | Normal update | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgent:delete` | Normal delete | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgent:importFromFile` | Normal import | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgent:exportAsClaudeCode` | Normal export | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgent:openInExplorer` | Normal open | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgent:syncFromDisk` | Normal sync | Returns `{ success: true, data: [] }` |
| `subAgentLibrary:getList` | Returns library list | Returns `{ success: true, data: [] }` |
| `subAgentLibrary:install` | Normal install | Returns `{ success: false, error: 'Sub-Agent feature is disabled' }` |
| `subAgentLibrary:checkUpdates` | Normal check | Returns `{ success: true, data: [] }` |

---

## 7. Startup Update Service Changes

### 7.1 Pipeline Step Control

**File**: `src/main/lib/startupUpdate/startupUpdateService.ts`

Current 9-step pipeline:

| Step | Function | Feature Flag Guard |
|------|----------|--------------------|
| 1 | Check MCP updates | — |
| 2 | Install MCP updates | — |
| 3 | Check Skill updates | — |
| 4 | Install Skill updates | — |
| 5 | Check Agent updates | — |
| 6 | Install Agent updates | — |
| **7** | **Check Sub-Agent updates** | **`kosmosFeatureSubAgent`** |
| **8** | **Install Sub-Agent updates** | **`kosmosFeatureSubAgent`** |
| 9 | Complete | — |

### 7.2 Data Migration Control

**File**: `src/main/main.ts` (`startup:checkAndInstallUpdates` handler)

| Operation | Feature Flag Guard |
|-----------|--------------------|
| `SubAgentMigration.needsMigration()` check | `kosmosFeatureSubAgent` |
| `SubAgentMigration.migrate()` execution | `kosmosFeatureSubAgent` |
| `ProfileCacheManager.syncSubAgentIndex()` | `kosmosFeatureSubAgent` |

---

## 8. Behavior Matrix

### 8.1 Feature Behavior Comparison

| Behavior | Flag = true | Flag = false |
|----------|-------------|--------------|
| `spawn_subagent` tool registration | ✅ Registered | ❌ Not registered |
| `spawn_subagents` tool registration | ✅ Registered | ❌ Not registered |
| LLM visibility of spawn tools | ✅ Visible | ❌ Not visible |
| Sub-Agent system prompt injection | ✅ Injected | ❌ Skipped |
| Settings "Sub-Agents" navigation item | ✅ Shown | ❌ Hidden |
| `/settings/sub-agents` route | ✅ Registered | ❌ Not registered |
| Agent Editor "Sub-Agents" Tab | ✅ Shown | ❌ Hidden |
| Sub-Agent IPC CRUD | ✅ Normal execution | ❌ Returns empty/error |
| Sub-Agent Library browse/install | ✅ Normal | ❌ Returns empty/error |
| Startup Sub-Agent CDN update check | ✅ Executed | ❌ Skipped |
| Startup Sub-Agent update installation | ✅ Executed | ❌ Skipped |
| Startup Sub-Agent data migration | ✅ Executed | ❌ Skipped |
| Sub-Agent file storage (agents/ directory) | ✅ Normal read/write | ⚪ Retained but not operated |
| `ChatAgent.sub_agents` reference data | ✅ Normal | ⚪ Retained but not effective |
| profile.json `sub_agents` index | ✅ Normal | ⚪ Retained but not operated |

### 8.2 Toggle Switching Scenarios

| Scenario | Behavior |
|----------|----------|
| Fresh install, Flag = true | All Sub-Agent features work normally |
| Fresh install, Flag = false | Sub-Agent features completely hidden, no data, no UI |
| In use, Flag true → false | UI hidden immediately, existing configured data retained (no data loss), LLM no longer calls spawn tools |
| In use, Flag false → true | UI restored immediately, existing data and configuration take effect immediately, migration and updates executed on next startup |

> **Note**: The Feature Flag is resolved at application startup and cannot be dynamically toggled at runtime. The true→false / false→true scenarios described above refer to behavior after restarting the application.

---

## 9. Implementation Plan

### Phase 1 — Flag Definition and Main Process Core Controls (Day 1)

| Step | File | Description |
|------|------|-------------|
| 1.1 | `featureFlags/types.ts` | Add `kosmosFeatureSubAgent` to `FeatureFlagName` union type |
| 1.2 | `featureFlags/featureFlagDefinitions.ts` | Add Flag definition (defaultValue: `true`) |
| 1.3 | `builtinToolsManager.ts` | Conditional registration of spawn tools in `initialize()` |
| 1.4 | `builtinToolsManager.ts` | Defensive guard in `executeTool()` |
| 1.5 | `agentChat.ts` | Conditional injection in `getAgentSpecificSystemPrompt()` |
| 1.6 | `startupUpdateService.ts` | Entry guard for Steps 7 and 8 |
| 1.7 | `main.ts` | Migration and sync guard |

### Phase 2 — IPC Handler Controls (Day 1)

| Step | File | Description |
|------|------|-------------|
| 2.1 | `main.ts` | Entry guard for all `subAgent:*` handlers |
| 2.2 | `main.ts` | Entry guard for all `subAgentLibrary:*` handlers |

### Phase 3 — Renderer Process UI Controls (Day 2)

| Step | File | Description |
|------|------|-------------|
| 3.1 | `SettingsNavigation.tsx` | Conditional rendering of Sub-Agents NavItem |
| 3.2 | `AppRoutes.tsx` | Conditional registration of Sub-Agent routes |
| 3.3 | `AgentChatEditingView.tsx` | Conditional rendering of Sub-Agents Tab |

### Phase 4 — Testing and Verification (Day 2)

| Step | Description |
|------|-------------|
| 4.1 | Unit test: FeatureFlagManager new flag registration and default value |
| 4.2 | Unit test: BuiltinToolsManager does not register spawn tools when flag=false |
| 4.3 | Manual test: Full flow verification with `--disable-features=kosmosFeatureSubAgent` |
| 4.4 | Manual test: Confirm no regression with flag=true (default) |

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// featureFlagManager.test.ts
describe('kosmosFeatureSubAgent', () => {
  it('should be registered as a valid feature flag', () => {
    const flags = FeatureFlagManager.getInstance().getAllFlagsValues();
    expect('kosmosFeatureSubAgent' in flags).toBe(true);
  });

  it('should default to true', () => {
    expect(FeatureFlagManager.getInstance().isEnabled('kosmosFeatureSubAgent')).toBe(true);
  });

  it('should respect CLI --disable-features override', () => {
    // Mock CLI args with --disable-features=kosmosFeatureSubAgent
    const manager = createManagerWithArgs(['--disable-features=kosmosFeatureSubAgent']);
    expect(manager.isEnabled('kosmosFeatureSubAgent')).toBe(false);
  });
});
```

```typescript
// builtinToolsManager.test.ts
describe('sub-agent tools registration', () => {
  it('should register spawn tools when flag is enabled', () => {
    mockFeatureFlag('kosmosFeatureSubAgent', true);
    const tools = builtinToolsManager.getAllTools();
    expect(tools.has('spawn_subagent')).toBe(true);
    expect(tools.has('spawn_subagents')).toBe(true);
  });

  it('should NOT register spawn tools when flag is disabled', () => {
    mockFeatureFlag('kosmosFeatureSubAgent', false);
    const tools = builtinToolsManager.getAllTools();
    expect(tools.has('spawn_subagent')).toBe(false);
    expect(tools.has('spawn_subagents')).toBe(false);
  });
});
```

### 10.2 Manual Testing Checklist

| # | Test Scenario | Expected Result | Flag |
|---|--------------|-----------------|------|
| 1 | Launch application (default flag=true) | All Sub-Agent features work normally | true |
| 2 | Launch application (--disable-features=kosmosFeatureSubAgent) | Sub-Agent UI completely hidden | false |
| 3 | Settings page navigation | No "Sub-Agents" navigation item | false |
| 4 | Direct access to `#/settings/sub-agents` URL | Page does not exist or is blank | false |
| 5 | Agent Editor | No "Sub-Agents" Tab | false |
| 6 | Send message with an Agent that has sub_agents configured | LLM does not attempt to call spawn tools | false |
| 7 | Application startup logs | No Sub-Agent CDN update check logs | false |
| 8 | Startup after re-enabling | Migration executes normally, data fully restored | true |

### 10.3 E2E Tests (Optional)

Extend startup tests in `tests/e2e/`:

```typescript
test('sub-agent feature flag controls UI visibility', async ({ app }) => {
  // Launch with --disable-features=kosmosFeatureSubAgent
  // Navigate to settings
  // Assert "Sub-Agents" nav item not visible
});
```
