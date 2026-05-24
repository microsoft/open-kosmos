# Unified Data Structure Management Refactoring Plan

> Document created: 2026-01-18  
> Status: Proposed

## 1. Background and Problem

### 1.1 Current Issues

Data structure definitions are currently scattered across multiple locations in the project, causing the following problems:

1. **Easy to miss fields when adding new ones** — requires changes in multiple places; omissions frequently cause fields to be filtered out
2. **Duplicate definitions** — the same concept is defined in multiple places, increasing maintenance cost
3. **Type inconsistency** — type definitions between frontend/backend and different modules may fall out of sync
4. **Scattered conversion logic** — Library Item → Config conversion logic is spread across various components

### 1.2 Current State of Scattered Data Structures

```
Current state: data structure definitions are scattered; the same concept is defined in multiple places

1. Backend core types (some serve as Single Source of Truth)
   └── src/main/lib/userDataADO/types/profile.ts
       ├── ChatAgent
       ├── ChatConfig
       ├── McpServerConfig
       └── ...

2. Frontend re-export (✅ good practice)
   └── src/renderer/lib/userData/types/index.ts
       └── re-export from profile.ts

3. ❌ Problem 1: Agent Library interface defined again
   └── src/renderer/components/chat/agent-area/AddFromAgentLibraryViewContent.tsx
       └── AgentLibraryItem.configuration  // duplicates ChatAgent fields!

4. ❌ Problem 2: Built-in tool parameter interfaces defined again
   ├── src/main/lib/mcpRuntime/builtinTools/addAgentByConfigTool.ts
   │   └── AddAgentByConfigArgs  // duplicates ChatAgent fields!
   └── src/main/lib/mcpRuntime/builtinTools/updateAgentByConfigTool.ts
       └── UpdateAgentByConfigArgs  // duplicates ChatAgent fields!

5. ❌ Problem 3: MCP-related types defined again
   └── src/renderer/lib/mcp/mcpClientCacheManager.ts
       └── MCPServerExtended  // duplicates McpServerConfig fields!
```

### 1.3 Design Intent Behind the Two Categories of Data Structures

The project has two categories of data structures with different purposes — this is **by design**:

| Type | Purpose | Characteristics |
|------|---------|-----------------|
| **Library Item** | Configuration on CDN | Includes metadata, dependency requirements, installation prompts, etc. |
| **Config** | Runtime configuration | Lean, actual-use configuration stored in profile.json |

```
┌─────────────────────────────────────────────────────────────────────┐
│  Library Item (CDN config)            Config (runtime config)        │
│  ↓ includes metadata, deps, prompts   ↓ lean, actual-use config      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  AgentLibraryItem ──────────────────→ AgentConfig (ChatAgent)       │
│  ├── name                             ├── name                      │
│  ├── version                          ├── emoji                     │
│  ├── description       convert        ├── avatar                    │
│  ├── contact          ────→           ├── role                      │
│  ├── requirements                     ├── model                     │
│  ├── configuration ─────────────────→ ├── mcp_servers               │
│  │   ├── emoji                        ├── system_prompt             │
│  │   ├── avatar                       ├── skills                    │
│  │   ├── model                        ├── version                   │
│  │   └── ...                          ├── source                    │
│  └── prompts                          └── ...                       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  McpLibraryItem ────────────────────→ McpServerConfig               │
│  ├── name                             ├── name                      │
│  ├── version                          ├── transport                 │
│  ├── description       convert        ├── command                   │
│  └── ...              ────→           ├── args                      │
│                                       ├── version                   │
│                                       └── source                    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SkillLibraryItem ──────────────────→ SkillConfig                   │
│  ├── name                             ├── name                      │
│  ├── version           convert        ├── description               │
│  ├── description      ────→           ├── version                   │
│  └── ...                              └── source                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Refactoring Goals

1. **Single Source of Truth (SSOT)** — each data structure is defined exactly once
2. **Manage both Item and Config** — clearly distinguish the two categories of data structures
3. **Centralize conversion logic** — Library Item → Config conversions are managed in one place
4. **Add a field by changing only one place** — reduces the risk of omissions
5. **Shared types between frontend and backend** — avoid type inconsistency

---

## 3. Directory Structure Design

```
src/
└── shared/                          # Shared module for frontend and backend
    └── types/                       # Centralized type definition hub
        ├── index.ts                 # Unified export of all types
        │
        ├── agent/                   # Agent-related types
        │   ├── index.ts             # Unified Agent type export
        │   ├── config.ts            # AgentConfig (runtime config)
        │   ├── library.ts           # AgentLibraryItem (CDN config)
        │   ├── defaults.ts          # Default values
        │   └── converter.ts         # Item → Config converter
        │
        ├── mcp/                     # MCP-related types
        │   ├── index.ts             # Unified MCP type export
        │   ├── config.ts            # McpServerConfig (runtime config)
        │   ├── library.ts           # McpLibraryItem (CDN config)
        │   ├── defaults.ts          # Default values
        │   └── converter.ts         # Item → Config converter
        │
        ├── skill/                   # Skill-related types
        │   ├── index.ts             # Unified Skill type export
        │   ├── config.ts            # SkillConfig (runtime config)
        │   ├── library.ts           # SkillLibraryItem (CDN config)
        │   ├── defaults.ts          # Default values
        │   └── converter.ts         # Item → Config converter
        │
        ├── chat/                    # Chat-related types
        │   ├── index.ts
        │   └── config.ts            # ChatConfig, ChatSession, ContextEnhancement, etc.
        │
        └── profile/                 # Profile-related types
            ├── index.ts
            └── config.ts            # Profile, ZeroStates, etc.
```

---

## 4. Detailed Type Design

### 4.1 Agent Types

#### `src/shared/types/agent/config.ts` — Runtime Configuration

```typescript
/**
 * Agent runtime configuration
 * 
 * This is the configuration actually stored in profile.json and used by the application.
 */

import type { AgentMcpServer } from '../mcp';
import type { ContextEnhancement, ZeroStates } from '../chat';

/** Agent source type */
export type AgentSource = 'IN-LIBRARY' | 'ON-DEVICE';

/**
 * Agent runtime configuration — stored in profile.json
 */
export interface AgentConfig {
  /** Agent name */
  name: string;
  /** Agent role */
  role: string;
  /** Agent emoji */
  emoji: string;
  /** Agent avatar URL (only for IN-LIBRARY agents; empty for ON-DEVICE) */
  avatar?: string;
  /** Model in use */
  model: string;
  /** Working directory path */
  workspace?: string;
  /** Agent version */
  version?: string;
  /** Remote version (used for IN-LIBRARY version comparison) */
  remoteVersion?: string;
  /** Agent source */
  source?: AgentSource;
  /** MCP server list dedicated to this agent */
  mcp_servers: AgentMcpServer[];
  /** System prompt */
  system_prompt: string;
  /** Context Enhancement configuration */
  context_enhancement?: ContextEnhancement;
  /** List of skill names used by the agent */
  skills?: string[];
  /** Zero States configuration */
  zero_states?: ZeroStates;
}

/** Input for creating an agent (name required, others optional) */
export type CreateAgentInput = Pick<AgentConfig, 'name'> & Partial<Omit<AgentConfig, 'name'>>;

/** Input for updating an agent (all fields optional) */
export type UpdateAgentInput = Partial<AgentConfig>;
```

#### `src/shared/types/agent/library.ts` — Library Data Structure

```typescript
/**
 * Agent Library Item
 * 
 * This is the data structure in agent_lib.json on CDN.
 * It contains metadata, dependency requirements, prompts, etc. needed for installation.
 */

import type { AgentSource } from './config';

/**
 * Configuration fields inside an Agent Library item.
 * These fields are converted into AgentConfig.
 */
export interface AgentLibraryConfiguration {
  emoji?: string;
  avatar?: string;
  name?: string;
  workspace?: string;
  model?: string;
  mcp_servers?: Array<{
    name: string;
    tools?: string[];
  }>;
  system_prompt?: string;
  context_enhancement?: {
    search_memory?: {
      enabled: boolean;
      semantic_similarity_threshold?: number;
      semantic_top_n?: number;
    };
    generate_memory?: {
      enabled: boolean;
    };
  };
  skills?: string[];
  zero_states?: {
    greeting?: string;
    quick_starts?: Array<{
      title: string;
      image?: string;
      description: string;
      prompt: string;
    }>;
  };
}

/**
 * Agent dependency requirements
 */
export interface AgentRequirements {
  /** Software dependencies */
  software?: Record<string, string>;
  /** MCP server dependencies */
  mcp?: string[];
  /** Skill dependencies */
  skills?: string[];
}

/**
 * Agent prompt configuration (used for Kobi-assisted installation)
 */
export interface AgentPrompts {
  setup_agent?: string;
  update_agent?: string;
  setup_requirements?: string;
}

/**
 * Agent Library Item — full structure on CDN
 */
export interface AgentLibraryItem {
  /** Agent name (unique identifier in the library) */
  name: string;
  /** Agent version */
  version: string;
  /** Agent source (always IN-LIBRARY in the library) */
  source?: AgentSource;
  /** Agent description */
  description: string;
  /** Contact information */
  contact?: string;
  /** Dependency requirements */
  requirements?: AgentRequirements;
  /** Agent configuration (will be converted to AgentConfig) */
  configuration?: AgentLibraryConfiguration;
  /** Prompt configuration */
  prompts?: AgentPrompts;
}

/**
 * Agent Library data file structure
 */
export interface AgentLibraryData {
  agents: AgentLibraryItem[];
}
```

#### `src/shared/types/agent/converter.ts` — Converter

```typescript
/**
 * Agent type converter
 * 
 * Responsible for converting AgentLibraryItem → AgentConfig
 */

import type { AgentConfig, AgentSource } from './config';
import type { AgentLibraryItem } from './library';
import { DEFAULT_AGENT_CONFIG } from './defaults';

/**
 * Conversion options
 */
export interface AgentConvertOptions {
  /** Workspace path override (used to preserve the user's existing workspace) */
  workspaceOverride?: string;
}

/**
 * Converts an AgentLibraryItem to an AgentConfig
 * 
 * @param item - Agent Library Item from CDN
 * @param options - Conversion options
 * @returns AgentConfig for runtime use
 */
export function convertAgentLibraryItemToConfig(
  item: AgentLibraryItem,
  options?: AgentConvertOptions
): AgentConfig {
  const config = item.configuration || {};
  
  return {
    // Basic info
    name: config.name || item.name,
    role: 'Assistant',
    emoji: config.emoji || DEFAULT_AGENT_CONFIG.emoji,
    avatar: config.avatar || '',
    model: config.model || DEFAULT_AGENT_CONFIG.model,
    
    // Version and source
    version: item.version || '1.0.0',
    remoteVersion: item.version || '1.0.0',  // IN-LIBRARY: remoteVersion = version
    source: 'IN-LIBRARY' as AgentSource,
    
    // Working directory (supports override)
    workspace: options?.workspaceOverride ?? config.workspace ?? '',
    
    // Feature configuration
    mcp_servers: config.mcp_servers || [],
    system_prompt: config.system_prompt || '',
    skills: config.skills || [],
    
    // Enhancement configuration
    context_enhancement: config.context_enhancement || DEFAULT_AGENT_CONFIG.context_enhancement,
    zero_states: config.zero_states || DEFAULT_AGENT_CONFIG.zero_states,
  };
}

/**
 * Checks whether an AgentConfig needs to be updated from the Library
 * 
 * @param current - Current configuration
 * @param libraryItem - Configuration in the Library
 * @returns Whether an update is needed
 */
export function shouldUpdateFromLibrary(
  current: AgentConfig,
  libraryItem: AgentLibraryItem
): boolean {
  if (current.source !== 'IN-LIBRARY') return false;
  if (!current.remoteVersion || !libraryItem.version) return false;
  
  // Simple version comparison (can be extended to semver comparison)
  return libraryItem.version > current.remoteVersion;
}
```

#### `src/shared/types/agent/defaults.ts` — Default Values

```typescript
/**
 * Agent default configuration
 */

import type { AgentConfig } from './config';

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  name: 'Kobi',
  role: 'Default Assistant',
  emoji: '🐬',
  avatar: '',  // ON-DEVICE defaults to empty
  model: 'gpt-4.1',
  version: '1.0.0',
  remoteVersion: '',
  source: 'ON-DEVICE',
  mcp_servers: [{ name: 'builtin-tools', tools: [] }],
  system_prompt: `You are a highly capable AI assistant designed to help users with a wide variety of tasks...`,
  context_enhancement: {
    search_memory: {
      enabled: false,
      semantic_similarity_threshold: 0.0,
      semantic_top_n: 5
    },
    generate_memory: {
      enabled: false
    }
  },
  skills: [],
  zero_states: {
    greeting: '',
    quick_starts: []
  }
};
```

#### `src/shared/types/agent/index.ts` — Unified Export

```typescript
/**
 * Unified Agent type export
 */

// Runtime configuration
export type {
  AgentSource,
  AgentConfig,
  CreateAgentInput,
  UpdateAgentInput
} from './config';

// Library data structures
export type {
  AgentLibraryItem,
  AgentLibraryData,
  AgentLibraryConfiguration,
  AgentRequirements,
  AgentPrompts
} from './library';

// Default values
export { DEFAULT_AGENT_CONFIG } from './defaults';

// Converter
export {
  convertAgentLibraryItemToConfig,
  shouldUpdateFromLibrary
} from './converter';
export type { AgentConvertOptions } from './converter';
```

---

### 4.2 MCP Types (Similar Structure)

#### `src/shared/types/mcp/config.ts`

```typescript
/**
 * MCP Server runtime configuration
 */

export type McpSource = 'IN-LIBRARY' | 'ON-DEVICE';

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp' | string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  in_use: boolean;
  version?: string;
  remoteVersion?: string;
  source?: McpSource;
}

export interface AgentMcpServer {
  name: string;
  tools: string[];
}
```

#### `src/shared/types/mcp/library.ts`

```typescript
/**
 * MCP Library Item — structure on CDN
 */

export interface McpLibraryItem {
  name: string;
  version: string;
  description: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  // ... other metadata
}

export interface McpLibraryData {
  servers: McpLibraryItem[];
}
```

---

### 4.3 Skill Types (Similar Structure)

#### `src/shared/types/skill/config.ts`

```typescript
/**
 * Skill runtime configuration
 */

export type SkillSource = 'IN-LIBRARY' | 'ON-DEVICE';

export interface SkillConfig {
  name: string;
  description: string;
  version: string;
  remoteVersion?: string;
  source: SkillSource;
}
```

#### `src/shared/types/skill/library.ts`

```typescript
/**
 * Skill Library Item — structure on CDN
 */

export interface SkillLibraryItem {
  name: string;
  version: string;
  description: string;
  // ... other metadata
}

export interface SkillLibraryData {
  skills: SkillLibraryItem[];
}
```

---

### 4.4 Unified Export

#### `src/shared/types/index.ts`

```typescript
/**
 * Centralized type export hub
 * 
 * Usage rules:
 * 1. Config types are used for runtime storage and usage
 * 2. LibraryItem types are used for CDN data retrieval
 * 3. Converters are used for LibraryItem → Config conversion
 */

// ============================================
// Agent-related
// ============================================
export type {
  // Runtime configuration
  AgentSource,
  AgentConfig,
  CreateAgentInput,
  UpdateAgentInput,
  // Library data structures
  AgentLibraryItem,
  AgentLibraryData,
  AgentLibraryConfiguration,
  AgentRequirements,
  AgentPrompts,
  // Converter options
  AgentConvertOptions
} from './agent';

export {
  DEFAULT_AGENT_CONFIG,
  convertAgentLibraryItemToConfig,
  shouldUpdateFromLibrary
} from './agent';

// ============================================
// MCP-related
// ============================================
export type {
  McpSource,
  McpServerConfig,
  AgentMcpServer,
  McpLibraryItem,
  McpLibraryData
} from './mcp';

export {
  DEFAULT_MCP_CONFIG,
  convertMcpLibraryItemToConfig
} from './mcp';

// ============================================
// Skill-related
// ============================================
export type {
  SkillSource,
  SkillConfig,
  SkillLibraryItem,
  SkillLibraryData
} from './skill';

export {
  DEFAULT_SKILL_CONFIG,
  convertSkillLibraryItemToConfig
} from './skill';

// ============================================
// Chat-related
// ============================================
export type {
  ChatConfig,
  ChatConfigRuntime,
  ChatSession,
  ContextEnhancement,
  ZeroStates,
  QuickStartItem
} from './chat';

export { DEFAULT_CONTEXT_ENHANCEMENT, DEFAULT_ZERO_STATES } from './chat';

// ============================================
// Profile-related
// ============================================
export type {
  Profile,
  ProfileV2
} from './profile';
```

---

## 5. Migration Plan

### 5.0 Migration Principles

> ⚠️ **Important principle: No backward compatibility — complete migration to the new architecture**

| Principle | Description |
|-----------|-------------|
| **Full cleanup** | Delete all old type definitions, duplicate code, and deprecated implementations |
| **No compatibility shim** | Do not add any backward-compatible adapter code |
| **One-shot migration** | Migrate all related code at once — no phased batches |
| **Delete old files** | Delete files that are no longer needed after migration |
| **Update all references** | Exhaustive search and update of all import paths |

**Cleanup targets:**

```
Items to delete/refactor:

1. ❌ Delete duplicate interface definitions in components
   - AgentLibraryItem in AddFromAgentLibraryViewContent.tsx
   - McpLibraryItem in AddFromMcpLibraryViewContent.tsx
   - SkillLibraryItem in AddFromSkillLibraryViewContent.tsx

2. ❌ Delete duplicate interface definitions in built-in tools
   - AddAgentByConfigArgs in addAgentByConfigTool.ts
   - UpdateAgentByConfigArgs in updateAgentByConfigTool.ts

3. ❌ Delete/refactor scattered conversion logic
   - Handwritten libraryItem → config conversion code in various components
   
4. ❌ Delete old type files (if fully superseded)
   - Evaluate whether src/main/lib/userDataADO/types/profile.ts can be fully migrated

5. ✅ Uniformly use type definitions under shared/types/
6. ✅ Uniformly use conversion functions from converter.ts
```

### 5.1 Migration Steps

| Phase | Task | Operation Type |
|-------|------|---------------|
| **Phase 1** | Create `src/shared/types/` directory structure | 🆕 Add |
| **Phase 2** | Migrate existing types from `profile.ts` to corresponding shared files | 🔄 Migrate |
| **Phase 3** | Modify backend `profile.ts` to re-export | 🔄 Refactor |
| **Phase 4** | Modify frontend `types/index.ts` to re-export | 🔄 Refactor |
| **Phase 5** | **Delete** duplicate interface definitions in components; replace with imports | ❌ Delete |
| **Phase 6** | **Delete** scattered conversion logic; use the unified converter | ❌ Delete |
| **Phase 7** | Exhaustive search and verification — ensure no stale references remain | ✅ Verify |
| **Phase 8** | Delete old files that are no longer needed | ❌ Clean up |

### 5.2 Backend Migration

```typescript
// src/main/lib/userDataADO/types/profile.ts
// Change to import from shared and re-export

export * from '../../../../shared/types';

// Backend-specific types, if any, are added here
export interface BackendOnlyType {
  // ...
}
```

### 5.3 Frontend Migration

```typescript
// src/renderer/lib/userData/types/index.ts
// Change to import from shared and re-export

export * from '../../../../shared/types';

// Frontend-specific types, if any, are added here
export interface FrontendOnlyType {
  // ...
}
```

### 5.4 Component Migration Example

```typescript
// src/renderer/components/chat/agent-area/AddFromAgentLibraryViewContent.tsx

// ❌ Delete: locally duplicated interface definitions (~100+ lines)
// interface AgentLibraryItem { ... }
// interface AgentLibraryData { ... }
// interface RequirementCheckResult { ... }

// ✅ Replace with: import from the centralized type hub
import {
  AgentLibraryItem,
  AgentLibraryData,
  AgentConfig,
  convertAgentLibraryItemToConfig
} from '../../../../shared/types';

// ❌ Delete: handwritten conversion logic
// const agentConfig = {
//   emoji: selectedAgent.configuration.emoji || '🤖',
//   name: selectedAgent.configuration.name || selectedAgent.name,
//   model: selectedAgent.configuration.model || 'gpt-4.1',
//   ...
// };

// ✅ Replace with: use the unified converter
const agentConfig = convertAgentLibraryItemToConfig(libraryItem, {
  workspaceOverride: existingWorkspace
});
```

### 5.5 Code to Delete

#### 5.5.1 Duplicate Interface Definitions (must delete)

| File | Delete | Replace With |
|------|--------|-------------|
| `AddFromAgentLibraryViewContent.tsx` | `interface AgentLibraryItem {...}` | `import { AgentLibraryItem } from 'shared/types'` |
| `AddFromAgentLibraryViewContent.tsx` | `interface AgentLibraryData {...}` | `import { AgentLibraryData } from 'shared/types'` |
| `AddFromMcpLibraryViewContent.tsx` | `interface McpLibraryItem {...}` | `import { McpLibraryItem } from 'shared/types'` |
| `AddFromSkillLibraryViewContent.tsx` | `interface SkillLibraryItem {...}` | `import { SkillLibraryItem } from 'shared/types'` |
| `addAgentByConfigTool.ts` | `interface AddAgentByConfigArgs {...}` | `import { CreateAgentInput } from 'shared/types'` |
| `updateAgentByConfigTool.ts` | `interface UpdateAgentByConfigArgs {...}` | `import { UpdateAgentInput } from 'shared/types'` |

#### 5.5.2 Scattered Conversion Logic (must delete)

| File | Delete | Replace With |
|------|--------|-------------|
| `AddFromAgentLibraryViewContent.tsx` | `const agentConfig = { emoji: ..., name: ..., ... }` | `convertAgentLibraryItemToConfig()` |
| `AddFromMcpLibraryViewContent.tsx` | MCP config construction logic | `convertMcpLibraryItemToConfig()` |
| `AddFromSkillLibraryViewContent.tsx` | Skill config construction logic | `convertSkillLibraryItemToConfig()` |

#### 5.5.3 Duplicate Default Value Definitions (must delete)

| File | Delete | Replace With |
|------|--------|-------------|
| Hardcoded defaults in various components | `'🤖'`, `'gpt-4.1'`, `'1.0.0'`, etc. | Use `DEFAULT_AGENT_CONFIG` |

### 5.6 Migration Verification Checklist

```bash
# 1. Check for remaining old interface definitions
grep -r "interface AgentLibraryItem" src/
grep -r "interface McpLibraryItem" src/
grep -r "interface SkillLibraryItem" src/

# 2. Check for remaining handwritten conversion logic
grep -r "selectedAgent.configuration.emoji" src/
grep -r "selectedAgent.configuration.name" src/

# 3. Check for remaining hardcoded default values
grep -r "'🤖'" src/renderer/
grep -r "'gpt-4.1'" src/renderer/

# 4. Confirm all imports point to shared/types
grep -r "from.*shared/types" src/

# 5. TypeScript compilation check
npm run type-check
```

---

## 6. Standard Workflow for Adding New Fields

Using `avatar` as an example:

### 6.1 Change Checklist

| File | Change |
|------|--------|
| `shared/types/agent/config.ts` | Add `avatar?: string` to `AgentConfig` |
| `shared/types/agent/library.ts` | Add `avatar?: string` to `AgentLibraryConfiguration` |
| `shared/types/agent/defaults.ts` | Add `avatar: ''` to `DEFAULT_AGENT_CONFIG` |
| `shared/types/agent/converter.ts` | Add `avatar: config.avatar \|\| ''` to conversion logic |

### 6.2 Places That Benefit Automatically

- ✅ Frontend type checking
- ✅ Backend type checking  
- ✅ Library parsing
- ✅ Data storage
- ✅ IPC transport
- ✅ All components using `AgentConfig`

### 6.3 Places That May Need Additional Handling

- 🔧 `profileCacheManager.sanitizeProfileV2()` — data sanitization logic
- 🔧 UI components — rendering the new field

---

## 7. Benefits Summary

| Benefit | Description |
|---------|-------------|
| **Add a field by changing only one place** | e.g. adding `avatar` only requires changes under shared/types/agent/ |
| **Guaranteed type consistency** | TypeScript compiler automatically catches type mismatches |
| **Less duplicate code** | Eliminates 5+ duplicate interface definitions |
| **Better maintainability** | Type definitions are centralized, easier to understand and modify |
| **Derived types stay in sync automatically** | `CreateAgentInput`, `UpdateAgentInput` automatically include new fields |
| **Unified conversion logic** | Prevents inconsistencies caused by scattered conversion code |
| **Clear separation of Item and Config** | Responsibilities of the two data structure categories are explicit |
| **Reduced code volume** | Deletes large amounts of duplicate code; estimated reduction of 500+ lines |

---

## 8. Risks and Considerations

### 8.1 Migration Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Missing references cause compilation failure | Build failure | Exhaustive grep search + TypeScript compilation check |
| Inconsistent conversion logic | Data loss or corruption | Unit test coverage for converters |
| Runtime type errors | Application crash | Thorough testing of all Library installation flows |

### 8.2 Impact of Dropping Backward Compatibility

| Impact | Description |
|--------|-------------|
| Old version data | Relies on `profileCacheManager.sanitizeProfileV2()` for data migration |
| API changes | Built-in tool parameter interfaces change; documentation must be updated accordingly |
| Test cases | All related unit tests and integration tests must be updated |

---

## 9. Appendix

### 9.1 Type Naming Conventions

| Type | Naming Pattern | Example |
|------|---------------|---------|
| Runtime configuration | `{Entity}Config` | `AgentConfig`, `McpServerConfig` |
| Library data | `{Entity}LibraryItem` | `AgentLibraryItem`, `McpLibraryItem` |
| Library dataset | `{Entity}LibraryData` | `AgentLibraryData`, `McpLibraryData` |
| Source type | `{Entity}Source` | `AgentSource`, `McpSource` |
| Create input | `Create{Entity}Input` | `CreateAgentInput` |
| Update input | `Update{Entity}Input` | `UpdateAgentInput` |
| Default configuration | `DEFAULT_{ENTITY}_CONFIG` | `DEFAULT_AGENT_CONFIG` |
| Converter function | `convert{Entity}LibraryItemToConfig` | `convertAgentLibraryItemToConfig` |

### 9.2 File Responsibilities

| File | Responsibility |
|------|---------------|
| `config.ts` | Runtime configuration interfaces, derived types |
| `library.ts` | CDN data structure interfaces |
| `defaults.ts` | Default configuration values |
| `converter.ts` | Item → Config conversion functions |
| `index.ts` | Unified export |
