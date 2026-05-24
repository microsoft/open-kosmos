# Sub-Agent Technical Architecture Requirements
Let's first implement a version with a less complex architecture

## Specific Requirements:
- kosmos (this project) is a general-purpose agent, which differs somewhat from Claude Code
- Sub-agents can be configured in the kosmos (this project) settings page, similar to how skills are configured
  - Sub-agents can also be configured with MCP, default tools, and skills just like regular agents
  - Current Agents can select and enable sub-agents in the same way they select and enable skills.
  - Sub-agents do not support selecting and enabling other sub-agents.
- Sub-agents uniformly use the parent agent's LLM model
- Sub-agents have a configuration option indicating whether they can access parent context, isolated by default
- How should the top-level agent's system prompt for managing sub-agents be generated.
- kosmos (this project) sub-agent tasks can also run in parallel.
- Technical documentation should be generated based on the current kosmos (this project) technical architecture
- Technical documentation includes: technical architecture (background & UI), and reasonable implementation steps