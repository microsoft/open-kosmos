#!/usr/bin/env python3
"""
Quick validation script for AGENT.md files.

Validates AGENT.md format, required fields, naming conventions,
and field value constraints. Aligned with SubAgentFileManager.validateAgentConfig()
runtime validation rules.

Usage:
    quick_validate.py <agent-directory>

Examples:
    quick_validate.py agents/code-reviewer
    quick_validate.py ./my-agent
"""

import sys
import re
import os

try:
    import yaml
except ImportError:
    # Fallback: basic YAML parsing without pyyaml
    yaml = None


# Name pattern matching SubAgentFileManager.validateAgentName()
NAME_PATTERN = re.compile(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')

# Valid context_access values
VALID_CONTEXT_ACCESS = {'isolated', 'parent_summary', 'full_history'}

# YAML front-matter regex
FRONTMATTER_REGEX = re.compile(r'^---\n(.*?)\n---', re.DOTALL)


def parse_yaml_basic(yaml_text):
    """
    Basic YAML parser fallback when pyyaml is not installed.
    Handles simple key-value pairs and nested x-kosmos block.
    """
    result = {}
    current_block = None

    for line in yaml_text.split('\n'):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        # Detect nested block (x-kosmos:)
        if line.startswith('x-kosmos:'):
            current_block = {}
            result['x-kosmos'] = current_block
            continue

        # Nested key-value (indented under x-kosmos)
        if current_block is not None and (line.startswith('  ') or line.startswith('\t')):
            match = re.match(r'^\s+(\w[\w_-]*):\s*(.*)', line)
            if match:
                key = match.group(1)
                value = match.group(2).strip().strip('"').strip("'")
                if value.lower() == 'true':
                    value = True
                elif value.lower() == 'false':
                    value = False
                elif value.isdigit():
                    value = int(value)
                current_block[key] = value
            continue
        else:
            current_block = None

        # Top-level key-value
        match = re.match(r'^(\w[\w_-]*):\s*(.*)', line)
        if match:
            key = match.group(1)
            value = match.group(2).strip().strip('"').strip("'")
            if value.lower() == 'true':
                value = True
            elif value.lower() == 'false':
                value = False
            elif value.isdigit():
                value = int(value)
            result[key] = value

    return result


def validate_agent(agent_path):
    """
    Validate an AGENT.md file in the given directory.

    Returns:
        (errors: list[str], warnings: list[str])
    """
    errors = []
    warnings = []

    agent_path = os.path.abspath(agent_path)
    dir_name = os.path.basename(agent_path)

    # Check AGENT.md exists
    agent_md_path = os.path.join(agent_path, 'AGENT.md')
    if not os.path.isfile(agent_md_path):
        errors.append(f"AGENT.md not found in {agent_path}")
        return errors, warnings

    # Read content
    try:
        with open(agent_md_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        errors.append(f"Failed to read AGENT.md: {e}")
        return errors, warnings

    # Check YAML front-matter starts with ---
    if not content.startswith('---'):
        errors.append("AGENT.md must start with YAML front-matter (---)")
        return errors, warnings

    # Extract front-matter
    match = FRONTMATTER_REGEX.match(content)
    if not match:
        errors.append("Invalid YAML front-matter format. Expected closing --- marker.")
        return errors, warnings

    yaml_text = match.group(1)

    # Parse YAML
    try:
        if yaml is not None:
            frontmatter = yaml.safe_load(yaml_text)
        else:
            frontmatter = parse_yaml_basic(yaml_text)

        if not isinstance(frontmatter, dict):
            errors.append("YAML front-matter must be a mapping (key-value pairs)")
            return errors, warnings
    except Exception as e:
        errors.append(f"Invalid YAML in front-matter: {e}")
        return errors, warnings

    # ===== Required fields =====

    # name: required, must match pattern
    name = frontmatter.get('name')
    if not name:
        errors.append("Missing required field: 'name'")
    elif not isinstance(name, str):
        errors.append(f"'name' must be a string, got {type(name).__name__}")
    else:
        name = name.strip()
        if not NAME_PATTERN.match(name):
            errors.append(
                f"Invalid name '{name}'. Must match pattern: "
                "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ "
                "(lowercase letters, digits, hyphens; no leading/trailing hyphens)"
            )
        if '--' in name:
            errors.append(f"Name '{name}' cannot contain consecutive hyphens")

        # Check name matches directory name
        if name != dir_name:
            errors.append(
                f"Name '{name}' in AGENT.md does not match directory name '{dir_name}'. "
                "They must be identical."
            )

        # Advisory length warning (runtime has no limit, but long names are impractical)
        if len(name) > 64:
            warnings.append(f"Name is {len(name)} characters — consider keeping it under 64 for readability")

    # description: required, non-empty
    description = frontmatter.get('description')
    if not description:
        errors.append("Missing required field: 'description'")
    elif not isinstance(description, str):
        errors.append(f"'description' must be a string, got {type(description).__name__}")
    else:
        description = description.strip()
        if not description:
            errors.append("'description' cannot be empty")
        if '[TODO' in description:
            warnings.append("Description contains [TODO] placeholder — remember to fill it in")

    # ===== Optional fields validation =====

    # maxTurns: 1-100
    max_turns = frontmatter.get('maxTurns', frontmatter.get('max_turns'))
    if max_turns is not None:
        try:
            max_turns_int = int(max_turns)
            if max_turns_int < 1 or max_turns_int > 100:
                errors.append(f"maxTurns must be between 1 and 100, got {max_turns_int}")
        except (ValueError, TypeError):
            errors.append(f"maxTurns must be an integer, got '{max_turns}'")

    # model: advisory check
    model = frontmatter.get('model')
    if model is not None and isinstance(model, str):
        model = model.strip()
        if not model:
            warnings.append("'model' is empty — will default to 'inherit'")

    # context_access: must be valid value
    x_kosmos = frontmatter.get('x-kosmos', {})
    if isinstance(x_kosmos, dict):
        context_access = x_kosmos.get('context_access')
        if context_access is not None:
            if context_access not in VALID_CONTEXT_ACCESS:
                errors.append(
                    f"context_access must be one of: {', '.join(sorted(VALID_CONTEXT_ACCESS))}. "
                    f"Got '{context_access}'"
                )
    elif x_kosmos is not None:
        warnings.append("'x-kosmos' should be a mapping — KOSMOS extension fields may not be recognized")

    # ===== x-kosmos namespace check =====
    # Verify KOSMOS-specific fields are under x-kosmos, not at top level
    kosmos_fields = {
        'display_name', 'emoji', 'version', 'builtin_tools', 'disallow_builtin_tools',
        'context_access', 'workspace', 'knowledgeBase',
        'inherit_mcp_servers', 'inherit_skills', 'inherit_knowledge_base'
    }
    misplaced = kosmos_fields.intersection(frontmatter.keys())
    if misplaced:
        warnings.append(
            f"KOSMOS extension field(s) found at top level: {', '.join(sorted(misplaced))}. "
            "These should be nested under 'x-kosmos:' for Claude Code compatibility."
        )

    # ===== Markdown body (system_prompt) =====
    front_matter_end = content.index('\n---', 4) if '\n---' in content[4:] else -1
    if front_matter_end >= 0:
        markdown_body = content[front_matter_end + 4:].strip()
    else:
        markdown_body = ''

    if not markdown_body:
        errors.append("Markdown body (system prompt) is empty. The body after the YAML front-matter defines the sub-agent's system prompt.")

    if markdown_body and '[TODO' in markdown_body:
        warnings.append("System prompt contains [TODO] placeholders — remember to complete them")

    return errors, warnings


def main():
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <agent-directory>")
        print("\nExamples:")
        print("  python quick_validate.py agents/code-reviewer")
        print("  python quick_validate.py ./my-agent")
        sys.exit(1)

    agent_path = sys.argv[1]

    if not os.path.isdir(agent_path):
        print(f"❌ Error: '{agent_path}' is not a directory")
        sys.exit(1)

    print(f"🔍 Validating AGENT.md in: {os.path.abspath(agent_path)}")
    print()

    errors, warnings = validate_agent(agent_path)

    # Print warnings
    for warning in warnings:
        print(f"⚠️  Warning: {warning}")

    # Print errors
    for error in errors:
        print(f"❌ Error: {error}")

    # Summary
    if warnings:
        print()

    if errors:
        print(f"\n❌ Validation failed with {len(errors)} error(s)")
        sys.exit(1)
    else:
        if warnings:
            print(f"\n✅ AGENT.md is valid (with {len(warnings)} warning(s))")
        else:
            print("✅ AGENT.md is valid!")
        sys.exit(0)


if __name__ == "__main__":
    main()
