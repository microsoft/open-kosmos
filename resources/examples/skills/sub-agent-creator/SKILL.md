---
name: sub-agent-creator
description: Guide for creating effective KOSMOS sub-agents. Use when users want to create a new sub-agent (or update an existing sub-agent) that can be delegated specialized tasks by a parent agent. Covers AGENT.md file format, YAML front-matter configuration, system prompt writing, tool/MCP/skill configuration, context access modes, and Claude Code compatibility.
license: Complete terms in LICENSE.txt
---

# Sub-Agent Creator

This skill provides guidance for creating effective KOSMOS sub-agents using the AGENT.md file format.

## About Sub-Agents

Sub-agents are specialized, task-scoped AI agents that a parent agent can delegate work to via `spawn_subagent` or `spawn_multiple_subagents` tools. They run as lightweight, non-streaming conversation loops with their own tool access, system prompt, and optional context inheritance.

### Sub-Agent vs Agent

| Aspect | Agent | Sub-Agent |
|--------|-------|-----------|
| Lifetime | Persistent across sessions | Ephemeral — dies after task completion |
| UI | Full chat interface | No direct UI — results returned to parent |
| Configuration | `profile.json` + chat sessions | `AGENT.md` file in `agents/{name}/` |
| Spawning | User-initiated | Parent agent-initiated via tool call |
| Nesting | Can spawn sub-agents | **Cannot** spawn sub-agents (recursive prevention) |

### Runtime Limits

| Limit | Value |
|-------|-------|
| Max parallel sub-agent tasks | 5 |
| Max spawns per chat session | 20 |
| Default max turns per sub-agent | 25 (configurable 1–100) |
| Context compression threshold | 60% |
| Tool result truncation | 4,000 tokens |
| Recursive spawning | Blocked — sub-agents cannot spawn sub-agents |

### Context Access Modes

Sub-agents can access the parent conversation's context at three levels:

- **`isolated`** (default): No parent context. Sub-agent works only with its own system prompt and the task description. Best for independent, self-contained tasks.
- **`parent_summary`**: Receives a condensed summary of the parent conversation. Good for tasks that need awareness of what the user discussed but don't need full details.
- **`full_history`**: Receives the full parent conversation history. Use sparingly — this consumes significant context window and is only needed when the sub-agent must understand the complete discussion.

## AGENT.md File Format

Every sub-agent is defined by a single `AGENT.md` file with YAML front-matter and a Markdown body:

```
agents/{agent-name}/
└── AGENT.md
```

### Structure

```markdown
---
# Claude Code standard fields
name: my-agent
description: What this sub-agent does and when to delegate to it.
model: inherit
maxTurns: 25

# KOSMOS extension fields (under x-kosmos namespace)
x-kosmos:
  display_name: My Agent
  emoji: "🤖"
  version: "1.0.0"
  context_access: isolated
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: true
---

System prompt goes here as Markdown body...
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier. Lowercase letters, digits, and hyphens only. Must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` |
| `description` | string | Concise explanation of what the sub-agent does and **when** to delegate to it. The parent agent uses this to decide when to invoke the sub-agent |

### Claude Code Standard Fields (optional)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tools` | string[] | (inherit all) | Claude Code tool names: Read, Grep, Glob, Bash, Write, Edit, etc. |
| `disallowedTools` | string[] | [] | Tools to explicitly deny |
| `model` | string | `inherit` | LLM model: `inherit` (same as parent) or specific model name |
| `maxTurns` | number | 25 | Maximum conversation turns (1–100) |
| `skills` | string[] | [] | Skill names to preload |
| `mcpServers` | array | [] | MCP server references or inline configs |

### KOSMOS Extension Fields (under `x-kosmos`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `display_name` | string | (from name) | Human-readable display name |
| `emoji` | string | 🤖 | Icon emoji |
| `version` | string | 1.0.0 | Semantic version |
| `builtin_tools` | string[] | [] | KOSMOS built-in tool whitelist (e.g., `read_file`, `write_file`, `execute_command`) |
| `disallow_builtin_tools` | string[] | [] | KOSMOS built-in tool blacklist |
| `context_access` | string | isolated | `isolated` / `parent_summary` / `full_history` |
| `workspace` | string | "" | Independent workspace path (empty = inherit parent) |
| `knowledgeBase` | string | "" | Knowledge base path |
| `inherit_mcp_servers` | boolean | true | Inherit parent's MCP server configs |
| `inherit_skills` | boolean | true | Inherit parent's skills |
| `inherit_knowledge_base` | boolean | true | Inherit parent's knowledge base |

For the complete field reference with detailed semantics, see [references/kosmos-extensions.md](references/kosmos-extensions.md).

## Core Principles

### System Prompt Writing

The Markdown body of AGENT.md becomes the sub-agent's system prompt. Follow these principles:

1. **Be task-oriented**: Start with "You are a specialized sub-agent for [specific purpose]." Clearly state what the sub-agent does.
2. **Be concise**: Sub-agents have limited turns. Every token in the system prompt reduces the working context. Aim for 200–500 words.
3. **Define clear completion criteria**: State explicitly what "done" looks like so the sub-agent knows when to stop.
4. **Include step-by-step instructions**: Numbered steps help the sub-agent execute methodically within its turn limit.
5. **Specify output format**: Define how results should be returned to the parent agent.

### Tool Configuration Strategy

- **Principle of least privilege**: Only grant tools the sub-agent actually needs.
- **`builtin_tools` whitelist**: When set (non-empty), the sub-agent can ONLY use listed tools. Prefer this for security-sensitive tasks.
- **`inherit_mcp_servers: true`**: Convenient for sub-agents that need the same external services as the parent. Set to `false` if the sub-agent should be sandboxed.
- **Claude Code `tools` field**: Maps to KOSMOS built-in tools automatically on import (e.g., `Read` → `read_file`, `Bash` → `execute_command`).

### Context Access Selection Guide

| Use Case | Recommended Mode | Reason |
|----------|-----------------|--------|
| Code review, file processing | `isolated` | Task is self-contained |
| Follow-up research based on conversation | `parent_summary` | Needs awareness, not full detail |
| Complex multi-step collaboration | `full_history` | Must understand full discussion |
| Data analysis, formatting | `isolated` | Independent of conversation |

Default to `isolated` unless there's a clear reason for broader access.

### Model Selection

- **`inherit`** (default): Uses the same model as the parent agent. Recommended for most cases.
- **Specific model**: Use when the sub-agent needs a different capability level (e.g., a simpler model for repetitive tasks, or a more capable model for complex reasoning).

## Sub-Agent Creation Process

Follow these steps to create a new sub-agent:

### Step 1: Understand the Sub-Agent's Purpose

Clarify with the user:
- What specific task will this sub-agent handle?
- When should the parent agent delegate to it?
- What tools and resources does it need?
- Does it need parent conversation context?

### Step 2: Plan Configuration

Based on the requirements, determine:
- **Tools needed**: Which built-in tools, MCP servers, and skills
- **Context access**: isolated, parent_summary, or full_history
- **Constraints**: maxTurns limit, workspace isolation
- **Inheritance**: Whether to inherit parent's MCP servers, skills, knowledge base

### Step 3: Write the AGENT.md

Use `write_file` to create `agents/{agent-name}/AGENT.md` in the current workspace with:
1. YAML front-matter with all configuration fields
2. Markdown body containing the system prompt

Prefer using `write_file` directly to create the complete AGENT.md file. This is the most reliable approach since it requires no external dependencies.

If the user prefers a scaffold template, the `scripts/init_agent.py` script can generate a starter AGENT.md:

```bash
python scripts/init_agent.py <agent-name> --path <output-directory>
```

### Step 4: Move to Profile Agents Directory

**⚠️ IMPORTANT**: The AGENT.md file created in Step 3 is in the chat workspace directory, but KOSMOS reads sub-agents from the **profile-level agents directory**. You must move the file to the correct location.

```
Source:      {workspace}/agents/{agent-name}/AGENT.md
Destination: C:/Users/<username>/AppData/Roaming/kosmos-app/profiles/<user_alias>/agents/{agent-name}/AGENT.md
```

Steps:
1. Ask the user for their KOSMOS profile alias, or help them find it
2. Use `execute_command` to move the entire `agents/{agent-name}/` folder to the profile agents directory

Example:
```bash
# Windows
move "{workspace}\agents\{agent-name}" "C:\Users\<username>\AppData\Roaming\kosmos-app\profiles\<user_alias>\agents\{agent-name}"

# macOS / Linux
mv "{workspace}/agents/{agent-name}" "~/Library/Application Support/kosmos-app/profiles/<user_alias>/agents/{agent-name}"
```

### Step 5: Sync and Test

After moving the AGENT.md file to the profile agents directory:
1. Tell the user to go to **Settings → Sub-Agents** and click the **Sync** button to reload sub-agent configurations
2. The sub-agent should now appear in the Sub-Agents list
3. Assign the sub-agent to a parent agent
4. Test by asking the parent agent to delegate an appropriate task
5. Verify the sub-agent executes correctly and returns useful results

Iterate on the system prompt and configuration based on test results.

## Common Design Patterns

For detailed patterns with complete AGENT.md examples, see [references/agent-patterns.md](references/agent-patterns.md):

1. **Tool Specialist** — Focused on specific tool operations (code review, file processing)
2. **Research Assistant** — Information retrieval and knowledge synthesis
3. **Task Executor** — Command execution and automation
4. **Collaborative** — Context-aware tasks requiring parent conversation awareness

## Complete Example

Here is a complete, production-ready AGENT.md for a code reviewer sub-agent:

```markdown
---
name: code-reviewer
description: Expert code review specialist. Delegate to this sub-agent when you need thorough code review with focus on bugs, security issues, performance, and best practices.
model: inherit
maxTurns: 15

x-kosmos:
  display_name: Code Reviewer
  emoji: "🔍"
  version: "1.0.0"
  builtin_tools:
    - read_file
    - search_text_in_files
    - search_files
  context_access: parent_summary
  inherit_mcp_servers: false
  inherit_skills: false
  inherit_knowledge_base: true
---

You are a senior code reviewer ensuring high standards of code quality.

When invoked with code to review:
1. Read the specified files using read_file
2. Analyze for: bugs, security vulnerabilities, performance issues, code style
3. Search for related patterns in the codebase using search_text_in_files
4. Return a structured review report

## Review Report Format

Return findings in this structure:

### Critical Issues
- [List any bugs or security vulnerabilities]

### Improvements
- [List performance and maintainability suggestions]

### Positive Observations
- [Note well-written code patterns]

### Summary
[One paragraph overall assessment with priority recommendations]

## Guidelines
- Focus on actionable feedback — every finding should have a suggested fix
- Prioritize: security > correctness > performance > style
- Reference specific line numbers when pointing out issues
- Keep the review concise — aim for quality over quantity
```

## Resources

- **scripts/init_agent.py**: Generate a starter AGENT.md template with proper structure
- **scripts/quick_validate.py**: Validate AGENT.md format and required fields
- **references/agent-patterns.md**: Four common sub-agent design patterns with complete examples
- **references/kosmos-extensions.md**: Complete reference for all KOSMOS `x-kosmos` extension fields
