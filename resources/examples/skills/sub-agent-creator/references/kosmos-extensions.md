# KOSMOS Extension Fields Reference

All KOSMOS-specific fields are placed under the `x-kosmos` key in the YAML front-matter to ensure interoperability with the Claude Code sub-agent specification.

```yaml
---
# Claude Code standard fields (top level)
name: my-agent
description: What this agent does.

# KOSMOS extension fields (namespaced)
x-kosmos:
  display_name: My Agent
  emoji: "🤖"
  version: "1.0.0"
  # ... other KOSMOS-specific fields
---
```

## Field Reference

### display_name

- **Type**: string
- **Default**: Auto-generated from `name` (e.g., `code-reviewer` → `Code Reviewer`)
- **Purpose**: Human-readable name shown in the KOSMOS UI.
- **Relationship to `name`**: `name` is the machine identifier (lowercase, hyphenated); `display_name` is the UI label.

```yaml
x-kosmos:
  display_name: Code Reviewer Pro
```

### emoji

- **Type**: string (single emoji character)
- **Default**: `🤖`
- **Purpose**: Visual icon displayed alongside the sub-agent in the KOSMOS UI.
- **Recommendation**: Choose an emoji that represents the sub-agent's function.

```yaml
x-kosmos:
  emoji: "🔍"  # Code reviewer
  emoji: "📚"  # Research assistant
  emoji: "🏗️"  # Build runner
  emoji: "📝"  # Document writer
```

### version

- **Type**: string (semantic versioning)
- **Default**: `1.0.0`
- **Purpose**: Version tracking for the sub-agent configuration. Used by the Startup Update Service for CDN-distributed sub-agents.
- **Format**: Follow [semver](https://semver.org/) — `MAJOR.MINOR.PATCH`

```yaml
x-kosmos:
  version: "1.2.0"
```

### builtin_tools

- **Type**: string[] (array of tool identifiers)
- **Default**: `[]` (empty = no restriction, sub-agent can use all available tools)
- **Purpose**: Whitelist of KOSMOS built-in tools this sub-agent is allowed to use. When non-empty, the sub-agent can ONLY use tools in this list.

**Available tools** (common subset):

| Tool ID | Description |
|---------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `search_files` | Search for files by name pattern |
| `search_text_in_files` | Search text content within files (ripgrep) |
| `execute_command` | Execute shell commands |
| `fetch_web_content` | Fetch and read web page content |
| `bing_web_search` | Search the web via Bing |
| `bing_image_search` | Search images via Bing |
| `google_web_search` | Search the web via Google |
| `google_image_search` | Search images via Google |
| `read_office_files` | Read Office documents (docx, xlsx, pptx) |
| `append_to_file` | Append content to existing file |
| `move_file` | Move or rename files |
| `download_and_save_file` | Download a URL and save to disk |

```yaml
x-kosmos:
  builtin_tools:
    - read_file
    - search_text_in_files
    - execute_command
```

**Relationship to Claude Code `tools`**: The `tools` field at the top level uses Claude Code tool names (e.g., `Read`, `Grep`, `Bash`). On import, KOSMOS automatically maps these to `builtin_tools` equivalents:

| Claude Code Tool | KOSMOS builtin_tool |
|-----------------|-------------------|
| Read | read_file |
| Grep | search_text_in_files |
| Glob | search_files |
| Bash | execute_command |
| Write | write_file |
| Edit | write_file |

### disallow_builtin_tools

- **Type**: string[] (array of tool identifiers)
- **Default**: `[]`
- **Purpose**: Blacklist of KOSMOS built-in tools. These tools are removed from the sub-agent's available tool set at runtime.
- **Usage**: Use when you want to inherit most tools but exclude specific dangerous ones.

```yaml
x-kosmos:
  disallow_builtin_tools:
    - execute_command
    - write_file
```

**Relationship to Claude Code `disallowedTools`**: Same mapping as `tools` → `builtin_tools`, applied inversely.

### context_access

- **Type**: enum string
- **Default**: `isolated`
- **Valid values**: `isolated`, `parent_summary`, `full_history`
- **Purpose**: Controls how much of the parent agent's conversation context the sub-agent receives.

| Value | Description | Token Cost | Use When |
|-------|-------------|------------|----------|
| `isolated` | No parent context — only task description and system prompt | Lowest | Task is self-contained (code review, formatting, independent analysis) |
| `parent_summary` | Condensed summary of parent conversation | Medium | Sub-agent needs awareness of discussion context but not exact messages |
| `full_history` | Full parent conversation history | Highest | Sub-agent must understand exact conversation flow (documentation, follow-up tasks) |

```yaml
x-kosmos:
  context_access: parent_summary
```

**Performance note**: `full_history` can consume a significant portion of the sub-agent's context window, leaving less room for tool results and reasoning. Use only when genuinely necessary.

### workspace

- **Type**: string (file path)
- **Default**: `""` (empty = inherit parent agent's workspace)
- **Purpose**: Sets an independent workspace directory for the sub-agent. File operations are scoped to this directory.

```yaml
x-kosmos:
  workspace: "/path/to/isolated/workspace"
```

**When to use**: When the sub-agent should operate in a different directory than the parent (e.g., a build agent working in a temp directory, a documentation agent writing to a docs folder).

### knowledgeBase

- **Type**: string (file path)
- **Default**: `""`
- **Purpose**: Path to a knowledge base directory for the sub-agent.
- **Interaction with `inherit_knowledge_base`**:
  - Non-empty: Uses specified path regardless of inheritance setting
  - Empty + `inherit_knowledge_base: true`: Inherits parent's knowledge base
  - Empty + `inherit_knowledge_base: false`: No knowledge base

```yaml
x-kosmos:
  knowledgeBase: "/path/to/knowledge"
```

### inherit_mcp_servers

- **Type**: boolean
- **Default**: `true`
- **Purpose**: Whether to inherit the parent agent's MCP server configurations at runtime.
- **Merge behavior**: When `true`, the sub-agent gets the union of parent + own MCP servers. If both define a server with the same name, the sub-agent's configuration takes priority.

```yaml
x-kosmos:
  inherit_mcp_servers: false  # Sandboxed — only use own MCP servers
```

### inherit_skills

- **Type**: boolean
- **Default**: `true`
- **Purpose**: Whether to inherit the parent agent's skill configurations.
- **Merge behavior**: When `true`, skills are merged as a union set (deduplicated by name).

```yaml
x-kosmos:
  inherit_skills: false  # Only use skills explicitly listed in top-level 'skills' field
```

### inherit_knowledge_base

- **Type**: boolean
- **Default**: `true`
- **Purpose**: Whether to inherit the parent agent's knowledge base when the sub-agent's own `knowledgeBase` is empty.

```yaml
x-kosmos:
  inherit_knowledge_base: true
```

## Claude Code Standard Fields vs KOSMOS Fields

### Interoperability

AGENT.md files are designed to be compatible with both Claude Code and KOSMOS:

| Field Location | Read by Claude Code | Read by KOSMOS | Notes |
|---------------|-------------------|----------------|-------|
| Top-level YAML | ✅ | ✅ | Standard fields |
| `x-kosmos:` namespace | ❌ (ignored) | ✅ | KOSMOS extensions |
| Markdown body | ✅ (as instructions) | ✅ (as system_prompt) | Universal |

### Compatibility Mappings

KOSMOS handles legacy and alternative field names:

| YAML Field (alternative) | Canonical Field | Notes |
|-------------------------|----------------|-------|
| `max_turns` | `maxTurns` | Snake_case compat |
| `mcp_servers` | `mcpServers` | Snake_case compat |
| `tools: Read, Grep` | `builtin_tools: [read_file, search_text_in_files]` | Auto-mapped on import |

### Minimal vs Full Configuration

**Minimal AGENT.md** (only required fields):

```yaml
---
name: simple-helper
description: A simple helper for basic tasks.
---

You are a helpful assistant for basic tasks.
```

KOSMOS fills in all defaults: `model: inherit`, `maxTurns: 25`, `context_access: isolated`, all inheritance enabled.

**Full AGENT.md** (all fields explicitly set):

```yaml
---
name: full-config-agent
description: Demonstrates all available configuration fields.
tools:
  - Read
  - Grep
  - Bash
disallowedTools: []
model: inherit
maxTurns: 20
skills:
  - code-conventions
mcpServers:
  - github-server

x-kosmos:
  display_name: Fully Configured Agent
  emoji: "⚙️"
  version: "2.1.0"
  builtin_tools:
    - read_file
    - search_text_in_files
    - execute_command
  disallow_builtin_tools: []
  context_access: parent_summary
  workspace: ""
  knowledgeBase: ""
  inherit_mcp_servers: true
  inherit_skills: true
  inherit_knowledge_base: false
---

You are a fully configured sub-agent demonstrating all available settings.

[System prompt continues here...]
```
