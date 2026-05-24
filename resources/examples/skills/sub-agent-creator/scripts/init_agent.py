#!/usr/bin/env python3
"""
Sub-Agent Initializer - Creates a new sub-agent directory with template AGENT.md

Usage:
    init_agent.py <agent-name> --path <path>

Examples:
    init_agent.py code-reviewer --path agents
    init_agent.py data-analyzer --path ./my-agents
    init_agent.py research-helper --path /workspace/agents
"""

import sys
import re
from pathlib import Path


AGENT_TEMPLATE = """---
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

## Output Format

[TODO: Define how results should be returned to the parent agent]

## Guidelines

- [TODO: Important guideline 1]
- [TODO: Important guideline 2]
- [TODO: Important guideline 3]
- Always provide a clear summary of completed work
"""

NAME_PATTERN = re.compile(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')


def title_case_name(name):
    """Convert hyphenated name to Title Case for display."""
    return ' '.join(word.capitalize() for word in name.split('-'))


def validate_agent_name(name):
    """Validate agent name format. Returns (valid, error_message)."""
    if not name:
        return False, "Agent name cannot be empty"

    if not NAME_PATTERN.match(name):
        return False, (
            f"Invalid agent name '{name}'. "
            "Must be lowercase letters, digits, and hyphens only. "
            "Must start and end with a letter or digit. "
            "Pattern: ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
        )

    if '--' in name:
        return False, f"Agent name '{name}' cannot contain consecutive hyphens"

    return True, None


def init_agent(agent_name, path):
    """
    Initialize a new sub-agent directory with template AGENT.md.

    Args:
        agent_name: Name of the sub-agent (hyphen-case)
        path: Path where the agent directory should be created

    Returns:
        Path to created agent directory, or None if error
    """
    # Validate name
    valid, error = validate_agent_name(agent_name)
    if not valid:
        print(f"❌ Error: {error}")
        return None

    # Determine agent directory path
    agent_dir = Path(path).resolve() / agent_name

    # Check if directory already exists
    if agent_dir.exists():
        print(f"❌ Error: Agent directory already exists: {agent_dir}")
        return None

    # Create agent directory
    try:
        agent_dir.mkdir(parents=True, exist_ok=False)
        print(f"✅ Created agent directory: {agent_dir}")
    except Exception as e:
        print(f"❌ Error creating directory: {e}")
        return None

    # Create AGENT.md from template
    agent_title = title_case_name(agent_name)
    agent_content = AGENT_TEMPLATE.format(
        agent_name=agent_name,
        agent_title=agent_title
    )

    agent_md_path = agent_dir / 'AGENT.md'
    try:
        agent_md_path.write_text(agent_content, encoding='utf-8')
        print("✅ Created AGENT.md")
    except Exception as e:
        print(f"❌ Error creating AGENT.md: {e}")
        return None

    # Print next steps
    print(f"\n✅ Sub-agent '{agent_name}' initialized successfully at {agent_dir}")
    print("\nNext steps:")
    print("1. Edit AGENT.md — complete all [TODO] items in the YAML front-matter and system prompt")
    print("2. Run quick_validate.py to verify the format:")
    print(f"   python quick_validate.py {agent_dir}")
    print("3. Import into KOSMOS via 'Import from AGENT.md (Claude Code)' button")
    print("4. Assign the sub-agent to a parent agent and test it")

    return agent_dir


def main():
    if len(sys.argv) < 4 or sys.argv[2] != '--path':
        print("Usage: init_agent.py <agent-name> --path <path>")
        print("\nAgent name requirements:")
        print("  - Lowercase letters, digits, and hyphens only")
        print("  - Must start and end with a letter or digit")
        print("  - No consecutive hyphens")
        print("  - Pattern: ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
        print("\nExamples:")
        print("  init_agent.py code-reviewer --path agents")
        print("  init_agent.py data-analyzer --path ./my-agents")
        print("  init_agent.py research-helper --path /workspace/agents")
        sys.exit(1)

    agent_name = sys.argv[1]
    path = sys.argv[3]

    print(f"🚀 Initializing sub-agent: {agent_name}")
    print(f"   Location: {path}")
    print()

    result = init_agent(agent_name, path)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
