/**
 * ReadHtmlTool - Agent-safe HTML reader
 * 
 * Design goals:
 * - Never return the full page HTML
 * - Structure first, content second (DOM outline first)
 * - Agent-oriented selector / section level reading
 * - Prevent minified / inline script from blowing up context
 * 
 * Three modes:
 * 1. outline (default): Returns DOM skeleton, Agent views structure first then decides what to read
 * 2. section: Reads plain text by semantic blocks (main/article/body)
 * 3. selector: Reads precisely by CSS selector
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { BuiltinToolDefinition } from './types';

// Re-export types for backward compatibility
export type { BuiltinToolDefinition } from './types';

// ============ Safety thresholds ============
const HTML_READ_LIMITS = {
  PROBE_BYTES: 64 * 1024,           // 64KB for DOM probing (slightly larger than original design, covers more structure)
  MAX_TEXT_BYTES: 96 * 1024,        // 96KB maximum text output
  MAX_NODES: 200,                   // Maximum number of DOM nodes to return
  MAX_TEXT_NODE: 4 * 1024,          // 4KB maximum per text node
  MAX_SELECTOR_DEPTH: 3,            // Maximum nesting depth for selector
} as const;

// ============ Type definitions ============
export type HtmlReadMode = 'outline' | 'section' | 'selector';
export type HtmlSection = 'main' | 'article' | 'body' | 'head';
export type TruncationReason = 'max_nodes' | 'max_bytes' | 'text_node_limit' | 'none';

export interface ReadHtmlToolArgs {
  filePath: string;

  // Mode selection (default: outline)
  mode?: HtmlReadMode;

  // Section mode parameters
  section?: HtmlSection;

  // Selector mode parameters (supports minimal CSS subset)
  selector?: string; // e.g. "#main", ".content", "article"

  // Operation description for UI display
  description?: string;
}

export interface HtmlOutlineNode {
  tag: string;
  id?: string;
  className?: string;
  depth: number;
  textPreview?: string; // First 50 characters preview
}

export interface ReadHtmlToolResult {
  fileName: string;
  filePath: string;
  mode: HtmlReadMode;
  
  // Returned in outline mode
  outline?: HtmlOutlineNode[];
  
  // Returned in section / selector mode
  content?: string;
  
  // Metadata
  truncated: boolean;
  truncationReason?: TruncationReason;
  bytesRead: number;
  
  // Assists Agent decision-making
  hasScript: boolean;
  hasStyle: boolean;
  suggestedSelectors?: string[]; // Suggested selectors
}

export class ReadHtmlTool {
  
  /**
   * Get tool definition (Agent-friendly description)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'read_html',
      description: `Safely read HTML files with structure-first approach.
MODES:
- outline (default): Returns DOM skeleton with tag/id/class. Use this FIRST to understand page structure.
- section: Extract text from semantic sections (main/article/body/head). Auto-strips scripts and styles.
- selector: Read specific elements by CSS selector (#id, .class, tag). Use after outline reveals targets.

CONSTRAINTS:
- Max ${HTML_READ_LIMITS.PROBE_BYTES / 1024}KB probe size
- Max ${HTML_READ_LIMITS.MAX_NODES} DOM nodes in outline
- Max ${HTML_READ_LIMITS.MAX_TEXT_BYTES / 1024}KB text output
- Never returns full raw HTML

RECOMMENDED FLOW:
1. Call with mode='outline' first
2. Review structure and suggestedSelectors
3. Call again with mode='section' or mode='selector' for specific content`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what is being read (for UI display). E.g., "Reading HTML page structure", "Extracting article content"'
          },
          filePath: {
            type: 'string',
            description: 'Path to the HTML file to read'
          },
          mode: {
            type: 'string',
            enum: ['outline', 'section', 'selector'],
            description: 'Reading mode (default: outline)',
            default: 'outline'
          },
          section: {
            type: 'string',
            enum: ['main', 'article', 'body', 'head'],
            description: 'Section to extract (for section mode)'
          },
          selector: {
            type: 'string',
            description: 'CSS selector like #id, .class, or tag (for selector mode)'
          }
        },
        required: ['description', 'filePath']
      }
    };
  }

  /**
   * Execute HTML reading
   */
  static async execute(args: ReadHtmlToolArgs): Promise<ReadHtmlToolResult> {
    const { filePath, mode = 'outline' } = args;
    
    if (!filePath) {
      throw new Error('filePath is required');
    }
    
    // Verify file exists
    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new Error(`File not accessible: ${filePath}`);
    }
    
    // Phase 1: Probe read (only reads the first N KB)
    const { html, bytesRead } = await this.probeHtml(filePath);
    
    // Detect characteristics
    const hasScript = /<script[\s\S]*?>/i.test(html);
    const hasStyle = /<style[\s\S]*?>/i.test(html);
    
    const fileName = path.basename(filePath);
    
    // Execute based on mode
    switch (mode) {
      case 'outline':
        return this.buildOutline(filePath, fileName, html, bytesRead, hasScript, hasStyle);
      
      case 'section':
        return this.readSection(filePath, fileName, html, bytesRead, hasScript, hasStyle, args.section || 'body');
      
      case 'selector':
        if (!args.selector) {
          throw new Error('selector is required in selector mode');
        }
        return this.readBySelector(filePath, fileName, html, bytesRead, hasScript, hasStyle, args.selector);
      
      default:
        throw new Error(`Unsupported mode: ${mode}`);
    }
  }

  // ============ Phase 1: Probe Read ============
  
  /**
   * Only reads the first N KB of the file to avoid full loading
   */
  private static async probeHtml(filePath: string): Promise<{ html: string; bytesRead: number }> {
    const fd = await fsPromises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(HTML_READ_LIMITS.PROBE_BYTES);
      const { bytesRead } = await fd.read(buffer, 0, HTML_READ_LIMITS.PROBE_BYTES, 0);
      const html = buffer.subarray(0, bytesRead).toString('utf8');
      return { html, bytesRead };
    } finally {
      await fd.close();
    }
  }

  // ============ Outline Mode ============
  
  /**
   * Build DOM skeleton (structure only, no content)
   */
  private static buildOutline(
    filePath: string,
    fileName: string,
    html: string,
    bytesRead: number,
    hasScript: boolean,
    hasStyle: boolean
  ): ReadHtmlToolResult {
    const outline: HtmlOutlineNode[] = [];
    const depthStack: string[] = [];
    
    // Void (self-closing) tags
    const voidTags = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);
    
    // Match all tags
    const tagRegex = /<\s*(\/)?\s*([a-zA-Z0-9]+)([^>]*)>/g;
    let match: RegExpExecArray | null;
    
    while ((match = tagRegex.exec(html)) !== null) {
      if (outline.length >= HTML_READ_LIMITS.MAX_NODES) break;
      
      const isClose = Boolean(match[1]);
      const tag = match[2].toLowerCase();
      const attrs = match[3] || '';
      
      // Skip script and style content
      if (tag === 'script' || tag === 'style') {
        if (!isClose) {
          // Jump to the corresponding closing tag
          const closeRegex = new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'gi');
          closeRegex.lastIndex = tagRegex.lastIndex;
          const closeMatch = closeRegex.exec(html);
          if (closeMatch) {
            tagRegex.lastIndex = closeMatch.index + closeMatch[0].length;
          }
        }
        continue;
      }
      
      if (isClose) {
        // Closing tag, decrease depth
        const lastOpenTag = depthStack.pop();
        // Error tolerance: if tags don't match, attempt to fix
        if (lastOpenTag && lastOpenTag !== tag) {
          depthStack.push(lastOpenTag); // Put it back
        }
      } else {
        // Opening tag
        const depth = depthStack.length;
        
        // Parse attributes
        const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
        const classMatch = attrs.match(/class\s*=\s*["']([^"']+)["']/i);
        
        // Get text preview (first 50 characters after the tag)
        const afterTag = html.slice(tagRegex.lastIndex, tagRegex.lastIndex + 100);
        const textPreview = this.extractTextPreview(afterTag);
        
        outline.push({
          tag,
          id: idMatch?.[1],
          className: classMatch?.[1],
          depth,
          textPreview: textPreview || undefined
        });
        
        // Only push non-void tags onto the stack
        if (!voidTags.has(tag) && !attrs.includes('/>')) {
          depthStack.push(tag);
        }
      }
    }
    
    // Generate suggested selectors
    const suggestedSelectors = this.generateSuggestedSelectors(outline);
    
    return {
      fileName,
      filePath,
      mode: 'outline',
      outline,
      truncated: outline.length >= HTML_READ_LIMITS.MAX_NODES,
      truncationReason: outline.length >= HTML_READ_LIMITS.MAX_NODES ? 'max_nodes' : undefined,
      bytesRead,
      hasScript,
      hasStyle,
      suggestedSelectors
    };
  }

  /**
   * Extract text preview (first 50 characters)
   */
  private static extractTextPreview(html: string): string {
    // Remove tags, keep text only
    const text = html
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text.length > 50) {
      return text.slice(0, 50) + '...';
    }
    return text;
  }

  /**
   * Generate suggested selectors based on the outline
   */
  private static generateSuggestedSelectors(outline: HtmlOutlineNode[]): string[] {
    const selectors: string[] = [];
    const seen = new Set<string>();
    
    // Priority: meaningful semantic tags > elements with id > elements with common class
    const semanticTags = ['main', 'article', 'nav', 'header', 'footer', 'aside', 'section'];
    const meaningfulClasses = ['content', 'main', 'article', 'post', 'entry', 'body', 'text', 'container'];
    
    for (const node of outline) {
      // Semantic tags
      if (semanticTags.includes(node.tag) && !seen.has(node.tag)) {
        selectors.push(node.tag);
        seen.add(node.tag);
      }
      
      // Elements with id
      if (node.id && !seen.has(`#${node.id}`)) {
        selectors.push(`#${node.id}`);
        seen.add(`#${node.id}`);
      }
      
      // Meaningful classes
      if (node.className) {
        const classes = node.className.split(/\s+/);
        for (const cls of classes) {
          if (meaningfulClasses.some(m => cls.toLowerCase().includes(m))) {
            const selector = `.${cls}`;
            if (!seen.has(selector)) {
              selectors.push(selector);
              seen.add(selector);
            }
          }
        }
      }
      
      if (selectors.length >= 10) break;
    }
    
    return selectors;
  }

  // ============ Section Mode ============
  
  /**
   * Read by semantic section
   */
  private static readSection(
    filePath: string,
    fileName: string,
    html: string,
    bytesRead: number,
    hasScript: boolean,
    hasStyle: boolean,
    section: HtmlSection
  ): ReadHtmlToolResult {
    // Match section tag and its content
    const regex = new RegExp(`<${section}[^>]*>([\\s\\S]*?)<\\/${section}>`, 'i');
    const match = html.match(regex);
    
    if (!match) {
      return {
        fileName,
        filePath,
        mode: 'section',
        content: `[No <${section}> element found in the HTML]`,
        truncated: false,
        bytesRead,
        hasScript,
        hasStyle
      };
    }
    
    const { content, truncated, truncationReason } = this.extractAndCleanText(match[1]);
    
    return {
      fileName,
      filePath,
      mode: 'section',
      content,
      truncated,
      truncationReason,
      bytesRead,
      hasScript,
      hasStyle
    };
  }

  // ============ Selector Mode ============
  
  /**
   * Read by CSS selector (supports minimal subset)
   */
  private static readBySelector(
    filePath: string,
    fileName: string,
    html: string,
    bytesRead: number,
    hasScript: boolean,
    hasStyle: boolean,
    selector: string
  ): ReadHtmlToolResult {
    let regex: RegExp;
    
    // Parse selector type
    if (selector.startsWith('#')) {
      // ID selector: #main
      const id = this.escapeRegex(selector.slice(1));
      regex = new RegExp(`<([a-zA-Z0-9]+)[^>]*id\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
    } else if (selector.startsWith('.')) {
      // Class selector: .content
      const cls = this.escapeRegex(selector.slice(1));
      regex = new RegExp(`<([a-zA-Z0-9]+)[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
    } else {
      // Tag selector: article
      const tag = this.escapeRegex(selector);
      regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    }
    
    const match = html.match(regex);
    
    if (!match) {
      return {
        fileName,
        filePath,
        mode: 'selector',
        content: `[No element matching '${selector}' found in the HTML]`,
        truncated: false,
        bytesRead,
        hasScript,
        hasStyle
      };
    }
    
    // match[1] is the tag name (for ID/Class selectors), match[2] is the content
    const contentMatch = selector.startsWith('#') || selector.startsWith('.') ? match[2] : match[1];
    const { content, truncated, truncationReason } = this.extractAndCleanText(contentMatch || '');
    
    return {
      fileName,
      filePath,
      mode: 'selector',
      content,
      truncated,
      truncationReason,
      bytesRead,
      hasScript,
      hasStyle
    };
  }

  // ============ Utility methods ============
  
  /**
   * Extract and clean text (remove script/style, limit size)
   */
  private static extractAndCleanText(htmlFragment: string): {
    content: string;
    truncated: boolean;
    truncationReason?: TruncationReason;
  } {
    // Remove script and style
    let text = htmlFragment
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')  // Replace tags with spaces
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, '')    // Remove numeric entities
      .replace(/\s+/g, ' ')      // Merge whitespace
      .trim();
    
    let truncated = false;
    let truncationReason: TruncationReason | undefined;
    
    // Check single node limit
    if (text.length > HTML_READ_LIMITS.MAX_TEXT_NODE) {
      text = text.slice(0, HTML_READ_LIMITS.MAX_TEXT_NODE) + '\n[... text truncated ...]';
      truncated = true;
      truncationReason = 'text_node_limit';
    }
    
    // Check total byte limit
    const byteSize = Buffer.byteLength(text, 'utf8');
    if (byteSize > HTML_READ_LIMITS.MAX_TEXT_BYTES) {
      // Truncate proportionally
      const ratio = HTML_READ_LIMITS.MAX_TEXT_BYTES / byteSize;
      text = text.slice(0, Math.floor(text.length * ratio)) + '\n[... content truncated due to size limit ...]';
      truncated = true;
      truncationReason = 'max_bytes';
    }
    
    return { content: text, truncated, truncationReason };
  }

  /**
   * Escape regex special characters
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
