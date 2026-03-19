# Unified Data Structure Management Refactoring Plan

> Document created: 2026-01-18  
> Status: Proposal

## 1. Background and Problems

### 1.1 Current Issues

Data structure definitions in the current project are scattered across multiple locations, leading to the following issues:

1. **Easy to miss when adding new fields** - Requires changes in multiple places, frequently leading to fields being filtered out due to omissions
2. **Duplicate definitions** - The same concepts are defined in multiple places, resulting in high maintenance costs
3. **Type inconsistencies** - Type definitions between frontend/backend and different modules may be out of sync
4. **Scattered conversion logic** - Library Item → Config conversion logic is spread across various components

### 1.2 Current State of Scattered Data Structures

```
Current state: Data structure definitions are scattered, same concepts defined in multiple places

1. Backend core types (partially serving as Single Source of Truth)
   └── src/main/lib/userDataADO/types/profile.ts
       ├── ChatAgent
       ├── ChatConfig
       ├── McpServerConfig
       └── ...

2. Frontend re-exports (✅ Good practice)
   └── src/renderer/lib/userData/types/index.ts
       └── re-export from profile.ts

3. ❌ Issue 1: Agent Library interface duplicate definitions
   └── src/renderer/components/chat/agent-area/AddFromAgentLibraryViewContent.tsx
       └── AgentLibraryItem.configuration  // Duplicates ChatAgent fields!

4. ❌ Issue 2: Built-in tool parameter interface duplicate definitions
   ├── src/main/lib/mcpRuntime/builtinTools/addAgentByConfigTool.ts
   │   └── AddAgentByConfigArgs  // Duplicates ChatAgent fields!
   └── src/main/lib/mcpRuntime/builtinTools/updateAgentByConfigTool.ts
       └── UpdateAgentByConfigArgs  // Duplicates ChatAgent fields!

5. ❌ Issue 3: MCP-related type duplicate definitions
   └── src/renderer/lib/mcp/mcpClientCacheManager.ts
       └── MCPServerExtended  // Duplicates McpServerConfig fields!
```

### 1.3 Design Intent of Two Data Structure Types

The project has two types of data structures for different purposes, which is **by design**:

| Type | Purpose | Characteristics |
|------|---------|-----------------|
| **Library Item** | Configuration on CDN | Contains metadata, dependency requirements, setup prompts, etc. |
| **Config** | Runtime configuration | Streamlined configuration for actual use, stored in profile.json |

```
┌─────────────────────────────────────────────────────────────────────┐
│  Library Item (CDN config)            Config (Runtime config)       │
│  ↓ Contains metadata, deps, prompts   ↓ Streamlined runtime config  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  AgentLibraryItem ──────────────────→ AgentConfig (ChatAgent)       │
│  ├── name                             ├── name                      │
│  ├── version                          ├── emoji                     │
│  ├── description      Conversion      ├── avatar                    │
│  ├── contact           ────→          ├── role                      │
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
│  ├── description      Conversion      ├── command                   │
│  └── ...               ────→          ├── args                      │
│                                       ├── version                   │
│                                       └── source                    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SkillLibraryItem ──────────────────→ SkillConfig                   │
│  ├── name                             ├── name                      │
│  ├── version          Conversion      ├── description               │
│  ├── description       ────→          ├── version                   │
│  └── ...                              └── source                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Refactoring Goals

1. **Single Source of Truth (SSOT)** - Each data structure is defined only once
2. **Manage both Item and Config** - Clearly distinguish between the two types of data structures
3. **Centralized conversion logic** - Unified management of Library Item → Config conversions
4. **Only one change needed for new fields** - Reduce the risk of omissions
5. **Shared types between frontend and backend** - Avoid type inconsistencies

---

## 3. Directory Structure Design

```
src/
└── shared/                          # Shared module between frontend and backend
    └── types/                       # Unified type definition center
        ├── index.ts                 # Unified export for all types
        │
        ├── agent/                   # Agent-related types
        │   ├── index.ts             # Agent type unified export
        │   ├── config.ts            # AgentConfig (runtime config)
        │   ├── library.ts           # AgentLibraryItem (CDN config)
        │   ├── defaults.ts          # Default values
        │   └── converter.ts         # Item → Config converter
        │
        ├── mcp/                     # MCP-related types
        │   ├── index.ts             # MCP type unified export
        │   ├── config.ts            # McpServerConfig (runtime config)
        │   ├── library.ts           # McpLibraryItem (CDN config)
        │   ├── defaults.ts          # Default values
        │   └── converter.ts         # Item → Config converter
        │
        ├── skill/                   # Skill-related types
        │   ├── index.ts             # Skill type unified export
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

#### `src/shared/types/agent/config.ts` - Runtime Configuration

```typescript
/**
 * Agent Runtime Configuration
 * 
 * This is the configuration actually stored in profile.json and used by the application
 */

import type { AgentMcpServer } from '../mcp';
import type { ContextEnhancement, ZeroStates } from '../chat';

/** Agent source type */
export type AgentSource = 'IN-LIBRARY' | 'ON-DEVICE';

/**
 * Agent runtime configuration - stored in profile.json
 */
export interface AgentConfig {
  /** Agent name */
  name: string;
  /** Agent role */
  role: string;
  /** Agent emoji */
  emoji: string;
  /** Agent avatar URL (only for IN-LIBRARY agents, empty for ON-DEVICE) */
  avatar?: string;
  /** Model to use */
  model: string;
  /** Workspace directory path */
  workspace?: string;
  /** Agent version */
  version?: string;
  /** Remote version (used for IN-LIBRARY version comparison) */
  remoteVersion?: string;
  /** Agent source */
  source?: AgentSource;
  /** Agent-specific MCP server list */
  mcp_servers: AgentMcpServer[];
  /** System prompt */
  system_prompt: string;
  /** Context Enhancement configuration */
  context_enhancement?: ContextEnhancement;
  /** List of Skill names used by the Agent */
  skills?: string[];
  /** Zero States configuration */
  zero_states?: ZeroStates;
}

/** Input for creating an Agent (name is required, others optional) */
export type CreateAgentInput = Pick<AgentConfig, 'name'> & Partial<Omit<AgentConfig, 'name'>>;

/** Input for updating an Agent (all fields optional) */
export type UpdateAgentInput = Partial<AgentConfig>;
```

#### `src/shared/types/agent/library.ts` - Library Data Structure

```typescript
/**
 * Agent Library Item
 * 
 * This is the data structure in agent_lib.json on the CDN
 * Contains metadata, dependency requirements, prompts, etc. needed for installation
 */

import type { AgentSource } from './config';

/**
 * Configuration fields in the Agent Library
 * These fields will be converted to AgentConfig
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
 * Agent Library Item - Complete structure on CDN
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

#### `src/shared/types/agent/converter.ts` - Converter

```typescript
/**
 * Agent type converter
 * 
 * Responsible for AgentLibraryItem → AgentConfig conversion
 */

import type { AgentConfig, AgentSource } from './config';
import type { AgentLibraryItem } from './library';
import { DEFAULT_AGENT_CONFIG } from './defaults';

/**
 * Conversion options
 */
export interface AgentConvertOptions {
  /** Override workspace path (used to preserve user's existing workspace) */
  workspaceOverride?: string;
}

/**
 * Convert AgentLibraryItem to AgentConfig
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
    // Basic information
    name: config.name || item.name,
    role: 'Assistant',
    emoji: config.emoji || DEFAULT_AGENT_CONFIG.emoji,
    avatar: config.avatar || '',
    model: config.model || DEFAULT_AGENT_CONFIG.model,
    
    // Version and source
    version: item.version || '1.0.0',
    remoteVersion: item.version || '1.0.0',  // IN-LIBRARY: remoteVersion = version
    source: 'IN-LIBRARY' as AgentSource,
    
    // Workspace directory (supports override)
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
 * Check whether an AgentConfig needs to be updated from the Library
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

#### `src/shared/types/agent/defaults.ts` - Default Values

```typescript
/**
 * Agent default configuration
 */

import type { AgentConfig } from './config';

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  name: 'Kobi',
  role: 'Default Assistant',
  emoji: '🐬',
  avatar: '',  // Default empty for ON-DEVICE
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

#### `src/shared/types/agent/index.ts` - Unified Export

```typescript
/**
 * Agent type unified export
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
 * MCP Library Item - Structure on CDN
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
 * Skill Library Item - Structure on CDN
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
 * Unified type export center
 * 
 * Usage rules:
 * 1. Config types are used for runtime storage and usage
 * 2. LibraryItem types are used for fetching CDN data
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

> ⚠️ **Important principle: No backward compatibility considerations, full migration to the new architecture**

| Principle | Description |
|-----------|-------------|
| **Complete cleanup** | Delete all old type definitions, duplicate code, and deprecated implementations |
| **No compatibility layer** | Do not add any backward-compatible adapter code |
| **One-time migration** | All related code migrated at once, not in batches |
| **Delete old files** | Delete old files that are no longer needed after migration |
| **Update all references** | Perform a full search and update all import paths |

**Cleanup targets:**

```
Content to delete/refactor:

1. ❌ Delete duplicate interface definitions in components
   - AgentLibraryItem in AddFromAgentLibraryViewContent.tsx
   - McpLibraryItem in AddFromMcpLibraryViewContent.tsx
   - SkillLibraryItem in AddFromSkillLibraryViewContent.tsx

2. ❌ Delete duplicate interface definitions in built-in tools
   - AddAgentByConfigArgs in addAgentByConfigTool.ts
   - UpdateAgentByConfigArgs in updateAgentByConfigTool.ts

3. ❌ Delete/refactor scattered conversion logic
   - Hand-written libraryItem → config conversion code in various components
   
4. ❌ Delete old type files (if fully replaced)
   - Evaluate whether src/main/lib/userDataADO/types/profile.ts is fully migrated

5. ✅ Use type definitions from shared/types/ uniformly
6. ✅ Use conversion functions from converter.ts uniformly
```

### 5.1 Migration Steps

| Phase | Task | Operation Type |
|------|------|----------|
| **Phase 1** | Create `src/shared/types/` directory structure | 🆕 New |
| **Phase 2** | Migrate existing types from `profile.ts` to corresponding shared files | 🔄 Migrate |
| **Phase 3** | Modify backend `profile.ts` to re-export | 🔄 Refactor |
| **Phase 4** | Modify frontend `types/index.ts` to re-export | 🔄 Refactor |
| **Phase 5** | **Delete** duplicate interface definitions in components, replace with imports | ❌ Delete |
| **Phase 6** | **Delete** scattered conversion logic, use unified converter instead | ❌ Delete |
| **Phase 7** | Full search validation, ensure no missed references | ✅ Verify |
| **Phase 8** | Delete old files that are no longer needed | ❌ Cleanup |

### 5.2 Backend Migration

```typescript
// src/main/lib/userDataADO/types/profile.ts
// Changed to import from shared and re-export

export * from '../../../../shared/types';

// Add backend-specific types here if needed
export interface BackendOnlyType {
  // ...
}
```

### 5.3 Frontend Migration

```typescript
// src/renderer/lib/userData/types/index.ts
// Changed to import from shared and re-export

export * from '../../../../shared/types';

// Add frontend-specific types here if needed
export interface FrontendOnlyType {
  // ...
}
```

### 5.4 Component Migration Example

```typescript
// src/renderer/components/chat/agent-area/AddFromAgentLibraryViewContent.tsx

// ❌ Delete: Locally duplicated interface definitions (~100+ lines)
// interface AgentLibraryItem { ... }
// interface AgentLibraryData { ... }
// interface RequirementCheckResult { ... }

// ✅ Replace with: Import from the unified type center
import {
  AgentLibraryItem,
  AgentLibraryData,
  AgentConfig,
  convertAgentLibraryItemToConfig
} from '../../../../shared/types';

// ❌ Delete: Hand-written conversion logic
// const agentConfig = {
//   emoji: selectedAgent.configuration.emoji || '🤖',
//   name: selectedAgent.configuration.name || selectedAgent.name,
//   model: selectedAgent.configuration.model || 'gpt-4.1',
//   ...
// };

// ✅ Replace with: Use unified converter
const agentConfig = convertAgentLibraryItemToConfig(libraryItem, {
  workspaceOverride: existingWorkspace
});
```

### 5.5 Code to Delete Checklist

#### 5.5.1 Duplicate Interface Definitions (Must Delete)

| File | Content to Delete | Replace With |
|------|----------|--------|
| `AddFromAgentLibraryViewContent.tsx` | `interface AgentLibraryItem {...}` | `import { AgentLibraryItem } from 'shared/types'` |
| `AddFromAgentLibraryViewContent.tsx` | `interface AgentLibraryData {...}` | `import { AgentLibraryData } from 'shared/types'` |
| `AddFromMcpLibraryViewContent.tsx` | `interface McpLibraryItem {...}` | `import { McpLibraryItem } from 'shared/types'` |
| `AddFromSkillLibraryViewContent.tsx` | `interface SkillLibraryItem {...}` | `import { SkillLibraryItem } from 'shared/types'` |
| `addAgentByConfigTool.ts` | `interface AddAgentByConfigArgs {...}` | `import { CreateAgentInput } from 'shared/types'` |
| `updateAgentByConfigTool.ts` | `interface UpdateAgentByConfigArgs {...}` | `import { UpdateAgentInput } from 'shared/types'` |

#### 5.5.2 Scattered Conversion Logic (Must Delete)

| File | Content to Delete | Replace With |
|------|----------|--------|
| `AddFromAgentLibraryViewContent.tsx` | `const agentConfig = { emoji: ..., name: ..., ... }` | `convertAgentLibraryItemToConfig()` |
| `AddFromMcpLibraryViewContent.tsx` | MCP config construction logic | `convertMcpLibraryItemToConfig()` |
| `AddFromSkillLibraryViewContent.tsx` | Skill config construction logic | `convertSkillLibraryItemToConfig()` |

#### 5.5.3 Duplicate Default Value Definitions (Must Delete)

| File | Content to Delete | Replace With |
|------|----------|--------|
| Hard-coded default values in components | `'🤖'`, `'gpt-4.1'`, `'1.0.0'` etc. | Use `DEFAULT_AGENT_CONFIG` |

### 5.6 Migration Verification Checklist

```bash
# 1. Search for any remaining old interface definitions
grep -r "interface AgentLibraryItem" src/
grep -r "interface McpLibraryItem" src/
grep -r "interface SkillLibraryItem" src/

# 2. Search for any remaining hand-written conversion logic
grep -r "selectedAgent.configuration.emoji" src/
grep -r "selectedAgent.configuration.name" src/

# 3. Search for any remaining hard-coded default values
grep -r "'🤖'" src/renderer/
grep -r "'gpt-4.1'" src/renderer/

# 4. Verify all imports point to shared/types
grep -r "from.*shared/types" src/

# 5. TypeScript compilation check
npm run type-check
```

---

## 6. Standard Process for Adding New Fields

Using the addition of the `avatar` field as an example:

### 6.1 Change Checklist

| File | Changes |
|------|----------|
| `shared/types/agent/config.ts` | `AgentConfig` add `avatar?: string` |
| `shared/types/agent/library.ts` | `AgentLibraryConfiguration` add `avatar?: string` |
| `shared/types/agent/defaults.ts` | `DEFAULT_AGENT_CONFIG` add `avatar: ''` |
| `shared/types/agent/converter.ts` | Add to conversion logic: `avatar: config.avatar \|\| ''` |

### 6.2 Automatically Effective Areas

- ✅ Frontend type checking
- ✅ Backend type checking  
- ✅ Library parsing
- ✅ Data storage
- ✅ IPC transport
- ✅ All components using `AgentConfig`

### 6.3 Areas That May Need Additional Handling

- 🔧 `profileCacheManager.sanitizeProfileV2()` - Data sanitization logic
- 🔧 UI components - Rendering the new field

---

## 7. Benefits Summary

| Benefit | Description |
|------|------|
| **Only one change needed for new fields** | e.g., adding `avatar` only requires changes in the shared/types/agent/ directory |
| **Type consistency guarantee** | TypeScript compiler automatically checks for type mismatches |
| **Reduced duplicate code** | Eliminates 5+ duplicate interface definitions |
| **Better maintainability** | Centralized type definitions, easier to understand and modify |
| **Derived types auto-sync** | `CreateAgentInput`, `UpdateAgentInput` automatically include new fields |
| **Unified conversion logic** | Avoids inconsistencies caused by scattered conversion logic |
| **Clear distinction between Item and Config** | Two types of data structures with clear responsibilities |
| **Reduced code volume** | Deletes a large amount of duplicate code, estimated reduction of 500+ lines |

---

## 8. Risks and Considerations

### 8.1 Migration Risks

| Risk | Impact | Mitigation |
|------|------|----------|
| Missed references causing compilation failure | Build failure | Full grep search + TypeScript compilation check |
| Inconsistent conversion logic | Data loss or errors | Unit test coverage for converters |
| Runtime type errors | Application crash | Thorough testing of all Library installation flows |

### 8.2 Impact of Not Considering Backward Compatibility

| Impact | Description |
|------|------|
| Legacy data | Relies on `profileCacheManager.sanitizeProfileV2()` for data migration |
| API changes | Built-in tool parameter interface changes require documentation updates |
| Test cases | All related unit tests and integration tests need to be updated |

---

## 9. Appendix

### 9.1 Type Naming Conventions

| Type | Naming Pattern | Example |
|------|----------|------|
| Runtime configuration | `{Entity}Config` | `AgentConfig`, `McpServerConfig` |
| Library data | `{Entity}LibraryItem` | `AgentLibraryItem`, `McpLibraryItem` |
| Library dataset | `{Entity}LibraryData` | `AgentLibraryData`, `McpLibraryData` |
| Source type | `{Entity}Source` | `AgentSource`, `McpSource` |
| Create input | `Create{Entity}Input` | `CreateAgentInput` |
| Update input | `Update{Entity}Input` | `UpdateAgentInput` |
| Default configuration | `DEFAULT_{ENTITY}_CONFIG` | `DEFAULT_AGENT_CONFIG` |
| Conversion function | `convert{Entity}LibraryItemToConfig` | `convertAgentLibraryItemToConfig` |

### 9.2 File Responsibilities

| File | Responsibility |
|------|------|
| `config.ts` | Runtime configuration interfaces, derived types |
| `library.ts` | CDN data structure interfaces |
| `defaults.ts` | Default configuration values |
| `converter.ts` | Item → Config conversion functions |
| `index.ts` | Unified export |
