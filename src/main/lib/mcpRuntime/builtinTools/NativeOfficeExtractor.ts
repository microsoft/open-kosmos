/**
 * NativeOfficeExtractor - Extract text from IRM-encrypted Office documents
 * using native OS automation (AppleScript on macOS, PowerShell/COM on Windows).
 *
 * Strategy (cross-platform):
 * 1. macOS: AppleScript → Microsoft Word / PowerPoint (handles IRM automatically)
 * 2. Windows: PowerShell + COM → Word.Application / PowerPoint.Application (handles IRM automatically)
 * 3. Other platforms: Not supported (caller should fall back to error message)
 *
 * Uses native Office automation so encrypted local files can be read without
 * any tenant service or network dependency.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TextExtractionResult } from './officeExtractionTypes';
import {
  buildExcelPowerShellScript,
  buildPowerPointPowerShellScript,
  buildWordPowerShellScript,
} from './nativeOfficePowerShellScripts';
import { getGlobalLogger } from '../../unifiedLogger';

const execFileAsync = promisify(execFile);
const logger = getGlobalLogger();
const LOG_SOURCE = 'NativeOfficeExtractor';

/** Timeout for native app operations (2 minutes for Word, 3 minutes for PowerPoint, 2 minutes for Excel) */
const WORD_TIMEOUT_MS = 120_000;
const POWERPOINT_TIMEOUT_MS = 180_000;
const EXCEL_TIMEOUT_MS = 120_000;

/** Retry configuration for transient AppleScript/COM errors */
const MAX_RETRIES = 2; // up to 2 retries (3 total attempts)
const RETRY_DELAY_MS = 3_000; // wait 3 seconds between retries to let Office app stabilize

/**
 * AppleScript/COM error codes that are transient and worth retrying:
 * - -600: "Application isn't running" — app was quit by previous extraction, not yet relaunched
 * - -609: "Connection is invalid" — Word app wasn't ready or lost connection
 * - -1700: "Can't make ... into type text" — document didn't open properly
 * - -1708: "... doesn't understand the ... message" — app was busy with previous doc
 * - -1712: "... doesn't have permission" — timing issue with app startup
 * - RPC_E_CALL_REJECTED / CO_E_SERVER_EXEC_FAILURE — Windows COM transient errors
 */
const RETRYABLE_ERROR_PATTERNS = [
  'error: (-600)',     // Application isn't running
  '-600)',
  "isn't running",     // Alternative form of -600
  'error: (-609)',     // Connection is invalid
  '-609)',
  'error: (-1700)',    // Can't make into type
  '-1700)',
  'error: (-1708)',    // doesn't understand the message
  '-1708)',
  'error: (-1712)',    // doesn't have permission
  '-1712)',
  'rpc_e_call_rejected',    // Windows COM: server busy
  'co_e_server_exec_failure', // Windows COM: server launch failed
  'the rpc server is unavailable',
];

function isRetryableError(error: any): boolean {
  const msg = (error.message || String(error)).toLowerCase();
  return RETRYABLE_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Serial execution queues for Office apps.
 *
 * Word and PowerPoint are single-instance apps on both macOS and Windows.
 * Concurrent AppleScript/COM calls to the same app cause errors like:
 *   - macOS: error -609 "Connection is invalid", -1700 "Can't make into type text",
 *            -1708 "active document doesn't understand the close message"
 *   - Windows: COM RPC_E_CALL_REJECTED, CO_E_SERVER_EXEC_FAILURE
 *
 * We maintain separate queues for Word and PowerPoint so that:
 *   - Multiple Word extractions run serially (one after another)
 *   - Multiple PowerPoint extractions run serially
 *   - Word and PowerPoint can run in parallel (they are different apps)
 */
const appQueues: Record<NativeOfficeApp, Promise<any>> = {
  word: Promise.resolve(),
  powerpoint: Promise.resolve(),
  excel: Promise.resolve(),
};

/**
 * Enqueue a task to run serially within the given app's queue.
 * Returns a promise that resolves/rejects with the task's result.
 */
function enqueueForApp<T>(app: NativeOfficeApp, task: () => Promise<T>): Promise<T> {
  const previous = appQueues[app];
  // Chain onto the previous task — always continue even if previous failed
  const next = previous.catch(() => {}).then(() => task());
  // Update the queue tail (swallow rejections so future tasks still run)
  appQueues[app] = next.catch(() => {});
  return next;
}

export type NativeOfficeApp = 'word' | 'powerpoint' | 'excel';

export interface NativeOfficeCheckResult {
  word: boolean;
  powerpoint: boolean;
  excel: boolean;
  platform: 'darwin' | 'win32' | 'unsupported';
}

export class NativeOfficeExtractor {
  /**
   * Check whether native Office extraction is supported on this platform
   */
  static isPlatformSupported(): boolean {
    return process.platform === 'darwin' || process.platform === 'win32';
  }

  /**
   * Check which Office apps are installed and available for automation
   */
  static async checkOfficeInstalled(): Promise<NativeOfficeCheckResult> {
    const result: NativeOfficeCheckResult = {
      word: false,
      powerpoint: false,
      excel: false,
      platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'unsupported',
    };

    if (process.platform === 'darwin') {
      result.word = await NativeOfficeExtractor.checkMacAppInstalled('com.microsoft.Word');
      result.powerpoint = await NativeOfficeExtractor.checkMacAppInstalled('com.microsoft.Powerpoint');
      result.excel = await NativeOfficeExtractor.checkMacAppInstalled('com.microsoft.Excel');
    } else if (process.platform === 'win32') {
      result.word = await NativeOfficeExtractor.checkWindowsComAvailable('Word.Application');
      result.powerpoint = await NativeOfficeExtractor.checkWindowsComAvailable('PowerPoint.Application');
      result.excel = await NativeOfficeExtractor.checkWindowsComAvailable('Excel.Application');
    }

    logger.info(
      `[${LOG_SOURCE}] Office check: platform=${result.platform}, word=${result.word}, powerpoint=${result.powerpoint}, excel=${result.excel}`,
      LOG_SOURCE,
    );

    return result;
  }

  /**
   * Determine which Office app is needed for a given file extension
   */
  static getRequiredApp(fileName: string): NativeOfficeApp | null {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.docx':
      case '.doc':
        return 'word';
      case '.pptx':
      case '.ppt':
        return 'powerpoint';
      case '.xlsx':
      case '.xls':
        return 'excel';
      default:
        return null;
    }
  }

  /**
   * Extract text from an encrypted document file using native Office automation.
   *
   * The file must already be saved to disk (temporary file).
   * The native Office app will open it, handle IRM decryption, extract text, and close.
   *
   * @param filePath Absolute path to the document file on disk
   * @param fileName Original file name (for extension detection and reporting)
   * @returns TextExtractionResult with extracted content
   */
  static async extractFromFile(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const app = NativeOfficeExtractor.getRequiredApp(fileName);
    if (!app) {
      throw new Error(`Unsupported file type for native extraction: ${path.extname(fileName)}`);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    logger.info(
      `[${LOG_SOURCE}] Attempting native ${app} extraction for "${fileName}" on ${process.platform} (queued)`,
      LOG_SOURCE,
    );

    // Use serial queue to prevent concurrent AppleScript/COM calls to the same Office app.
    // Word and PowerPoint are single-instance apps; concurrent automation calls cause
    // errors like -609, -1700, -1708 (macOS) or RPC_E_CALL_REJECTED (Windows).
    return enqueueForApp(app, async () => {
      logger.info(
        `[${LOG_SOURCE}] Dequeued: starting ${app} extraction for "${fileName}"`,
        LOG_SOURCE,
      );

      // Retry loop for transient AppleScript/COM errors (e.g., -609 "Connection is invalid")
      let lastError: any;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          logger.warn(
            `[${LOG_SOURCE}] Retry ${attempt}/${MAX_RETRIES} for "${fileName}" after ${RETRY_DELAY_MS}ms delay`,
            LOG_SOURCE,
          );
          await sleep(RETRY_DELAY_MS);
        }

        try {
          if (process.platform === 'darwin') {
            return app === 'word'
              ? await NativeOfficeExtractor.extractWordMac(filePath, fileName)
              : app === 'powerpoint'
                ? await NativeOfficeExtractor.extractPowerPointMac(filePath, fileName)
                : await NativeOfficeExtractor.extractExcelMac(filePath, fileName);
          } else if (process.platform === 'win32') {
            return app === 'word'
              ? await NativeOfficeExtractor.extractWordWindows(filePath, fileName)
              : app === 'powerpoint'
                ? await NativeOfficeExtractor.extractPowerPointWindows(filePath, fileName)
                : await NativeOfficeExtractor.extractExcelWindows(filePath, fileName);
          } else {
            throw new Error(`Native Office extraction is not supported on ${process.platform}`);
          }
        } catch (error: any) {
          lastError = error;
          if (isRetryableError(error) && attempt < MAX_RETRIES) {
            logger.warn(
              `[${LOG_SOURCE}] Transient error on attempt ${attempt + 1} for "${fileName}": ${error.message?.substring(0, 150)}`,
              LOG_SOURCE,
            );
            continue; // retry
          }
          throw error; // non-retryable or exhausted retries
        }
      }

      // Should not reach here, but just in case
      throw lastError;
    });
  }

  /**
   * Save a buffer to a temporary file and extract using native Office
   *
   * @param buffer File content buffer
   * @param fileName Original file name
   * @returns TextExtractionResult
   */
  static async extractFromBuffer(buffer: Buffer, fileName: string): Promise<TextExtractionResult> {
    const ext = path.extname(fileName).toLowerCase();
    const tempPath = path.join(os.tmpdir(), `office-native-${Date.now()}${ext}`);

    try {
      fs.writeFileSync(tempPath, buffer);
      logger.info(`[${LOG_SOURCE}] Saved encrypted file to temp: ${tempPath}`, LOG_SOURCE);
      return await NativeOfficeExtractor.extractFromFile(tempPath, fileName);
    } finally {
      // Cleanup temp file
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
          logger.info(`[${LOG_SOURCE}] Cleaned up temp file: ${tempPath}`, LOG_SOURCE);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ================================================================
  // macOS AppleScript Extractors
  // ================================================================

  /**
   * Extract Word document text on macOS using AppleScript
   * Adapted from word_applescript_extractor.py
   */
  private static async extractWordMac(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const absPath = path.resolve(filePath);
    const escapedPath = absPath.replace(/"/g, '\\"');

    // AppleScript: activate Word, open document, extract text, get stats, close (no quit — keep running for next extraction)
    const applescript = [
      'on run',
      '  tell application "Microsoft Word"',
      '    activate',
      '    set docPath to POSIX file "' + escapedPath + '"',
      '    open docPath',
      '    set doc to active document',
      '    set docText to content of text object of doc as text',
      '    set wordCount to count words of text object of doc',
      '    set charCount to count characters of text object of doc',
      '    close doc saving no',
      '    return "STATS:0|" & wordCount & "|" & charCount & linefeed & "TEXT:" & docText',
      '  end tell',
      'end run',
    ].join('\n');

    try {
      const { stdout, stderr } = await execFileAsync('osascript', ['-e', applescript], {
        timeout: WORD_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large documents
      });

      if (stderr && stderr.trim()) {
        logger.warn(`[${LOG_SOURCE}] AppleScript stderr: ${stderr.substring(0, 200)}`, LOG_SOURCE);
      }

      return NativeOfficeExtractor.parseAppleScriptWordOutput(stdout, fileName);
    } catch (error: any) {
      NativeOfficeExtractor.handleNativeError(error, 'Word', 'macOS');
      throw error; // unreachable, handleNativeError always throws
    }
  }

  /**
   * Extract PowerPoint presentation text on macOS using AppleScript
   * Adapted from powerpoint_applescript_extractor.py
   */
  private static async extractPowerPointMac(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const absPath = path.resolve(filePath);
    const escapedPath = absPath.replace(/"/g, '\\"');

    // AppleScript: activate PowerPoint, open presentation, iterate slides, extract text, close (no quit — keep running for next extraction)
    const applescript = [
      'on run',
      '  tell application "Microsoft PowerPoint"',
      '    activate',
      '    set presPath to POSIX file "' + escapedPath + '"',
      '    open presPath',
      '    set pres to active presentation',
      '    set slideCount to count slides of pres',
      '    set allText to ""',
      '    repeat with i from 1 to slideCount',
      '      set currentSlide to slide i of pres',
      '      set allText to allText & linefeed & "--- Slide " & i & " ---" & linefeed',
      '      set shapeCount to count shapes of currentSlide',
      '      repeat with j from 1 to shapeCount',
      '        try',
      '          set currentShape to shape j of currentSlide',
      '          if has text frame of currentShape then',
      '            set textFrame to text frame of currentShape',
      '            if has text of textFrame then',
      '              set shapeText to content of text range of textFrame',
      '              if shapeText is not "" then',
      '                set allText to allText & shapeText & linefeed',
      '              end if',
      '            end if',
      '          end if',
      '        end try',
      '      end repeat',
      '    end repeat',
      '    close pres saving no',
      '    return "STATS:" & slideCount & linefeed & "TEXT:" & allText',
      '  end tell',
      'end run',
    ].join('\n');

    try {
      const { stdout, stderr } = await execFileAsync('osascript', ['-e', applescript], {
        timeout: POWERPOINT_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024,
      });

      if (stderr && stderr.trim()) {
        logger.warn(`[${LOG_SOURCE}] AppleScript stderr: ${stderr.substring(0, 200)}`, LOG_SOURCE);
      }

      return NativeOfficeExtractor.parseAppleScriptPowerPointOutput(stdout, fileName);
    } catch (error: any) {
      NativeOfficeExtractor.handleNativeError(error, 'PowerPoint', 'macOS');
      throw error; // unreachable
    }
  }

  // ================================================================
  // Windows PowerShell/COM Extractors
  // ================================================================

  /**
   * Extract Word document text on Windows using PowerShell COM automation
   * Adapted from word_com_extractor.py
   */
  private static async extractWordWindows(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const absPath = path.resolve(filePath).replace(/\//g, '\\');
    const psScript = buildWordPowerShellScript(absPath);

    try {
      const { stdout, stderr } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        {
          timeout: WORD_TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        },
      );

      if (stderr && stderr.trim()) {
        logger.warn(`[${LOG_SOURCE}] PowerShell stderr: ${stderr.substring(0, 200)}`, LOG_SOURCE);
      }

      return NativeOfficeExtractor.parsePowerShellWordOutput(stdout, fileName);
    } catch (error: any) {
      NativeOfficeExtractor.handleNativeError(error, 'Word', 'Windows');
      throw error; // unreachable
    }
  }

  /**
   * Extract PowerPoint presentation text on Windows using PowerShell COM automation
   * Adapted from powerpoint_com_extractor.py
   */
  private static async extractPowerPointWindows(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const absPath = path.resolve(filePath).replace(/\//g, '\\');
    const psScript = buildPowerPointPowerShellScript(absPath);

    try {
      const { stdout, stderr } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        {
          timeout: POWERPOINT_TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        },
      );

      if (stderr && stderr.trim()) {
        logger.warn(`[${LOG_SOURCE}] PowerShell stderr: ${stderr.substring(0, 200)}`, LOG_SOURCE);
      }

      return NativeOfficeExtractor.parsePowerShellPowerPointOutput(stdout, fileName);
    } catch (error: any) {
      NativeOfficeExtractor.handleNativeError(error, 'PowerPoint', 'Windows');
      throw error; // unreachable
    }
  }

  // ================================================================
  // Excel Extractors
  // ================================================================

  /**
   * Extract Excel workbook text on macOS using AppleScript
   * Iterates sheets → used range rows → cells, outputs tab-separated text
   */
  private static async extractExcelMac(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const absPath = path.resolve(filePath);
    const escapedPath = absPath.replace(/"/g, '\\"');

    // AppleScript: activate Excel, open workbook, iterate sheets/rows/cells, close (no quit)
    const applescript = [
      'on run',
      '  tell application "Microsoft Excel"',
      '    activate',
      '    set wbPath to POSIX file "' + escapedPath + '"',
      '    open wbPath',
      '    set wb to active workbook',
      '    set sheetCount to count worksheets of wb',
      '    set allText to ""',
      '    repeat with i from 1 to sheetCount',
      '      set ws to worksheet i of wb',
      '      set wsName to name of ws',
      '      set allText to allText & "--- Sheet " & i & ": " & wsName & " ---" & linefeed',
      '      try',
      '        set usedR to used range of ws',
      '        set rowCount to count rows of usedR',
      '        set colCount to count columns of usedR',
      '        repeat with r from 1 to rowCount',
      '          set rowText to ""',
      '          repeat with c from 1 to colCount',
      '            try',
      '              set cellVal to string value of cell r of column c of usedR',
      '              if cellVal is missing value then set cellVal to ""',
      '            on error',
      '              set cellVal to ""',
      '            end try',
      '            if c > 1 then set rowText to rowText & tab',
      '            set rowText to rowText & cellVal',
      '          end repeat',
      '          set allText to allText & rowText & linefeed',
      '        end repeat',
      '      end try',
      '      set allText to allText & linefeed',
      '    end repeat',
      '    close wb saving no',
      '    return "STATS:" & sheetCount & linefeed & "TEXT:" & allText',
      '  end tell',
      'end run',
    ].join('\n');

    try {
      const { stdout, stderr } = await execFileAsync('osascript', ['-e', applescript], {
        timeout: EXCEL_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024,
      });

      if (stderr && stderr.trim()) {
        logger.warn(`[${LOG_SOURCE}] AppleScript stderr: ${stderr.substring(0, 200)}`, LOG_SOURCE);
      }

      return NativeOfficeExtractor.parseAppleScriptExcelOutput(stdout, fileName);
    } catch (error: any) {
      NativeOfficeExtractor.handleNativeError(error, 'Excel', 'macOS');
      throw error; // unreachable
    }
  }

  /**
   * Extract Excel workbook text on Windows using PowerShell COM automation
   */
  private static async extractExcelWindows(filePath: string, fileName: string): Promise<TextExtractionResult> {
    const absPath = path.resolve(filePath).replace(/\//g, '\\');
    const psScript = buildExcelPowerShellScript(absPath);

    try {
      const { stdout, stderr } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        {
          timeout: EXCEL_TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        },
      );

      if (stderr && stderr.trim()) {
        logger.warn(`[${LOG_SOURCE}] PowerShell stderr: ${stderr.substring(0, 200)}`, LOG_SOURCE);
      }

      return NativeOfficeExtractor.parsePowerShellExcelOutput(stdout, fileName);
    } catch (error: any) {
      NativeOfficeExtractor.handleNativeError(error, 'Excel', 'Windows');
      throw error; // unreachable
    }
  }

  // ================================================================
  // Output Parsers
  // ================================================================

  /**
   * Parse AppleScript Word extractor output
   * Format: "STATS:pageCount|wordCount|charCount\nTEXT:content"
   */
  private static parseAppleScriptWordOutput(output: string, fileName: string): TextExtractionResult {
    if (output.includes('STATS:') && output.includes('TEXT:')) {
      const [statsPart, ...textParts] = output.split('TEXT:');
      const content = textParts.join('TEXT:').trim();

      const lines = content.split('\n');

      logger.info(
        `[${LOG_SOURCE}] Word AppleScript extraction OK: ${lines.length} lines, ${content.length} chars`,
        LOG_SOURCE,
      );

      return {
        content,
        fileType: path.extname(fileName).replace('.', ''),
        extractionMethod: 'native-applescript-word',
        totalLines: lines.length,
        totalPages: 1,
      };
    }

    // Fallback: treat entire output as content
    logger.warn(`[${LOG_SOURCE}] Could not parse AppleScript stats, using raw output`, LOG_SOURCE);
    const lines = output.split('\n');
    return {
      content: output.trim(),
      fileType: path.extname(fileName).replace('.', ''),
      extractionMethod: 'native-applescript-word',
      totalLines: lines.length,
      totalPages: 1,
    };
  }

  /**
   * Parse AppleScript PowerPoint extractor output
   * Format: "STATS:slideCount\nTEXT:content"
   */
  private static parseAppleScriptPowerPointOutput(output: string, fileName: string): TextExtractionResult {
    if (output.includes('STATS:') && output.includes('TEXT:')) {
      const [statsPart, ...textParts] = output.split('TEXT:');
      const content = textParts.join('TEXT:').trim();
      const slideCountStr = statsPart.replace('STATS:', '').trim();
      const slideCount = parseInt(slideCountStr, 10) || 0;

      const lines = content.split('\n');

      logger.info(
        `[${LOG_SOURCE}] PowerPoint AppleScript extraction OK: ${slideCount} slides, ${content.length} chars`,
        LOG_SOURCE,
      );

      return {
        content,
        fileType: path.extname(fileName).replace('.', ''),
        extractionMethod: 'native-applescript-powerpoint',
        totalLines: lines.length,
        totalPages: slideCount,
      };
    }

    logger.warn(`[${LOG_SOURCE}] Could not parse AppleScript stats, using raw output`, LOG_SOURCE);
    const lines = output.split('\n');
    return {
      content: output.trim(),
      fileType: path.extname(fileName).replace('.', ''),
      extractionMethod: 'native-applescript-powerpoint',
      totalLines: lines.length,
      totalPages: 0,
    };
  }

  /**
   * Parse PowerShell Word extractor output
   * Format: "STATS:pageCount|wordCount|charCount\nTEXT_START\ncontent\nTEXT_END"
   */
  private static parsePowerShellWordOutput(output: string, fileName: string): TextExtractionResult {
    const textStartIdx = output.indexOf('TEXT_START');
    const textEndIdx = output.indexOf('TEXT_END');

    if (textStartIdx !== -1 && textEndIdx !== -1) {
      const content = output.substring(textStartIdx + 'TEXT_START'.length, textEndIdx).trim();

      // Parse stats
      const statsLine = output.substring(0, textStartIdx).trim();
      let pageCount = 0;
      if (statsLine.startsWith('STATS:')) {
        const parts = statsLine.replace('STATS:', '').split('|');
        pageCount = parseInt(parts[0], 10) || 0;
      }

      const lines = content.split('\n');

      logger.info(
        `[${LOG_SOURCE}] Word PowerShell extraction OK: ${pageCount} pages, ${lines.length} lines, ${content.length} chars`,
        LOG_SOURCE,
      );

      return {
        content,
        fileType: path.extname(fileName).replace('.', ''),
        extractionMethod: 'native-powershell-word',
        totalLines: lines.length,
        totalPages: pageCount,
      };
    }

    // Fallback
    logger.warn(`[${LOG_SOURCE}] Could not parse PowerShell output markers, using raw output`, LOG_SOURCE);
    const lines = output.split('\n');
    return {
      content: output.trim(),
      fileType: path.extname(fileName).replace('.', ''),
      extractionMethod: 'native-powershell-word',
      totalLines: lines.length,
      totalPages: 1,
    };
  }

  /**
   * Parse PowerShell PowerPoint extractor output
   * Format: "STATS:slideCount\nTEXT_START\ncontent\nTEXT_END"
   */
  private static parsePowerShellPowerPointOutput(output: string, fileName: string): TextExtractionResult {
    const textStartIdx = output.indexOf('TEXT_START');
    const textEndIdx = output.indexOf('TEXT_END');

    if (textStartIdx !== -1 && textEndIdx !== -1) {
      const content = output.substring(textStartIdx + 'TEXT_START'.length, textEndIdx).trim();

      // Parse stats
      const statsLine = output.substring(0, textStartIdx).trim();
      let slideCount = 0;
      if (statsLine.startsWith('STATS:')) {
        slideCount = parseInt(statsLine.replace('STATS:', '').trim(), 10) || 0;
      }

      const lines = content.split('\n');

      logger.info(
        `[${LOG_SOURCE}] PowerPoint PowerShell extraction OK: ${slideCount} slides, ${content.length} chars`,
        LOG_SOURCE,
      );

      return {
        content,
        fileType: path.extname(fileName).replace('.', ''),
        extractionMethod: 'native-powershell-powerpoint',
        totalLines: lines.length,
        totalPages: slideCount,
      };
    }

    logger.warn(`[${LOG_SOURCE}] Could not parse PowerShell output markers, using raw output`, LOG_SOURCE);
    const lines = output.split('\n');
    return {
      content: output.trim(),
      fileType: path.extname(fileName).replace('.', ''),
      extractionMethod: 'native-powershell-powerpoint',
      totalLines: lines.length,
      totalPages: 0,
    };
  }

  /**
   * Parse AppleScript Excel extractor output
   * Format: "STATS:sheetCount\nTEXT:content"
   */
  private static parseAppleScriptExcelOutput(output: string, fileName: string): TextExtractionResult {
    if (output.includes('STATS:') && output.includes('TEXT:')) {
      const [statsPart, ...textParts] = output.split('TEXT:');
      const content = textParts.join('TEXT:').trim();
      const sheetCountStr = statsPart.replace('STATS:', '').trim();
      const sheetCount = parseInt(sheetCountStr, 10) || 0;

      const lines = content.split('\n');

      logger.info(
        `[${LOG_SOURCE}] Excel AppleScript extraction OK: ${sheetCount} sheets, ${content.length} chars`,
        LOG_SOURCE,
      );

      return {
        content,
        fileType: path.extname(fileName).replace('.', ''),
        extractionMethod: 'native-applescript-excel',
        totalLines: lines.length,
        totalPages: sheetCount,
      };
    }

    logger.warn(`[${LOG_SOURCE}] Could not parse AppleScript stats, using raw output`, LOG_SOURCE);
    const lines = output.split('\n');
    return {
      content: output.trim(),
      fileType: path.extname(fileName).replace('.', ''),
      extractionMethod: 'native-applescript-excel',
      totalLines: lines.length,
      totalPages: 0,
    };
  }

  /**
   * Parse PowerShell Excel extractor output
   * Format: "STATS:sheetCount\nTEXT_START\ncontent\nTEXT_END"
   */
  private static parsePowerShellExcelOutput(output: string, fileName: string): TextExtractionResult {
    const textStartIdx = output.indexOf('TEXT_START');
    const textEndIdx = output.indexOf('TEXT_END');

    if (textStartIdx !== -1 && textEndIdx !== -1) {
      const content = output.substring(textStartIdx + 'TEXT_START'.length, textEndIdx).trim();

      const statsLine = output.substring(0, textStartIdx).trim();
      let sheetCount = 0;
      if (statsLine.startsWith('STATS:')) {
        sheetCount = parseInt(statsLine.replace('STATS:', '').trim(), 10) || 0;
      }

      const lines = content.split('\n');

      logger.info(
        `[${LOG_SOURCE}] Excel PowerShell extraction OK: ${sheetCount} sheets, ${content.length} chars`,
        LOG_SOURCE,
      );

      return {
        content,
        fileType: path.extname(fileName).replace('.', ''),
        extractionMethod: 'native-powershell-excel',
        totalLines: lines.length,
        totalPages: sheetCount,
      };
    }

    logger.warn(`[${LOG_SOURCE}] Could not parse PowerShell output markers, using raw output`, LOG_SOURCE);
    const lines = output.split('\n');
    return {
      content: output.trim(),
      fileType: path.extname(fileName).replace('.', ''),
      extractionMethod: 'native-powershell-excel',
      totalLines: lines.length,
      totalPages: 0,
    };
  }

  // ================================================================
  // Helper Methods
  // ================================================================

  /**
   * Check if a macOS application is installed via bundle ID
   */
  private static async checkMacAppInstalled(bundleId: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-e', 'tell application "Finder" to get POSIX path of (application file id "' + bundleId + '" as alias)'],
        { timeout: 5000 },
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if a Windows COM object is available
   */
  private static async checkWindowsComAvailable(progId: string): Promise<boolean> {
    try {
      const psScript = [
        'try {',
        '    $app = New-Object -ComObject ' + progId,
        '    $app.Quit()',
        '    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null',
        '    Write-Output "OK"',
        '} catch {',
        '    Write-Output "FAIL"',
        '}',
      ].join('\n');

      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeout: 15000, windowsHide: true },
      );
      return stdout.trim() === 'OK';
    } catch {
      return false;
    }
  }

  /**
   * Handle and log native extraction errors with user-friendly messages
   */
  private static handleNativeError(error: any, appName: string, platform: string): never {
    const errMsg = error.message || String(error);

    if (error.killed || errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout')) {
      logger.error(
        `[${LOG_SOURCE}] ${appName} extraction timed out on ${platform}. The document may be too large or ${appName} is unresponsive.`,
        LOG_SOURCE,
      );
      throw new Error(
        `${appName} extraction timed out. The document may be too large or ${appName} is unresponsive. ` +
        `Please try opening the document directly in ${appName}.`,
      );
    }

    if (errMsg.toLowerCase().includes('password')) {
      logger.error(`[${LOG_SOURCE}] Document is password-protected (not just IRM)`, LOG_SOURCE);
      throw new Error(
        'Document is password-protected. Native Office extraction can handle IRM-encrypted documents, ' +
        'but not password-protected documents. Please enter the password manually in the Office application.',
      );
    }

    if (errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('rights')) {
      logger.error(`[${LOG_SOURCE}] Insufficient IRM permissions`, LOG_SOURCE);
      throw new Error(
        'Insufficient IRM permissions to access this document. ' +
        'Please ensure you have the required permissions and try opening the document in the Office application first.',
      );
    }

    logger.error(`[${LOG_SOURCE}] ${appName} extraction failed on ${platform}: ${errMsg}`, LOG_SOURCE);
    throw new Error(
      `Failed to extract text using ${appName} on ${platform}: ${errMsg}. ` +
      'Use action="download" to save the file locally, then open in the Office application.',
    );
  }
}
