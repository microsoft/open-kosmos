/**
 * Unified content processing utility — UnifiedAttachmentSystem
 *
 * Provides unified content part handling, transformation, and validation
 * Supports unified management for text, image, and file content types
 */

import {
  TextContentPart,
  ImageContentPart,
  FileContentPart,
  OfficeContentPart,
  OthersContentPart,
  UnifiedContentPart,
  Message,
  MessageHelper,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_TEXT_TYPES,
  FILE_ATTACHMENT_LIMITS,
} from '@shared/types/chatTypes';
import { getImageDimensions, smartCompressImage, shouldCompressImageAdvanced } from './imageCompression';
import { createLogger } from './logger';
const logger = createLogger('[ContentUtils]');

// ===== Content Creation Utilities =====

export class ContentPartFactory {
  // Create text content part
  static createText(text: string): TextContentPart {
    return {
      type: 'text',
      text: text.trim()
    };
  }

  // Create image content part
  static createImage(imageData: {
    url: string;
    fileName: string;
    fileSize: number;
    width?: number;
    height?: number;
    mimeType: string;
    detail?: 'low' | 'high' | 'auto';
  }): ImageContentPart {
    return {
      type: 'image',
      image_url: {
        url: imageData.url,
        detail: imageData.detail || 'auto'
      },
      metadata: {
        fileName: imageData.fileName,
        fileSize: imageData.fileSize,
        width: imageData.width,
        height: imageData.height,
        mimeType: imageData.mimeType
      }
    };
  }

  // Create file content part — uses file path reference mode
  static createFile(fileData: {
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
    encoding?: string;
    lastModified?: number;
    lines?: number;
    detail?: 'auto' | 'low' | 'high';
  }): FileContentPart {
    return {
      type: 'file',
      file: {
        fileName: fileData.fileName,
        filePath: fileData.filePath,
        mimeType: fileData.mimeType
      },
      metadata: {
        fileSize: fileData.fileSize,
        lines: fileData.lines,
        lastModified: fileData.lastModified || Date.now(),
        encoding: fileData.encoding || 'utf-8',
        detail: fileData.detail || 'auto'
      }
    };
  }

  // Create Office document content part — provides metadata required by read_office_file
  static createOffice(fileData: {
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
    extension?: string;
    lastModified?: number;
    pages?: number;
    lines?: number;
    detail?: 'auto' | 'low' | 'high';
  }): OfficeContentPart {
    return {
      type: 'office',
      file: {
        fileName: fileData.fileName,
        filePath: fileData.filePath,
        mimeType: fileData.mimeType,
        extension: fileData.extension,
      },
      metadata: {
        fileSize: fileData.fileSize,
        lastModified: fileData.lastModified || Date.now(),
        pages: fileData.pages,
        lines: fileData.lines,
        detail: fileData.detail || 'auto',
        truncated: false,
      },
    };
  }

  // Create other file type content part — metadata only, content not read
  static createOthers(fileData: {
    fileName: string;
    filePath?: string;  // 🔥 FIX: add filePath parameter support
    fileSize: number;
    mimeType: string;
    lastModified?: number;
    fileExtension?: string;
    description?: string;
    detail?: 'auto' | 'low' | 'high';
  }): OthersContentPart {
    return {
      type: 'others',
      file: {
        fileName: fileData.fileName,
        filePath: fileData.filePath || '', // 🔥 FIX: use provided filePath, default to empty string
        mimeType: fileData.mimeType
      },
      metadata: {
        fileSize: fileData.fileSize,
        lastModified: fileData.lastModified || Date.now(),
        detail: fileData.detail || 'auto',
        fileExtension: fileData.fileExtension,
        description: fileData.description || `Other file type: ${fileData.fileName}`
      }
    };
  }
}

// ===== File Processing Utilities =====

export class FileProcessor {
  private static readonly OFFICE_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroEnabled.12',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  ];

  private static readonly OFFICE_EXTENSIONS = [
    '.pdf',
    '.docx',
    '.docm',
    '.pptx',
    '.pptm',
  ];

  // Check whether a file is a supported image format
  static isImageFile(file: File): boolean {
    return SUPPORTED_IMAGE_TYPES.includes(file.type as any);
  }

  // Check whether a file is an Office document
  static isOfficeFile(file: File): boolean {
    const mimeType = (file.type || '').toLowerCase();
    if (this.OFFICE_MIME_TYPES.includes(mimeType)) {
      return true;
    }

    const fileName = file.name.toLowerCase();
    return this.OFFICE_EXTENSIONS.some(ext => fileName.endsWith(ext));
  }

  // Check whether a file is a supported text format
  static isTextFile(file: File): boolean {
    if (this.isOfficeFile(file)) {
      return false;
    }

    // Check MIME type
    if (SUPPORTED_TEXT_TYPES.includes(file.type as any)) {
      return true;
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    return FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS.some(ext =>
      fileName.endsWith(ext.toLowerCase())
    );
  }

  // Check whether a file is of "other" type (not image, text, or Office)
  static isOthersFile(file: File): boolean {
    return !this.isImageFile(file) && !this.isTextFile(file) && !this.isOfficeFile(file);
  }

  // Check whether a file size is within the limit
  static isFileSizeValid(file: File): boolean {
    return file.size <= FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES;
  }

  // Convert a File object to a DataURL
  static async fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Convert a File object to text
  static async fileToText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        let content = reader.result as string;

        // Check line count limit
        const lines = content.split('\n');
        if (lines.length > FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES) {
          content = lines.slice(0, FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES).join('\n') +
                   `\n\n... [File truncated; original has ${lines.length} lines, showing first ${FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES}]`;
        }

        resolve(content);
      };
      reader.onerror = reject;
      reader.readAsText(file, 'utf-8');
    });
  }

  // Get the MIME type of a file
  static getMimeType(file: File): string {
    if (file.type) {
      return file.type;
    }

    // Infer MIME type from file extension
    const fileName = file.name.toLowerCase();
    const mimeMap: Record<string, string> = {
      // Basic text files
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.rst': 'text/x-rst',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
      '.rtf': 'text/rtf',

      // Web technologies
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.jsx': 'text/javascript',
      '.tsx': 'text/typescript',
      '.mjs': 'text/javascript',
      '.cjs': 'text/javascript',
      '.css': 'text/css',
      '.scss': 'text/x-scss',
      '.sass': 'text/x-sass',
      '.less': 'text/x-less',
      '.stylus': 'text/x-stylus',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.xhtml': 'application/xhtml+xml',
      '.vue': 'text/x-vue',
      '.svelte': 'text/x-svelte',
      '.json': 'application/json',
      '.json5': 'application/json5',
      '.jsonc': 'application/json',
      '.xml': 'application/xml',
      '.svg': 'image/svg+xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.toml': 'text/x-toml',
      '.ini': 'text/x-ini',
      '.cfg': 'text/x-ini',
      '.conf': 'text/x-ini',

      // Programming languages — C/C++ family
      '.c': 'text/x-c',
      '.cc': 'text/x-c++',
      '.cpp': 'text/x-cpp',
      '.cxx': 'text/x-cpp',
      '.c++': 'text/x-cpp',
      '.h': 'text/x-c',
      '.hpp': 'text/x-cpp',
      '.hxx': 'text/x-cpp',
      '.h++': 'text/x-cpp',

      // Programming languages — others
      '.py': 'text/x-python',
      '.pyw': 'text/x-python',
      '.pyc': 'application/x-python-code',
      '.pyi': 'text/x-python',
      '.pyx': 'text/x-cython',
      '.java': 'text/x-java',
      '.class': 'application/java-vm',
      '.jar': 'application/java-archive',
      '.scala': 'text/x-scala',
      '.kt': 'text/x-kotlin',
      '.kts': 'text/x-kotlin',
      '.cs': 'text/x-csharp',
      '.vb': 'text/x-vb',
      '.fs': 'text/x-fsharp',
      '.fsx': 'text/x-fsharp',
      '.fsi': 'text/x-fsharp',
      '.rs': 'text/x-rust',
      '.go': 'text/x-go',
      '.mod': 'text/x-go-mod',
      '.sum': 'text/plain',
      '.rb': 'text/x-ruby',
      '.rbw': 'text/x-ruby',
      '.gem': 'application/x-gem',
      '.rake': 'text/x-ruby',
      '.php': 'text/x-php',
      '.php3': 'text/x-php',
      '.php4': 'text/x-php',
      '.php5': 'text/x-php',
      '.phtml': 'text/x-php',
      '.pl': 'text/x-perl',
      '.pm': 'text/x-perl',
      '.t': 'text/x-perl',
      '.pod': 'text/x-pod',
      '.swift': 'text/x-swift',
      '.m': 'text/x-objc',
      '.mm': 'text/x-objc++',
      '.r': 'text/x-r',
      '.R': 'text/x-r',
      '.rmd': 'text/x-r-markdown',
      '.rnw': 'text/x-r-sweave',
      '.jl': 'text/x-julia',
      '.julia': 'text/x-julia',
      '.dart': 'text/x-dart',
      '.flutter': 'text/x-dart',
      '.lua': 'text/x-lua',
      '.luac': 'application/x-lua-bytecode',

      // Shell scripts
      '.sh': 'text/x-shellscript',
      '.bash': 'text/x-shellscript',
      '.zsh': 'text/x-shellscript',
      '.fish': 'text/x-shellscript',
      '.csh': 'text/x-shellscript',
      '.tcsh': 'text/x-shellscript',
      '.ps1': 'text/x-powershell',
      '.psm1': 'text/x-powershell',
      '.psd1': 'text/x-powershell',
      '.bat': 'text/x-msdos-batch',
      '.cmd': 'text/x-msdos-batch',

      // Assembly and low-level languages
      '.asm': 'text/x-asm',
      '.s': 'text/x-asm',
      '.S': 'text/x-asm',

      // Databases
      '.sql': 'text/x-sql',
      '.mysql': 'text/x-mysql',
      '.pgsql': 'text/x-pgsql',
      '.sqlite': 'text/x-sqlite',

      // Containerization
      '.dockerfile': 'text/x-dockerfile',
      '.containerfile': 'text/x-dockerfile',

      // Config files
      '.env': 'text/x-dotenv',
      '.envrc': 'text/x-dotenv',
      '.editorconfig': 'text/x-editorconfig',
      '.gitignore': 'text/x-gitignore',
      '.gitattributes': 'text/x-gitattributes',
      '.eslintrc': 'application/json',
      '.prettierrc': 'application/json',
      '.babelrc': 'application/json',
      '.npmrc': 'text/x-npmrc',
      '.yarnrc': 'text/x-yarnrc',
      '.tsconfig': 'application/json',
      '.jsconfig': 'application/json',
      '.webpack': 'text/javascript',
      '.rollup': 'text/javascript',
      '.vite': 'text/javascript',
      '.makefile': 'text/x-makefile',
      '.cmake': 'text/x-cmake',
      '.gradle': 'text/x-gradle',
      '.maven': 'text/x-maven',
      '.ant': 'text/x-ant',
      '.properties': 'text/x-java-properties',
      '.lock': 'text/plain',

      // Documentation and markup languages
      '.tex': 'text/x-latex',
      '.latex': 'text/x-latex',
      '.bib': 'text/x-bibtex',
      '.cls': 'text/x-latex',
      '.sty': 'text/x-latex',
      '.org': 'text/x-org',
      '.adoc': 'text/x-asciidoc',
      '.asciidoc': 'text/x-asciidoc',
      '.wiki': 'text/x-wiki',
      '.mediawiki': 'text/x-mediawiki',

      // Data formats
      '.csv': 'text/csv',
      '.tsv': 'text/tab-separated-values',
      '.psv': 'text/plain',
      '.dsv': 'text/plain',
      '.log': 'text/x-log',
      '.out': 'text/plain',
      '.err': 'text/plain',
      '.trace': 'text/x-log',

      // Other formats
      '.patch': 'text/x-patch',
      '.diff': 'text/x-diff',
      '.rej': 'text/x-reject',
      '.spec': 'text/x-rpm-spec',
      '.rpm': 'application/x-rpm',
      '.deb': 'application/x-deb',
      '.pem': 'text/x-pem-file',
      '.crt': 'text/x-x509-ca-cert',
      '.key': 'text/plain',
      '.pub': 'text/plain'
    };

    for (const [ext, mime] of Object.entries(mimeMap)) {
      if (fileName.endsWith(ext)) {
        return mime;
      }
    }

    return 'text/plain'; // Default
  }
}

// ===== Content Conversion Utilities =====

export class ContentConverter {
  // Convert a string to unified content format
  static stringToContent(text: string): UnifiedContentPart[] {
    if (!text.trim()) {
      return [];
    }

    return [ContentPartFactory.createText(text)];
  }

  // Convert unified content format to plain text
  static contentToString(content: UnifiedContentPart[]): string {
    return content
      .filter(part => part.type === 'text')
      .map(part => (part as TextContentPart).text)
      .join(' ')
      .trim();
  }

  // 🔥 Core fix: Create image content part from a File object, with automatic compression
  static async fileToImageContent(file: File): Promise<ImageContentPart> {
    if (!FileProcessor.isImageFile(file)) {
      throw new Error(`Unsupported image format: ${file.type}`);
    }

    if (!FileProcessor.isFileSizeValid(file)) {
      throw new Error(`File size exceeds limit: ${file.size} bytes`);
    }


    // 🔥 Key fix: Check whether compression is needed; compress first if so
    let processedFile = file;
    let wasCompressed = false;

    try {
      const needsCompression = await shouldCompressImageAdvanced(file);

      if (needsCompression) {

        const compressionResult = await smartCompressImage(file);
        processedFile = compressionResult.compressedFile;
        wasCompressed = compressionResult.wasCompressed;

      } else {
      }
    } catch (compressionError) {
      // If compression fails, continue with the original file
      processedFile = file;
      wasCompressed = false;
    }

    // Convert to DataURL (now using the compressed file)
    const dataUrl = await FileProcessor.fileToDataURL(processedFile);

    // 🔥 Fix: Get actual dimensions of the processed file to ensure correct token calculation
    let width: number | undefined;
    let height: number | undefined;

    try {
      const dimensions = await getImageDimensions(processedFile);
      width = dimensions.width;
      height = dimensions.height;

    } catch (error) {
    }

    return ContentPartFactory.createImage({
      url: dataUrl,
      fileName: file.name, // Preserve original file name
      fileSize: processedFile.size, // 🔥 Use compressed file size
      width,
      height,
      mimeType: FileProcessor.getMimeType(processedFile),
      detail: 'auto' // 🔥 Fix: explicitly set detail to auto for correct token calculation
    });
  }

  // Create file content part from a File object — uses file path reference mode
  static async fileToFileContent(file: File): Promise<FileContentPart> {
    if (!FileProcessor.isTextFile(file)) {
      throw new Error(`Unsupported file format: ${file.type}`);
    }

    // 🔥 FIX: Fix file path handling; prefer the full path obtained via the Electron API
    // Priority: fullPath (Electron API) > webkitRelativePath > original path property > filename only
    let filePath = file.name; // Default to filename
    let needsWorkspaceSave = true; // Default: needs saving to workspace

    // 🔥 First priority: Check whether a full path was attached via the Electron API
    if ((file as any).fullPath && (file as any).fullPath !== file.name) {
      filePath = (file as any).fullPath;
      needsWorkspaceSave = false; // Full path available; no need to save to workspace
      logger.debug(`[ContentConverter] 🔥 Using full path from Electron API: ${filePath}`);
    }
    // Second priority: Check for relative path info (may be present when dragging a folder)
    else if ((file as any).webkitRelativePath) {
      filePath = (file as any).webkitRelativePath;
      needsWorkspaceSave = false; // Relative path means it came from folder drag; no need to save
      logger.debug(`[ContentConverter] Using webkitRelativePath: ${filePath}`);
    }
    // Third priority: Electron environment may have a path property different from the filename
    else if ((file as any).path && (file as any).path !== file.name) {
      filePath = (file as any).path;
      needsWorkspaceSave = false; // Real path available; no need to save to workspace
      logger.debug(`[ContentConverter] Using path property: ${filePath}`);
    }

    // 🔧 FIX: For filename-only cases, the file must be saved to the workspace via another mechanism
    // The actual file save logic should be handled when the message is sent
    if (needsWorkspaceSave) {
      logger.warn(`[ContentConverter] ⚠️ File ${file.name} has filename only; needs to be saved to workspace when message is sent`);
    }

    return ContentPartFactory.createFile({
      fileName: file.name,
      filePath: filePath,
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      lastModified: file.lastModified,
      detail: 'auto'
    });
  }

  // Create other file type content part from a File object — metadata only, content not read
  static async fileToOthersContent(file: File): Promise<OthersContentPart> {
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';

    // 🔥 FIX: Use the same path handling logic as fileToFileContent
    let filePath = file.name; // Default to filename
    let needsWorkspaceSave = true; // Default: needs saving to workspace

    // 🔥 First priority: Check whether a full path was attached via the Electron API
    if ((file as any).fullPath && (file as any).fullPath !== file.name) {
      filePath = (file as any).fullPath;
      needsWorkspaceSave = false; // Full path available; no need to save to workspace
      logger.debug(`[ContentConverter] 🔥 Others file using full path from Electron API: ${filePath}`);
    }
    // Second priority: Check for relative path info (may be present when dragging a folder)
    else if ((file as any).webkitRelativePath) {
      filePath = (file as any).webkitRelativePath;
      needsWorkspaceSave = false; // Relative path means it came from folder drag; no need to save
      logger.debug(`[ContentConverter] Others file using webkitRelativePath: ${filePath}`);
    }
    // Third priority: Electron environment may have a path property different from the filename
    else if ((file as any).path && (file as any).path !== file.name) {
      filePath = (file as any).path;
      needsWorkspaceSave = false; // Real path available; no need to save to workspace
      logger.debug(`[ContentConverter] Others file using path property: ${filePath}`);
    }

    if (needsWorkspaceSave) {
      logger.warn(`[ContentConverter] ⚠️ Others file ${file.name} has filename only; needs to be saved to workspace when message is sent`);
    }

    return ContentPartFactory.createOthers({
      fileName: file.name,
      filePath: filePath,  // 🔥 FIX: pass the correct file path
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      lastModified: file.lastModified,
      fileExtension: fileExtension,
      description: `Other file type: ${file.name} (${fileExtension.toUpperCase()})`,
      detail: 'auto'
    });
  }

  // Create Office document content part from a File object — retain only metadata reference
  static async fileToOfficeContent(file: File): Promise<OfficeContentPart> {
    logger.debug(`[ContentConverter] fileToOfficeContent called:`, {
      name: file.name,
      type: file.type,
      size: file.size,
      fullPath: (file as any).fullPath,
      isOffice: FileProcessor.isOfficeFile(file),
    });
    if (!FileProcessor.isOfficeFile(file)) {
      throw new Error(`Unsupported Office file format: ${file.type || file.name}`);
    }

    // 🔥 FIX: Use the same path handling logic as fileToFileContent
    let filePath = file.name; // Default to filename
    let needsWorkspaceSave = true; // Default: needs saving to workspace

    // 🔥 First priority: Check whether a full path was attached via the Electron API
    if ((file as any).fullPath && (file as any).fullPath !== file.name) {
      filePath = (file as any).fullPath;
      needsWorkspaceSave = false; // Full path available; no need to save to workspace
      logger.debug(`[ContentConverter] 🔥 Office file using full path from Electron API: ${filePath}`);
    }
    // Second priority: Check for relative path info (may be present when dragging a folder)
    else if ((file as any).webkitRelativePath) {
      filePath = (file as any).webkitRelativePath;
      needsWorkspaceSave = false; // Relative path means it came from folder drag; no need to save
      logger.debug(`[ContentConverter] Office file using webkitRelativePath: ${filePath}`);
    }
    // Third priority: Electron environment may have a path property different from the filename
    else if ((file as any).path && (file as any).path !== file.name) {
      filePath = (file as any).path;
      needsWorkspaceSave = false; // Real path available; no need to save to workspace
      logger.debug(`[ContentConverter] Office file using path property: ${filePath}`);
    }

    if (needsWorkspaceSave) {
      logger.warn(`[ContentConverter] ⚠️ Office file ${file.name} has filename only; needs to be saved to workspace when message is sent`);
    }

    const extension = file.name.split('.').pop()?.toLowerCase();

    return ContentPartFactory.createOffice({
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType: FileProcessor.getMimeType(file),
      extension,
      lastModified: file.lastModified,
      detail: 'auto',
    });
  }

}

// ===== Content Statistics Utilities =====

export class ContentAnalyzer {
  // Analyze content statistics
  static analyzeContent(content: UnifiedContentPart[]): {
    textLength: number;
    imageCount: number;
    fileCount: number;
    officeCount: number;
    othersCount: number;
    totalSize: number;
    estimatedTokens: number;
  } {
    let textLength = 0;
    let imageCount = 0;
    let fileCount = 0;
    let officeCount = 0;
    let othersCount = 0;
    let totalSize = 0;

    content.forEach(part => {
      switch (part.type) {
        case 'text':
          textLength += part.text.length;
          break;
        case 'image':
          imageCount++;
          totalSize += part.metadata.fileSize;
          break;
        case 'file':
          fileCount++;
          totalSize += part.metadata.fileSize;
          // File reference mode: do not measure content length since content is not pre-loaded
          break;
        case 'office':
          officeCount++;
          totalSize += part.metadata.fileSize;
          break;
        case 'others':
          othersCount++; // Count "others" type separately
          totalSize += part.metadata.fileSize;
          // "Others" type: content not read; only metadata size counted
          break;
      }
    });

    // Simple token estimate (1 token ≈ 4 characters)
    // In file reference mode, file tokens need to be dynamically calculated via readFileTool
    const estimatedTokens = Math.ceil(textLength / 4) + imageCount * 100 + fileCount * 50 + officeCount * 60 + othersCount * 10; // "others" type uses only metadata; lower token cost

    return {
      textLength,
      imageCount,
      fileCount,
      officeCount,
      othersCount,
      totalSize,
      estimatedTokens
    };
  }

  // Check whether content exceeds limits
  static checkLimits(content: UnifiedContentPart[]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const analysis = this.analyzeContent(content);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file size limit
    if (analysis.totalSize > FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES * 5) {
      errors.push(`Total file size exceeds limit: ${analysis.totalSize} bytes`);
    }

    // Check token budget
    if (analysis.estimatedTokens > FILE_ATTACHMENT_LIMITS.MAX_TOKEN_BUDGET * 10) {
      warnings.push(`Estimated token count is high: ${analysis.estimatedTokens}`);
    }

    // Check content quantity
    if (analysis.imageCount > 10) {
      warnings.push(`Large number of images: ${analysis.imageCount}`);
    }

    const totalDocumentCount = analysis.fileCount + analysis.officeCount;
    if (totalDocumentCount > 20) {
      warnings.push(`Large number of files: ${totalDocumentCount}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

// ===== Utility Function Exports =====

// Generate a unique ID
export const generateId = (prefix = 'content'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format line count
export const formatLineCount = (lines: number): string => {
  if (lines === 1) return '1 line';
  return `${lines.toLocaleString()} lines`;
};

// Get file icon class name (for UI display)
export const getFileIconClass = (mimeType: string, fileName: string): string => {
  if (mimeType.startsWith('image/')) return 'icon-image';
  if (mimeType.startsWith('text/')) return 'icon-text';

  const ext = fileName.toLowerCase().split('.').pop();
  const iconMap: Record<string, string> = {
    // Web technologies
    'js': 'icon-js',
    'ts': 'icon-ts',
    'jsx': 'icon-jsx',
    'tsx': 'icon-tsx',
    'mjs': 'icon-js',
    'cjs': 'icon-js',
    'css': 'icon-css',
    'scss': 'icon-css',
    'sass': 'icon-css',
    'less': 'icon-css',
    'stylus': 'icon-css',
    'html': 'icon-html',
    'htm': 'icon-html',
    'xhtml': 'icon-html',
    'vue': 'icon-vue',
    'svelte': 'icon-svelte',
    'json': 'icon-json',
    'json5': 'icon-json',
    'jsonc': 'icon-json',
    'xml': 'icon-xml',
    'svg': 'icon-svg',
    'yaml': 'icon-yaml',
    'yml': 'icon-yaml',
    'toml': 'icon-config',
    'ini': 'icon-config',
    'cfg': 'icon-config',
    'conf': 'icon-config',

    // Documents and markup
    'md': 'icon-markdown',
    'rst': 'icon-markdown',
    'txt': 'icon-text',
    'doc': 'icon-text',
    'rtf': 'icon-text',
    'tex': 'icon-latex',
    'latex': 'icon-latex',
    'bib': 'icon-latex',
    'org': 'icon-text',
    'adoc': 'icon-markdown',
    'asciidoc': 'icon-markdown',
    'wiki': 'icon-text',
    'mediawiki': 'icon-text',

    // Programming languages — C/C++ family
    'c': 'icon-c',
    'cc': 'icon-cpp',
    'cpp': 'icon-cpp',
    'cxx': 'icon-cpp',
    'c++': 'icon-cpp',
    'h': 'icon-h',
    'hpp': 'icon-h',
    'hxx': 'icon-h',
    'h++': 'icon-h',

    // Programming languages — mainstream
    'py': 'icon-python',
    'pyw': 'icon-python',
    'pyi': 'icon-python',
    'pyx': 'icon-python',
    'java': 'icon-java',
    'class': 'icon-java',
    'jar': 'icon-java',
    'scala': 'icon-scala',
    'kt': 'icon-kotlin',
    'kts': 'icon-kotlin',
    'cs': 'icon-csharp',
    'vb': 'icon-vb',
    'fs': 'icon-fsharp',
    'fsx': 'icon-fsharp',
    'fsi': 'icon-fsharp',
    'rs': 'icon-rust',
    'go': 'icon-go',
    'mod': 'icon-go',
    'rb': 'icon-ruby',
    'rbw': 'icon-ruby',
    'rake': 'icon-ruby',
    'php': 'icon-php',
    'php3': 'icon-php',
    'php4': 'icon-php',
    'php5': 'icon-php',
    'phtml': 'icon-php',
    'pl': 'icon-perl',
    'pm': 'icon-perl',
    't': 'icon-perl',
    'pod': 'icon-perl',
    'swift': 'icon-swift',
    'm': 'icon-objc',
    'mm': 'icon-objc',
    'r': 'icon-r',
    'R': 'icon-r',
    'rmd': 'icon-r',
    'rnw': 'icon-r',
    'jl': 'icon-julia',
    'julia': 'icon-julia',
    'dart': 'icon-dart',
    'flutter': 'icon-dart',
    'lua': 'icon-lua',

    // Shell and scripts
    'sh': 'icon-shell',
    'bash': 'icon-shell',
    'zsh': 'icon-shell',
    'fish': 'icon-shell',
    'csh': 'icon-shell',
    'tcsh': 'icon-shell',
    'ps1': 'icon-powershell',
    'psm1': 'icon-powershell',
    'psd1': 'icon-powershell',
    'bat': 'icon-batch',
    'cmd': 'icon-batch',

    // Assembly and system
    'asm': 'icon-assembly',
    's': 'icon-assembly',
    'S': 'icon-assembly',

    // Databases
    'sql': 'icon-database',
    'mysql': 'icon-database',
    'pgsql': 'icon-database',
    'sqlite': 'icon-database',

    // Containers and deployment
    'dockerfile': 'icon-docker',
    'containerfile': 'icon-docker',

    // Config files
    'env': 'icon-config',
    'envrc': 'icon-config',
    'editorconfig': 'icon-config',
    'gitignore': 'icon-git',
    'gitattributes': 'icon-git',
    'eslintrc': 'icon-eslint',
    'prettierrc': 'icon-prettier',
    'babelrc': 'icon-babel',
    'npmrc': 'icon-npm',
    'yarnrc': 'icon-yarn',
    'tsconfig': 'icon-typescript',
    'jsconfig': 'icon-javascript',
    'webpack': 'icon-webpack',
    'rollup': 'icon-rollup',
    'vite': 'icon-vite',
    'makefile': 'icon-makefile',
    'cmake': 'icon-cmake',
    'gradle': 'icon-gradle',
    'maven': 'icon-maven',
    'ant': 'icon-ant',
    'properties': 'icon-properties',
    'lock': 'icon-lock',

    // Data formats
    'csv': 'icon-csv',
    'tsv': 'icon-csv',
    'psv': 'icon-csv',
    'dsv': 'icon-csv',
    'log': 'icon-log',
    'out': 'icon-log',
    'err': 'icon-log',
    'trace': 'icon-log',

    // Other formats
    'patch': 'icon-diff',
    'diff': 'icon-diff',
    'rej': 'icon-diff',
    'spec': 'icon-rpm',
    'rpm': 'icon-rpm',
    'deb': 'icon-deb',
    'pem': 'icon-certificate',
    'crt': 'icon-certificate',
    'key': 'icon-key',
    'pub': 'icon-key'
  };

  return iconMap[ext || ''] || 'icon-file';
};