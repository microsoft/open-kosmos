/**
 * ReadOfficeFileTool built-in tool
 * Handles reading and pagination logic for Office files (currently supports PDF, Word, PPT)
 * Note: This is a built-in tool, not an MCP protocol tool
 * Security validation has been moved to AgentChat.validateToolPathsAndRequestApproval()
 */

import { FILE_ATTACHMENT_LIMITS } from '../../constants/fileConstants';
import * as fs from 'node:fs/promises';
import type { BuiltinToolDefinition } from './types';

export interface ReadOfficeFileToolArgs {
  // File path (required)
  filePath: string;        // Full path to the file

  // Operation description for UI display
  description?: string;

  // File metadata (optional, for display and optimization)
  fileName?: string;       // File name
  fileSize?: number;       // File size (bytes)
  fileType?: string;       // File type/extension
  mimeType?: string;       // MIME type

  // Read range (optional)
  //  - When no page/line is provided, the entire document is processed subject to a 2000-line limit
  //  - When only page is provided, the page range is extracted first, then line-based pagination is applied to the result
  //  - When only line is provided, line segments are extracted from all pages, still subject to the upper limit
  startLine?: number;      // Starting line number (1-based)
  endLine?: number;        // Ending line number (1-based)
  lineCount?: number;      // Number of lines to read (starting from startLine)
  startPage?: number;      // Starting page number (1-based)
  endPage?: number;        // Ending page number (1-based)
}

export interface ReadOfficeFileToolResult {
  content: string;        // Text content returned after reading
  fileName: string;       // Actual file name returned
  startLine: number;      // Starting line number of the returned content
  endLine: number;        // Ending line number of the returned content
  totalLines: number;     // Total number of lines within the current page range
  size: number;           // Content length (character count)
  truncated: boolean;     // Whether content was truncated due to limits
  startPage: number;      // Actual starting page number read
  endPage: number;        // Actual ending page number read
  totalPages: number;     // Total number of pages in the file
}

export class ReadOfficeFileTool {
  
  /**
   * Execute the file reading tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: ReadOfficeFileToolArgs): Promise<ReadOfficeFileToolResult> {

    // 1. Resolve file path (supports multiple formats)
    const actualPath = this.resolveFilePath(args);

    // 2. Argument validation
    const validation = this.validateArgs({ ...args, path: actualPath });
    if (!validation.isValid) {
      throw new Error(`Invalid arguments: ${validation.error}`);
    }

    // Note: Path security validation has been moved to AgentChat.validateToolPathsAndRequestApproval()

    // 3. Branch processing based on type
    const documentType = this.resolveDocumentType(args, actualPath);

    if (!documentType) {
      throw new Error('Unsupported office file type: currently only PDF, Word, or PowerPoint files are supported');
    }

    // 4. File reading and processing
    try {
      const result = documentType === 'pdf'
        ? await this.readPdfWithPagination({ ...args, path: actualPath })
        : documentType === 'word'
          ? await this.readWordWithPagination({ ...args, path: actualPath })
          : await this.readPowerPointWithPagination({ ...args, path: actualPath });
      return result;
    } catch (error) {
      throw new Error(`File read failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 🔄 New: Resolve file path, supports multiple input formats
   */
  private static resolveFilePath(args: ReadOfficeFileToolArgs): string {
    const path = args.filePath;

    if (!path) {
      throw new Error('No file path provided. filePath is required');
    }


    return path;
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'read_office_file',
      description: 'Read the contents of office documents (currently PDF, Word, and PowerPoint). PDF/PPT support page and line-based pagination; Word supports line-based pagination only. Maximum 2000 lines per call.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what is being read (for UI display). E.g., "Reading PDF report", "Checking Word document"'
          },
          filePath: {
            type: 'string',
            description: 'Path to the office document to read (relative or absolute)'
          },
          fileName: {
            type: 'string',
            description: 'Name of the file (for display purposes)'
          },
          fileSize: {
            type: 'number',
            description: 'Size of the file in bytes',
            minimum: 0
          },
          fileType: {
            type: 'string',
            description: 'File extension (e.g., ".pdf")'
          },
          mimeType: {
            type: 'string',
            description: 'MIME type of the file'
          },
          startLine: {
            type: 'number',
            description: 'Starting line number (1-based, optional)',
            minimum: 1
          },
          endLine: {
            type: 'number',
            description: 'Ending line number (1-based, optional)',
            minimum: 1
          },
          lineCount: {
            type: 'number',
            description: 'Number of lines to read from startLine',
            minimum: 1
          },
          startPage: {
            type: 'number',
            description: 'Starting page number (1-based, optional). Ignored for Word documents.',
            minimum: 1
          },
          endPage: {
            type: 'number',
            description: 'Ending page number (1-based, optional). Ignored for Word documents.',
            minimum: 1
          }
        },
        required: ['description', 'filePath']
      }
    };
  }

  /**
   * Validate arguments
   */
  private static validateArgs(args: ReadOfficeFileToolArgs & { path: string }): { isValid: boolean; error?: string } {
    // Validate path
    if (!args.path || typeof args.path !== 'string') {
      return { isValid: false, error: 'filePath is required and must be a string' };
    }

    // Validate line-level parameters
    const startLine = args.startLine;
    if (startLine !== undefined) {
      if (!Number.isInteger(startLine) || startLine < 1) {
        return { isValid: false, error: 'startLine must be a positive integer' };
      }
    }

    // Validate endLine
    if (args.endLine !== undefined) {
      if (!Number.isInteger(args.endLine) || args.endLine < 1) {
        return { isValid: false, error: 'endLine must be a positive integer' };
      }
    }

    // Validate lineCount
    if (args.lineCount !== undefined) {
      if (!Number.isInteger(args.lineCount) || args.lineCount < 1) {
        return { isValid: false, error: 'lineCount must be a positive integer' };
      }
    }

    // Validate line range logic
    const actualStartLine = startLine || 1;
    if (args.endLine !== undefined && actualStartLine > args.endLine) {
      return { isValid: false, error: 'startLine cannot be greater than endLine' };
    }

    // Validate page-level parameters
    if (args.startPage !== undefined) {
      if (!Number.isInteger(args.startPage) || args.startPage < 1) {
        return { isValid: false, error: 'startPage must be a positive integer' };
      }
    }

    // Validate endPage
    if (args.endPage !== undefined) {
      if (!Number.isInteger(args.endPage) || args.endPage < 1) {
        return { isValid: false, error: 'endPage must be a positive integer' };
      }
    }

    // Validate page range logic
    if (args.startPage !== undefined && args.endPage !== undefined && args.startPage > args.endPage) {
      return { isValid: false, error: 'startPage cannot be greater than endPage' };
    }

    // Validate file size (if provided)
    if (args.fileSize !== undefined) {
      if (!Number.isInteger(args.fileSize) || args.fileSize < 0) {
        return { isValid: false, error: 'fileSize must be a non-negative integer' };
      }
    }

    return { isValid: true };
  }

  /**
   * Determine file type
   */
  private static resolveDocumentType(args: ReadOfficeFileToolArgs, resolvedPath: string): 'pdf' | 'word' | 'ppt' | null {
    // Prioritize using the provided MIME type for determination
    const mime = args.mimeType?.toLowerCase();
    if (mime === 'application/pdf') {
      return 'pdf';
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime === 'application/vnd.ms-word.document.macroenabled.12') {
      return 'word';
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mime === 'application/vnd.ms-powerpoint.presentation.macroenabled.12' ||
        mime === 'application/vnd.ms-powerpoint') {
      return 'ppt';
    }

    // Then check the provided extension parameter (may or may not include a dot)
    const normalizedType = args.fileType?.toLowerCase();
    if (normalizedType) {
      if (normalizedType === 'pdf' || normalizedType === '.pdf') {
        return 'pdf';
      }
      if (normalizedType === 'docx' || normalizedType === '.docx' ||
          normalizedType === 'docm' || normalizedType === '.docm') {
        return 'word';
      }
      if (normalizedType === 'pptx' || normalizedType === '.pptx' ||
          normalizedType === 'pptm' || normalizedType === '.pptm' ||
          normalizedType === 'ppt' || normalizedType === '.ppt') {
        return 'ppt';
      }
    }

    // Finally fall back to determining by the resolved path suffix
    const candidateNames = [args.fileName, resolvedPath];
    for (const name of candidateNames) {
      if (typeof name !== 'string') {
        continue;
      }
      const lower = name.toLowerCase();
      if (lower.endsWith('.pdf')) {
        return 'pdf';
      }
      if (lower.endsWith('.docx') || lower.endsWith('.docm')) {
        return 'word';
      }
      if (lower.endsWith('.pptx') || lower.endsWith('.pptm') || lower.endsWith('.ppt')) {
        return 'ppt';
      }
    }

    return null;
  }

  /**
   * PDF file reading and paginated extraction
   * Event-driven parsing flow
   * - Pre-initializes line buffer, current page line list, overall page collection, and page number tracking
   * - Uses flushLines() to sort text fragments on the same line by x coordinate and concatenate them before a page break
   * - finalizePage() is responsible for persisting the current page when entering a new page or at the end, and resetting line state
   * - reader.parseBuffer(buffer, callback) uses event callbacks: item === null indicates end, item.page marks a page break, item.text represents text fragments on the current page
   * - The entire Promise resolves after pdfreader signals completion, returning the complete pages array for subsequent page/line trimming
   */
  private static async readPdfWithPagination(args: ReadOfficeFileToolArgs & { path: string }): Promise<ReadOfficeFileToolResult> {
    try {

      // 1. Read PDF Buffer and initialize pdfreader
      const { PdfReader } = require('pdfreader');
      const fileBuffer = await fs.readFile(args.path);

      // 2. Use pdfreader's item-by-item callback; combine text into lines by (y, x) coordinates, then classify into different pages
      const pageLines = await new Promise<string[][]>((resolve, reject) => {
        const reader = new PdfReader();
        const rowsByLine = new Map<number, Array<{ x: number; text: string }>>();
        let currentPageLines: string[] = [];
        const pages: string[][] = [];
        let currentPageNumber = 0;

        // Sort accumulated text blocks on the current page by line and concatenate into final line text
        const flushLines = () => {
          if (rowsByLine.size === 0) {
            return;
          }
          const sortedY = Array.from(rowsByLine.keys()).sort((a, b) => a - b);
          for (const y of sortedY) {
            const segments = rowsByLine.get(y)?.sort((left, right) => left.x - right.x) ?? [];
            const lineText = segments.map(segment => segment.text).join(' ').trimEnd();
            currentPageLines.push(lineText);
          }
          rowsByLine.clear();
        };

        // Push the current page's line results into pages and prepare to collect the next page
        const finalizePage = () => {
          flushLines();
          if (currentPageNumber === 0 && currentPageLines.length === 0 && pages.length === 0) {
            return;
          }
          pages.push(currentPageLines);
          currentPageLines = [];
        };

        // Parse pdf buffer and collect text by item
        reader.parseBuffer(fileBuffer, (error: unknown, item: any) => {
          if (error) {
            reject(error);
            return;
          }

          // item === null indicates parsing is complete
          if (!item) {
            finalizePage();
            resolve(pages);
            return;
          }

          // item.page indicates a new page is encountered; the previous page must be finalized first
          if (item.page) {
            if (currentPageNumber !== 0 || currentPageLines.length > 0) {
              finalizePage();
            }
            currentPageNumber = item.page;
            return;
          }

          // item.text is a text fragment on the current page, classified by y/x coordinates
          if (item.text) {
            const y = Math.round(typeof item.y === 'number' ? item.y : 0);
            const x = typeof item.x === 'number' ? item.x : 0;
            const bucket = rowsByLine.get(y) ?? [];
            bucket.push({ x, text: item.text });
            rowsByLine.set(y, bucket);
          }
        });
      });

      // 3. If the entire PDF has no text content, return an empty result directly
      const totalPages = pageLines.length;
      if (totalPages === 0) {
        return {
          content: '',
          fileName: args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path,
          startLine: 1,
          endLine: 0,
          totalLines: 0,
          size: 0,
          truncated: false,
          startPage: 1,
          endPage: 0,
          totalPages: 0
        };
      }

      // 4. Trim page range based on the provided arguments
      const requestedStartPage = args.startPage ?? 1;
      const requestedEndPage = args.endPage ?? totalPages;
      const normalizedStartPage = Math.max(1, Math.min(requestedStartPage, totalPages));
      const normalizedEndPage = Math.max(normalizedStartPage, Math.min(requestedEndPage, totalPages));

      // 5. Concatenate lines from selected pages into a single line array, separating pages with empty lines
      const selectedPages = pageLines.slice(normalizedStartPage - 1, normalizedEndPage);
      const lines: string[] = [];
      selectedPages.forEach((page, index) => {
        lines.push(...page);
        if (index < selectedPages.length - 1) {
          lines.push('');
        }
      });

      // 6. Log parsing results for diagnostics
      const totalLines = lines.length;


      // 7. Apply line-level pagination, compatible with startLine/endLine/lineCount
      const startLine = args.startLine || 1;
      const requestedEndLine = args.endLine || (args.lineCount ? startLine + args.lineCount - 1 : totalLines);
      const maxEndLine = Math.min(
        requestedEndLine,
        startLine + FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES - 1,
        totalLines
      );

      // 8. Extract line content and prepare return value
      const selectedLines = lines.slice(startLine - 1, maxEndLine);
      const resultContent = selectedLines.join('\n');

      const truncated = (requestedEndLine > maxEndLine) ||
                        (maxEndLine < totalLines && !args.endLine && !args.lineCount) ||
                        (selectedLines.length >= FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES);

      const fileName = args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path;

      return {
        content: resultContent,
        fileName,
        startLine,
        endLine: maxEndLine,
        totalLines,
        size: resultContent.length,
        truncated,
        startPage: normalizedStartPage,
        endPage: normalizedEndPage,
        totalPages
      };
    } catch (error) {
      throw new Error(`Failed to extract PDF text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Word file reading and pagination handling
   * Parsing flow description:
   * - Calls mammoth to extract plain text and normalize line breaks
   * - Word documents lack a stable concept of pages, so only line-based extraction is supported; page numbers are always treated as a single page
   * - Retains the same line-level truncation and statistics logic as PDF/PPT
   */
  private static async readWordWithPagination(args: ReadOfficeFileToolArgs & { path: string }): Promise<ReadOfficeFileToolResult> {
    try {

      // 1. Call mammoth to extract raw text, normalize line break characters to avoid platform differences in subsequent pagination/line trimming
      const mammothLib = require('mammoth');
      const result = await mammothLib.extractRawText({ path: args.path });
      const rawText = (result.value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();

      // 2. Return an empty result directly when content is empty, maintaining consistent start/end line/page semantics with the PDF branch
      if (!rawText) {
        if (args.startPage !== undefined || args.endPage !== undefined) {
        }
        return {
          content: '',
          fileName: args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path,
          startLine: 1,
          endLine: 0,
          totalLines: 0,
          size: 0,
          truncated: false,
          startPage: 1,
          endPage: 0,
          totalPages: 0
        };
      }

      if (args.startPage !== undefined || args.endPage !== undefined) {
      }

      // 3. Process Word document by lines, always treated as a single page
      const lines = rawText.split('\n');

      // 4. Log parsing results for subsequent diagnostics
      const totalLines = lines.length;


      // 5. Apply line-level trimming logic, consistent with other formats, while protected by the global line count limit
      const startLine = args.startLine || 1;
      const requestedEndLine = args.endLine || (args.lineCount ? startLine + args.lineCount - 1 : totalLines);
      const maxEndLine = Math.min(
        requestedEndLine,
        startLine + FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES - 1,
        totalLines
      );

      // 6. Extract target lines, aggregate results, and determine whether content was truncated
      const selectedLines = lines.slice(startLine - 1, maxEndLine);
      const resultContent = selectedLines.join('\n');

      const truncated = (requestedEndLine > maxEndLine) ||
                        (maxEndLine < totalLines && !args.endLine && !args.lineCount) ||
                        (selectedLines.length >= FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES);

      const fileName = args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path;

      return {
        content: resultContent,
        fileName,
        startLine,
        endLine: maxEndLine,
        totalLines,
        size: resultContent.length,
        truncated,
        startPage: 1,
        endPage: 1,
        totalPages: 1
      };
    } catch (error) {
      throw new Error(`Failed to extract Word text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static async readPowerPointWithPagination(args: ReadOfficeFileToolArgs & { path: string }): Promise<ReadOfficeFileToolResult> {
    try {

      // 1. Read the PowerPoint file and extract it as a ZIP directory using jszip for accessing slide XML
      const JSZip = require('jszip');
      const fileBuffer = await fs.readFile(args.path);
      const zip = await JSZip.loadAsync(fileBuffer);

      // 2. First parse presentation.xml and relationship files: use the relationship table to locate each slide's ZIP path, then restore the official display order based on the p:sldId list; fall back to numeric ordering if parsing fails
      let slideFiles: string[] = [];
      const presentationXmlFile = zip.files['ppt/presentation.xml'];
      const presentationRelsFile = zip.files['ppt/_rels/presentation.xml.rels'];
      if (presentationXmlFile && presentationRelsFile) {
        try {
          const [presentationXml, relsXml] = await Promise.all([
            presentationXmlFile.async('string'),
            presentationRelsFile.async('string')
          ]);

          // 2.1 Parse presentation.xml.rels: build a mapping from r:id to slide XML path, filtering out non-slide relationship entries
          const relationshipMap = new Map<string, string>();
          const relationshipRegex = /<Relationship\b([^>]*?)\/>/gi;
          let relationshipMatch: RegExpExecArray | null;
          while ((relationshipMatch = relationshipRegex.exec(relsXml)) !== null) {
            const attributes = relationshipMatch[1];
            const idMatch = attributes.match(/\bId="([^"]+)"/i);
            const targetMatch = attributes.match(/\bTarget="([^"]+)"/i);
            const typeMatch = attributes.match(/\bType="([^"]+)"/i);
            if (!idMatch || !targetMatch) {
              continue;
            }
            const relationshipType = typeMatch?.[1] ?? '';
            if (!relationshipType.endsWith('/slide')) {
              continue;
            }
            const normalizedTarget = targetMatch[1].replace(/^\.\//, '').replace(/^\.\.\//, '');
            const zipPath = normalizedTarget.startsWith('ppt/') ? normalizedTarget : `ppt/${normalizedTarget}`;
            relationshipMap.set(idMatch[1], zipPath.replace(/\\/g, '/'));
          }

          // 2.2 Map out the actual slide paths based on the p:sldId order in presentation.xml, forming the final ordered list
          if (relationshipMap.size > 0) {
            const slideIdRegex = /<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/>/gi;
            const orderedSlides: string[] = [];
            let slideIdMatch: RegExpExecArray | null;
            while ((slideIdMatch = slideIdRegex.exec(presentationXml)) !== null) {
              const relationshipId = slideIdMatch[1];
              const targetPath = relationshipMap.get(relationshipId);
              if (targetPath && zip.files[targetPath]) {
                orderedSlides.push(targetPath);
              }
            }
            if (orderedSlides.length > 0) {
              slideFiles = orderedSlides;
            }
          }
        } catch (orderError) {
        }
      }

      // 2.3 If the order was not successfully determined, fall back to the legacy logic of natural sorting by slideN number
      if (slideFiles.length === 0) {
        slideFiles = Object.keys(zip.files)
          .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
          .sort((left, right) => {
            const leftMatch = left.match(/slide(\d+)\.xml$/i);
            const rightMatch = right.match(/slide(\d+)\.xml$/i);
            const leftIndex = leftMatch ? parseInt(leftMatch[1], 10) : 0;
            const rightIndex = rightMatch ? parseInt(rightMatch[1], 10) : 0;
            return leftIndex - rightIndex;
          });
      }

      // 3. Return an empty result directly when slides are missing, maintaining consistent semantics with other formats
      if (slideFiles.length === 0) {
        return {
          content: '',
          fileName: args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path,
          startLine: 1,
          endLine: 0,
          totalLines: 0,
          size: 0,
          truncated: false,
          startPage: 1,
          endPage: 0,
          totalPages: 0
        };
      }

      // 4. Parse each slide's XML, extract paragraph text, and store in the pages array
      const pages: string[][] = [];
      for (const slidePath of slideFiles) {
        const slideFile = zip.files[slidePath];
        if (!slideFile) {
          continue;
        }
        const slideXml = await slideFile.async('string');
        const slideLines = this.extractPowerPointSlideLines(slideXml);
        pages.push(slideLines);
      }

      // 5. Verify again whether valid content exists, preventing blank slides from causing subsequent out-of-bounds errors
      const totalPages = pages.length;
      if (totalPages === 0) {
        return {
          content: '',
          fileName: args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path,
          startLine: 1,
          endLine: 0,
          totalLines: 0,
          size: 0,
          truncated: false,
          startPage: 1,
          endPage: 0,
          totalPages: 0
        };
      }

      // 6. Trim range based on the start/end pages provided by the caller, ensuring page numbers do not go out of bounds
      const requestedStartPage = args.startPage ?? 1;
      const requestedEndPage = args.endPage ?? totalPages;
      const normalizedStartPage = Math.max(1, Math.min(requestedStartPage, totalPages));
      const normalizedEndPage = Math.max(normalizedStartPage, Math.min(requestedEndPage, totalPages));

      // 7. Merge lines from selected pages into the final line array, inserting empty lines as slide separators as needed
      const selectedPages = pages.slice(normalizedStartPage - 1, normalizedEndPage);
      const lines: string[] = [];
      for (let index = 0; index < selectedPages.length; index++) {
        const page = selectedPages[index];
        if (page.length > 0) {
          lines.push(...page);
        }
        const hasNextPage = index < selectedPages.length - 1;
        const nextPageHasContent = hasNextPage ? selectedPages[index + 1].length > 0 : false;
        if (hasNextPage && (page.length > 0 || nextPageHasContent)) {
          lines.push('');
        }
      }

      // 8. Log parsing statistics for diagnosing PPT content
      const totalLines = lines.length;


      // 9. Apply line-level trimming logic, consistent with other formats, while adhering to the global line count limit
      const startLine = args.startLine || 1;
      const requestedEndLine = args.endLine || (args.lineCount ? startLine + args.lineCount - 1 : totalLines);
      const maxEndLine = Math.min(
        requestedEndLine,
        startLine + FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES - 1,
        totalLines
      );

      // 10. Trim target lines and construct the return result, also marking whether truncation occurred
      const selectedLines = lines.slice(startLine - 1, maxEndLine);
      const resultContent = selectedLines.join('\n');

      const truncated = (requestedEndLine > maxEndLine) ||
                        (maxEndLine < totalLines && !args.endLine && !args.lineCount) ||
                        (selectedLines.length >= FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES);

      const fileName = args.fileName || args.path.split('/').pop() || args.path.split('\\').pop() || args.path;

      return {
        content: resultContent,
        fileName,
        startLine,
        endLine: maxEndLine,
        totalLines,
        size: resultContent.length,
        truncated,
        startPage: normalizedStartPage,
        endPage: normalizedEndPage,
        totalPages
      };
    } catch (error) {
      throw new Error(`Failed to extract PowerPoint text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static extractPowerPointSlideLines(slideXml: string): string[] {
    const lines: string[] = [];
    const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    let paragraphMatch: RegExpExecArray | null;
    while ((paragraphMatch = paragraphRegex.exec(slideXml)) !== null) {
      const paragraphXml = paragraphMatch[1];
      const runRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>|<a:tab\s*\/>/gi;
      const parts: string[] = [];
      let runMatch: RegExpExecArray | null;
      while ((runMatch = runRegex.exec(paragraphXml)) !== null) {
        if (runMatch[1] !== undefined) {
          const decoded = this.decodeXmlEntities(runMatch[1]);
          if (decoded.length > 0) {
            parts.push(decoded);
          }
        } else if (runMatch[0].toLowerCase().startsWith('<a:br')) {
          parts.push('\n');
        } else {
          parts.push('\t');
        }
      }

      if (parts.length === 0) {
        continue;
      }

      const paragraphText = parts.join('');
      const segments = paragraphText.split(/\n+/);
      segments.forEach(segment => {
        const normalized = segment.replace(/\s+/g, ' ').trim();
        if (normalized.length > 0) {
          lines.push(normalized);
        }
      });
    }
    return lines;
  }

  private static decodeXmlEntities(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const codePoint = parseInt(hex, 16);
        return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint);
      })
      .replace(/&#(\d+);/g, (_, dec) => {
        const codePoint = parseInt(dec, 10);
        return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint);
      });
  }
}
