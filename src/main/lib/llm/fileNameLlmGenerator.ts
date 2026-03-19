import { ghcModelApi } from './ghcModelApi';

/**
 * File Name Generator response interface
 */
export interface FileNameGeneratorResponse {
  success: boolean;
  fileName?: string;
  extension?: string;
  fullFileName?: string;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

/**
 * File Name LLM Generator
 * Uses LLM API to generate appropriate file names based on content
 */
export class FileNameLlmGenerator {
  // System prompt for generating file names
  private static readonly SYSTEM_PROMPT = `# File Name Generator

You are an expert at analyzing text content and generating appropriate file names. Your task is to analyze the provided content and generate a descriptive, concise file name with the correct extension.

## Guidelines

### File Name Requirements
- **Length**: Maximum 10 words
- **Format**: Use kebab-case (words connected with hyphens "-")
- **No spaces**: Replace all spaces with hyphens
- **Lowercase**: All characters should be lowercase
- **Descriptive**: The name should reflect the content's main topic or purpose
- **Clean**: No special characters except hyphens

### Extension Detection Rules
Analyze the content format and structure to determine the appropriate extension:

1. **JSON (.json)**: Content starts with { or [ and appears to be valid JSON structure
2. **Markdown (.md)**: Content contains markdown syntax like #, ##, *, -, \`\`\`, [text](url), etc.
3. **HTML (.html)**: Content contains HTML tags like <html>, <div>, <p>, <head>, <body>, etc.
4. **JavaScript (.js)**: Content contains JavaScript syntax like function, const, let, var, =>, import, export, etc.
5. **TypeScript (.ts)**: Content contains TypeScript syntax like interface, type, :string, :number, etc.
6. **CSS (.css)**: Content contains CSS syntax like selectors, {}, properties with colons
7. **Python (.py)**: Content contains Python syntax like def, class, import, from, if __name__
8. **YAML (.yaml)**: Content has key: value structure without JSON braces
9. **XML (.xml)**: Content starts with <?xml or contains XML tags
10. **SQL (.sql)**: Content contains SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, etc.
11. **Shell (.sh)**: Content starts with #!/bin/bash or contains shell commands
12. **Plain Text (.txt)**: Default for plain text content without specific formatting

### Examples

**Content**: "# Project Roadmap\n\n## Q1 2025\n- Feature A\n- Feature B"
**Result**: {"fileName": "project-roadmap", "extension": "md", "fullFileName": "project-roadmap.md"}

**Content**: "{\n  \"name\": \"my-app\",\n  \"version\": \"1.0.0\"\n}"
**Result**: {"fileName": "my-app-package-config", "extension": "json", "fullFileName": "my-app-package-config.json"}

**Content**: "function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price, 0); }"
**Result**: {"fileName": "calculate-total-function", "extension": "js", "fullFileName": "calculate-total-function.js"}

**Content**: "Meeting notes from product review session. Key decisions: 1. Launch date is March 15..."
**Result**: {"fileName": "product-review-meeting-notes", "extension": "txt", "fullFileName": "product-review-meeting-notes.txt"}

**Content**: "<html><head><title>Dashboard</title></head><body><h1>Welcome</h1></body></html>"
**Result**: {"fileName": "dashboard-page", "extension": "html", "fullFileName": "dashboard-page.html"}

## Output Format

Return ONLY a valid JSON object. Do not include any explanatory text, markdown markers, or code blocks:

{
  "success": true,
  "fileName": "kebab-case-file-name",
  "extension": "ext",
  "fullFileName": "kebab-case-file-name.ext"
}

If the content is too short or meaningless:

{
  "success": false,
  "warnings": ["Content too short or unclear"],
  "fileName": "untitled",
  "extension": "txt",
  "fullFileName": "untitled.txt"
}

**Important**: 
- File name must be maximum 10 words connected with hyphens
- Always determine the most appropriate extension based on content format
- Return valid JSON only`;

  private static readonly GENERATION_PROMPT = `Analyze the following content and generate an appropriate file name with extension:

CONTENT:
`;

  /**
   * Validate if content is suitable for file name generation
   * @param content Content to analyze
   * @returns Validation result
   */
  private static validateContent(content: string): {
    isValid: boolean;
    suggestion?: string;
  } {
    const trimmedContent = content.trim();
    
    // Check if content is too short
    if (trimmedContent.length < 3) {
      return {
        isValid: false,
        suggestion: 'Content too short to generate meaningful file name'
      };
    }

    // Check if content contains no meaningful text
    if (!/[a-zA-Z\u4e00-\u9fa5]/.test(trimmedContent)) {
      return {
        isValid: false,
        suggestion: 'Content contains no meaningful text for file name generation'
      };
    }

    return { isValid: true };
  }

  /**
   * Parse LLM response to extract file name information
   * @param response Raw LLM response
   * @returns Parsed file name response
   */
  private static parseResponse(response: string): FileNameGeneratorResponse {
    try {
      // Try to extract JSON from the response
      let jsonStr = response.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      
      // Try to find JSON object in the response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      const parsed = JSON.parse(jsonStr);
      
      // Validate and clean the file name
      let fileName = parsed.fileName || 'untitled';
      fileName = fileName
        .toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '') // Remove special chars except hyphens and Chinese
        .replace(/-+/g, '-')            // Replace multiple hyphens with single
        .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens
      
      // Limit to ~10 words (by hyphens)
      const words = fileName.split('-');
      if (words.length > 10) {
        fileName = words.slice(0, 10).join('-');
      }
      
      const extension = parsed.extension || 'txt';
      const fullFileName = `${fileName}.${extension}`;
      
      return {
        success: true,
        fileName,
        extension,
        fullFileName,
        rawResponse: response
      };
    } catch (error) {
      console.error('[FileNameLlmGenerator] Failed to parse response:', error);
      
      // Fallback: generate simple file name from timestamp
      const timestamp = Date.now();
      return {
        success: false,
        fileName: `pasted-content-${timestamp}`,
        extension: 'txt',
        fullFileName: `pasted-content-${timestamp}.txt`,
        errors: ['Failed to parse LLM response'],
        rawResponse: response
      };
    }
  }

  /**
   * Generate file name from content using LLM
   * @param content Content to generate file name from
   * @returns File name generator response
   */
  static async generateFileName(content: string): Promise<FileNameGeneratorResponse> {
    try {
      // Validate content
      const validation = this.validateContent(content);
      if (!validation.isValid) {
        const timestamp = Date.now();
        return {
          success: false,
          fileName: `pasted-content-${timestamp}`,
          extension: 'txt',
          fullFileName: `pasted-content-${timestamp}.txt`,
          warnings: [validation.suggestion || 'Invalid content']
        };
      }

      // Truncate content if too long (use first 2000 chars for analysis)
      const truncatedContent = content.length > 2000 
        ? content.slice(0, 2000) + '\n...[content truncated]...'
        : content;

      // Build the prompt
      const userPrompt = `${this.GENERATION_PROMPT}${truncatedContent}`;

      // Call LLM API - use claude-haiku-4.5 model (faster and lower cost)
      const response = await ghcModelApi.callModel(
        'claude-haiku-4.5',
        userPrompt,
        this.SYSTEM_PROMPT,
        500,  // maxTokens
        0.3   // temperature - lower for more consistent results
      );

      // Parse and return the response
      return this.parseResponse(response);
    } catch (error) {
      console.error('[FileNameLlmGenerator] Error generating file name:', error);
      
      // Fallback to timestamp-based name
      const timestamp = Date.now();
      return {
        success: false,
        fileName: `pasted-content-${timestamp}`,
        extension: 'txt',
        fullFileName: `pasted-content-${timestamp}.txt`,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }
}

// Export singleton instance for convenience
export const fileNameLlmGenerator = FileNameLlmGenerator;
