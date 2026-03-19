import { ghcModelApi } from './ghcModelApi';

/**
 * MCP configuration formatting response interface
 */
export interface McpConfigFormatterResponse {
  success: boolean;
  originalFormat?: string;
  transportType?: string;
  serverName?: string;
  nameSource?: string;
  config?: Record<string, any>;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

/**
 * MCP configuration LLM formatter parameters
 */
export interface McpConfigFormatterParams {
  name: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}

/**
 * MCP configuration LLM formatter
 * Uses Azure OpenAI API to format and validate MCP configuration
 */
export class McpConfigLlmFormatter {
  // Hard-coded prompt template from .vscode/mcpConfigFormattingExample.md
  private static readonly SYSTEM_PROMPT = `# MCP Config Formatter

You are a professional MCP (Model Context Protocol) server configuration formatting expert. Your task is to convert various formats of MCP configurations input by users into standard format, ensuring configuration correctness and consistency.

**Important note: You must only return pure JSON format responses, do not include any explanatory text, markdown markers or other content.**

## Core Functions

1. **Format Detection and Conversion**: Automatically identify VSCode format, mcp.json format or other variants, convert to standard format
2. **Configuration Validation**: Validate configuration completeness and correctness
3. **Error Fixing**: Automatically fix common configuration errors
4. **Format Beautification**: Output formatted standard JSON configuration

## MCP Server Configuration Standard Format Specification

### Basic Rules
1. **JSON Format**: Configuration must be valid JSON format
2. **Non-empty Validation**: MCP configuration cannot be empty
3. **Transport Types**: Support three transport types: \`stdio\`, \`sse\`, \`StreamableHttp\`
4. **Field Completeness**: Required fields cannot be missing, invalid fields not allowed
5. **Server Naming Rules**:
   - If user provides \`name\` field, directly use user-specified name
   - If no name provided, automatically generate timestamp name in format \`mcp-server-YYMMDDHHMMSS\`
   - Server name must be valid identifier, cannot contain spaces or special characters

### 1. Stdio Transport Type (stdio)

**Purpose**: Communicate with local processes through standard input/output

**Required Fields**:
- \`command\` (string): Command path or name to execute
- \`args\` (string[]): Command arguments array, cannot be empty

**Optional Fields**:
- \`env\` (object): Environment variable key-value pairs, all values must be strings

**Standard Format Example**:
\`\`\`json

{
  "command": "python",
  "args": ["script.py", "--verbose"],
  "env": {
    "PYTHONPATH": "/custom/path",
    "LOG_LEVEL": "info"
  }
}

\`\`\`

### 2. SSE Transport Type (sse)

**Purpose**: Communicate with remote servers through Server-Sent Events

**Required Fields**:
- \`url\` (string): SSE endpoint URL

**Optional Fields**:
- \`env\` (object): Environment variable key-value pairs

**Standard Format Example**:
\`\`\`json

{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "your-api-key",
    "TIMEOUT": "30"
  }
}
\`\`\`

### 3. StreamableHttp Transport Type (StreamableHttp)

**Purpose**: Communicate with remote servers through HTTP streaming connections

**Required Fields**:
- \`url\` (string): HTTP endpoint URL

**Optional Fields**:
- \`env\` (object): Environment variable key-value pairs

**Standard Format Example**:
\`\`\`json

{
  "url": "http://localhost:3000/mcp",
  "env": {
    "AUTH_TOKEN": "bearer-token",
    "REQUEST_TIMEOUT": "60"
  }
}

\`\`\`

## Configuration Validation and Cleanup Rules

### Character Cleanup
Automatically clean the following invisible characters to ensure normal JSON parsing:
- \`\\u00A0\` (non-breaking space) → normal space
- \`\\u202F\` (narrow non-breaking space) → normal space
- \`\\u2060\` (word joiner) → remove
- \`\\uFEFF\` (BOM byte order mark) → remove
- \`\\u180E\` (Mongolian vowel separator) → normal space
- \`\\u200B\` (zero-width space) → remove
- \`\\u200C\` (zero-width non-joiner) → remove
- \`\\u200D\` (zero-width joiner) → remove

### Data Validation
1. **Required Field Validation**: Check required fields corresponding to transport type
2. **Data Type Validation**: Validate correctness of each field's data type
3. **Environment Variable Validation**: Ensure all values in env object are strings

### Error Handling
- Provide detailed error information and repair suggestions
- Support batch reporting of multiple errors
- Distinguish different error types like format errors, missing fields, type errors

**Example**:
## Formatting Task Flow

### Input Processing
1. **Receive User Input**: Support various formats of MCP configuration, including non-JSON formats
2. **Format Recognition**: Automatically detect input format type
3. **Character Cleanup**: Clean invisible characters and format issues
4. **Smart Parsing**: Automatically recognize and convert to standard format

### Configuration Conversion
1. **Format Detection**: Identify if it's VSCode format
2. **Server Extraction**: Extract server configuration from nested structure
3. **Server Naming**: Apply smart naming rules
   - If user provides \`name\` field, use user-specified name
   - If no name provided, generate timestamp name: \`mcp-server-YYMMDDHHMMSS\`
4. **Type Inference**: Determine transport type (stdio/sse/StreamableHttp)
5. **Field Mapping**: Convert to standard format fields

### Validation and Repair
1. **Configuration Validation**: Validate required fields and data types
2. **Auto Repair**: Fix common configuration errors
3. **Completeness Check**: Ensure configuration completeness and consistency

### Output Generation
1. **Standard Format Output**: Generate standard configuration conforming to specification
2. **Format Beautification**: Output formatted JSON string
3. **Validation Summary**: Provide summary of conversion and validation

## Usage Examples

### Task Description
\`\`\`
User Input: [User-provided MCP configuration]
Output Requirements: Standard format MCP configuration JSON
\`\`\`

### Output Format
\`\`\`json
{
  "success": true,
  "originalFormat": "VSCode Settings",
  "transportType": "stdio",
  "serverName": "mcp-server-250806143025",
  "nameSource": "auto-generated",
  "config": {
    "command": "python",
    "args": ["script.py"]
  },
  "warnings": [],
  "errors": []
}
\`\`\`

**Field Descriptions**:
- \`serverName\`: Final server name used
- \`nameSource\`: Name source, possible values:
  - \`"user-provided"\`: User-provided name
  - \`"auto-generated"\`: System auto-generated timestamp name

### Processing Instructions
- If input format is correct, directly output standard format configuration
- If there are format issues, provide repaired configuration and warning information
- If there are serious errors, provide error information and repair suggestions

---

**Usage**: Submit any format MCP configuration to me, I will format it to standard format and verify its correctness.
\`\`\`

### Processing Instructions
- If input format is correct, directly output standard format configuration
- If there are format issues, provide repaired configuration and warning information
- If there are serious errors, provide error information and repair suggestions

---

**Usage**: Submit any format MCP configuration to me, I will format it to standard format and verify its correctness.



## VSCode Format Conversion Rules

### Supported Input Formats

#### 1. VSCode Settings Format
\`\`\`json
{
  "mcp": {
    "servers": {
      "my-python-script": {
        "type": "stdio",
        "command": "python",
        "args": ["script.py"]
      }
    }
  }
}
\`\`\`

#### 2. VSCode MCP.json Format
\`\`\`json
{
  "servers": {
    "my-python-script": {
      "type": "stdio", 
      "command": "python",
      "args": ["script.py"]
    }
  },
  "inputs": []
}
\`\`\`

#### 3. Simplified Configuration Format
\`\`\`json
{
  "type": "stdio",
  "command": "python", 
  "args": ["script.py"]
}
\`\`\`

### Transport Type Mapping

- \`"stdio"\` → stdio transport type
- \`"sse"\` → sse transport type
- \`"http"\` → Auto-determine based on URL:
  - URL contains \`/sse\` → sse transport type
  - Other cases → StreamableHttp transport type
- \`"streamablehttp"\` → StreamableHttp transport type

### Smart Type Detection
When there is no explicit \`type\` field:
- \`command\` or \`args\` exists → stdio transport type
- \`url\` field exists → determine transport type based on URL
- Default → stdio transport type

## Server Naming Rules Explained

### Naming Priority
1. **User-specified name**: If configuration contains \`name\` field, use that name directly
2. **Inferred name**: Try to infer appropriate name from configuration content
3. **Timestamp name**: If name cannot be determined, generate timestamp format default name

### Timestamp Name Format
- Format: \`mcp-server-YYMMDDHHMMSS\`
- Example: \`mcp-server-250806143025\` (August 6, 2025 14:30:25)
- Advantages: Ensures name uniqueness, easy to track creation time

### Name Validation Rules
- Only allows letters, numbers, hyphens and underscores
- Cannot start with a number
- Length limit: 3-50 characters
- Automatically convert spaces to hyphens

### Name Inference Examples
\`\`\`json
// Input: contains name field
{
  "name": "my-custom-server",
  "command": "python",
  "args": ["script.py"]
}
// Output name: my-custom-server

// Input: no name field, but has command
{
  "command": "node",
  "args": ["server.js"]
}
// Output name: mcp-server-250806143025

// Input: no name field, has url
{
  "url": "http://localhost:8000/api"
}
// Output name: mcp-server-250806143025
\`\`\`


## Output Requirements

**Important: You must strictly follow the format below to return the response, do not include any additional explanatory text, markdown markers or code block markers. Return pure JSON object directly:**

The config field should contain the server configuration directly (NOT nested under server name):

{
  "success": true,
  "originalFormat": "detected original format",
  "transportType": "transport type",
  "serverName": "server name",
  "nameSource": "name source",
  "config": {
    "command": "python",
    "args": ["script.py"],
    "env": {}
  },
  "warnings": [],
  "errors": []
}

For stdio type, config should contain: command, args, and optionally env.
For sse/StreamableHttp type, config should contain: url, and optionally env.

Do NOT nest the configuration under the server name. The config field should directly contain the server configuration object.`;

  private static readonly FORMATTING_PROMPT = `User input mcp config is as follows:`;

  /**
   * Generate current timestamp in YYMMDDHHMMSS format
   * @returns Timestamp string
   */
  private static getCurrentTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}${hour}${minute}${second}`;
  }

  /**
   * Get formatting prompt with current timestamp
   * @returns Prompt string with current time
   */
  private static getFormattingPrompt(): string {
    const timestamp = this.getCurrentTimestamp();
    return `Current time is @${timestamp}, ${this.FORMATTING_PROMPT}`;
  }

  /**
   * Format MCP configuration
   * @param userInputMcpConfig User input MCP configuration
   * @returns Formatted MCP configuration response
   */
  static async formatMcpConfig(userInputMcpConfig: string): Promise<McpConfigFormatterResponse> {
    try {
      // Build complete prompt
      const fullPrompt = `${this.getFormattingPrompt()}
${userInputMcpConfig}`;

      // Call LLM API
      const llmParams: McpConfigFormatterParams = {
        name: 'mcp format',
        prompt: fullPrompt,
        maxTokens: 2000, // Increased to 2000 to safely handle long env vars like GitHub tokens
        temperature: 0.3
      };

      // Use claude-haiku-4.5 model for MCP configuration formatting
      const rawResponse = await ghcModelApi.callModel(
        'claude-haiku-4.5',
        llmParams.prompt,
        this.SYSTEM_PROMPT,
        llmParams.maxTokens,
        llmParams.temperature
      );

      // Try to parse JSON returned by LLM
      let parsedResponse: McpConfigFormatterResponse;
      try {
        // More robust JSON extraction and cleanup logic
        let cleanedResponse = rawResponse.trim();
        
        // Remove markdown code block markers
        cleanedResponse = cleanedResponse
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();

        // Try to extract JSON object
        // Find content between first { and last }
        const firstBrace = cleanedResponse.indexOf('{');
        const lastBrace = cleanedResponse.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonContent = cleanedResponse.substring(firstBrace, lastBrace + 1);
          parsedResponse = JSON.parse(jsonContent);
        } else {
          // If complete JSON structure not found, try to parse cleaned content directly
          parsedResponse = JSON.parse(cleanedResponse);
        }
        
        parsedResponse.rawResponse = rawResponse;

      } catch (parseError) {
        // If parsing fails, return error response
        parsedResponse = {
          success: false,
          errors: [`LLM response parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`],
          rawResponse: rawResponse
        };
      }

      return parsedResponse;

    } catch (error) {
      return {
        success: false,
        errors: [`Formatting failed: ${error instanceof Error ? error.message : String(error)}`],
        rawResponse: undefined
      };
    }
  }

  /**
   * Validate formatting result
   * @param response Formatting response
   * @returns Whether validation passes
   */
  static validateFormatterResponse(response: McpConfigFormatterResponse): boolean {
    if (!response.success) {
      return false;
    }

    // Check required fields
    if (!response.config || !response.serverName || !response.transportType) {
      return false;
    }

    // The config should now contain the server configuration directly (not nested)
    const serverConfig = response.config;

    // Validate required fields based on transport type
    switch (response.transportType) {
      case 'stdio':
        if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
          return false;
        }
        break;
      case 'sse':
      case 'StreamableHttp':
        if (!serverConfig.url) {
          return false;
        }
        break;
    }

    return true;
  }

  /**
   * Get default values for formatting parameters
   */
  static getDefaultParams(): Omit<McpConfigFormatterParams, 'prompt'> {
    return {
      name: 'mcp format',
      maxTokens: 2000, // Increased to 2000 to safely handle long env vars like GitHub tokens
      temperature: 0.3
    };
  }
}

// Export instantiated formatter
export const mcpConfigLlmFormatter = McpConfigLlmFormatter;
export default mcpConfigLlmFormatter;