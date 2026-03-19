export interface LlmApiSettings {
  apiKey: string;
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
}

// Keep Config as alias for backward compatibility
export type Config = LlmApiSettings;

// ===== Retained image support definitions - for file processing tools =====
export enum ChatImageMimeType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  GIF = 'image/gif',
  WEBP = 'image/webp',
  BMP = 'image/bmp',
}

// Image format validation - fully replicating VSCode supported formats
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp'
] as const;

export const validateImageFile = (file: File): boolean => {
  return SUPPORTED_IMAGE_TYPES.includes(file.type as any);
};

// ===== Unified content part interfaces - new architecture =====

// Base content part
export interface ContentPart {
  type: 'text' | 'image' | 'file' | 'office' | 'others';
}

// Text content part
export interface TextContentPart extends ContentPart {
  type: 'text';
  text: string;
}

// Image content part
export interface ImageContentPart extends ContentPart {
  type: 'image';
  image_url: {
    url: string; // base64 data URL or file URL
    detail?: 'low' | 'high' | 'auto';
  };
  metadata: {
    fileName: string;
    fileSize: number;
    width?: number;
    height?: number;
    mimeType: string;
    // 🔄 New: compression status flags
    storageCompressed?: boolean;    // Whether storage compression has been applied
    originalSize?: number;          // Original file size
    compressionRatio?: number;      // Compression ratio
    compressionStage?: 'first' | 'second' | 'both'; // Compression stage marker
  };
}

// File content part
export interface FileContentPart extends ContentPart {
  type: 'file';
  file: {
    fileName: string;
    filePath: string; // File path reference, replaces pre-read content
    mimeType: string;
  };
  metadata: {
    fileSize: number;
    lines?: number;
    lastModified?: number;
    encoding?: string;
    detail?: 'auto' | 'low' | 'high'; // Processing precision control
    truncated?: boolean; // Indicates whether file content was truncated
  };
}

// Office document content part (provides metadata needed by read_office_file)
export interface OfficeContentPart extends ContentPart {
  type: 'office';
  file: {
    fileName: string;
    filePath: string; // Office file path reference
    mimeType: string; // application/pdf, application/vnd.openxmlformats-officedocument.* series
    extension?: string; // File extension (e.g., pdf, docx, pptx)
  };
  metadata: {
    fileSize: number;
    lines?: number;
    pages?: number; // PDF/PPT page count
    lastModified?: number;
    detail?: 'auto' | 'low' | 'high'; // Processing precision control
    truncated?: boolean; // Indicates whether file content was truncated
  };
}

// Other file content part (metadata only, content not read)
export interface OthersContentPart extends ContentPart {
  type: 'others';
  file: {
    fileName: string;
    filePath: string; // Set to empty string, indicating content doesn't need to be read
    mimeType: string;
  };
  metadata: {
    fileSize: number;
    lastModified?: number;
    detail?: 'auto' | 'low' | 'high'; // Processing precision control
    fileExtension?: string;
    description?: string; // File description
  };
}

// Unified content part type
export type UnifiedContentPart = TextContentPart | ImageContentPart | FileContentPart | OfficeContentPart | OthersContentPart;

// ===== Refactored Message interface =====
export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: UnifiedContentPart[]; // Unified multipart content
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  streamingComplete?: boolean; // Flag to indicate if streaming is complete for this message
  timestamp?: number; // Message timestamp
}

// ===== MessageHelper utility class =====
export class MessageHelper {
  // Extract all text content
  static getText(message: Message): string {
    return message.content
      .filter(part => part.type === 'text')
      .map(part => (part as TextContentPart).text)
      .join(' ');
  }
  
  // Get image attachments
  static getImages(message: Message): ImageContentPart[] {
    return message.content.filter(part => part.type === 'image') as ImageContentPart[];
  }
  
  // Get file attachments
  static getFiles(message: Message): FileContentPart[] {
    return message.content.filter(part => part.type === 'file') as FileContentPart[];
  }
  
  // Get Office document attachments
  static getOffice(message: Message): OfficeContentPart[] {
    return message.content.filter(part => part.type === 'office') as OfficeContentPart[];
  }
  
  // Get other type attachments
  static getOthers(message: Message): OthersContentPart[] {
    return message.content.filter(part => part.type === 'others') as OthersContentPart[];
  }
  
  // Check if message has attachments
  static hasAttachments(message: Message): boolean {
    return message.content.some(part => part.type !== 'text');
  }
  
  // 🔄 New: check if message has images
  static hasImages(message: Message): boolean {
    return message.content.some(part => part.type === 'image');
  }
  
  // 🔄 New: check if message has files
  static hasFiles(message: Message): boolean {
    return message.content.some(part => part.type === 'file');
  }
  
  // 🔄 New: check if message has Office documents
  static hasOffice(message: Message): boolean {
    return message.content.some(part => part.type === 'office');
  }

  // 🔄 New: check if message has other type files
  static hasOthers(message: Message): boolean {
    return message.content.some(part => part.type === 'others');
  }
  
  // Get attachment count statistics
  static getAttachmentCounts(message: Message): { images: number; files: number; office: number; others: number; total: number } {
    const images = this.getImages(message).length;
    const files = this.getFiles(message).length;
    const office = this.getOffice(message).length;
    const others = this.getOthers(message).length;
    return { images, files, office, others, total: images + files + office + others };
  }
  
  // Create plain text message
  static createTextMessage(text: string, role: Message['role'] = 'user', id?: string): Message {
    return {
      id: id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role,
      content: [{
        type: 'text',
        text
      }],
      timestamp: Date.now()
    };
  }
  
  // Create tool message
  static createToolMessage(content: string, tool_call_id: string, name: string, id?: string): Message {
    return {
      id: id || `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role: 'tool',
      content: [{
        type: 'text',
        text: content
      }],
      tool_call_id,
      name,
      timestamp: Date.now()
    };
  }
  
  // Append text content to message
  static appendTextContent(message: Message, text: string): void {
    // Find existing text part
    const textPart = message.content.find(part => part.type === 'text') as TextContentPart;
    if (textPart) {
      textPart.text += text;
    } else {
      // If no text part exists, create a new one
      message.content.unshift({
        type: 'text',
        text
      });
    }
  }
  
  // Set text content (replace all text parts)
  static setTextContent(message: Message, text: string): void {
    // Remove all existing text parts
    message.content = message.content.filter(part => part.type !== 'text');
    // Add new text part
    message.content.unshift({
      type: 'text',
      text
    });
  }
  
  // Validate message format
  static isValidMessage(message: any): message is Message {
    return message &&
           typeof message.role === 'string' &&
           Array.isArray(message.content) &&
           message.content.every((part: any) =>
             part.type && ['text', 'image', 'file', 'office', 'others'].includes(part.type)
           );
  }
}

// ===== Deprecated old interface definitions - transitional compatibility support =====
// Note: The following interfaces are deprecated, kept only for transitional compatibility, will be fully removed in phase 4

// @deprecated Use the new UnifiedContentPart instead
export interface ChatReferenceBinaryData {
  readonly mimeType: string;
  data(): Promise<Uint8Array>;
  readonly reference?: string; // Corresponds to VSCode's Uri
}

// @deprecated Use the new UnifiedContentPart instead
export interface LanguageModelDataPart {
  mimeType: string;
  data: Uint8Array;
}

// @deprecated Use the new UnifiedContentPart instead
export interface ChatReferenceFileData {
  readonly mimeType: string;
  data(): Promise<Uint8Array | string>; // Supports binary and text
  readonly reference?: string;
  readonly size?: number; // File size
  readonly isText?: boolean; // Whether it's a text file
  readonly fileName?: string; // File name - key property
  readonly text?: string; // Pre-processed text content - key property
  readonly fileReference?: FileReference; // New: file reference metadata
}

// File reference metadata - simplified version
export interface FileReference {
  filePath: string;        // Full file path
  fileName: string;        // File name (without path)
  fileSize: number;        // File size (bytes)
  fileType?: string;       // File type/extension
  mimeType?: string;       // MIME type
  startLine?: number;      // Start line number (for partial files)
  lineCount?: number;      // Number of lines to read
  lastModified?: number;   // File last modified time
  isTextFile?: boolean;    // Whether it's a text file
}

// Supported text file formats - aligned with VSCode
export const SUPPORTED_TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/javascript',
  'text/typescript',
  'text/css',
  'text/html',
  'text/json',
  'application/json',
  'text/xml',
  'application/xml',
  'text/yaml',
  'text/x-python',
  'text/x-java',
  'text/x-csharp',
  'text/x-cpp',
  'text/x-rust'
] as const;

// File size limits - aligned with VSCode
export const FILE_ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB - aligned with VSCode
  MAX_TEXT_LINES: 2000, // Maximum line count limit
  MAX_TOKEN_BUDGET: 600, // Token budget control
  SUPPORTED_TEXT_EXTENSIONS: [
    // Basic text files
    '.txt', '.md', '.rst', '.doc', '.rtf', '.pdf', '.docx', '.docm', '.pptx', '.pptm',
    // Web technologies
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.css', '.scss', '.sass', '.less', '.stylus',
    '.html', '.htm', '.xhtml', '.vue', '.svelte',
    '.json', '.json5', '.jsonc', '.xml', '.svg',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    // Programming languages - C/C++ family
    '.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hpp', '.hxx', '.h++',
    // Programming languages - Others
    '.py', '.pyw', '.pyc', '.pyi', '.pyx',
    '.java', '.class', '.jar', '.scala', '.kt', '.kts',
    '.cs', '.vb', '.fs', '.fsx', '.fsi',
    '.rs', '.go', '.mod', '.sum',
    '.rb', '.rbw', '.gem', '.rake',
    '.php', '.php3', '.php4', '.php5', '.phtml',
    '.pl', '.pm', '.t', '.pod',
    '.swift', '.m', '.mm', '.h',
    '.r', '.R', '.rmd', '.rnw',
    '.jl', '.julia',
    '.dart', '.flutter',
    '.lua', '.luac',
    '.sh', '.bash', '.zsh', '.fish', '.csh', '.tcsh',
    '.ps1', '.psm1', '.psd1',
    '.bat', '.cmd',
    '.asm', '.s', '.S',
    '.sql', '.mysql', '.pgsql', '.sqlite',
    '.dockerfile', '.containerfile',
    // Configuration and data files
    '.env', '.envrc', '.editorconfig', '.gitignore', '.gitattributes',
    '.eslintrc', '.prettierrc', '.babelrc', '.npmrc', '.yarnrc',
    '.tsconfig', '.jsconfig', '.webpack', '.rollup', '.vite',
    '.makefile', '.cmake', '.gradle', '.maven', '.ant',
    '.properties', '.lock', '.sum', '.mod',
    // Markup languages and documentation
    '.tex', '.latex', '.bib', '.cls', '.sty',
    '.org', '.adoc', '.asciidoc',
    '.wiki', '.mediawiki',
    // Data formats
    '.csv', '.tsv', '.psv', '.dsv',
    '.log', '.out', '.err', '.trace',
    // Other text formats
    '.patch', '.diff', '.rej',
    '.spec', '.rpm', '.deb',
    '.pem', '.crt', '.key', '.pub'
  ]
} as const;

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
}

export interface StartChatCallbacks {
  onAssistantMessage?: (message: Message) => void;
  onToolUse?: (toolName: string) => void;
  onToolResult?: (toolMessage: Message) => void;
  onConversationComplete?: () => void; // 🔄 New: conversation processing complete callback
}

export interface SystemMessageCallbacks {
  onAdd?: (message: Message) => void;
  onRemove?: (message: Message) => void;
}

export interface ChatCompletionRequest {
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  model?: string;
  tools?: any[];
  tool_choice?: string;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: Message;
    finish_reason: string;
  }>;
}

export interface ToolExecutionRequest {
  toolName: string;
  toolArgs: { [key: string]: unknown };
}