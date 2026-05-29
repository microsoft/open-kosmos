/**
 * ReadOfficeFileTool built-in tool
 * Handles reading and pagination logic for Office files (currently supports PDF, Word, PPT, Excel)
 * Note: This is a built-in tool, not an MCP protocol tool
 * Security validation has been moved to AgentChat.validateToolPathsAndRequestApproval()
 */

import { FILE_ATTACHMENT_LIMITS } from '../../constants/fileConstants';
import * as fs from 'node:fs/promises';
import type { BuiltinToolDefinition } from './types';
import { PdfReader } from 'pdfreader';
import mammoth from 'mammoth';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Inline Office XML helpers
// ---------------------------------------------------------------------------

function extractSlideTextFromXml(xml: string): string[] {
  const lines: string[] = [];
  // Extract text runs from <a:t> elements, grouped by paragraph <a:p>
  const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let paraMatch: RegExpExecArray | null;
  while ((paraMatch = paragraphRegex.exec(xml)) !== null) {
    const paraXml = paraMatch[1];
    const textRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    let textMatch: RegExpExecArray | null;
    const parts: string[] = [];
    while ((textMatch = textRegex.exec(paraXml)) !== null) {
      parts.push(textMatch[1]);
    }
    const line = parts.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (line.trim()) {
      lines.push(line);
    }
  }
  return lines;
}

async function parseExcelSharedStrings(zip: JSZip): Promise<string[]> {
  const sharedStringsFile = zip.files['xl/sharedStrings.xml'];
  if (!sharedStringsFile) return [];
  const xml = await sharedStringsFile.async('string');
  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siXml = siMatch[1];
    const parts: string[] = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(siXml)) !== null) {
      parts.push(tMatch[1]);
    }
    strings.push(parts.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return strings;
}

function parseExcelWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowXml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1];
      const cellInner = cellMatch[2];
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const vMatch = cellInner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const rawValue = vMatch ? vMatch[1] : '';
      let value = rawValue;
      if (typeMatch && typeMatch[1] === 's') {
        const idx = parseInt(rawValue, 10);
        value = Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : rawValue;
      }
      cells.push(value);
    }
    if (cells.some(c => c.trim())) {
      rows.push(cells.join('\t'));
    }
  }
  return rows;
}

async function resolveExcelSheetEntries(zip: JSZip): Promise<Array<{ name: string; zipPath: string }>> {
  const workbookFile = zip.files['xl/workbook.xml'];
  const relsFile = zip.files['xl/_rels/workbook.xml.rels'];
  if (!workbookFile || !relsFile) return [];
  const [workbookXml, relsXml] = await Promise.all([workbookFile.async('string'), relsFile.async('string')]);

  // Build rId -> zip path map
  const relMap = new Map<string, string>();
  const relRegex = /<Relationship\b([^>]*?)\/>/gi;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml)) !== null) {
    const attrs = relMatch[1];
    const idM = attrs.match(/\bId="([^"]+)"/i);
    const targetM = attrs.match(/\bTarget="([^"]+)"/i);
    if (idM && targetM) {
      const target = targetM[1].replace(/^\.\//, '');
      relMap.set(idM[1], target.startsWith('xl/') ? target : `xl/${target}`);
    }
  }

  const entries: Array<{ name: string; zipPath: string }> = [];
  const sheetRegex = /<sheet\b([^>]*)\/>/gi;
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetRegex.exec(workbookXml)) !== null) {
    const attrs = sheetMatch[1];
    const nameM = attrs.match(/\bname="([^"]+)"/i);
    const ridM = attrs.match(/\br:id="([^"]+)"/i);
    if (!nameM || !ridM) continue;
    const zipPath = relMap.get(ridM[1]);
    if (zipPath && zip.files[zipPath]) {
      entries.push({ name: nameM[1], zipPath });
    }
  }
  return entries;
}

export interface ReadOfficeFileToolArgs {
  // File path (required)
  filePath: string;        // Full path to the file

  // Operation description for UI display
  description?: string;

  // File metadata (optional, used for display and optimization)
  fileName?: string;       // File name
  fileSize?: number;       // File size in bytes
  fileType?: string;       // File type/extension
  mimeType?: string;       // MIME type

  // Read range (optional)
  //  - If no page/line is specified, the entire document is processed subject to a 2000-line limit
  //  - If only page is specified, that page range is first extracted, then line pagination is applied to the result
  //  - If only line is specified, lines are extracted from all pages, still protected by the upper limit
  startLine?: number;      // Starting line number (1-based)
  endLine?: number;        // Ending line number (1-based)
  lineCount?: number;      // Number of lines to read (starting from startLine)
  startPage?: number;      // Starting page number (1-based)
  endPage?: number;        // Ending page number (1-based)
}

export interface ReadOfficeFileToolResult {
  content: string;        // Text content returned after reading
  fileName: string;       // Actual file name returned
  startLine: number;      // Starting line number of returned content
  endLine: number;        // Ending line number of returned content
  totalLines: number;     // Total lines within the current page range
  size: number;           // Content length (in characters)
  truncated: boolean;     // Whether content was truncated due to limits
  startPage: number;      // Actual starting page number read
  endPage: number;        // Actual ending page number read
  totalPages: number;     // Total number of pages in the file
}

export class ReadOfficeFileTool {

  /**
   * Execute the file reading tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: ReadOfficeFileToolArgs, options?: { signal?: AbortSignal }): Promise<ReadOfficeFileToolResult> {

    // 1. Resolve the file path (supports multiple formats)
    const actualPath = this.resolveFilePath(args);

    // 2. Validate arguments
    const validation = this.validateArgs({ ...args, path: actualPath });
    if (!validation.isValid) {
      throw new Error(`Invalid arguments: ${validation.error}`);
    }

    // Note: path security validation has been moved to AgentChat.validateToolPathsAndRequestApproval()

    // 3. Branch by document type
    const documentType = this.resolveDocumentType(args, actualPath);

    if (!documentType) {
      throw new Error('Unsupported office file type: currently only PDF, Word, PowerPoint, or Excel files are supported');
    }

    // 4. Read and process the file
    try {
      switch (documentType) {
        case 'pdf':
          return await this.readPdfWithPagination({ ...args, path: actualPath });
        case 'word':
          return await this.readWordWithPagination({ ...args, path: actualPath });
        case 'excel':
          return await this.readExcelWithPagination({ ...args, path: actualPath });
        case 'ppt':
          return await this.readPowerPointWithPagination({ ...args, path: actualPath });
      }
    } catch (error) {
      throw new Error(`File read failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resolve file path, supports multiple input formats
   */
  private static resolveFilePath(args: ReadOfficeFileToolArgs): string {
    const path = args.filePath;

    if (!path) {
      throw new Error('No file path provided. filePath is required');
    }


    return path;
  }

  /**
   * Get tool definition (for registering with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'read_office_file',
      description: 'Read the contents of office documents (currently PDF, Word, PowerPoint, and Excel). PDF/PPT/Excel support page and line-based pagination; Word supports line-based pagination only. Maximum 2000 lines per call.',
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
   * Determine the document type
   */
  private static resolveDocumentType(args: ReadOfficeFileToolArgs, resolvedPath: string): 'pdf' | 'word' | 'ppt' | 'excel' | null {
    // Prioritize MIME type if provided
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
    if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mime === 'application/vnd.ms-excel' ||
        mime === 'application/vnd.ms-excel.sheet.macroenabled.12') {
      return 'excel';
    }

    // Then check the passed-in file type extension parameter (with or without dot)
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
      if (normalizedType === 'xlsx' || normalizedType === '.xlsx' ||
          normalizedType === 'xlsm' || normalizedType === '.xlsm' ||
          normalizedType === 'xls' || normalizedType === '.xls') {
        return 'excel';
      }
    }

    // Fall back to determining type from the resolved path's extension
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
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) {
        return 'excel';
      }
    }

    return null;
  }

  /**
   * PDF file reading and pagination extraction
   * Event-driven parsing flow:
   * - Pre-initialize line cache, current page line list, overall page collection, and page counter
   * - Use flushLines() to sort text segments by x before page transitions and concatenate them into lines
   * - finalizePage() persists the current page when entering a new page or at the end, then resets line state
   * - reader.parseBuffer(buffer, callback) uses event callbacks: item === null means end, item.page signals a page change, item.text is a text fragment on the current page
   * - The whole Promise resolves after pdfreader signals completion, returning the full pages array for subsequent page/line slicing
   */
  private static async readPdfWithPagination(args: ReadOfficeFileToolArgs & { path: string }): Promise<ReadOfficeFileToolResult> {
    try {

      // 1. Read PDF buffer and initialize pdfreader
      const fileBuffer = await fs.readFile(args.path);

      // 2. Use pdfreader item callbacks; we combine text by (y, x) coordinates into line text, then group by page
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

        // Push current page's line results into pages, then prepare to collect the next page
        const finalizePage = () => {
          flushLines();
          if (currentPageNumber === 0 && currentPageLines.length === 0 && pages.length === 0) {
            return;
          }
          pages.push(currentPageLines);
          currentPageLines = [];
        };

        // Parse pdf buffer and collect text items
        reader.parseBuffer(fileBuffer, (error: unknown, item: any) => {
          if (error) {
            reject(error);
            return;
          }

          // item === null means parsing is complete
          if (!item) {
            finalizePage();
            resolve(pages);
            return;
          }

          // item.page indicates a new page; finalize the previous page first
          if (item.page) {
            if (currentPageNumber !== 0 || currentPageLines.length > 0) {
              finalizePage();
            }
            currentPageNumber = item.page;
            return;
          }

          // item.text is a text fragment on the current page; group by y/x coordinates
          if (item.text) {
            const y = Math.round(typeof item.y === 'number' ? item.y : 0);
            const x = typeof item.x === 'number' ? item.x : 0;
            const bucket = rowsByLine.get(y) ?? [];
            bucket.push({ x, text: item.text });
            rowsByLine.set(y, bucket);
          }
        });
      });

      // 3. If the entire PDF has no text content, return an empty result immediately
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

      // 4. Clip the page range based on call arguments
      const requestedStartPage = args.startPage ?? 1;
      const requestedEndPage = args.endPage ?? totalPages;
      const normalizedStartPage = Math.max(1, Math.min(requestedStartPage, totalPages));
      const normalizedEndPage = Math.max(normalizedStartPage, Math.min(requestedEndPage, totalPages));

      // 5. Concatenate lines from selected pages into one array, separated by blank lines between pages
      const selectedPages = pageLines.slice(normalizedStartPage - 1, normalizedEndPage);
      const lines: string[] = [];
      selectedPages.forEach((page, index) => {
        lines.push(...page);
        if (index < selectedPages.length - 1) {
          lines.push('');
        }
      });

      // 6. Log parse results for diagnostics
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
   * Word file reading and pagination
   * Parsing flow:
   * - Call mammoth to extract plain text and normalize line endings
   * - Word documents lack a stable page concept, so only line-based extraction is supported; page numbers always treated as single page
   * - Preserves the same line-level truncation and statistics logic as other formats
   */
  private static async readWordWithPagination(args: ReadOfficeFileToolArgs & { path: string }): Promise<ReadOfficeFileToolResult> {
    try {

      // 0. Read file buffer, first check whether the file is encrypted
      const fileBuffer = await fs.readFile(args.path);
      if (this.isCdfv2Encrypted(fileBuffer)) {
        return await this.extractEncryptedWithNativeOffice(args.path, args);
      }

      // 1. Call mammoth to extract raw text; normalize line endings to avoid platform differences in pagination/line slicing
      const result = await mammoth.extractRawText({ path: args.path });
      const rawText = (result.value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();

      // 2. Return empty result when content is empty, maintaining consistent start/end line/page semantics with the PDF branch
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

      // 3. Word documents are processed by line, always treated as single page
      const lines = rawText.split('\n');

      // 4. Log parse results for subsequent diagnostics
      const totalLines = lines.length;


      // 5. Apply line-level slicing logic, consistent with other formats, protected by global line count limit
      const startLine = args.startLine || 1;
      const requestedEndLine = args.endLine || (args.lineCount ? startLine + args.lineCount - 1 : totalLines);
      const maxEndLine = Math.min(
        requestedEndLine,
        startLine + FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES - 1,
        totalLines
      );

      // 6. Slice target lines and summarize results, compute whether truncation occurred
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

      // 1. Read the PowerPoint file and unzip it with jszip to access slide XML files
      const fileBuffer = await fs.readFile(args.path);

      // 1.1 First check whether the file is encrypted (CDFV2/OLE2 format)
      if (this.isCdfv2Encrypted(fileBuffer)) {
        return await this.extractEncryptedWithNativeOffice(args.path, args);
      }

      const zip = await JSZip.loadAsync(fileBuffer);

      // 2. Parse presentation.xml and relationship files: use the relationship table to locate each slide's ZIP path, then restore official display order from the p:sldId list; fall back to numeric order if parsing fails
      let slideFiles: string[] = [];
      const presentationXmlFile = zip.files['ppt/presentation.xml'];
      const presentationRelsFile = zip.files['ppt/_rels/presentation.xml.rels'];
      if (presentationXmlFile && presentationRelsFile) {
        try {
          const [presentationXml, relsXml] = await Promise.all([
            presentationXmlFile.async('string'),
            presentationRelsFile.async('string')
          ]);

          // 2.1 Parse presentation.xml.rels: build a map of r:id -> slide XML path, filtering out non-slide relationship entries
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

          // 2.2 Map actual slide paths in the order of p:sldId in presentation.xml to form the final ordered list
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

      // 2.3 If slide order could not be determined, fall back to old logic: sort by slideN numeric order
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

      // 3. Return empty result immediately when no slides found, consistent semantics with other formats
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

      // 4. Parse each slide's XML to extract paragraph text and store in the pages array
      const pages: string[][] = [];
      for (const slidePath of slideFiles) {
        const slideFile = zip.files[slidePath];
        if (!slideFile) {
          continue;
        }
        const slideXml = await slideFile.async('string');
        const slideLines = extractSlideTextFromXml(slideXml);
        pages.push(slideLines);
      }

      // 5. Validate again that valid content exists, to avoid out-of-bounds issues from blank slides
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

      // 6. Clip the page range from the caller's start/end page arguments, ensuring no out-of-bounds
      const requestedStartPage = args.startPage ?? 1;
      const requestedEndPage = args.endPage ?? totalPages;
      const normalizedStartPage = Math.max(1, Math.min(requestedStartPage, totalPages));
      const normalizedEndPage = Math.max(normalizedStartPage, Math.min(requestedEndPage, totalPages));

      // 7. Merge lines from selected pages into the final line array, inserting blank lines as slide separators as needed
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

      // 8. Log parse statistics for PPT content diagnostics
      const totalLines = lines.length;


      // 9. Apply line-level slicing logic, consistent with other formats, respecting global line count limit
      const startLine = args.startLine || 1;
      const requestedEndLine = args.endLine || (args.lineCount ? startLine + args.lineCount - 1 : totalLines);
      const maxEndLine = Math.min(
        requestedEndLine,
        startLine + FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES - 1,
        totalLines
      );

      // 10. Slice target lines and build return result, marking whether truncation occurred
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

  /**
   * Excel file reading and pagination
   * Uses jszip to unzip .xlsx files and parse sharedStrings + worksheets XML
   * Encrypted files go through NativeOfficeExtractor
   */
  private static async readExcelWithPagination(args: ReadOfficeFileToolArgs & { path: string }): Promise<ReadOfficeFileToolResult> {
    try {
      // 0. Read file buffer, first check whether the file is encrypted
      const fileBuffer = await fs.readFile(args.path);
      if (this.isCdfv2Encrypted(fileBuffer)) {
        return await this.extractEncryptedWithNativeOffice(args.path, args);
      }

      // 1. Unzip ZIP
      const zip = await JSZip.loadAsync(fileBuffer);

      // 2. Parse sharedStrings
      const sharedStrings = await parseExcelSharedStrings(zip);

      // 3. Determine sheet order
      const sheetEntries = await resolveExcelSheetEntries(zip);

      if (sheetEntries.length === 0) {
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

      // 4. Extract text per sheet; each sheet is treated as a "page"
      const pages: string[][] = [];
      for (let i = 0; i < sheetEntries.length; i++) {
        const entry = sheetEntries[i];
        const wsFile = zip.files[entry.zipPath];
        if (!wsFile) continue;
        const wsXml = await wsFile.async('string');
        const rows = parseExcelWorksheetRows(wsXml, sharedStrings);
        const sheetLines: string[] = [`--- Sheet ${i + 1}: ${entry.name} ---`, ...rows];
        pages.push(sheetLines);
      }

      // 5. Page range clipping
      const totalPages = pages.length;
      const requestedStartPage = args.startPage ?? 1;
      const requestedEndPage = args.endPage ?? totalPages;
      const normalizedStartPage = Math.max(1, Math.min(requestedStartPage, totalPages));
      const normalizedEndPage = Math.max(normalizedStartPage, Math.min(requestedEndPage, totalPages));

      const selectedPages = pages.slice(normalizedStartPage - 1, normalizedEndPage);
      const lines: string[] = [];
      selectedPages.forEach((page, index) => {
        lines.push(...page);
        if (index < selectedPages.length - 1) {
          lines.push('');
        }
      });

      // 6. Line-level pagination
      const totalLines = lines.length;
      const startLine = args.startLine || 1;
      const requestedEndLine = args.endLine || (args.lineCount ? startLine + args.lineCount - 1 : totalLines);
      const maxEndLine = Math.min(
        requestedEndLine,
        startLine + FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES - 1,
        totalLines
      );

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
      throw new Error(`Failed to extract Excel text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect whether a buffer is a CDFV2/OLE2 file (IRM-encrypted or legacy Office format)
   */
  private static isCdfv2Encrypted(buffer: Buffer): boolean {
    if (buffer.length < 8) return false;
    // CDFV2/OLE2 magic bytes: D0 CF 11 E0
    return buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
  }

  /**
   * Encrypted Office files are not supported without NativeOfficeExtractor.
   */
  private static async extractEncryptedWithNativeOffice(
    _filePath: string,
    _args: ReadOfficeFileToolArgs & { path: string },
  ): Promise<ReadOfficeFileToolResult> {
    throw new Error(
      'This file appears to be IRM-encrypted or in legacy Office format. ' +
      'Native Office extraction is not available in this build. ' +
      'Please open the file in Microsoft Office and save it in an unencrypted format.',
    );
  }
}
