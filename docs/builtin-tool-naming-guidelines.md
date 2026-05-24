# Built-in Tool Naming Guidelines

This document defines the direct naming scheme for OpenKosmos built-in tools.

## Goals

- Keep tool names predictable across runtime, UI, tests, and docs.
- Prefer verb-first names that describe the actual capability.
- Use the same canonical name in file names, tool definitions, manager registration, and call sites.
- Avoid compatibility aliases once a rename is approved.

## Naming Rules

- Use `verb_resource` or `verb_resource_scope` snake_case names.
- Start with the primary action: `get`, `list`, `search`, `read`, `create`, `update`, `install`, `set`, `download`, `manage`, `spawn`.
- Use nouns that reflect the user-facing concept instead of storage or implementation details.
- Use `from_config` when the tool creates a resource from a provided config object.
- Use `status` or `installation_state` for inspection tools, and `runtime_availability` for callability in the current chat.

## Stable Exceptions

The following names stay unchanged:

- `read_file`
- `search_files`
- `write_file`
- `execute_command`
- `get_current_datetime`
- `google_web_search`
- `bing_web_search`
- `fetch_web_content`

## Canonical Examples

- `get_mcp_template_from_library`
- `create_mcp_server_from_config`
- `update_mcp_server`
- `get_mcp_status`
- `set_mcp_connection_state`
- `get_agent_template_from_library`
- `create_agent_from_config`
- `update_agent`
- `get_agent_status`
- `list_agents`
- `install_skill_from_library`
- `install_skill_from_device`
- `get_skill_installation_state`
- `get_skill_runtime_availability`
- `search_file_contents`
- `download_file`
- `spawn_subagents`
- `update_schedule`

## Required Consistency

For every built-in tool rename, update all of the following together:

- implementation file name
- exported class name
- `getDefinition().name`
- manager registration and dispatch
- UI display mappings
- tool call views
- tests
- docs and examples

If any of these remain on the old name, the repo drifts into an inconsistent state quickly.