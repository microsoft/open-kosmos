# Built-in Skill `sub-agent-creator` Implementation Plan

> Version: 1.1.0 | Date: 2026-03-02 | Based on OpenKosmos v1.21.8 Architecture
>
> **v1.1.0 Change Summary** (Based on Tech Review Revisions):
> - 🔧 §3 Directory Structure: Removed `package_agent.py` — AGENT.md is a single-file configuration, no packaging needed (unlike the `.skill` ZIP distribution model for Skills)
> - 🔧 §5 Script Design: Removed §5.3 `package_agent.py` section entirely
> - 🔧 §5.2 Validation Rules: `name`/`description` length limits aligned with `SubAgentFileManager` runtime (no length limits at runtime, script only issues advisory warnings)
> - 🔧 §7.3 CDN Publishing: `skills_lib.json` entry format corrected to actual `SkillLibraryItem` schema (only name/description/version/contact)
> - 🔧 §8.1 Execution Path: Changed to recommend `write_file` direct write to workspace + "Import from AGENT.md" two-step workflow, no Python script dependency
> - 🔧 §8.2 Write Path: Added key finding that SecurityValidator `agents/` directory is not whitelisted, with mitigation plan
> - 🔧 §8.5 Added: Opportunity analysis for `add_sub_agent_by_config` built-in tool
> - 🔧 §10 Implementation Plan: Removed `package_agent.py` related tasks, simplified Phase 2
> - 🔧 §11 Testing Strategy: Removed `package_agent.py` related test cases
> - 🔧 Appendix B Risk Assessment: Added SecurityValidator whitelist risk item
> - 🔧 Added §12 Tech Review Audit Record

---

## Table of Contents

1. [Background and Motivation](#1-background-and-motivation)
2. [Existing Architecture Analysis](#2-existing-architecture-analysis)
3. [Design Plan](#3-design-plan)
4. [SKILL.md Content Design](#4-skillmd-content-design)
5. [Script Design](#5-script-design)
6. [Reference Documentation Design](#6-reference-documentation-design)
7. [Registration and Installation Mechanism](#7-registration-and-installation-mechanism)
8. [Interaction with Existing Systems](#8-interaction-with-existing-systems)
9. [File Change List](#9-file-change-list)
10. [Implementation Plan](#10-implementation-plan)
11. [Testing Strategy](#11-testing-strategy)
12. [Tech Review Audit Record](#12-tech-review-audit-record)

---

## 1. Background and Motivation

### 1.1 Current State

OpenKosmos currently has a built-in skill `skill-creator` that guides AI Agents in creating new Skills. However, for Sub-Agent creation, users can only create them manually through UI forms or install pre-built Sub-Agents from the CDN library. **There is no capability for AI Agents to automatically create high-quality Sub-Agents through conversation.**

### 1.2 Goals

Add a new built-in skill `sub-agent-creator` to enable AI Agents to:

1. Understand the user's Sub-Agent requirements and guide them in clarifying the Sub-Agent's purpose
2. Generate complete Sub-Agent configurations conforming to the OpenKosmos AGENT.md specification
3. Automatically create AGENT.md files (written to the `agents/` directory)
4. Be compatible with Claude Code's Sub-Agent specification format
5. Include helper scripts such as validation

### 1.3 Design Principles

Maintain a consistent paradigm with `skill-creator`:

| Dimension | skill-creator | sub-agent-creator (this proposal) |
|------|--------------|---------------------------|
| Core File | `SKILL.md` | `SKILL.md` |
| Scripts | `init_skill.py`, `package_skill.py`, `quick_validate.py` | `init_agent.py`, `quick_validate.py` |
| Reference Docs | `references/workflows.md`, `references/output-patterns.md` | `references/agent-patterns.md`, `references/kosmos-extensions.md` |
| Output Artifact | `{skill-name}/SKILL.md` | `{agent-name}/AGENT.md` |
| Directory | `skills/{skill-name}/` | `agents/{agent-name}/` |

---

## 2. Existing Architecture Analysis

### 2.1 Sub-Agent Storage Architecture (Current State After File-Based Refactoring)

```
{userData}/profiles/{userAlias}/
├── profile.json
│   ├── sub_agents: SubAgentIndex[]     ← Lightweight index (name, version, source, remoteVersion)
│   └── chats[].agent.sub_agents: string[]  ← Agent-level name references
└── agents/                              ← File-based storage
    └── {agent-name}/
        └── AGENT.md                     ← YAML front-matter + Markdown body
```

### 2.2 AGENT.md Format Specification

```markdown
---
# Claude Code Standard Fields
name: code-reviewer
description: Expert code review specialist.
tools:
  - Read
  - Grep
model: inherit
maxTurns: 25
skills:
  - api-conventions
mcpServers:
  - github-server

# OpenKosmos Extension Fields
x-kosmos:
  display_name: Code Reviewer
  emoji: "🔍"
  version: "1.0.0"
  builtin_tools:
    - read_file
    - search_file_contents
  context_access: parent_summary
  workspace: ""
  knowledgeBase: ""
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: true
---

You are a senior code reviewer ensuring high standards of code quality...
```

### 2.3 SubAgentConfig Key Fields

| Category | Field | Description |
|----------|------|------|
| **Claude Code Standard** | `name` | Unique identifier (lowercase + digits + hyphens) |
| | `description` | Description used for AI delegation decisions |
| | `tools` | Claude Code tool list (Read, Grep, Bash...) |
| | `disallowedTools` | Disallowed tools list |
| | `model` | Model selection (inherit / specific model name) |
| | `maxTurns` | Maximum agent turns (default 25) |
| | `skills` | Preloaded Skills |
| | `mcpServers` | MCP server configuration |
| **OpenKosmos Extension** | `display_name` | UI display name |
| | `emoji` | Icon |
| | `version` | Version number |
| | `builtin_tools` | OpenKosmos built-in tools whitelist |
| | `context_access` | Context access mode (isolated / parent_summary / full_history) |
| | `workspace` | Independent workspace path |
| | `knowledgeBase` | Knowledge base path |
| | `inherit_mcp_servers` | Whether to inherit parent MCP servers |
| | `inherit_skills` | Whether to inherit parent Skills |
| | `inherit_knowledge_base` | Whether to inherit parent knowledge base |

### 2.4 Sub-Agent Runtime Limits

| Limit | Value |
|------|-----|
| Maximum parallel tasks | 5 |
| Maximum spawns per session | 20 |
| Default maximum turns | 25 |
| Context compression threshold | 60% |
| Tool result truncation threshold | 4,000 tokens |
| Sub-agents cannot spawn sub-agents | Recursion guard |

### 2.5 Built-in Skill Installation Mechanism

Built-in skills are guaranteed to always exist through three layers of safeguards:

1. **`BUILTIN_SKILL_NAMES`** (`src/shared/constants/builtinSkills.ts`): Declaration list
2. **FRE (First Run Experience)**: `FreSettingUpView.installBuiltinAssets()` installs from CDN
3. **Every Startup**: `StartupUpdateService` checks for missing skills and reinstalls
4. **Profile Loading**: `ProfileCacheManager` automatically adds built-in skills to agent's `skills[]`

**Skill Source**: Downloaded and installed from CDN `skills_lib.json`. The `resources/examples/skills/` directory contains **development source code** (for publishing to CDN) and does not directly participate in runtime installation.

---

## 3. Design Plan

### 3.1 Directory Structure

```
resources/examples/skills/sub-agent-creator/
├── SKILL.md                         ← Core: Sub-Agent creation guide
├── LICENSE.txt                      ← Apache License 2.0
├── scripts/
│   ├── init_agent.py                ← Create Sub-Agent directory and template AGENT.md
│   └── quick_validate.py            ← Validate AGENT.md format
└── references/
    ├── agent-patterns.md            ← Sub-Agent design patterns and best practices
    └── kosmos-extensions.md         ← OpenKosmos x-kosmos extension fields reference
```

### 3.2 SKILL.md Design Approach

Following the successful pattern of `skill-creator`, the `sub-agent-creator` SKILL.md should include:

1. **What is a Sub-Agent**: A concise explanation of Sub-Agents and their relationship to regular Agents
2. **Core Design Principles**: Effective system_prompt writing, proper tool/permission configuration
3. **AGENT.md File Format**: Complete format specification (YAML front-matter + Markdown body)
4. **Claude Code Compatibility**: Relationship between standard fields and OpenKosmos extension fields
5. **Creation Process**: 6-step process (consistent paradigm with skill-creator)
6. **Using Scripts**: `init_agent.py`, `quick_validate.py`

### 3.3 Key Differences from skill-creator

| Difference | skill-creator | sub-agent-creator |
|--------|--------------|-------------------|
| Output Format | SKILL.md (YAML has only name + description) | AGENT.md (YAML contains full configuration + x-kosmos extensions) |
| Output Content | body = AI instruction document | body = system_prompt |
| Configuration Complexity | Low (2 required fields) | High (20+ optional fields, split between Claude Code standard layer and OpenKosmos extension layer) |
| Resource Types | scripts/ + references/ + assets/ | No resource subdirectories for now (AGENT.md is self-contained) |
| Installation Target | `skills/{name}/SKILL.md` | `agents/{name}/AGENT.md` |
| Compatibility Requirements | None (OpenKosmos proprietary) | Must be compatible with Claude Code Sub-Agent specification |
| Runtime Constraints | None | Has explicit resource limits (parallelism, turns, recursion guard) |

---

## 4. SKILL.md Content Design

### 4.1 Frontmatter

```yaml
---
name: sub-agent-creator
description: Guide for creating effective OpenKosmos sub-agents. Use when users want to create a new sub-agent (or update an existing sub-agent) that can be delegated specialized tasks by a parent agent. Covers AGENT.md file format, YAML front-matter configuration, system prompt writing, tool/MCP/skill configuration, context access modes, and Claude Code compatibility.
license: Complete terms in LICENSE.txt
---
```

### 4.2 Body Structure Overview

```
# Sub-Agent Creator

## About Sub-Agents
  - What is a Sub-Agent
  - Sub-Agent vs Agent (role differences)
  - Runtime limits (parallelism, turns, recursion prohibition)
  - Context access modes (isolated / parent_summary / full_history)

## AGENT.md File Format
  - Format specification (YAML front-matter + Markdown body)
  - Required fields: name, description
  - Claude Code standard fields reference
  - OpenKosmos extension fields (x-kosmos namespace)
  - Complete example

## Core Principles
  - System Prompt writing principles (concise, actionable, task-oriented)
  - Tool configuration strategy (least privilege vs full inheritance)
  - Context access mode selection guide
  - Model selection strategy (inherit vs specific)

## Sub-Agent Creation Process
  Step 1: Understand the sub-agent's purpose and use cases
  Step 2: Plan configuration (tools, MCP, Skills, permissions)
  Step 3: Write AGENT.md (front-matter + system prompt)
  Step 4: Validate format (run quick_validate.py)
  Step 5: Import into OpenKosmos (Import from AGENT.md or write_file direct write)
  Step 6: Test and iterate

## Resources
  - scripts/init_agent.py: Create Sub-Agent directory and template
  - scripts/quick_validate.py: Validate AGENT.md format
  - references/agent-patterns.md: Common Sub-Agent design patterns
  - references/kosmos-extensions.md: OpenKosmos x-kosmos fields complete reference
```

### 4.3 Design Considerations

1. **Progressive Disclosure**: SKILL.md contains only core creation guidance (<500 lines); detailed field references and design patterns are split into the `references/` directory
2. **AGENT.md-Centric**: All creation workflows ultimately output an AGENT.md file
3. **Compatibility First**: Clearly distinguish Claude Code standard fields from OpenKosmos extension fields so users understand interoperability
4. **Example-Driven**: Include 3-4 complete AGENT.md examples covering different scenarios (code review, data analysis, documentation writing, research assistant)

---

## 5. Script Design

### 5.1 `scripts/init_agent.py`

**Function**: Create Sub-Agent directory and template AGENT.md

**Usage**:
```bash
python init_agent.py <agent-name> --path <output-directory>
```

**Logic**:
1. Validate `agent-name` format (lowercase letters + digits + hyphens, `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`)
2. Create `{agent-name}/` directory under the specified path
3. Generate template `AGENT.md` containing:
   - Complete YAML front-matter (name, description TODO, model: inherit, maxTurns: 25, x-kosmos defaults)
   - Markdown body template (structured TODO for system_prompt)
4. Print next-step instructions

**AGENT.md Template**:
```markdown
---
name: {agent_name}
description: "[TODO: Describe what this sub-agent does and when it should be delegated tasks. Be specific — the parent agent uses this to decide when to invoke this sub-agent.]"
model: inherit
maxTurns: 25

x-kosmos:
  display_name: "{agent_title}"
  emoji: "🤖"
  version: "1.0.0"
  context_access: isolated
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: true
---

[TODO: Write the system prompt for this sub-agent]

You are a specialized sub-agent for [TODO: purpose].

When invoked:
1. [TODO: First step]
2. [TODO: Second step]
3. [TODO: Third step]

Key guidelines:
- [TODO: Important guideline 1]
- [TODO: Important guideline 2]
```

### 5.2 `scripts/quick_validate.py`

**Function**: Validate AGENT.md format correctness

**Validation Rules**:

| Rule | Description |
|------|------|
| AGENT.md exists | Directory must contain an AGENT.md file |
| YAML frontmatter format | Delimited by `---`, starting at the first line |
| `name` required | Lowercase + digits + hyphens, matching `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` |
| `description` required | Non-empty string |
| `name` matches directory name | YAML name must match the directory name |
| `model` value valid | inherit / sonnet / opus / haiku / specific model name (advisory warning only) |
| `maxTurns` range | Integer between 1-100 |
| `context_access` value valid | isolated / parent_summary / full_history |
| `x-kosmos` namespace | OpenKosmos extension fields must be under x-kosmos |
| Markdown body non-empty | system_prompt cannot be empty |

> **Tech Review Revision**: The original `name` ≤64 character and `description` ≤1024 character limits have been removed — `SubAgentFileManager.validateAgentConfig()` at runtime **does not enforce length limits** (only checks non-empty and regex pattern). Script validation rules should align with runtime to avoid cases where the script passes but runtime fails (or vice versa). Length recommendations can be output as warnings rather than errors.

---

## 6. Reference Documentation Design

### 6.1 `references/agent-patterns.md`

**Content**: Common Sub-Agent design patterns and complete examples

```
# Sub-Agent Design Patterns

## 1. Tool Specialist
   Scenarios: Code review, file processing, data analysis
   Characteristics: Strict tools whitelist, isolated context
   Complete AGENT.md example

## 2. Research Assistant
   Scenarios: Information retrieval, document search, knowledge organization
   Characteristics: web search + file read tools, parent_summary context
   Complete AGENT.md example

## 3. Task Executor
   Scenarios: Command execution, deployment, automation scripts
   Characteristics: execute_command tool, independent workspace
   Complete AGENT.md example

## 4. Collaborative
   Scenarios: Tasks requiring awareness of parent conversation context
   Characteristics: full_history context, inherit MCP/Skills
   Complete AGENT.md example

## Anti-Patterns
   - Overly broad system_prompt
   - Unnecessary full_history context access
   - Excessively large maxTurns causing resource waste
   - Lack of clear task completion criteria
```

### 6.2 `references/kosmos-extensions.md`

**Content**: Complete reference for all extension fields under the `x-kosmos` namespace

```
# OpenKosmos Extension Fields Reference

## x-kosmos Namespace

All OpenKosmos-specific fields are placed under the x-kosmos key in YAML front-matter,
ensuring interoperability with the Claude Code standard format.

## Field Reference

### display_name (string)
  ... Purpose, default value, relationship to name

### emoji (string)
  ... Purpose, default value, recommended selection approach

### version (string, semver)
  ... Semantic version number

### builtin_tools (string[])
  ... OpenKosmos built-in tool identifier whitelist
  ... Relationship to Claude Code tools field
  ... Complete tool list reference

### disallow_builtin_tools (string[])
  ... Blocklist

### context_access (enum)
  ... Detailed semantics of isolated / parent_summary / full_history
  ... Selection guide and performance implications

### workspace (string)
  ... Independent workspace

### knowledgeBase (string)
  ... Knowledge base path

### inherit_mcp_servers / inherit_skills / inherit_knowledge_base (boolean)
  ... Inheritance mechanism details
  ... Merge rules (union deduplication, sub-agent takes precedence on name conflicts)

## Relationship Between Claude Code Standard Fields and OpenKosmos Fields
  ... tools vs builtin_tools
  ... mcpServers vs mcp_servers (compatibility mapping)
  ... maxTurns vs max_turns (compatibility mapping)
```

---

## 7. Registration and Installation Mechanism

### 7.1 Code Changes: Register as Built-in Skill

**File**: `src/shared/constants/builtinSkills.ts`

```typescript
// Before
export const BUILTIN_SKILL_NAMES: string[] = [
  'skill-creator',
];

// After
export const BUILTIN_SKILL_NAMES: string[] = [
  'skill-creator',
  'sub-agent-creator',
];
```

### 7.2 Installation Flow (No Additional Changes Needed)

After registering in `BUILTIN_SKILL_NAMES`, the existing three-layer safeguard mechanism takes effect automatically:

1. **FRE**: `FreSettingUpView.installBuiltinAssets()` iterates `BUILTIN_SKILL_NAMES` and installs automatically
2. **Startup Update**: `StartupUpdateService` checks the `BUILTIN_SKILLS` list and installs missing skills automatically from CDN
3. **Profile Loading**: `ProfileCacheManager` automatically adds built-in skills to agent.skills[] in `sanitizeAgent()`

### 7.3 CDN Publishing (Required)

> **Note**: Although `sub-agent-creator` is a built-in skill, CDN publishing **cannot be omitted**. In the current architecture, all built-in skill installation paths (FRE `installBuiltinAssets()`, `StartupUpdateService`, `install_skill_from_library` tool) download ZIP packages from CDN via `SkillLibraryFetcher.addSkill()`. **There is no fallback path for installing from the app's internal `resources/` directory.** If the skill cannot be found on CDN, FRE and startup updates will silently skip it (only outputting a warning log).

The `resources/examples/skills/sub-agent-creator/` directory needs to be:
1. Packaged as `sub-agent-creator-1.0.0.zip` and uploaded to CDN (`{cdnBaseUrl}/skills/`)
2. Add an entry in `skills_lib.json`:

```json
{
  "name": "sub-agent-creator",
  "description": "Guide for creating effective OpenKosmos sub-agents with AGENT.md format.",
  "version": "1.0.0"
}
```

> **Tech Review Revision**:
> - CDN entry strictly matches the `SkillLibraryItem` interface (`skillLibraryFetcher.ts`), with only `name`/`description`/`version`/`contact?` — 4 fields
> - CDN package format is ZIP (`{skillName}-{version}.zip`), downloaded and extracted by `SkillLibraryFetcher.addSkill()`
> - **Improvement Opportunity**: Currently there is no offline fallback. Consider adding a local installation degradation path from `resources/examples/skills/` in the future, but this does not block v1.0.0

### 7.4 Relationship with Agent Default Skills

**Current Behavior**: `ProfileCacheManager.sanitizeAgent()` automatically adds all skills in `BUILTIN_SKILL_NAMES` to each Agent's `skills[]`. This means **`sub-agent-creator` will automatically appear in all Agents' skills lists**.

**Assessment**: This is reasonable because:
- Sub-Agent management (spawn) is a capability any Agent might use
- Skills use Progressive Disclosure — only metadata (name + description ~100 tokens) stays in context permanently, body is loaded on demand
- Consistent with `skill-creator` behavior

**If restrictions are needed in the future**: A `BUILTIN_SKILL_CATEGORIES` field can be added in `builtinSkills.ts` to distinguish between "all agents" and "only agents with sub-agents configured." However, this optimization is not needed for v1.0.0.

---

## 8. Interaction with Existing Systems

### 8.1 Actual Execution Path for the Creation Flow

When an AI Agent uses the `sub-agent-creator` skill to assist users in creating a Sub-Agent, the **recommended** tool invocation chain is:

```
1. Agent reads skill guidance → read_file("skills/sub-agent-creator/SKILL.md") loads creation guide
2. After guiding the user to clarify requirements, directly use write_file to create AGENT.md in the workspace directory
3. (Optional) Validate format → execute_command("python scripts/quick_validate.py agents/my-agent")
4. User clicks the OpenKosmos UI "Import from AGENT.md (Claude Code)" button to import → registration complete
```

> **Tech Review Revision**: The original main path relied on `execute_command("python init_agent.py ...")`, which had two problems:
> 1. **Python Dependency**: The user's environment may not have Python or `pyyaml`
> 2. **Path Uncertainty**: The Agent needs to know the full path to `init_agent.py` (located in `skills/sub-agent-creator/scripts/`)
>
> **Better Recommended Path**: After understanding the AGENT.md format, the AI Agent **directly uses the `write_file` tool to generate the complete AGENT.md file** and writes it to the workspace. Benefits:
> - No external dependencies (Python not required)
> - The Agent's understanding of the AGENT.md format comes from SKILL.md guidance, resulting in higher generation quality
> - `init_agent.py` is retained as a command-line tool for advanced users but not as the main workflow entry point
>
> **SKILL.md should clearly instruct the Agent to**:
> 1. Prefer using `write_file` to directly create `{workspace}/agents/{name}/AGENT.md`
> 2. After creation, prompt the user to click "Import from AGENT.md" in OpenKosmos to import
> 3. Only fall back to `init_agent.py` if the user explicitly requests using a script

### 8.2 Write Path Considerations

When the AI Agent creates files via `write_file`, the correct path must be used:

| Scenario | Write Path | Follow-up Action |
|------|----------|----------|
| Agent has workspace configured | `{workspace}/agents/{name}/AGENT.md` | User clicks "Import from AGENT.md" |
| Agent has no workspace | Any user-accessible path | User clicks "Import from AGENT.md" and selects the file |

> **Tech Review Key Finding: SecurityValidator `agents/` Directory Not Whitelisted**
>
> `FileSecurityValidator.isPathInWhitelist()` (`fileSecurityValidator.ts`) currently **only whitelists the `skills/` directory**:
> ```typescript
> // pathParts[1] === 'skills' returns true
> ```
> The `agents/` directory is **not in the whitelist**. This means if an Agent attempts to use `write_file` to write to `{userData}/profiles/{alias}/agents/{name}/AGENT.md`, SecurityValidator will treat it as an out-of-bounds operation and trigger approval or rejection.
>
> **Mitigation Options** (choose one):
> 1. **(Recommended) Extend the whitelist**: Add `pathParts[1] === 'agents'` check in `isPathInWhitelist()`. This is the most lightweight change (1 line of code), treating `agents/` the same as `skills/`.
> 2. **Use workspace + Import path only**: Do not modify SecurityValidator; Agent writes to workspace instead of userData, and the user imports manually. However, this adds extra user steps.
>
> If option 1 is chosen, `fileSecurityValidator.ts` modification needs to be added to the **§9 File Change List**.

### 8.3 Relationship with Sub-Agent Management Built-in Tools

OpenKosmos currently has the following Sub-Agent related built-in tools:

| Tool | Purpose | Relationship with sub-agent-creator skill |
|------|------|----------------------------------|
| `spawn_subagent` | Spawn sub-agent at runtime | Unrelated — the skill handles "creating configuration," the tool handles "running instances" |
| `spawn_subagents` | Spawn multiple sub-agents in parallel | Unrelated |

> **Note**: There is currently **no** `add_sub_agent_by_config` type LLM-callable tool in the codebase. Sub-Agent add/update/delete operations are all performed through IPC at the UI layer (`subAgent:add`, `subAgent:update`, `subAgent:delete`). This differs from Agent management — Agent management already has `create_agent_from_config`, `update_agent`, and other built-in tools.

### 8.4 Relationship with sub-agent-file-based-refactoring

The `sub-agent-creator` skill inherently **depends on** the file-based refactoring (AGENT.md format) because:
- The creation flow centers around AGENT.md files as the core output artifact
- Scripts need to operate on the `agents/{name}/AGENT.md` directory structure
- Validation logic is based on the AGENT.md specification

The file-based refactoring is complete (`SubAgentFileManager` — 810 lines of code already shipped), so **there is no dependency blocker**.

### 8.5 Improvement Opportunity: `add_sub_agent_by_config` Built-in Tool

> **Added in Tech Review**

The current end-to-end flow for creating Sub-Agents requires users to manually "Import from AGENT.md." Following the pattern of Agent management's `create_agent_from_config` built-in tool, a new `add_sub_agent_by_config` built-in tool could be added to achieve **100% automated Sub-Agent creation** by AI Agents through conversation:

```
Current flow: Agent writes AGENT.md → User manually imports → Done
Ideal flow:   Agent calls add_sub_agent_by_config → Backend auto-writes AGENT.md + registers index → Done
```

**Assessment**:
- **Feasibility**: The `subAgent:add` IPC handler already supports creation from a `SubAgentConfig` object (complete flow of writing AGENT.md + updating profile index); it only needs to be wrapped as a built-in tool
- **Reference Implementation**: The `AddAgentByConfigTool` pattern (433 lines) can be directly reused
- **Relationship with skill**: Complementary — the skill provides creation knowledge and best practice guidance, the tool provides hands-free automation capability
- **Recommendation**: Target as a Phase 2 improvement; does not block v1.0.0 release. v1.0.0 uses the `write_file` + Import two-step flow first

---

## 9. File Change List

### 9.1 New Files

| File | Description |
|------|------|
| `resources/examples/skills/sub-agent-creator/SKILL.md` | Core skill definition |
| `resources/examples/skills/sub-agent-creator/LICENSE.txt` | Apache License 2.0 (reuse skill-creator's LICENSE) |
| `resources/examples/skills/sub-agent-creator/scripts/init_agent.py` | Sub-Agent initialization script |
| `resources/examples/skills/sub-agent-creator/scripts/quick_validate.py` | AGENT.md validation script |
| `resources/examples/skills/sub-agent-creator/references/agent-patterns.md` | Sub-Agent design patterns reference |
| `resources/examples/skills/sub-agent-creator/references/kosmos-extensions.md` | OpenKosmos x-kosmos fields reference |

### 9.2 Modified Files

| File | Change |
|------|------|
| `src/shared/constants/builtinSkills.ts` | Add `'sub-agent-creator'` to `BUILTIN_SKILL_NAMES` array |
| `src/main/lib/security/fileSecurityValidator.ts` | (Optional, see §8.2) Add `agents/` directory to `isPathInWhitelist()` whitelist |

### 9.3 Files That Do Not Need Modification

The following files **do not need changes** because they already operate dynamically based on `BUILTIN_SKILL_NAMES`:

| File | Reason |
|------|------|
| `src/renderer/components/fre/FreSettingUpView.tsx` | Iterates `BUILTIN_SKILL_NAMES`, automatically includes new skill |
| `src/main/lib/startupUpdate/startupUpdateService.ts` | Iterates `BUILTIN_SKILLS`, automatically checks and installs |
| `src/main/lib/userDataADO/profileCacheManager.ts` | Iterates `BUILTIN_SKILL_NAMES`, automatically adds to agent.skills[] |
| `src/renderer/components/skills/SkillListPanel.tsx` | `isBuiltinSkill()` automatically recognizes, prevents deletion |
| `src/main/lib/skill/skillManager.ts` | Installation flow is generic, not tied to specific skill names |

---

## 10. Implementation Plan

### Phase 1: Skill Content Creation (Estimated 2 days)

| Step | Task | Priority |
|------|------|--------|
| 1.1 | Write `SKILL.md` (core creation guide, <500 lines) | P0 |
| 1.2 | Write `references/agent-patterns.md` (4 design patterns + examples) | P0 |
| 1.3 | Write `references/kosmos-extensions.md` (x-kosmos fields complete reference) | P0 |
| 1.4 | Copy `LICENSE.txt` (same as skill-creator) | P0 |

### Phase 2: Script Development (Estimated 0.5 days)

| Step | Task | Priority |
|------|------|--------|
| 2.1 | Implement `scripts/init_agent.py` | P0 |
| 2.2 | Implement `scripts/quick_validate.py` | P0 |

### Phase 3: Registration and Integration (Estimated 0.5 days)

| Step | Task | Priority |
|------|------|--------|
| 3.1 | Modify `builtinSkills.ts` to register `sub-agent-creator` | P0 |
| 3.2 | Add entry to CDN `skills_lib.json` | P0 |
| 3.3 | Upload skill package to CDN | P0 |

### Phase 4: Testing (Estimated 0.5 days)

| Step | Task | Priority |
|------|------|--------|
| 4.1 | Script unit tests | P0 |
| 4.2 | FRE installation test | P0 |
| 4.3 | Startup update installation test | P1 |
| 4.4 | End-to-end creation flow test | P1 |

**Total: Approximately 3.5 working days**

---

## 11. Testing Strategy

### 11.1 Script Tests

| Test | Description |
|------|------|
| `init_agent.py` normal creation | Verify directory structure and AGENT.md template content are correct |
| `init_agent.py` duplicate creation | Verify error when directory already exists |
| `init_agent.py` invalid name | Verify name validation (uppercase letters, special characters, overly long) |
| `quick_validate.py` valid AGENT.md | Verify passes validation |
| `quick_validate.py` missing name | Verify reports error |
| `quick_validate.py` missing description | Verify reports error |
| `quick_validate.py` invalid YAML | Verify reports error |
| `quick_validate.py` name doesn't match directory name | Verify reports error |
| `quick_validate.py` empty system_prompt | Verify reports error |


### 11.2 Integration Tests

| Test | Description |
|------|------|
| FRE installation | Fresh profile, after FRE `sub-agent-creator` skill exists in `skills/` directory |
| Startup update | Manually delete skill directory and restart, verify automatic recovery |
| Agent auto-association | After creating a new Agent, `skills[]` automatically includes `sub-agent-creator` |
| Skill cannot be deleted | The delete button for `sub-agent-creator` is disabled in the UI |

### 11.3 End-to-End Tests

| Test | Description |
|------|------|
| Create Sub-Agent via conversation | Trigger the skill through Agent conversation, AI guides user to create AGENT.md |
| Generated AGENT.md can be imported | Successfully imported via "Import from AGENT.md" |
| Generated AGENT.md can be spawned | After import, spawning the Sub-Agent executes normally |

---

## Appendix A: Complete Comparison with skill-creator

| Dimension | skill-creator | sub-agent-creator |
|------|--------------|-------------------|
| **Registration Location** | `BUILTIN_SKILL_NAMES` | `BUILTIN_SKILL_NAMES` |
| **SKILL.md Line Count** | ~357 lines | Target <500 lines |
| **Number of Scripts** | 3 (init, package, validate) | 2 (init, validate) — AGENT.md does not need packaging |
| **Reference Docs** | 2 (workflows, output-patterns) | 2 (agent-patterns, kosmos-extensions) |
| **Frontmatter Fields** | name, description, license | name, description, license |
| **Output Artifact** | `{skill-name}/SKILL.md` | `{agent-name}/AGENT.md` |
| **Output Frontmatter** | Simple (name, description) | Complex (20+ fields, layered namespace) |
| **Output Body** | AI instruction document | system_prompt |
| **Creation Steps** | 6 steps | 5 steps (no packaging step) |
| **Installation Source** | CDN skills_lib.json | CDN skills_lib.json |
| **Installation Safeguards** | FRE + startup update + profile auto-fill | FRE + startup update + profile auto-fill |

## Appendix B: Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|--------|--------|------|
| SKILL.md content quality insufficient, causing AI-generated AGENT.md to be unusable | High | Medium | Include 4+ complete, tested AGENT.md examples; automatic validation via quick_validate |
| Python scripts cannot execute in user environment (no Python / no pyyaml) | Medium | Medium | Agent can fall back to directly creating AGENT.md using write_file, no script dependency |
| SecurityValidator whitelist does not include `agents/` directory, LLM write_file is blocked | High | High | Extend `isPathInWhitelist()` or guide LLM to write to workspace then manually import (see §8.2) |
| CDN publishing delay prevents new users from getting the skill | Medium | Low | Align with CDN publishing workflow, ensure skills_lib.json is updated in sync |
| AGENT.md format out of sync with file-based refactoring | High | Low | Format specifications in SKILL.md and references directly reference SubAgentFileManager.parseAgentMarkdown() implementation |
| All Agents automatically include this skill, increasing metadata token overhead | Low | High | ~100 tokens of metadata overhead is acceptable; refine the description field to control size |

---

## 12. Tech Review Audit Record

> **Review Version**: 1.1.0 | **Review Date**: 2025-01 | **Review Method**: Item-by-item verification against codebase

### 12.1 Issues Found Summary

| # | Severity | Issue | Section | Resolution |
|---|--------|------|----------|------|
| 1 | **HIGH** | `package_agent.py` is unnecessary — AGENT.md is a single-file configuration, unlike Skills that have multi-file directories requiring ZIP packaging | §3, §4, §5, §10, §11 | Removed. Script count reduced from 3→2, creation steps from 6→5 |
| 2 | **HIGH** | `FileSecurityValidator.isPathInWhitelist()` only whitelists `skills/` directory, `agents/` directory not included — LLM cannot directly write to userData agents path via `write_file` | §8 | Added detailed §8.2 describing the issue with two solution options (recommend extending whitelist) |
| 3 | **MEDIUM** | Original §5.2 validation rules included hard limits of name ≤30 chars / description ≤200 chars, but runtime `SubAgentFileManager.validateAgentConfig()` has no such limits | §5 | Changed to advisory warnings rather than hard limits, aligned with runtime |
| 4 | **MEDIUM** | Original §7.3 CDN schema used non-existent `display_name`/`emoji`/`source` fields; actual `SkillLibraryItem` interface only has `name`/`description`/`version`/`contact?` | §7 | Corrected to match actual interface |
| 5 | **MEDIUM** | Original §8 execution path over-relied on Python scripts, did not consider LLM's preferred path of directly generating AGENT.md via `write_file` | §8 | Rewritten; `write_file` → Import is now the preferred path, scripts are supplementary |
| 6 | **LOW** | Original document referenced non-existent `add_sub_agent` built-in tool | §8 | Corrected; added §8.5 analyzing `add_sub_agent_by_config` as a Phase 2 opportunity |
| 7 | **LOW** | `agentChat.ts` line 633 uses lowercase `skill.md` to load skill content, but actual filename is `SKILL.md` (uppercase). Works on Windows/macOS (case-insensitive), may fail on Linux | Codebase | Documented as known risk; does not affect this proposal but needs a follow-up fix |
| 8 | **INFO** | `SubAgentFileManager`'s `syncFromDisk()` only scans the profile-level `agents/` directory, does not proactively scan workspace — requires UI "Import" flow to trigger | §8 | Explicitly stated in §8.1 execution path |

### 12.2 Architecture Decision Record

| Decision | Rationale |
|------|------|
| **Retain Python scripts as auxiliary tools, not the sole path** | LLM can directly generate AGENT.md; scripts serve as convenient scaffold/validate tools; avoids hard Python dependency |
| **Do not create package_agent.py** | AGENT.md is a single file, unlike the SKILL.md skill directory that needs packaging for distribution |
| **Recommend extending SecurityValidator whitelist** | Enabling LLM to directly write to the agents directory is the shortest execution path, and agents has equivalent security model to skills |
| **Slim CDN entry to 4 fields** | Strictly match `SkillLibraryItem` interface to avoid frontend undefined errors |
| **List `add_sub_agent_by_config` as Phase 2** | Current import flow works but is suboptimal; a new built-in tool enables one-step completion but requires code changes, suitable for iteration |

### 12.3 Outstanding Items

1. **SecurityValidator whitelist extension** requires code changes (`fileSecurityValidator.ts`) and should be completed during implementation
2. **`agentChat.ts` `skill.md` casing issue** should be submitted as an independent fix PR
3. **`add_sub_agent_by_config` built-in tool** can be implemented as a follow-up enhancement after the sub-agent-creator skill is stable
4. **SKILL.md body quality** is a critical success factor — must include sufficient complete AGENT.md examples covering different patterns (research, tool-specialist, coding, coordination)
