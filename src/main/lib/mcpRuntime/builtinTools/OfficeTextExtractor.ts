/**
 * OfficeTextExtractor - Document Text Extractor
 * Extracts plain text content from downloaded file Buffers
 *
 * Reuses existing project dependencies:
 * - mammoth: Word (.docx) text extraction
 * - pdfreader: PDF text extraction
 * - jszip: PowerPoint (.pptx) and Excel (.xlsx) XML parsing
 * - Built-in: Plain text files (.txt, .md, .csv, .json, .xml)
 *
 * For IRM-encrypted documents (CDFV2/OLE2 format):
 * - macOS: AppleScript automation via Microsoft Word / PowerPoint / Excel
 * - Windows: PowerShell COM automation via Word.Application / PowerPoint.Application / Excel.Application
 * - Falls back to error message if native Office is not available
 *
 * Adapted from ReadOfficeFileTool's extraction logic, modified for Buffer input
 */

import type { TextExtractionResult } from './officeExtractionTypes';
import { NativeOfficeExtractor } from './NativeOfficeExtractor';
import {
  extractSlideTextFromXml,
  parseExcelSharedStrings,
  parseExcelWorksheetRows,
  resolveExcelSheetEntries,
} from './OfficeXmlParsers';
import { getGlobalLogger } from '../../unifiedLogger';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import mammoth from 'mammoth';
import { PdfReader } from 'pdfreader';
import JSZip from 'jszip';

const logger = getGlobalLogger();
const LOG_SOURCE = 'OfficeTextExtractor';

/**
 * Supported file types
 */
const SUPPORTED_EXTENSIONS = new Set([
  '.docx', '.pdf', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
]);

export class OfficeTextExtractor {
  /**
   * Extract text content from a Buffer
   *
   * For IRM-encrypted documents (CDFV2/OLE2 format), automatically attempts
   * native Office extraction via AppleScript (macOS) or PowerShell COM (Windows)
   * when the corresponding Office application is installed.
   */
  static async extract(buffer: Buffer, fileName: string): Promise<TextExtractionResult> {
    const ext = path.extname(fileName).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(
        `Unsupported file type: "${ext}". Supported types: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}. ` +
        'Use action="download" to save the file locally instead.'
      );
    }

    // Pre-extraction: detect buffer content type mismatches
    const bufferCheck = this.validateBufferMagicBytes(buffer, ext, fileName);

    // If the file is encrypted, try native Office extraction before giving up
    if (bufferCheck.needsNativeExtraction) {
      logger.info(
        `[${LOG_SOURCE}] Encrypted file detected for "${fileName}" — attempting native Office extraction`,
        LOG_SOURCE,
      );
      return await this.attemptNativeExtraction(buffer, fileName, bufferCheck.error);
    }

    if (bufferCheck.error) {
      throw new Error(bufferCheck.error);
    }

    switch (ext) {
      case '.docx':
        return await this.extractWord(buffer, fileName);
      case '.pdf':
        return await this.extractPdf(buffer, fileName);
      case '.pptx':
        return await this.extractPowerPoint(buffer, fileName);
      case '.xlsx':
        return await this.extractExcel(buffer, fileName);
      case '.txt':
      case '.md':
      case '.csv':
      case '.json':
      case '.xml':
      case '.html':
      case '.htm':
        return this.extractPlainText(buffer, fileName, ext);
      default:
        throw new Error(`Extraction not implemented for: ${ext}`);
    }
  }

  /**
   * Attempt native Office extraction for IRM-encrypted documents.
   *
   * Strategy:
   * 1. Check if platform supports native extraction (macOS or Windows)
   * 2. Check if the required Office app is installed
   * 3. Save buffer to temp file and extract via AppleScript (macOS) or PowerShell COM (Windows)
   * 4. If native extraction fails, throw the original error with additional guidance
   *
   * @param buffer File content buffer
   * @param fileName Original file name
   * @param fallbackError Error message to use if native extraction is not available
   */
  private static async attemptNativeExtraction(
    buffer: Buffer,
    fileName: string,
    fallbackError: string | null,
  ): Promise<TextExtractionResult> {
    // Check platform support
    if (!NativeOfficeExtractor.isPlatformSupported()) {
      throw new Error(
        (fallbackError || `Cannot extract encrypted file "${fileName}".`) +
        ` Native Office extraction is not supported on ${process.platform}. ` +
        'Use action="download" to save the file, then open in Microsoft Office.',
      );
    }

    // Check if the required Office app is installed
    const requiredApp = NativeOfficeExtractor.getRequiredApp(fileName);
    if (!requiredApp) {
      throw new Error(
        (fallbackError || `Cannot extract encrypted file "${fileName}".`) +
        ' File type is not supported for native Office extraction.',
      );
    }

    const officeCheck = await NativeOfficeExtractor.checkOfficeInstalled();
    const isAppAvailable = officeCheck[requiredApp];
    if (!isAppAvailable) {
      const appNameMap = { word: 'Microsoft Word', powerpoint: 'Microsoft PowerPoint', excel: 'Microsoft Excel' };
      const appName = appNameMap[requiredApp];
      throw new Error(
        `Cannot extract encrypted file "${fileName}": ${appName} is not installed. ` +
        `IRM-encrypted documents require ${appName} desktop application for decryption. ` +
        `Please install ${appName} or use action="download" to save the file and open it manually.`,
      );
    }

    // Attempt native extraction
    logger.info(
      `[${LOG_SOURCE}] Native Office extraction: app=${requiredApp}, platform=${officeCheck.platform}`,
      LOG_SOURCE,
    );

    try {
      const result = await NativeOfficeExtractor.extractFromBuffer(buffer, fileName);
      logger.info(
        `[${LOG_SOURCE}] Native extraction succeeded for "${fileName}" — ` +
        `method=${result.extractionMethod}, chars=${result.content.length}`,
        LOG_SOURCE,
      );
      return result;
    } catch (nativeError: any) {
      const nativeMsg = nativeError.message || String(nativeError);
      logger.error(
        `[${LOG_SOURCE}] Native extraction failed for "${fileName}": ${nativeMsg}`,
        LOG_SOURCE,
      );
      // Re-throw the native error (it already has user-friendly messages from NativeOfficeExtractor)
      throw nativeError;
    }
  }

  /**
   * Extract Word (.docx) text
   * Uses mammoth library (existing project dependency)
   * Falls back to native Word extraction for IRM-encrypted files
   */
  private static async extractWord(buffer: Buffer, fileName: string): Promise<TextExtractionResult> {
    // Check if file is encrypted (CDFV2 signature) — try native extraction instead of failing
    if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf) {
      if (buffer.includes(Buffer.from('EncryptedPackage')) || buffer.includes(Buffer.from('EncryptionInfo'))) {
        logger.info(
          `[${LOG_SOURCE}] Word document "${fileName}" is IRM-encrypted, attempting native extraction`,
          LOG_SOURCE,
        );
        return await this.attemptNativeExtraction(buffer, fileName,
          'Document is encrypted with IRM or password protection.',
        );
      }
    }

    const tempPath = this.writeTempFile(buffer, '.docx');
    try {
      const result = await mammoth.extractRawText({ path: tempPath });
      const text = (result.value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
      const lines = text.split('\n');

      return {
        content: text,
        fileType: 'docx',
        extractionMethod: 'mammoth',
        totalLines: lines.length,
        totalPages: 1, // Word has no reliable page concept
      };
    } finally {
      this.cleanupTempFile(tempPath);
    }
  }

  /**
   * Extract PDF text
   * Uses pdfreader library (existing project dependency)
   */
  private static async extractPdf(buffer: Buffer, fileName: string): Promise<TextExtractionResult> {
    const pageLines = await new Promise<string[][]>((resolve, reject) => {
      const reader = new PdfReader();
      const rowsByLine = new Map<number, Array<{ x: number; text: string }>>();
      let currentPageLines: string[] = [];
      const pages: string[][] = [];
      let currentPageNumber = 0;

      const flushLines = () => {
        if (rowsByLine.size === 0) return;
        const sortedY = Array.from(rowsByLine.keys()).sort((a, b) => a - b);
        for (const y of sortedY) {
          const segments = rowsByLine.get(y)?.sort((a, b) => a.x - b.x) ?? [];
          const lineText = segments.map(s => s.text).join(' ').trimEnd();
          currentPageLines.push(lineText);
        }
        rowsByLine.clear();
      };

      const finalizePage = () => {
        flushLines();
        if (currentPageNumber === 0 && currentPageLines.length === 0 && pages.length === 0) return;
        pages.push(currentPageLines);
        currentPageLines = [];
      };

      reader.parseBuffer(buffer, (error: unknown, item: any) => {
        if (error) { reject(error); return; }
        if (!item) { finalizePage(); resolve(pages); return; }
        if (item.page) {
          if (currentPageNumber !== 0 || currentPageLines.length > 0) finalizePage();
          currentPageNumber = item.page;
          return;
        }
        if (item.text) {
          const y = Math.round(typeof item.y === 'number' ? item.y : 0);
          const x = typeof item.x === 'number' ? item.x : 0;
          const bucket = rowsByLine.get(y) ?? [];
          bucket.push({ x, text: item.text });
          rowsByLine.set(y, bucket);
        }
      });
    });

    const totalPages = pageLines.length;
    if (totalPages === 0) {
      return {
        content: '',
        fileType: 'pdf',
        extractionMethod: 'pdfreader',
        totalLines: 0,
        totalPages: 0,
      };
    }

    // Concatenate text from all pages
    const allLines: string[] = [];
    pageLines.forEach((page, index) => {
      allLines.push(...page);
      if (index < pageLines.length - 1) allLines.push('');
    });

    const content = allLines.join('\n');

    return {
      content,
      fileType: 'pdf',
      extractionMethod: 'pdfreader',
      totalLines: allLines.length,
      totalPages,
    };
  }

  /**
   * Extract PowerPoint (.pptx) text
   * Uses jszip decompression + XML parsing (consistent with ReadOfficeFileTool logic)
   * Falls back to native PowerPoint extraction for IRM-encrypted files
   */
  private static async extractPowerPoint(buffer: Buffer, fileName: string): Promise<TextExtractionResult> {
    let zip: any;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err: any) {
      // Check if it's an encrypted file — try native extraction before giving up
      const magicHex = buffer.length >= 8 ? buffer.subarray(0, 8).toString('hex').toUpperCase() : 'N/A';
      const isCdfv2 = buffer.length >= 4 && buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
      if (isCdfv2) {
        logger.info(
          `[${LOG_SOURCE}] PowerPoint "${fileName}" is CDFV2/OLE2 format (magic: ${magicHex}), attempting native extraction`,
          LOG_SOURCE,
        );
        return await this.attemptNativeExtraction(buffer, fileName,
          `Cannot extract "${fileName}": Downloaded file is CDFV2/OLE2 format (magic: ${magicHex}), ` +
          'likely IRM-encrypted or legacy .ppt format.',
        );
      }
      throw new Error(
        `Cannot extract "${fileName}": JSZip failed to parse as ZIP archive (magic: ${magicHex}). ` +
        `Original error: ${err.message}`
      );
    }

    // Determine slide order (consistent with ReadOfficeFileTool)
    let slideFiles: string[] = [];
    const presentationXmlFile = zip.files['ppt/presentation.xml'];
    const presentationRelsFile = zip.files['ppt/_rels/presentation.xml.rels'];

    if (presentationXmlFile && presentationRelsFile) {
      try {
        const [presentationXml, relsXml] = await Promise.all([
          presentationXmlFile.async('string'),
          presentationRelsFile.async('string'),
        ]);

        // Parse relationship file
        const relationshipMap = new Map<string, string>();
        const relRegex = /<Relationship\b([^>]*?)\/>/gi;
        let relMatch: RegExpExecArray | null;
        while ((relMatch = relRegex.exec(relsXml)) !== null) {
          const attrs = relMatch[1];
          const idMatch = attrs.match(/\bId="([^"]+)"/i);
          const targetMatch = attrs.match(/\bTarget="([^"]+)"/i);
          const typeMatch = attrs.match(/\bType="([^"]+)"/i);
          if (!idMatch || !targetMatch) continue;
          if (!typeMatch?.[1]?.endsWith('/slide')) continue;
          const normalizedTarget = targetMatch[1].replace(/^\.\//, '').replace(/^\.\.\//, '');
          const zipPath = normalizedTarget.startsWith('ppt/') ? normalizedTarget : `ppt/${normalizedTarget}`;
          relationshipMap.set(idMatch[1], zipPath.replace(/\\/g, '/'));
        }

        if (relationshipMap.size > 0) {
          const slideIdRegex = /<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/>/gi;
          const orderedSlides: string[] = [];
          let slideIdMatch: RegExpExecArray | null;
          while ((slideIdMatch = slideIdRegex.exec(presentationXml)) !== null) {
            const relId = slideIdMatch[1];
            const targetPath = relationshipMap.get(relId);
            if (targetPath && zip.files[targetPath]) {
              orderedSlides.push(targetPath);
            }
          }
          if (orderedSlides.length > 0) slideFiles = orderedSlides;
        }
      } catch {
        // Fall back to numeric sorting
      }
    }

    // Fallback: sort by slideN number
    if (slideFiles.length === 0) {
      slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
          const aMatch = a.match(/slide(\d+)\.xml$/i);
          const bMatch = b.match(/slide(\d+)\.xml$/i);
          return (parseInt(aMatch?.[1] || '0') - parseInt(bMatch?.[1] || '0'));
        });
    }

    if (slideFiles.length === 0) {
      return {
        content: '',
        fileType: 'pptx',
        extractionMethod: 'jszip+xml',
        totalLines: 0,
        totalPages: 0,
      };
    }

    // Extract text from each slide
    const allLines: string[] = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = zip.files[slideFiles[i]];
      if (!slideFile) continue;
      const slideXml = await slideFile.async('string');
      const slideLines = extractSlideTextFromXml(slideXml);
      if (slideLines.length > 0) {
        allLines.push(`--- Slide ${i + 1} ---`);
        allLines.push(...slideLines);
        allLines.push('');
      }
    }

    const content = allLines.join('\n');

    return {
      content,
      fileType: 'pptx',
      extractionMethod: 'jszip+xml',
      totalLines: allLines.length,
      totalPages: slideFiles.length,
    };
  }

  /**
   * Extract Excel (.xlsx) text
   * Uses jszip decompression + XML parsing for sharedStrings and worksheets
   * Falls back to native Excel extraction for IRM-encrypted files
   */
  private static async extractExcel(buffer: Buffer, fileName: string): Promise<TextExtractionResult> {
    let zip: any;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err: any) {
      const magicHex = buffer.length >= 8 ? buffer.subarray(0, 8).toString('hex').toUpperCase() : 'N/A';
      const isCdfv2 = buffer.length >= 4 && buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
      if (isCdfv2) {
        logger.info(
          `[${LOG_SOURCE}] Excel "${fileName}" is CDFV2/OLE2 format (magic: ${magicHex}), attempting native extraction`,
          LOG_SOURCE,
        );
        return await this.attemptNativeExtraction(buffer, fileName,
          `Cannot extract "${fileName}": Downloaded file is CDFV2/OLE2 format (magic: ${magicHex}), ` +
          'likely IRM-encrypted or legacy .xls format.',
        );
      }
      throw new Error(
        `Cannot extract "${fileName}": JSZip failed to parse as ZIP archive (magic: ${magicHex}). ` +
        `Original error: ${err.message}`
      );
    }

    // 1. Parse shared strings table
    const sharedStrings = await parseExcelSharedStrings(zip);

    // 2. Determine sheet order from workbook.xml + rels
    const sheetEntries = await resolveExcelSheetEntries(zip);

    if (sheetEntries.length === 0) {
      return {
        content: '',
        fileType: 'xlsx',
        extractionMethod: 'jszip+xml',
        totalLines: 0,
        totalPages: 0,
      };
    }

    // 3. Extract text from each worksheet
    const allLines: string[] = [];
    for (let i = 0; i < sheetEntries.length; i++) {
      const entry = sheetEntries[i];
      const wsFile = zip.files[entry.zipPath];
      if (!wsFile) continue;
      const wsXml = await wsFile.async('string');
      const rows = parseExcelWorksheetRows(wsXml, sharedStrings);
      allLines.push(`--- Sheet ${i + 1}: ${entry.name} ---`);
      allLines.push(...rows);
      allLines.push('');
    }

    const content = allLines.join('\n');

    return {
      content,
      fileType: 'xlsx',
      extractionMethod: 'jszip+xml',
      totalLines: allLines.length,
      totalPages: sheetEntries.length,
    };
  }

  /**
   * Extract plain text file
   */
  private static extractPlainText(buffer: Buffer, fileName: string, ext: string): TextExtractionResult {
    let text: string;
    try {
      text = buffer.toString('utf-8');
    } catch {
      text = buffer.toString('latin1');
    }

    const lines = text.split('\n');

    return {
      content: text,
      fileType: ext.replace('.', ''),
      extractionMethod: 'text-decode',
      totalLines: lines.length,
    };
  }

  /**
   * Write Buffer to a temporary file
   */
  private static writeTempFile(buffer: Buffer, ext: string): string {
    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, `office-extract-${Date.now()}${ext}`);
    fs.writeFileSync(tempPath, buffer);
    return tempPath;
  }

  /**
   * Clean up temporary file
   */
  private static cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Check whether the file type supports text extraction
   */
  static isSupported(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Validate buffer magic bytes against the expected file extension.
   * Detects IRM-encrypted files, HTML error pages, and format mismatches
   * BEFORE attempting extraction (which would produce cryptic jszip errors).
   *
   * Returns:
   * - { error: null, needsNativeExtraction: false } → extraction should proceed normally
   * - { error: string, needsNativeExtraction: true } → encrypted file, try native Office extraction
   * - { error: string, needsNativeExtraction: false } → fatal error, cannot extract
   */
  private static validateBufferMagicBytes(
    buffer: Buffer,
    ext: string,
    fileName: string,
  ): { error: string | null; needsNativeExtraction: boolean } {
    if (buffer.length < 4) {
      return {
        error: `Buffer too small (${buffer.length} bytes) — likely an empty or failed download for "${fileName}".`,
        needsNativeExtraction: false,
      };
    }

    const magicHex = buffer.subarray(0, 8).toString('hex').toUpperCase();
    const isCdfv2 = buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
    const isZip   = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    const isPdf   = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    const isHtml  = buffer[0] === 0x3C; // starts with '<'

    // Check for HTML error pages (applies to all file types)
    if (isHtml) {
      const head = buffer.toString('utf-8', 0, Math.min(200, buffer.length)).toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html') || head.includes('sign in') || head.includes('error')) {
        const preview = buffer.toString('utf-8', 0, Math.min(300, buffer.length));
        logger.error(
          `[${LOG_SOURCE}] Buffer for "${fileName}" is HTML, not ${ext} — likely a sign-in page or error response. Preview: ${preview}`,
          LOG_SOURCE,
        );
        return {
          error: `Downloaded content for "${fileName}" is an HTML page (likely authentication redirect or error), not a ${ext} file. ` +
                 'The file may require additional permissions or the download URL may have expired.',
          needsNativeExtraction: false,
        };
      }
    }

    // CDFV2 detection — IRM-encrypted or legacy Office format
    // Instead of immediately failing, flag for native Office extraction attempt
    if (isCdfv2) {
      const hasEncryptionMarker = buffer.includes(Buffer.from('EncryptedPackage')) || buffer.includes(Buffer.from('EncryptionInfo'));
      logger.warn(
        `[${LOG_SOURCE}] Buffer for "${fileName}" is CDFV2/OLE2 format (magic: ${magicHex}), encryption markers: ${hasEncryptionMarker}`,
        LOG_SOURCE,
        { fileName, magicHex, hasEncryptionMarker },
      );

      if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx') {
        const errorMsg = `File "${fileName}" is in CDFV2/OLE2 binary format (magic: ${magicHex}). ` +
          (hasEncryptionMarker
            ? 'The document is IRM-encrypted or password-protected.'
            : 'This may be a legacy Office format (.doc/.ppt/.xls) mislabeled as ' + ext + '.');

        // Flag for native extraction attempt — the caller will try native Office apps first
        return {
          error: errorMsg,
          needsNativeExtraction: true,
        };
      }
      // For other extensions, let it proceed (might be a valid .doc/.ppt)
    }

    // ZIP-based Office formats (.docx, .pptx) MUST start with PK signature
    if ((ext === '.docx' || ext === '.pptx' || ext === '.xlsx') && !isZip && !isCdfv2) {
      logger.warn(
        `[${LOG_SOURCE}] Buffer for "${fileName}" (expected ${ext}) does not start with ZIP/PK signature. Magic: ${magicHex}`,
        LOG_SOURCE,
        { fileName, ext, magicHex },
      );
      return {
        error: `Cannot extract "${fileName}": Expected ZIP-based ${ext} format but buffer signature is ${magicHex}. ` +
               'The download may have returned an error response or the file is in an unexpected format.',
        needsNativeExtraction: false,
      };
    }

    // PDF files should start with %PDF
    if (ext === '.pdf' && !isPdf) {
      logger.warn(
        `[${LOG_SOURCE}] Buffer for "${fileName}" (expected .pdf) does not start with %PDF signature. Magic: ${magicHex}`,
        LOG_SOURCE,
        { fileName, ext, magicHex },
      );
      // Don't block — pdfreader may still handle some edge cases
    }

    logger.info(
      `[${LOG_SOURCE}] Buffer validation OK for "${fileName}" — ext=${ext}, magic=${magicHex}, size=${buffer.length}`,
      LOG_SOURCE,
    );
    return { error: null, needsNativeExtraction: false };
  }
}
