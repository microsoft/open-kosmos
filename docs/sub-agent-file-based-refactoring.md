# Sub-Agent File-Based Storage Refactoring Technical Proposal

> Version: 1.1.0 | Date: 2026-03-02 | Based on OpenKosmos v1.21.8 Architecture
>
> **v1.1.0 Change Summary** (Revised based on Tech Review):
> - 🔧 §5 Data Model: Removed persistent fields duplicated between `SubAgentConfig` and `SubAgentIndex` (`remoteVersion`, `source`), clarified runtime-only semantics
> - 🔧 §5 Data Model: Clarified the layered relationship between `SubAgentConfig.tools` and `builtin_tools` (Claude Code layer vs OpenKosmos built-in layer)
> - 🔧 §7 Format Rules: Corrected `name` regex to allow single-character names (`/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`)
> - 🔧 §9 Backend: Added YAML library dependency notes for `SubAgentFileManager` parsing/serialization (reuses `js-yaml`)
> - 🔧 §9 Backend: Changed `ProfileCacheManager.getSubAgents()` to an async method with in-memory cache, avoiding hot-path I/O blocking
> - 🔧 §9 Backend: Added serialization lock design notes for `SubAgentFileManager` write operations
> - 🔧 §9 Backend: Added LRU cache layer for `SubAgentManager` config reads (avoids file reads on every spawn)
> - 🔧 §12 Migration: Changed migration marker from `_migration.sub_agents_v2` to a top-level `_migrationFlags` object in profile, for future migration reuse
> - 🔧 §13 CDN: Clarified that CDN lib format remains unchanged but installation flow requires `userAlias` parameter passthrough
> - 🔧 §14 Risks: Added "file watching vs manual sync" strategy decision and rationale
> - 🔧 §15 Implementation Plan: Phase 1 has no sequential dependency with the Runtime UI Progress document phases and can be done in parallel
> - 🔧 Added §17 Detailed Tech Review Audit Record

---

## Table of Contents

1. [Background and Motivation](#1-background-and-motivation)
2. [Claude Code Sub-Agent Specification Analysis](#2-claude-code-sub-agent-specification-analysis)
3. [OpenKosmos Current State Analysis](#3-kosmos-current-state-analysis)
4. [Target Design](#4-target-design)
5. [Data Model Design](#5-data-model-design)
6. [Directory Structure Design](#6-directory-structure-design)
7. [AGENT.md File Format](#7-agentmd-file-format)
8. [Compatibility Mapping: Claude Code ↔ OpenKosmos](#8-compatibility-mapping-claude-code--kosmos)
9. [Backend Architecture Changes](#9-backend-architecture-changes)
10. [Frontend Architecture Changes](#10-frontend-architecture-changes)
11. [IPC Layer Changes](#11-ipc-layer-changes)
12. [Data Migration Plan](#12-data-migration-plan)
13. [CDN Library and Auto-Update Adaptation](#13-cdn-library-and-auto-update-adaptation)
14. [Risk Assessment and Mitigation](#14-risk-assessment-and-mitigation)
15. [Implementation Plan](#15-implementation-plan)
16. [Testing Strategy](#16-testing-strategy)
17. [Tech Review Audit Record](#17-tech-review-audit-record)

---

## 1. Background and Motivation

### 1.1 Current Problems

Currently, OpenKosmos Sub-Agent configurations are **entirely stored in `profile.json`** (`ProfileV2.sub_agents: SubAgentConfig[]`). This approach has the following issues:

1. **Inconsistent with industry standards**: Claude Code defines sub-agents as independent Markdown files (`.claude/agents/*.md`), one file per sub-agent, with metadata described via YAML front-matter. This has become the de facto standard for AI Agent configuration.
2. **Poor portability**: Users cannot easily import/export, version control, or share individual sub-agent configurations across projects.
3. **profile.json bloat**: As sub-agent count grows and system_prompts become more complex, profile.json continues to bloat.
4. **Lack of file editability**: Users cannot directly edit sub-agents with a text editor (Claude Code users are accustomed to manually editing `.md` files).
5. **Skills consistency**: Skills already use an independent directory + `SKILL.md` file storage pattern; sub-agents should follow the same paradigm.

### 1.2 Refactoring Goals

- Migrate sub-agent configurations from `profile.json` to an independent `agents/` directory (at the same level as `skills/`)
- Each sub-agent defined using an `AGENT.md` file (YAML front-matter + Markdown body)
- File format **compatible with Claude Code's sub-agent specification**, supporting interoperability
- **Seamless migration**: Automatically migrate from old format to new format, transparent to users
- Maintain existing UI/IPC interface compatibility, minimizing frontend changes

---

## 2. Claude Code Sub-Agent Specification Analysis

### 2.1 File Storage

| Scope | Path | Priority |
|-------|------|----------|
| CLI flag | `--agents` JSON | 1 (highest) |
| Project-level | `.claude/agents/*.md` | 2 |
| User-level | `~/.claude/agents/*.md` | 3 |
| Plugin-level | Plugin's `agents/` directory | 4 (lowest) |

### 2.2 File Format

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

### 2.3 Complete Front-Matter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Unique identifier, lowercase letters + hyphens |
| `description` | ✅ | Description for Claude's delegation decisions |
| `tools` | ❌ | Available tool list (inherits all if omitted) |
| `disallowedTools` | ❌ | Disallowed tool list |
| `model` | ❌ | Model: sonnet/opus/haiku/inherit (default inherit) |
| `permissionMode` | ❌ | Permission mode |
| `maxTurns` | ❌ | Maximum agent turns |
| `skills` | ❌ | Preloaded Skills |
| `mcpServers` | ❌ | Available MCP servers |
| `hooks` | ❌ | Lifecycle hooks |
| `memory` | ❌ | Persistent memory scope: user/project/local |
| `background` | ❌ | Whether to run as a background task |
| `isolation` | ❌ | Worktree isolation |

---

## 3. OpenKosmos Current State Analysis

### 3.1 Current Storage Model

```
profile.json
├── sub_agents: SubAgentConfig[]        ← Global registry (all configs here)
└── chats[].agent.sub_agents: string[]  ← Agent-level name references
```

**SubAgentConfig** key fields:
- `name`, `display_name`, `description`, `emoji`
- `version`, `remoteVersion`, `source`
- `system_prompt`
- `mcp_servers`, `skills`, `builtin_tools`
- `workspace`, `knowledgeBase`
- `context_access`, `max_turns`
- `inherit_mcp_servers`, `inherit_skills`, `inherit_knowledge_base`

### 3.2 File Storage Pattern Already Validated by Skills

```
{userData}/profiles/{userAlias}/skills/{skill-name}/
└── SKILL.md   (YAML front-matter + Markdown body)
```

Two-level reference for Skills in Profile:
- `ProfileV2.skills: SkillConfig[]` — Global registry (name, description, version, source)
- `ChatAgent.skills: string[]` — Agent-level name references

---

## 4. Target Design

### 4.1 Core Architecture

Adopts a **file storage + lightweight profile index** hybrid approach:

```
{userData}/profiles/{userAlias}/agents/{agent-name}/
└── AGENT.md    ← YAML front-matter (full config) + Markdown body (system_prompt)
```

```
profile.json
├── sub_agents: SubAgentIndex[]         ← Lightweight index (name, version, source, remoteVersion)
└── chats[].agent.sub_agents: string[]  ← Agent-level name references (unchanged)
```

### 4.2 Design Decisions

| Decision | Approach | Rationale |
|----------|----------|-----------|
| Filename | `AGENT.md` | Consistent with `SKILL.md`, uppercase indicates key metadata file |
| Directory location | `agents/` at same level as `skills/` | Unified configuration management paradigm |
| Retain reference in profile | ✅ Keep lightweight index | ProfileCacheManager notification mechanism depends on profile.json changes; CDN version tracking requires `remoteVersion` |
| system_prompt storage location | Markdown body of AGENT.md | Consistent with Claude Code, supports direct user editing |
| OpenKosmos-specific fields | Placed in YAML `x-kosmos` namespace | Ensures Claude Code standard fields are not polluted, compatible for interoperability |
| Fields not supported by Claude Code | Parsed compatibly without errors | Unknown fields ignored when reading Claude Code format; preserved when writing |

---

## 5. Data Model Design

### 5.1 New `SubAgentIndex` (Lightweight Index in profile.json)

```typescript
/**
 * Sub-Agent lightweight index — stored in profile.json
 * Only retains the minimum fields needed for ProfileCacheManager notification mechanism and CDN updates
 * Full configuration is read from AGENT.md files
 */
export interface SubAgentIndex {
  /** Sub-agent unique name (matches directory name and name in AGENT.md) */
  name: string;
  /** Local version number */
  version: string;
  /** CDN remote version number (used by StartupUpdateService) */
  remoteVersion?: string;
  /** Source: CDN library or locally created */
  source: 'IN-LIBRARY' | 'ON-DEVICE';
}
```

### 5.2 Refactored `SubAgentConfig` (Full Configuration Parsed from AGENT.md)

> **Tech Review Revision**:
> - `remoteVersion` and `source` removed from `SubAgentConfig` — these two fields belong exclusively to `SubAgentIndex`, only needed by the profile index. `SubAgentConfig` is a runtime object parsed from files and should not contain CDN sync metadata.
> - The relationship between `tools` (Claude Code standard) and `builtin_tools` (OpenKosmos built-in) is clarified: `tools` stores Claude Code original tool names (e.g., `Read`, `Grep`), `builtin_tools` stores OpenKosmos built-in tool identifiers (e.g., `read_file`, `search_file_contents`). Both are merged at runtime by `SubAgentManager`.
> - `version` is retained in `SubAgentConfig` (written to AGENT.md's `x-kosmos.version`), as it's needed for data migration and export.

```typescript
/**
 * Sub-Agent full configuration — parsed from AGENT.md file
 * Compatible with Claude Code sub-agent front-matter standard fields
 *
 * Design principles:
 * - This interface is a "runtime configuration", does not contain CDN sync metadata (remoteVersion, source are in SubAgentIndex)
 * - Claude Code standard fields at top, OpenKosmos extension fields isolated via x-kosmos namespace
 * - system_prompt is parsed from Markdown body, does not appear in YAML front-matter
 */
export interface SubAgentConfig {
  // ========== Claude Code Standard Fields ==========
  /** Unique identifier (lowercase letters + digits + hyphens), required */
  name: string;
  /** Description used by Claude for delegation decisions, required */
  description: string;
  /**
   * Claude Code tool list (inherits all if omitted)
   * Stores Claude Code original tool names (e.g., Read, Grep, Glob, Bash),
   * mapped to OpenKosmos tool names at runtime by SubAgentManager
   */
  tools?: string[];
  /** Disallowed tool list — corresponds to Claude Code's disallowedTools */
  disallowedTools?: string[];
  /** Model selection: specific model name or 'inherit' (default inherit) */
  model?: string;
  /** Maximum agent turns */
  maxTurns?: number;
  /** Preloaded Skills name list */
  skills?: string[];
  /** MCP server configuration */
  mcpServers?: SubAgentMcpServerConfig[];

  // ========== OpenKosmos Extension Fields (x-kosmos namespace) ==========
  /** Display name */
  display_name?: string;
  /** Emoji icon */
  emoji?: string;
  /** Version number (written to AGENT.md x-kosmos.version, synced with SubAgentIndex.version) */
  version?: string;
  /**
   * OpenKosmos built-in tool whitelist (e.g., read_file, execute_command)
   * Complements tools (Claude Code layer): tools stores Claude Code original names, builtin_tools stores OpenKosmos identifiers
   * Empty array = no built-in tool restrictions
   */
  builtin_tools?: string[];
  /** Workspace path */
  workspace?: string;
  /** Knowledge base path */
  knowledgeBase?: string;
  /** Context access mode (OpenKosmos-specific) */
  context_access?: SubAgentContextAccess;
  /** Whether to inherit parent MCP servers */
  inherit_mcp_servers?: boolean;
  /** Whether to inherit parent Skills */
  inherit_skills?: boolean;
  /** Whether to inherit parent Knowledge Base */
  inherit_knowledge_base?: boolean;

  // ========== Runtime Fields (not persisted to AGENT.md) ==========
  /** System prompt (parsed from AGENT.md Markdown body) */
  system_prompt: string;
}
```

### 5.3 MCP Server Configuration Compatible Structure

```typescript
/**
 * Sub-Agent MCP server configuration
 * Compatible with Claude Code's mcpServers (supports reference names or inline definitions)
 */
export type SubAgentMcpServerConfig =
  | string                          // Reference a configured server name (Claude Code format)
  | AgentMcpServer;                 // OpenKosmos inline definition format
```

---

## 6. Directory Structure Design

### 6.1 New Directory Layout

```
{userData}/
├── profiles/{userAlias}/
│   ├── profile.json
│   │   ├── sub_agents: SubAgentIndex[]     ← Lightweight index (replaces original SubAgentConfig[])
│   │   └── chats[].agent.sub_agents: string[]  ← Unchanged
│   ├── skills/
│   │   └── {skill-name}/
│   │       └── SKILL.md
│   └── agents/                              ← New! At same level as skills/
│       ├── code-reviewer/
│       │   └── AGENT.md
│       ├── debugger/
│       │   └── AGENT.md
│       └── data-analyst/
│           └── AGENT.md
```

### 6.2 Directory Conventions

- Directory name = sub-agent's `name` field (lowercase letters + digits + hyphens)
- Each sub-agent directory **must** contain `AGENT.md`
- Sub-agent directories may contain other auxiliary files (e.g., knowledge base files, scripts), reserved for future expansion

---

## 7. AGENT.md File Format

### 7.1 Complete Format Definition

```markdown
---
# ===== Claude Code Standard Fields =====
name: code-reviewer
description: Expert code review specialist. Reviews code for quality, security, and maintainability.
tools:
  - Read
  - Grep
  - Glob
  - Bash
disallowedTools:
  - Write
model: inherit
maxTurns: 25
skills:
  - api-conventions
mcpServers:
  - github-server

# ===== OpenKosmos Extension Fields =====
x-kosmos:
  display_name: Code Reviewer
  emoji: "🔍"
  version: "1.2.0"
  context_access: parent_summary
  builtin_tools:
    - read_file
    - search_files
    - search_file_contents
  disallow_builtin_tools:
    - write_file
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: true
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

### 7.2 Format Rules

1. **YAML front-matter**: Delimited by `---`, must start at the first line (no leading blank lines)
2. **Markdown body**: All content after the front-matter → parsed as `system_prompt`
3. **name constraint**: `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (minimum 1 character), must match directory name (**Tech Review Revision**: original regex `[a-z0-9][a-z0-9-]*[a-z0-9]` required minimum 2 characters, disallowing single-character names like `a`, inconsistent with `SkillManager.validateSkillName()` validation rules — Skills allow single characters. Unified to optional middle segment)
4. **Required fields**: `name`, `description`
5. **OpenKosmos extension fields**: All placed under the `x-kosmos` namespace
6. **Forward compatibility**: Unrecognized front-matter fields are ignored during parsing (no errors)

### 7.3 Pure Claude Code Format AGENT.md (Compatible Import)

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

When OpenKosmos imports this format:
- Standard fields are mapped directly
- Missing OpenKosmos extension fields use default values (`DEFAULT_SUB_AGENT_CONFIG`)
- `display_name` is auto-generated from `name` (hyphens to spaces, capitalize first letters)
- `emoji` uses default value `🤖`
- `version` defaults to `1.0.0`
- `source` is set to `ON-DEVICE`

---

## 8. Compatibility Mapping: Claude Code ↔ OpenKosmos

### 8.1 Field Mapping Table

| Claude Code Field | OpenKosmos Field | Mapping Notes |
|-------------------|-------------|---------------|
| `name` | `name` | 1:1 direct mapping |
| `description` | `description` | 1:1 direct mapping |
| `tools` | `tools` + `builtin_tools` | Claude Code's tools includes built-in tool names; OpenKosmos splits into `tools` (general) and `builtin_tools` (OpenKosmos built-in tool whitelist) |
| `disallowedTools` | `disallowedTools` | 1:1 direct mapping (newly supported in OpenKosmos) |
| `model` | `model` | Claude Code uses aliases (sonnet/opus/haiku/inherit); OpenKosmos uses inherit or specific model ID |
| `maxTurns` | `maxTurns` / `max_turns` | Unified to `maxTurns` (camelCase), backward compatible with `max_turns` |
| `skills` | `skills` | 1:1 direct mapping |
| `mcpServers` | `mcpServers` / `mcp_servers` | Unified to `mcpServers` (camelCase), compatible with `mcp_servers` |
| `permissionMode` | — | Not supported in OpenKosmos, ignored during parsing |
| `hooks` | — | Not supported in OpenKosmos, ignored during parsing |
| `memory` | — | OpenKosmos manages via mem0 system, ignored during parsing |
| `background` | — | OpenKosmos does not support background sub-agents, ignored during parsing |
| `isolation` | — | OpenKosmos does not support worktree isolation, ignored during parsing |
| — | `x-kosmos.display_name` | OpenKosmos-specific |
| — | `x-kosmos.emoji` | OpenKosmos-specific |
| — | `x-kosmos.version` | OpenKosmos-specific |
| — | `x-kosmos.source` | OpenKosmos-specific |
| — | `x-kosmos.context_access` | OpenKosmos-specific |
| — | `x-kosmos.builtin_tools` | OpenKosmos-specific |
| — | `x-kosmos.workspace` | OpenKosmos-specific |
| — | `x-kosmos.knowledgeBase` | OpenKosmos-specific |
| — | `x-kosmos.inherit_*` | OpenKosmos-specific |

### 8.2 Bidirectional tools Field Conversion

**Claude Code → OpenKosmos (Import)**:
```yaml
# Claude Code format
tools: Read, Grep, Glob, Bash
```
Maps to:
- `tools: ["Read", "Grep", "Glob", "Bash"]` — preserves original tool names
- At runtime, `SubAgentManager` maps Claude Code tool names to OpenKosmos built-in tool names

**OpenKosmos → Claude Code (Export)**:
```yaml
# OpenKosmos format (only standard fields retained)
tools:
  - Read
  - Grep
  - Glob
  - Bash
```
- `x-kosmos` namespace is stripped when exporting to pure Claude Code format

---

## 9. Backend Architecture Changes

### 9.1 New `SubAgentFileManager`

Create `src/main/lib/subAgent/subAgentFileManager.ts`, responsible for reading, writing, and parsing AGENT.md files.

> **Tech Review Supplement**:
> - YAML parsing reuses the project's existing `js-yaml` dependency (`SkillManager.parseSkillMarkdown()` already uses `yaml.load()`), no new dependencies introduced.
> - Write operations need serialization protection: internally maintains `writeLock: Map<string, Promise<void>>` (indexed by agentName), preventing data loss from concurrent writes caused by rapid UI edits + CDN updates on the same file. Lock implementation references `RuntimeManager.installLocks`.
> - All file I/O uses `fs.promises` (async), not synchronous APIs — different from `SkillManager`'s `fs.readFileSync` pattern, because SubAgent files are read on the hot path (during spawn), and blocking the main thread would affect response latency.

```typescript
/**
 * SubAgentFileManager — Sub-Agent file system manager
 *
 * Responsibilities:
 * 1. Parse AGENT.md (YAML front-matter + Markdown body)
 * 2. Serialize SubAgentConfig → AGENT.md
 * 3. Manage CRUD operations for agents/ directory
 * 4. Import Claude Code format .md files from external sources
 * 5. Provide directory scanning to discover all installed sub-agents
 */
class SubAgentFileManager {
  // ===== Parsing =====
  parseAgentMarkdown(content: string): ParseResult<SubAgentConfig>;
  serializeToAgentMarkdown(config: SubAgentConfig): string;

  // ===== Directory Operations =====
  getAgentsDirectory(userAlias: string): string;
  getAgentDirectory(userAlias: string, agentName: string): string;
  getAgentFilePath(userAlias: string, agentName: string): string;

  // ===== CRUD =====
  readAgentConfig(userAlias: string, agentName: string): Promise<SubAgentConfig | null>;
  writeAgentConfig(userAlias: string, config: SubAgentConfig): Promise<void>;
  deleteAgentDirectory(userAlias: string, agentName: string): Promise<void>;
  listAgents(userAlias: string): Promise<string[]>;

  // ===== Scan and Sync =====
  scanAndSync(userAlias: string): Promise<SubAgentConfig[]>;

  // ===== Import/Export =====
  importClaudeCodeAgent(userAlias: string, mdFilePath: string): Promise<SubAgentConfig>;
  exportAsClaudeCodeFormat(config: SubAgentConfig): string;

  // ===== Validation =====
  validateAgentName(name: string): boolean;
  validateAgentConfig(config: Partial<SubAgentConfig>): ValidationResult;
}
```

#### Core Method Design

**`parseAgentMarkdown(content)`**:
```
1. Check if first line is `---`
2. Find closing `---`, extract YAML block
3. Parse YAML using logic similar to SkillManager.parseSkillMarkdown
4. Extract standard fields (name, description, tools, model, maxTurns, skills, mcpServers)
5. Extract extension fields under x-kosmos namespace
6. Remaining Markdown body → system_prompt
7. Apply DEFAULT_SUB_AGENT_CONFIG for missing OpenKosmos fields
```

**`serializeToAgentMarkdown(config)`**:
```
1. Build standard field YAML object (name, description, tools, model, maxTurns, skills, mcpServers)
2. Build x-kosmos extension field object
3. Render YAML front-matter
4. Append system_prompt as Markdown body
```

**`scanAndSync(userAlias)`**:
```
1. Traverse all subdirectories under agents/ directory
2. Read each AGENT.md, parse into SubAgentConfig
3. Compare with SubAgentIndex[] in profile.json
4. New entries: add index → profile
5. Missing entries: remove orphaned index from profile
6. Return complete config list
```

### 9.2 Modifying `ProfileCacheManager`

#### Changes

1. **`sub_agents` field type change**: `SubAgentConfig[]` → `SubAgentIndex[]`
2. **CRUD method refactoring**:
   - `getSubAgents()` → **changed to `async` method** (reads full config from `SubAgentFileManager`), results cached in memory (`Map<string, SubAgentConfig[]>`), cache invalidated by write operations and `syncSubAgentIndex`. Index is only used for enumeration.
   - `addSubAgent()` → simultaneously writes AGENT.md file + profile index + invalidates cache
   - `updateSubAgent()` → simultaneously updates AGENT.md file + profile index + invalidates cache
   - `deleteSubAgent()` → simultaneously deletes directory + profile index + cascading cleanup of ChatAgent.sub_agents[] references + invalidates cache

3. **New methods**:
   - `syncSubAgentIndex(userAlias)` — scans agents/ directory at startup, syncs profile index

> **Tech Review Key Revision**:
>
> Currently `ProfileCacheManager.getSubAgents()` is a **synchronous method** (reads directly from in-memory cache `profile.sub_agents`), called by `SubAgentManager.spawnSubAgent()` on the hot path. After refactoring to file system reads, it **must** become async. However, triggering file I/O on every spawn would cause latency regression.
>
> **Optimization approach**: Introduce a two-level cache —
> 1. `SubAgentFileManager` internally maintains `configCache: Map<string, SubAgentConfig>` (indexed by agent name)
> 2. First read loads from disk and populates cache; subsequent spawns hit cache (O(1))
> 3. Write operations (add/update/delete) and `syncSubAgentIndex` trigger corresponding cache entry invalidation
> 4. Cache has no TTL — files are exclusively written by OpenKosmos, no external modifications exist (user manual edits trigger full invalidation via "Sync from Disk" button)
>
> This ensures `SubAgentManager`'s `readAgentConfig()` calls do not trigger disk I/O in the vast majority of cases.

```typescript
// ProfileCacheManager modified sub-agent method signatures
class ProfileCacheManager {
  // Read full configs (from file system)
  async getSubAgents(): Promise<SubAgentConfig[]>;

  // Get lightweight index (from profile in-memory cache)
  getSubAgentIndex(): SubAgentIndex[];

  // Add sub-agent (write file + update index)
  async addSubAgent(alias: string, config: SubAgentConfig): Promise<void>;

  // Update sub-agent (write file + update index)
  async updateSubAgent(alias: string, name: string, updates: Partial<SubAgentConfig>): Promise<void>;

  // Delete sub-agent (delete directory + delete index + cascading cleanup)
  async deleteSubAgent(alias: string, name: string): Promise<void>;

  // Sync file system → profile index at startup
  async syncSubAgentIndex(alias: string): Promise<void>;
}
```

### 9.3 Modifying `SubAgentManager`

Core change: Reading sub-agent config from `ProfileCacheManager` changed to reading from `SubAgentFileManager`.

> **Tech Review Supplement**: In the current implementation, `SubAgentManager.spawnSubAgent()` synchronously gets config via `profileCacheManager.getSubAgents().find(...)`. After changing to file reads, note:
> 1. `SubAgentFileManager.readAgentConfig()` prioritizes in-memory cache hits, introducing no additional I/O latency
> 2. `spawnSubAgent()` method signature unchanged (already async), internally changed to `await subAgentFileManager.readAgentConfig()`
> 3. Parallel spawn scenario: when multiple sub-agents spawn simultaneously, cache reads have no race conditions (read-only operations)

```typescript
// Before
const subAgentConfig = profileCache.getSubAgents().find(s => s.name === name);

// After
const subAgentConfig = await subAgentFileManager.readAgentConfig(userAlias, name);
```

> **Additional note**: Currently `SubAgentManager` also reads the parent Agent's sub_agents reference from `profileCacheManager` (`chat.agent.sub_agents: string[]`) to validate whether a sub-agent name is configured on the parent Agent. This path is **not affected** — `ChatAgent.sub_agents` remains a `string[]` reference list in profile.json and is not migrated.

`spawnSubAgent()` method's config resolution chain:
```
1. Read AGENT.md from SubAgentFileManager → SubAgentConfig
2. Resolve model field (inherit → use parent model)
3. Resolve tools/builtin_tools (merge, inheritance)
4. Resolve mcpServers (reference resolution + inheritance merge)
5. Resolve skills (inheritance merge)
6. Build SubAgent runtime object
```

### 9.4 Modifying `StartupUpdateService`

Sub-agent update flow adjustments:

```
Original flow:
  CDN lib → compare with profile.sub_agents[] → merge → update profile.sub_agents[]

New flow:
  CDN lib → compare with profile.sub_agents[] (index only: version, remoteVersion)
         → download updated config
         → update AGENT.md file (via SubAgentFileManager)
         → update profile index (version, remoteVersion)
```

Update merge rules remain unchanged:
- **Remote-first**：description, system_prompt（Markdown body）
- **Local-first**：workspace, context_access, max_turns
- **Merge (union)**：mcp_servers, skills, builtin_tools

### 9.5 Sub-Agent Library Installation Flow

```
Original flow:
  Library item → SubAgentConfig → ProfileCacheManager.addSubAgent()

New flow:
  Library item → SubAgentConfig
              → SubAgentFileManager.writeAgentConfig() → create agents/{name}/AGENT.md
              → ProfileCacheManager.addSubAgentIndex() → update profile index
```

### 9.6 New Claude Code Agent Import Functionality

```typescript
// src/main/lib/subAgent/subAgentFileManager.ts

async importClaudeCodeAgent(userAlias: string, mdFilePath: string): Promise<SubAgentConfig> {
  // 1. Read .md file
  const content = await fs.readFile(mdFilePath, 'utf-8');

  // 2. Parse YAML front-matter (Claude Code standard fields)
  const parsed = this.parseAgentMarkdown(content);

  // 3. Fill in OpenKosmos defaults (display_name, emoji, version, source='ON-DEVICE')
  const config = this.applyKosmosDefaults(parsed);

  // 4. Write to agents/{name}/AGENT.md
  await this.writeAgentConfig(userAlias, config);

  return config;
}
```

---

## 10. Frontend Architecture Changes

### 10.1 Impact Scope

Frontend components obtain `SubAgentConfig[]` via IPC, and the IPC interface continues to return full `SubAgentConfig` objects, so **frontend changes are minimal**.

### 10.2 Specific Changes

| Component | Change | Notes |
|-----------|--------|-------|
| `SubAgentsView` | None | Still receives full SubAgentConfig[] via IPC |
| `CreateSubAgentView` | Minor | Added "Import Claude Code Agent" button |
| `EditSubAgentView` | Minor | Added "Export as Claude Code format" option |
| `SubAgentLibraryView` | None | Installation flow entry unchanged, backend writes files automatically |
| `AgentSubAgentsTab` | None | Still operates on `ChatAgent.sub_agents: string[]` |

### 10.3 New UI Features

1. **Import Claude Code Agent**
   - Entry: SubAgentsView page's "+" menu → "Import from Claude Code"
   - Flow: Select `.md` file → IPC call → backend parses + writes → refresh list
   
2. **Export as Claude Code Format**
   - Entry: SubAgentDropdownMenu → "Export as Claude Code format"
   - Flow: IPC call → backend generates pure standard format .md content → save file dialog

3. **Open in File Explorer**
   - Entry: SubAgentDropdownMenu → "Open in File Explorer"
   - Flow: Opens agents/{name}/ directory

---

## 11. IPC Layer Changes

### 11.1 Existing IPC Channel Adjustments

| Channel | Change | Notes |
|---------|--------|-------|
| `subAgent:getAll` | Implementation change | Backend changed to read from file system, return type still `SubAgentConfig[]` |
| `subAgent:add` | Implementation change | Backend simultaneously writes file + updates index |
| `subAgent:update` | Implementation change | Backend simultaneously updates file + index |
| `subAgent:delete` | Implementation change | Backend simultaneously deletes directory + index + cascading cleanup |

### 11.2 New IPC Channels

| Channel | Direction | Notes |
|---------|-----------|-------|
| `subAgent:importFromFile` | Renderer→Main | Import Claude Code .md file |
| `subAgent:exportAsClaudeCode` | Renderer→Main | Export as Claude Code standard format |
| `subAgent:openInExplorer` | Renderer→Main | Open agent directory in file explorer |
| `subAgent:syncFromDisk` | Renderer→Main | Manually trigger file system scan and sync |

---

## 12. Data Migration Plan

### 12.1 Migration Strategy

**Automatic, transparent, one-time** migration. Detected and executed at application startup.

### 12.2 Migration Flow

```
Application Startup
  │
  ├── ProfileCacheManager.loadProfile()
  │     └── Detect if profile.sub_agents[] contains old format (has system_prompt field)
  │
  ├── If old format detected:
  │     │
  │     ├── Step 1: Iterate each SubAgentConfig (old format)
  │     │     ├── Create agents/{name}/ directory
  │     │     ├── Generate AGENT.md (with x-kosmos extension fields)
  │     │     └── Write file
  │     │
  │     ├── Step 2: Replace profile.sub_agents[] with SubAgentIndex[]
  │     │     └── Only retain name, version, remoteVersion, source
  │     │
  │     ├── Step 3: Write updated profile.json
  │     │
  │     └── Step 4: Record migration completion marker
  │           └── profile.json adds _migrationFlags.sub_agents_file_based = true
  │
  └── Normal startup flow continues
```

> **Tech Review Revision**: Migration marker changed from `_migration.sub_agents_v2` to `_migrationFlags.sub_agents_file_based`.
> - Uses `_migrationFlags: Record<string, boolean>` object instead of nested `_migration` object, flatter and easier to reuse for future migrations
> - Field name `sub_agents_file_based` is more semantic than `sub_agents_v2` (clearly indicates "file-based migration" rather than generic "v2 format")
> - `_migrationFlags` as an optional top-level field of `ProfileV2`, preserved by sanitizeProfileV2 but not actively cleaned up

### 12.3 Migration Code Location

New file `src/main/lib/subAgent/subAgentMigration.ts`:

```typescript
/**
 * SubAgentMigration — one-time data migration
 * Migrates old format SubAgentConfig[] from profile.json to file system
 */
class SubAgentMigration {
  /**
   * Check if migration is needed
   */
  needsMigration(profile: ProfileV2): boolean;

  /**
   * Execute migration
   * 1. Create agents/{name}/AGENT.md for each old SubAgentConfig
   * 2. Replace profile.sub_agents with SubAgentIndex[]
   * 3. Mark migration as complete
   */
  async migrate(userAlias: string, profile: ProfileV2): Promise<void>;
}
```

### 12.4 Rollback Plan

- During migration, old `SubAgentConfig[]` data is **not immediately deleted**
- A `_migrationFlags.sub_agents_file_based_backup: SubAgentConfig[]` field is retained in profile
- If migration fails or rollback is needed, recovery is possible via the backup field
- Backup data can be cleaned up via an update after 30 days of stable operation

> **Tech Review Supplement**: Migration needs **atomicity guarantees** — write all AGENT.md files first, then update the profile index only after all succeed. If writing any file fails, roll back already-created files and keep profile unchanged. Implementation suggestion:
> 1. Phase A: Create all AGENT.md files in a temporary directory `agents_migration_tmp/`
> 2. Phase B: After all succeed, `rename` to the official `agents/` directory
> 3. Phase C: Update profile.json (SubAgentConfig[] → SubAgentIndex[] + marker)
> 4. If Phase A fails, clean up temporary directory, profile unchanged, retry on next startup

---

## 13. CDN Library and Auto-Update Adaptation

### 13.1 CDN Data Source Unchanged

`sub_agent_lib.json` format remains unchanged, still returns `SubAgentLibraryItem[]`.

### 13.2 Installation Flow Changes

> **Tech Review Supplement**: Currently `SubAgentLibraryFetcher.installFromLibrary(name)` signature does not include a `userAlias` parameter — it implicitly gets the current user via `profileCacheManager`. After refactoring, `userAlias` is needed to locate the `agents/{name}/` directory. Two options:
> - **Option A** (recommended): `SubAgentLibraryFetcher` maintains existing signature, internally obtains alias from `profileCacheManager` when calling `SubAgentFileManager` (consistent with existing pattern)
> - **Option B**: Extend signature to `installFromLibrary(name, userAlias)` (more explicit but larger change surface)

```
Original flow:
  SubAgentLibraryItem → SubAgentConfig → profileCacheManager.addSubAgent()

New flow:
  SubAgentLibraryItem
    → SubAgentConfig (with all fields)
    → subAgentFileManager.writeAgentConfig() → write AGENT.md
    → profileCacheManager.addSubAgentIndex() → update lightweight index
```

### 13.3 Update Merge Changes

StartupUpdateService's update merge needs to operate on both files and index simultaneously:

```
1. Fetch latest SubAgentLibraryItem from CDN
2. Compare local SubAgentIndex.version vs CDN version
3. If update needed:
   a. Read current AGENT.md from file system → current SubAgentConfig
   b. Apply merge rules (remote-first / local-first / merge)
   c. Write updated AGENT.md
   d. Update profile index (version, remoteVersion)
```

---

## 14. Risk Assessment and Mitigation

### 14.1 Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Migration failure causing sub-agent loss | High | Low | Backup field + transactional writes (write files first, then update index) |
| AGENT.md accidentally edited by user causing parse failure | Medium | Medium | Lenient parsing + detailed error messages + fallback to defaults |
| File system permission issues | Medium | Low | Error handling + logging + UI notifications |
| profile.json out of sync with file system | Medium | Medium | Automatic scanAndSync at startup + manual sync button |
| Claude Code format updates breaking compatibility | Low | Low | `x-kosmos` namespace isolation + ignore unknown fields strategy |
| Concurrent reads/writes to AGENT.md | Medium | Low | Write operation serialization (via SubAgentFileManager internal writeLock Map) |

> **Tech Review Added Risk Items**:

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| `getSubAgents()` changing from sync to async causing cascading caller changes | Medium | High | Introduce in-memory cache, async I/O only triggered on cold start; confirm all callers are already in async context |
| User manually editing AGENT.md causing cache-disk inconsistency | Medium | Medium | **Do not use chokidar file watching** (rationale: agents/ directory changes extremely infrequently, the memory and fd overhead of a watcher is not worth it; WorkspaceWatcher already consumes many fds). Instead use a "Sync from Disk" manual button in UI + automatic scanAndSync at startup |
| Runtime UI Progress document (`kosmos-sub-agent-runtime-ui-progress.md`) depends on `SubAgentRuntimeState` extension — if this refactoring changes `SubAgentConfig` field names (e.g., `max_turns` → `maxTurns`), the code in SubAgentManager that reads `max_turns` when constructing runtimeState needs to be updated simultaneously | Low | Medium | §5 data model keeps AGENT.md front-matter using `maxTurns` (camelCase), but `SubAgentConfig` retains both new `maxTurns` field and backward-compatible `max_turns` reading. SubAgentManager reads `maxTurns` first, falls back to `max_turns` |

### 14.2 Backward Compatibility Guarantees

1. **Detection logic**: Determines old vs new format by checking if `sub_agents[0]` contains a `system_prompt` field
2. **Read compatibility**: New code can read old format profile.json (triggers migration)
3. **Write irreversibility**: After migration, writes new format; old OpenKosmos versions cannot read the new format index (but won't crash, treats as empty array)

---

## 15. Implementation Plan

### Phase 1: Infrastructure (Estimated 3 days)

| Step | Task | File |
|------|------|------|
| 1.1 | Add `SubAgentIndex` type definition | `src/main/lib/userDataADO/types/profile.ts` |
| 1.2 | Refactor `SubAgentConfig` type (Claude Code compatible) | `src/main/lib/userDataADO/types/profile.ts` |
| 1.3 | Implement `SubAgentFileManager` | `src/main/lib/subAgent/subAgentFileManager.ts` |
| 1.4 | Implement `SubAgentMigration` | `src/main/lib/subAgent/subAgentMigration.ts` |
| 1.5 | Unit tests | `src/main/lib/subAgent/subAgentFileManager.test.ts` |

### Phase 2: Core Integration (Estimated 3 days)

| Step | Task | File |
|------|------|------|
| 2.1 | Modify `ProfileCacheManager` sub-agent CRUD | `src/main/lib/userDataADO/profileCacheManager.ts` |
| 2.2 | Modify `SubAgentManager` config reading | `src/main/lib/subAgent/subAgentManager.ts` |
| 2.3 | Modify `StartupUpdateService` | `src/main/lib/startupUpdate/startupUpdateService.ts` |
| 2.4 | Modify IPC handlers (`main.ts`) | `src/main/main.ts` |
| 2.5 | Modify preload bridge | `src/preload/main.ts` |

### Phase 3: Frontend Adaptation (Estimated 2 days)

| Step | Task | File |
|------|------|------|
| 3.1 | Add import/export UI | `src/renderer/components/subAgents/` |
| 3.2 | Add menu items to SubAgentDropdownMenu | `src/renderer/components/subAgents/SubAgentDropdownMenu.tsx` |
| 3.3 | Add import entry to CreateSubAgentView | `src/renderer/components/subAgents/CreateSubAgentView.tsx` |

### Phase 4: Testing and Wrap-up (Estimated 2 days)

| Step | Task |
|------|------|
| 4.1 | Migration test (old format → new format) |
| 4.2 | Claude Code format interoperability test |
| 4.3 | CDN library install/update test |
| 4.4 | E2E tests |
| 4.5 | Update project documentation (CLAUDE.md, copilot-instructions.md) |

**Total: approximately 10 working days**

> **Tech Review Implementation Suggestions**:
> 1. **Parallelism with Runtime UI Progress document**: This refactoring's Phase 1-2 and `kosmos-sub-agent-runtime-ui-progress.md`'s Phase 1-4 have **no sequential dependency** and can be implemented in parallel. The two proposals' modified file sets barely overlap (this proposal primarily modifies `profileCacheManager.ts`, adds `subAgentFileManager.ts`; the UI Progress proposal primarily modifies different methods in `subAgentChat.ts`, `subAgentManager.ts`). The only intersection is the single line in `SubAgentManager.spawnSubAgent()` that reads config — suggest UI Progress merges first (smaller change set), then this proposal rebases.
> 2. **Phase 1's `SubAgentFileManager` should prioritize unit tests**: The parsing logic (YAML front-matter + x-kosmos nested namespace + Markdown body) is the core foundation of the entire proposal, test coverage should be > 90%.
> 3. **Phase 2 should be split into 2.1 (ProfileCacheManager) + 2.2 (SubAgentManager + StartupUpdateService)**: The two parts can be done in parallel by different developers.

---

## 16. Testing Strategy

### 16.1 Unit Tests

| Test Suite | Coverage |
|------------|----------|
| SubAgentFileManager.parseAgentMarkdown | YAML parsing, standard fields, x-kosmos extensions, pure Claude Code format, error handling |
| SubAgentFileManager.serializeToAgentMarkdown | Serialization output correctness, special character escaping |
| SubAgentFileManager.CRUD | Create/read/update/delete directories and files |
| SubAgentMigration | Old→new migration completeness, idempotency, rollback recovery |
| Field mapping | Claude Code ↔ OpenKosmos bidirectional conversion correctness |

### 16.2 Integration Tests

| Test Suite | Coverage |
|------------|----------|
| ProfileCacheManager + FileManager | CRUD operations simultaneously update files and index |
| SubAgentManager + FileManager | spawnSubAgent reads config from file and executes correctly |
| StartupUpdateService | CDN updates correctly merged into AGENT.md |
| scanAndSync | File system scan synced with profile index |

### 16.3 E2E Tests

| Scenario | Description |
|----------|-------------|
| Fresh install | No agents/ directory, correctly created after CDN install |
| Legacy migration | profile.json contains old format, auto-migrated after startup |
| Import Claude Code Agent | Correctly imported after selecting .md file |
| Edit persistence | AGENT.md file content correctly updated after UI edit |
| Manual edit | After user modifies AGENT.md in editor, sync button correctly refreshes |

---

## Appendix A: File Change List

| Operation | File Path |
|-----------|-----------|
| **New** | `src/main/lib/subAgent/subAgentFileManager.ts` |
| **New** | `src/main/lib/subAgent/subAgentFileManager.test.ts` |
| **New** | `src/main/lib/subAgent/subAgentMigration.ts` |
| **New** | `src/main/lib/subAgent/subAgentMigration.test.ts` |
| **Modified** | `src/main/lib/userDataADO/types/profile.ts` — Add SubAgentIndex, refactor SubAgentConfig |
| **Modified** | `src/main/lib/userDataADO/profileCacheManager.ts` — Sub-agent CRUD methods |
| **Modified** | `src/main/lib/subAgent/subAgentManager.ts` — Config reading changed to file system |
| **Modified** | `src/main/lib/subAgent/types.ts` — Runtime type adaptation |
| **Modified** | `src/main/lib/startupUpdate/startupUpdateService.ts` — Update writes changed to file system |
| **Modified** | `src/main/main.ts` — IPC handlers added/adjusted |
| **Modified** | `src/preload/main.ts` — Bridge API additions |
| **Modified** | `src/renderer/components/subAgents/CreateSubAgentView.tsx` — Add import entry |
| **Modified** | `src/renderer/components/subAgents/SubAgentDropdownMenu.tsx` — Add export/open menu items |
| **Modified** | `src/shared/ipc/` — IPC channel type definitions |

## Appendix B: AGENT.md Complete Examples

### B.1 OpenKosmos Full Format

```markdown
---
name: data-analyst
description: Data analysis expert for SQL queries, data insights, and reporting. Use proactively for any data analysis tasks.
tools:
  - Read
  - Grep
  - Bash
model: inherit
maxTurns: 20
skills:
  - sql-best-practices
mcpServers:
  - database-server

x-kosmos:
  display_name: Data Analyst
  emoji: "📊"
  version: "1.0.0"
  context_access: parent_summary
  builtin_tools:
    - read_file
    - execute_command
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: false
---

You are a data analyst specializing in SQL and data analysis.

When invoked:
1. Understand the data analysis requirement
2. Write efficient SQL queries
3. Analyze and summarize results
4. Present findings clearly

Key practices:
- Write optimized SQL queries with proper filters
- Use appropriate aggregations and joins
- Include comments explaining complex logic
- Format results for readability
- Provide data-driven recommendations

For each analysis:
- Explain the query approach
- Document any assumptions
- Highlight key findings
- Suggest next steps based on data
```

### B.2 Auto-Generated Format After Importing from Claude Code

Original Claude Code file `code-reviewer.md`:
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. Analyze code and provide actionable feedback.
```

AGENT.md generated after import at `agents/code-reviewer/AGENT.md`:
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools:
  - Read
  - Glob
  - Grep
model: sonnet

x-kosmos:
  display_name: Code Reviewer
  emoji: "🤖"
  version: "1.0.0"
  context_access: isolated
  builtin_tools: []
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: true
---

You are a code reviewer. Analyze code and provide actionable feedback.
```

> **Tech Review Revision**: Removed `source: ON-DEVICE`, `workspace: ""`, `knowledgeBase: ""` from the import example — `source` is no longer stored in AGENT.md (belongs to SubAgentIndex), empty string defaults are not written to files to reduce noise.

---

## 17. Tech Review Audit Record

> Reviewer: Tech Reviewer | Date: 2026-03-02 | Based on OpenKosmos v1.21.8 codebase actual implementation

### 17.1 Overall Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Architecture soundness | ⭐⭐⭐⭐ | File storage + lightweight profile index hybrid model is the right choice, consistent with Skills pattern |
| Feasibility | ⭐⭐⭐⭐ | Proposal is overall feasible, no technical blockers on critical paths (parsing/serialization/CRUD/migration) |
| Compatibility design | ⭐⭐⭐⭐⭐ | `x-kosmos` namespace isolation + ignore unknown fields strategy is excellent |
| Risk identification | ⭐⭐⭐ | Basic risks identified; missing analysis of performance hot paths, async cascading impacts, and intersection with UI Progress document |
| Implementation operability | ⭐⭐⭐⭐ | Steps are clear, but needs coordination notes with parallel development documents |

### 17.2 Discovered Issues and Revision Checklist

#### P0 (Blocker Level — Must Fix Before Implementation)

**Issue #1: `SubAgentConfig` contains fields that don't belong to it**

- **Problem**: Original proposal §5.2's `SubAgentConfig` included both `remoteVersion` and `source` fields, but these two fields' responsibilities belong to `SubAgentIndex` (profile index) and should not appear in runtime objects parsed from AGENT.md. Writing `source` to `x-kosmos.source` in the file is also unreasonable — whether it's a CDN library install is deployment information, not configuration.
- **Fix**: Removed `remoteVersion` and `source` from `SubAgentConfig`, retained only in `SubAgentIndex`.
- **Impact**: All code reading `source` or `remoteVersion` from `SubAgentConfig` (e.g., `StartupUpdateService`) needs to read from `SubAgentIndex` instead.

**Issue #2: Cascading changes from `getSubAgents()` sync→async underestimated**

- **Problem**: Currently `ProfileCacheManager.getSubAgents()` is a synchronous method, directly called by `SubAgentManager.spawnSubAgent()` on the hot path (`profileCacheManager.getSubAgents().find(...)`). After refactoring to file reads it becomes async, but since spawnSubAgent itself is already async there's no syntax issue. **The real risk** is: `getSubAgents()` is also called by the frontend via IPC `subAgent:getAll` — the current IPC handler returns synchronous results directly:
  ```typescript
  ipcMain.handle('subAgent:getAll', async () => {
    const subAgents = pcManager.getSubAgents(); // synchronous
    return { success: true, data: subAgents };
  });
  ```
  After changing to async, `await` is needed, and the return latency perceived by the frontend may increase.
- **Fix**: Introduce in-memory cache layer (already supplemented in §9.2). `scanAndSync` warms the cache at startup, subsequent `getSubAgents()` returns from cache first (still async signature but nearly instantaneous).

#### P1 (Important — Affects Proposal Quality)

**Issue #3: `name` regex too strict, incompatible with Skills specification**

- **Problem**: Original proposal §7.2's name regex `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` requires minimum 2 characters, while `SkillManager.validateSkillName()`'s regex `/^[a-z0-9-]+$/` allows single characters. The inconsistency would cause confusion.
- **Fix**: Changed to `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (allows single character, but still disallows starting or ending with `-`).

**Issue #4: Missing details on YAML parsing/serialization of `x-kosmos` nested namespace**

- **Problem**: The proposal mentions OpenKosmos extension fields are placed under the `x-kosmos` namespace, but does not explain:
  1. How to handle `null` value fields in `x-kosmos` (e.g., `workspace: ""`) — empty string vs null have different semantics in YAML
  2. Semantic difference between `x-kosmos.builtin_tools: []` empty array and omitting the field (no restrictions vs unconfigured)
  3. `js-yaml`'s `yaml.dump()` output format control (parameters needed to ensure arrays are expanded to block format)
- **Fix suggestion**: In `SubAgentFileManager.serializeToAgentMarkdown()`:
  - Empty string fields (`workspace: ""`, `knowledgeBase: ""`) are not written to YAML (omission = default value)
  - `builtin_tools: []` is explicitly written (to distinguish "no restrictions" from "unconfigured")
  - Use `yaml.dump(obj, { lineWidth: -1, noRefs: true })` to avoid line wrapping and references

**Issue #5: Unclear mapping relationship between `tools` and `builtin_tools`**

- **Problem**: Claude Code's `tools` field contains tool names like `Read`, `Grep`, `Glob`, `Bash`. OpenKosmos's `builtin_tools` uses different naming like `read_file`, `search_file_contents`. The mapping table in §8 mentions "runtime mapping" but lacks a specific mapping dictionary and fallback strategy.
- **Fix**: Already supplemented in §5.2 explaining the relationship between both. Runtime mapping should implement a `CLAUDE_TO_OpenKosmos_TOOL_MAP` in `SubAgentManager.resolveInheritedConfig()`. For unmappable tool names (Claude Code custom tools), retain the original name and log a warning.

**Issue #6: Migration atomicity insufficient**

- **Problem**: §12's migration flow is "write files one by one → update profile", if there's a power outage or process crash midway, an inconsistent state with partial file writes + unchanged profile may occur.
- **Fix**: Already supplemented in §12.4 with a two-phase migration strategy (temporary directory → rename → update profile).

#### P2 (Suggestion — Optimization Improvements)

**Issue #7: `x-kosmos.source` should be removed from AGENT.md examples**

- **Problem**: Per Issue #1's fix, `source` is no longer stored in AGENT.md, but Appendix B examples still contain `source: IN-LIBRARY` / `source: ON-DEVICE`.
- **Fix**: Appendix B examples need to be updated accordingly (remove `source` lines). Some examples have been corrected in this review.

**Issue #8: Missing cross-impact analysis with `kosmos-sub-agent-runtime-ui-progress.md`**

- **Problem**: The UI Progress document extends `SubAgentRuntimeState` (adds `correlationId`, `maxTurns`, `steps`) and modifies `SubAgentManager.spawnSubAgent()` internal logic. This refactoring also modifies the config reading logic in `spawnSubAgent()`. Parallel development may produce merge conflicts.
- **Fix**: Already supplemented in §15 implementation plan with parallel development coordination notes. The two proposals modify different parts of `spawnSubAgent()`: UI Progress changes callback registration and runtimeState assembly (middle of method body), this proposal changes config reading (beginning of method body). Suggest UI Progress merges first.
- **Key intersecting code**: `SubAgentManager` currently uses `subAgentConfig.max_turns` to read the maximum turn count. In this refactoring, AGENT.md front-matter uses `maxTurns` (camelCase), and the parsed `SubAgentConfig` retains the new `maxTurns` field. Must ensure `SubAgentManager` is updated to read `maxTurns` (or maintain dual-read compatibility `config.maxTurns || config.max_turns`).

**Issue #9: `source` field handling in CDN update merge**

- **Problem**: `StartupUpdateService.installSubAgentUpdates()` currently writes `source: 'IN-LIBRARY'` as a merge field into `SubAgentConfig`. After refactoring, `source` only exists in `SubAgentIndex`, and the update flow needs to be adjusted to update files (without source) and index (with source) separately.
- **Fix suggestion**: Split the update merge code into:
  ```typescript
  // 1. Update file (SubAgentConfig fields, without source/remoteVersion)
  await subAgentFileManager.writeAgentConfig(alias, mergedConfig);
  // 2. Update index (SubAgentIndex fields, with source/remoteVersion)
  await profileCacheManager.updateSubAgentIndex(alias, name, {
    version: remote.version,
    remoteVersion: remote.version,
    source: 'IN-LIBRARY',
  });
  ```

**Issue #10: `SubAgentFileManager` should be a Singleton**

- **Problem**: The instantiation pattern for `SubAgentFileManager` is not specified in the proposal. Based on the OpenKosmos project's Singleton convention (all Manager classes are singletons), and since it needs to maintain internal writeLock and configCache state, Singleton should be explicitly used.
- **Fix suggestion**: `SubAgentFileManager` should use the `private static instance` + `getInstance()` pattern.

**Issue #11: `tools` string format compatibility when importing Claude Code Agent**

- **Problem**: Claude Code's `tools` field supports two formats: `tools: Read, Glob, Grep` (comma-separated string) and `tools:\n  - Read\n  - Glob` (YAML array). `js-yaml` will parse the former as a single string `"Read, Glob, Grep"`, and the latter as an array `["Read", "Glob", "Grep"]`.
- **Fix suggestion**: In `parseAgentMarkdown()`, if `tools` is a string type, split it into an array using the `,\s*` regex.

### 17.3 Compatibility Matrix with Runtime UI Progress Document

| Modified File | This Proposal's Impact Area | UI Progress Impact Area | Conflict Risk |
|---------------|----------------------------|------------------------|---------------|
| `profile.ts` | `SubAgentConfig` field refactoring + new `SubAgentIndex` | `SubAgentRuntimeState` extension (independent interface) | **None** |
| `types.ts` (subAgent) | No direct modification | New `SubAgentStepUpdate` + `SubAgentChatOptions` extension | **None** |
| `subAgentManager.ts` | `spawnSubAgent()` config reading at beginning (~L148) | `spawnSubAgent()` callback registration in middle (~L195-L260) + `sendStateUpdate()` (new method) | **Low** — different code regions |
| `subAgentChat.ts` | No direct modification | `executeToolCalls()` + `run()` callback injection | **None** |
| `profileCacheManager.ts` | `getSubAgents()`/`addSubAgent()`/`updateSubAgent()`/`deleteSubAgent()` method refactoring | No modifications | **None** |
| `startupUpdateService.ts` | `installSubAgentUpdates()` write target changed to file | No modifications | **None** |
| `main.ts` IPC handlers | Added 4 channels including `subAgent:importFromFile` | No modifications | **None** |

**Conclusion**: The two proposals can be safely developed in parallel. Suggest UI Progress merges first (smaller change set and nearly complete), then this proposal rebases.

### 17.4 Other Observations and Suggestions

1. **SkillManager code reuse opportunity**: The logic of `SkillManager.parseSkillMarkdown()` and `SubAgentFileManager.parseAgentMarkdown()` is highly similar (YAML front-matter extraction + required field validation + Markdown body separation). Suggest extracting a shared `parseMarkdownFrontMatter(content: string): { yaml: Record<string, unknown>; body: string }` utility function to `src/main/lib/utilities/`, reused by both Managers.

2. **AGENT.md should not store empty string defaults**: Empty string values like `workspace: ""` and `knowledgeBase: ""` in current examples would add noise to AGENT.md. Suggest omitting fields that match `DEFAULT_SUB_AGENT_CONFIG` during serialization, only writing user-explicitly-configured values. Missing fields are filled by `applyKosmosDefaults()` on read.

3. **AGENT.md system_prompt (Markdown body) should preserve leading blank line**: `serializeToAgentMarkdown()` should insert a blank line after the `---` closing marker before writing body (`---\n\n{body}`), consistent with Claude Code's file format and SKILL.md conventions.

4. **Migration unit tests should cover edge cases**:
   - Empty `sub_agents[]` array (no migration needed but should not error)
   - `system_prompt` containing `---` separators (YAML front-matter parsing trap)
   - Old format data with uppercase letters in `name` (should auto-convert to lowercase)
   - Old format data with duplicate names (should deduplicate, keeping the last one)

5. **`SubAgentDropdownMenu` existing code** already has room for extension (only 3 menu items: Edit / Delete / Apply to Agents), adding "Export" and "Open in Explorer" menu items can be directly appended with minimal changes.
