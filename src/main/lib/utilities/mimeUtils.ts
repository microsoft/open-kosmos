import * as path from 'path';

// ── Extension → MIME mapping ──────────────────────────────────────────

const EXTENSION_MIME_MAP: Record<string, string> = {
  // Office
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Text / data
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  // Programming languages
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.r': 'text/x-r',
  '.php': 'text/x-php',
  '.pl': 'text/x-perl',
  '.lua': 'text/x-lua',
  '.dart': 'text/x-dart',
  // Shell / scripting
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.fish': 'text/x-shellscript',
  '.ps1': 'text/x-powershell',
  '.bat': 'text/plain',
  '.cmd': 'text/plain',
  // Config / data
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/x-toml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',
  '.properties': 'text/plain',
  // Markup / style
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/x-less',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  // Database / query
  '.sql': 'text/x-sql',
  '.graphql': 'text/x-graphql',
  '.gql': 'text/x-graphql',
  // Build / project
  '.makefile': 'text/x-makefile',
  '.cmake': 'text/x-cmake',
  '.gradle': 'text/x-gradle',
  '.dockerfile': 'text/x-dockerfile',
  // Other text
  '.log': 'text/plain',
  '.rst': 'text/x-rst',
  '.tex': 'text/x-tex',
  '.proto': 'text/x-protobuf',
};

/** Guess MIME type from a file name's extension. Returns undefined if unknown. */
export function guessMimeFromFileName(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase();
  return EXTENSION_MIME_MAP[ext];
}

// ── Magic-bytes detection ─────────────────────────────────────────────

export interface BufferTypeInfo {
  /** Short identifier: 'png', 'jpeg', 'zip', 'pdf', 'cdfv2', 'html', 'xml', 'json', 'text-bom', 'unknown' */
  type: string;
  /** Human-readable description */
  description: string;
  /** Hex dump of first 8 bytes (uppercase) */
  hex: string;
  /** MIME type when deterministic (null for ambiguous types like 'zip' or non-content types like 'html') */
  mime: string | null;
}

/**
 * Identify the actual content type of a buffer by inspecting magic bytes.
 */
export function identifyBufferType(buf: Buffer): BufferTypeInfo {
  if (buf.length < 4) {
    return { type: 'unknown', description: 'Buffer too small to identify', hex: '', mime: null };
  }

  const hex = buf.subarray(0, 8).toString('hex').toUpperCase();

  // ── Images ──
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { type: 'png', description: 'PNG image', hex, mime: 'image/png' };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { type: 'jpeg', description: 'JPEG image', hex, mime: 'image/jpeg' };
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { type: 'gif', description: 'GIF image', hex, mime: 'image/gif' };
  }
  if (buf.length >= 12
    && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return { type: 'webp', description: 'WebP image', hex, mime: 'image/webp' };
  }

  // ── Documents ──
  // ZIP-based formats (.docx, .pptx, .xlsx, .zip) — PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) {
    return { type: 'zip', description: 'ZIP archive (Office Open XML / .docx / .pptx / .xlsx)', hex, mime: 'application/zip' };
  }
  // CDFV2 / OLE2 Compound Document — legacy Office or IRM-encrypted
  if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) {
    return { type: 'cdfv2', description: 'CDFV2/OLE2 (legacy Office format or IRM-encrypted)', hex, mime: null };
  }
  // PDF — %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { type: 'pdf', description: 'PDF document', hex, mime: 'application/pdf' };
  }

  // ── Text-based ──
  if (buf[0] === 0x3C) {
    const head = buf.toString('utf-8', 0, Math.min(100, buf.length)).toLowerCase();
    if (head.includes('<!doctype') || head.includes('<html') || head.includes('<!-')) {
      return { type: 'html', description: 'HTML document (likely error page)', hex, mime: null };
    }
    if (head.includes('<?xml')) {
      return { type: 'xml', description: 'XML document', hex, mime: 'application/xml' };
    }
  }
  // UTF-8 BOM
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { type: 'text-bom', description: 'UTF-8 text with BOM', hex, mime: null };
  }
  // JSON — starts with { or [
  if (buf[0] === 0x7B || buf[0] === 0x5B) {
    return { type: 'json', description: 'JSON-like text content', hex, mime: 'application/json' };
  }

  return { type: 'unknown', description: 'Unknown binary format', hex, mime: null };
}

/** Detect MIME type from file magic bytes. Returns null if not recognized or ambiguous. */
export function detectMimeFromMagicBytes(buf: Buffer): string | null {
  return identifyBufferType(buf).mime;
}
