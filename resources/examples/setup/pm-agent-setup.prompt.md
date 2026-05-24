# PM Agent Setup Guide

> Configure a fully functional PM Agent in Kosmos with required dependencies and MCP servers.

---

## Part 1: Install Dependencies

Execute the following setup guides:

- **Python >=3.10** (3.10 recommended): https://cdn.kosmos-ai.com/setup/python-setup.prompt.md
- **uv/uvx (version 0.6.x required)**: https://cdn.kosmos-ai.com/setup/uv-setup.prompt.md
- **playwright**: https://cdn.kosmos-ai.com/setup/playwright-setup.prompt.md

**Completion**: All dependencies installed and available.

---

## Part 2: MCP Setup

### 2.1 builtin-tools
Built-in, no action needed.

### 2.2 kosmos-mcp-stable

**Check**: Use `check_mcp_status` to verify status

**Install** (if not connected):

**Step 1: Locate uvx installation path**

Check the default location first:
- **Windows**: `%USERPROFILE%\.local\bin\uvx` (e.g., `C:\Users\YourName\.local\bin\uvx`)
- **macOS**: `~/.local/bin/uvx` (e.g., `/Users/YourName/.local/bin/uvx`)

**Windows** - Run in terminal:
```powershell
Get-Command uvx
```

**macOS** - Run in terminal:
```bash
which uvx
```

**If uvx is not found**:
1. Install uv/uvx first: https://cdn.kosmos-ai.com/setup/uv-setup.prompt.md
2. After installation, verify the actual path using the commands above

**Step 2: Use `add_mcp_by_config` with uvx absolute path**

Replace `<UVX_ABSOLUTE_PATH>` in the configuration below with the actual uvx path found in Step 1:

For example:
- Windows: `C:\\Users\\YourName\\.local\\bin\\uvx`
- macOS: `/Users/YourName/.local/bin/uvx`

```json
{
  "mcp_servers": [
    {
      "name": "kosmos-mcp-stable",
      "description": "# PM Agent MCP: Your Experienced Product Management Assistant\n\n## Overview\n\n**PM Agent MCP** is your senior Product Management assistant designed to help PMs with daily tasks throughout the product lifecycle. I specialize in transforming data and insights into actionable product decisions without writing code.\n\n## Core Capabilities\n\nI assist with:\n\n### 1. **User Feedback Analysis**\n- Categorize and extract insights from various feedback channels\n- Analyze user sentiment and verbatim feedback\n- Summarize feedback patterns and themes\n- Process data from multiple sources (Reddit, App Store reviews, social media, etc.)\n\n### 2. **Competitor Analysis**\n- Research and organize competitive intelligence\n- Conduct SWOT analysis\n- Gather market research and industry insights\n- Track competitor features and strategies\n\n### 3. **Data Analysis & Monitoring**\n- Track and interpret metrics from Titan dashboard\n- Monitor key performance indicators (DAU, MAU, retention, etc.)\n- Generate data-driven insights\n- Create visualizations and reports\n\n### 4. **Mission Review**\n- Review mission statements for clarity and falsifiability\n- Validate strategic objectives\n- Support cycle planning activities\n\n## How I Work\n\n### Structured Approach\n- I maintain organized workflows with clear task lists\n- Each project gets its own workspace folder with dated organization\n- I provide progress updates and Markdown-formatted narratives\n- All work is verified and evidence-based - no assumptions or hallucinations\n\n### Multi-Source Research\n- Web search for quick answers and current information\n- Data providers (Reddit, App Store, social media, Titan) for accurate metrics\n- Web scraping for detailed content when needed\n- Always prioritizing reliable data sources\n\n### Quality Output\n- High-quality, cohesive documents with proper citations\n- Reference lists with source URLs\n- Clear, actionable insights\n- Professional reports and visualizations\n\n## Getting Started\n\nSimply tell me which workflow you need help with:\n- **\"I need user feedback analysis\"**\n- **\"Help me with competitor research\"**\n- **\"I want to analyze data from Titan\"**\n- **\"Review our mission statement\"**\n\nI'll guide you through the specific process with step-by-step assistance tailored to your needs.\n\n---\n\n**Ready to help you make better product decisions!** 🚀",
      "transport": "stdio",
      "command": "<UVX_ABSOLUTE_PATH>",
      "args": [
        "kosmos-mcp"
      ],
      "env": {},
      "url": ""
    }
  ]
}
```

**Step 3: Verify connection**

Use `check_mcp_status` to confirm "connected" status.

**Troubleshooting**:
- Ensure Python >=3.10 is properly installed (3.10 recommended)
- Ensure uvx absolute path is correct (use `Get-Command uvx` on Windows or `which uvx` on macOS)
- If uvx path changed, update the MCP configuration with the new path
- Check network connectivity and error logs

**⚠️ IMPORTANT**: You MUST verify that kosmos-mcp-stable status shows "connected" before proceeding to Part 3. Use `check_mcp_status` to confirm.

**Completion**: kosmos-mcp-stable is connected.

---

## Part 3: Configure PM Agent

**Check**: Use `check_agent_status` to verify if "PM Agent" exists

**Create** (if not exists): Use `add_agent_by_config` with the following configuration:

```json
{
  "workspace": "",
  "agent": {
    "role": "Default Assistant",
    "emoji": "🦄",
    "name": "PM Agent",
    "model": "claude-sonnet-4",
    "mcp_servers": [
      {
        "name": "builtin-tools",
        "tools": [
          "read_file",
          "bing_web_search",
          "google_web_search",
          "search_files",
          "execute_command",
          "search_text_in_files",
          "fetch_web_content"
        ]
      },
      {
        "name": "kosmos-mcp-stable",
        "tools": []
      }
    ],
    "system_prompt": "# System Prompt: Professional Product Manager Assistant\n\n## Role Definition\nYou are an intelligent assistant specializing in supporting product managers throughout the product lifecycle. Your main objective is to help streamline workflows, provide insights, and facilitate high-quality decision-making.\n\n## Core Skills & Responsibilities\n- Conduct market and competitor research based on provided data or queries\n- Assist in drafting product requirement documents (PRDs)\n- Organize and prioritize feature requests and feedback\n- Support roadmap planning and milestone tracking\n- Prepare clear, actionable meeting notes and summaries\n- Help analyze user feedback and usage data to guide product improvements\n- Communicate effectively with cross-functional teams (engineering, design, marketing)\n\n## Working Methods\n- Ask clarifying questions when requirements are unclear\n- Present information concisely and in structured formats (tables, lists, summaries)\n- Suggest best practices in product management where appropriate\n- Maintain confidentiality and handle sensitive business data with care\n\n## Output Format\n- Use markdown for all outputs\n- Structure information with headings, lists, and tables as needed\n- Summarize findings and recommendations clearly\n\n## Considerations\n- Always tailor your assistance to the context and stage of the product\n- Adapt responses to the target audience (e.g., technical, business, executive)\n- Proactively highlight risks, dependencies, and opportunities",
    "context_enhancement": {
      "search_memory": {
        "enabled": false,
        "semantic_similarity_threshold": 0,
        "semantic_top_n": 5
      },
      "generate_memory": {
        "enabled": false
      }
    },
    "skills": []
  }
}
```

**⚠️ IMPORTANT**: Only proceed after confirming kosmos-mcp-stable is "connected" in Part 2.

**Completion**: "PM Agent" configured and appears in the agent list.

---

## Part 4: Verification

Run these checks:

1. **Python**: `python3 --version` → Should show Python >=3.10 (3.10 recommended) ✓
2. **uv**: `uv --version` → Should show version 0.6.x ✓
3. **uvx**: `uvx --version` → Should show version 0.6.x ✓
4. **playwright**: `playwright --version` → Version returned ✓
5. **kosmos-mcp-stable**: Use `check_mcp_status` → "connected" ✓
6. **PM Agent**: Use `check_agent_status` → "PM Agent" exists ✓

**Result**:
- ✅ All pass AND kosmos-mcp-stable shows "connected": Setup complete!
- ❌ Any fail OR kosmos-mcp-stable not "connected": Review corresponding part above and DO NOT complete setup until kosmos-mcp-stable is connected.

---

## Troubleshooting

### Python
- Version requirement: Python >=3.10 (3.10 recommended)
- Version incorrect: See https://cdn.kosmos-ai.com/setup/python-setup.prompt.md
- Use pyenv for version management

### uv/uvx
- Version requirement: uv 0.6.x (required)
- Version incorrect or not found: See https://cdn.kosmos-ai.com/setup/uv-setup.prompt.md
- Use `uv self update` to update to correct version
- Restart terminal or check PATH

### playwright
- Install fails: See https://cdn.kosmos-ai.com/setup/playwright-setup.prompt.md
- Upgrade pip: `pip install --upgrade pip`
- Check network/proxy

### kosmos-mcp-stable
- Connection failed: Verify Python >=3.10 (3.10 recommended) and uv/uvx 0.6.x are working
- Check Kosmos logs and firewall
- Try reinstalling from MCP Library

### Agent
- Verify all MCP servers are connected
- Check tool selections in MCP configuration
- Test with simple queries

---

## Next Steps

1. Test with simple questions
2. Try MCP tools (web search, file operations)
3. Draft PRDs or feature specifications
4. Configure custom prompts for your team

Enjoy using PM Agent! 🚀
