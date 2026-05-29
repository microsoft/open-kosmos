import fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '../../unifiedLogger';
import { getUserDataPath } from '../../userDataADO/pathUtils';
import { compressImageFirstPass, MAX_IMAGE_BYTES_FOR_INLINE, MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE } from '../../utilities/imageStorageCompression';
import { guessMimeFromFileName, detectMimeFromMagicBytes } from '../../utilities/mimeUtils';
import type { UserContentPart } from '../../../../shared/types/chatTypes';
import type { InboundAttachment } from '../types';

const logger = createLogger();

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 30_000;

const IMAGE_MIME_PREFIX = 'image/';

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-sh',
  'application/x-httpd-php',
]);
const OFFICE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

interface BufferDownloadResult {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export function getAttachmentRootDir(): string {
  return path.join(getUserDataPath(), 'remote-attachments');
}

export function getSessionAttachmentDir(chatSessionId: string): string {
  return path.join(getAttachmentRootDir(), chatSessionId);
}

export function sanitizeAttachmentName(fileName: string): string {
  const baseName = path.basename(fileName || 'unnamed');
  const sanitized = baseName
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || 'unnamed';
}

/** Response Content-Type values that are too generic to trust. */
const UNTRUSTED_RESPONSE_MIMES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
  'text/plain',
]);

/**
 * Determine MIME type for an attachment.
 * Priority: magic bytes → response Content-Type (excluding generic placeholders) → filename extension → octet-stream.
 * When magic bytes return application/zip, we refine via filename to distinguish office formats.
 */
function resolveMimeType(responseMime: string | null, fileName: string, buffer: Buffer): string {
  // ① Magic bytes — most trustworthy, based on actual content
  const magicMime = detectMimeFromMagicBytes(buffer);
  if (magicMime) {
    // ZIP magic could be docx/xlsx/pptx — refine with filename
    if (magicMime === 'application/zip') {
      const byName = guessMimeFromFileName(fileName);
      return byName || magicMime;
    }
    return magicMime;
  }

  // ② Response Content-Type header (strip charset/params, skip generic placeholders)
  const normalized = responseMime?.split(';')[0]?.trim()?.toLowerCase();
  if (normalized && !UNTRUSTED_RESPONSE_MIMES.has(normalized)) {
    return normalized;
  }

  // ③ Filename extension
  const byName = guessMimeFromFileName(fileName);
  return byName || normalized || 'application/octet-stream';
}

/** Returns true if the MIME type requires persisting to disk (office/text files reference filePath). */
function needsDisk(mimeType: string): boolean {
  return OFFICE_MIME_TYPES.has(mimeType)
    || TEXT_MIME_TYPES.has(mimeType)
    || TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

/** Download attachment into an in-memory buffer. */
const HTTP_REGEX = /^https?:\/\//i;
async function downloadToBuffer(
  attachment: InboundAttachment,
): Promise<BufferDownloadResult | null> {
  const url = attachment.url;
  if (!url || !HTTP_REGEX.test(url)) {
    return null;
  }
  const safeFileName = sanitizeAttachmentName(attachment.name);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ATTACHMENT_DOWNLOAD_TIMEOUT_MS),
      headers: attachment.kind === 'inline-image'
        ? { Authorization: `Bearer ${attachment.token}` }
        : undefined,
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      const buf = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(chunk as ArrayBuffer);
      totalBytes += buf.length;
      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Attachment too large: ${totalBytes}`);
      }
      chunks.push(buf);
    }

    const buffer = Buffer.concat(chunks, totalBytes);
    const mimeType = resolveMimeType(response.headers.get('content-type'), attachment.name, buffer);

    return { buffer, fileName: safeFileName, mimeType, fileSize: totalBytes };
  } catch (error) {
    logger.warn(`[AttachmentPipeline] Download failed for ${attachment.name}: ${String(error)}`);
    return null;
  }
}

/** Write a buffer to a local file and return its path. */
async function spillToDisk(
  buffer: Buffer,
  fileName: string,
  chatSessionId: string,
): Promise<string> {
  const dir = getSessionAttachmentDir(chatSessionId);
  await fs.mkdir(dir, { recursive: true });
  const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const localPath = path.join(dir, `${uniquePrefix}-${fileName}`);
  await fs.writeFile(localPath, buffer);
  return localPath;
}

/** Build a content part from an in-memory buffer (images & others — no disk needed). */
async function buildContentPartFromBuffer(file: BufferDownloadResult): Promise<UserContentPart> {
  if (file.mimeType.startsWith(IMAGE_MIME_PREFIX)) {
    if (file.fileSize > MAX_IMAGE_BYTES_FOR_INLINE) {
      return {
        type: 'text',
        text: `[Attachment "${file.fileName}" is too large (${Math.round(file.fileSize / 1024 / 1024)}MB); inline embedding was skipped.]`,
      };
    }

    const rawBase64 = file.buffer.toString('base64');
    try {
      const compressed = await compressImageFirstPass(rawBase64, file.mimeType, {
        maxDimension: 2048,
        targetShortSide: 768,
        quality: 80,
      });
      if (compressed.compressedSize > MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE) {
        return {
          type: 'text',
          text: `[Attachment "${file.fileName}" is still too large after compression (${Math.round(compressed.compressedSize / 1024 / 1024)}MB); inline embedding was skipped.]`,
        };
      }

      return {
        type: 'image',
        image_url: {
          url: `data:${compressed.mimeType};base64,${compressed.base64Data}`,
          detail: 'low',
        },
        metadata: {
          fileName: file.fileName,
          fileSize: compressed.compressedSize,
          mimeType: compressed.mimeType,
        },
      };
    } catch (error) {
      logger.warn(`[AttachmentPipeline] Image compression failed, skip inline image: ${String(error)}`);
      return {
        type: 'text',
        text: `[Attachment "${file.fileName}" compression failed; inline image embedding was skipped.]`,
      };
    }
  }

  // "Others" type — metadata only, no file path
  return {
    type: 'others',
    file: {
      fileName: file.fileName,
      filePath: '',
      mimeType: file.mimeType,
    },
    metadata: {
      fileSize: file.fileSize,
      fileExtension: path.extname(file.fileName).replace('.', ''),
      description: 'Remote attachment from IM',
    },
  };
}

/** Build a content part for a file already persisted on disk (office & text). */
function buildContentPartFromDisk(filePath: string, fileName: string, mimeType: string, fileSize: number): UserContentPart {
  if (OFFICE_MIME_TYPES.has(mimeType)) {
    const extension = path.extname(fileName).replace('.', '');
    return {
      type: 'office',
      file: { fileName, filePath, mimeType, extension },
      metadata: { fileSize },
    };
  }
  return {
    type: 'file',
    file: { fileName, filePath, mimeType },
    metadata: { fileSize },
  };
}

function failurePart(attachment: InboundAttachment): UserContentPart {
  return {
    type: 'text',
    text: `[Attachment "${sanitizeAttachmentName(attachment.name)}" download failed.]`,
  };
}

async function download(att: InboundAttachment) {
  return downloadToBuffer(att);
}

export async function downloadAndBuildParts(
  attachments: InboundAttachment[],
  chatSessionId: string,
) {
  const limited = attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

  const results: UserContentPart[] = new Array(limited.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= limited.length) return;

      const attachment = limited[index];
      const downloaded = await download(attachment);
      if (!downloaded) {
        results[index] = failurePart(attachment);
        continue;
      }

      if (needsDisk(downloaded.mimeType)) {
        const localPath = await spillToDisk(downloaded.buffer, downloaded.fileName, chatSessionId);
        results[index] = buildContentPartFromDisk(localPath, downloaded.fileName, downloaded.mimeType, downloaded.fileSize);
      } else {
        results[index] = await buildContentPartFromBuffer(downloaded);
      }
    }
  }

  const workerCount = Math.min(ATTACHMENT_DOWNLOAD_CONCURRENCY, limited.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const parts = [...results];

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    parts.push({
      type: 'text',
      text: `[Only the first ${MAX_ATTACHMENTS_PER_MESSAGE} attachments were processed; the rest were ignored.]`,
    });
  }

  return parts;
}


export function cleanupSessionAttachmentDir(chatSessionId: string) {
  const sessionDir = getSessionAttachmentDir(chatSessionId);
  return fs.rm(sessionDir, { recursive: true, force: true })
    .catch(() => {
      // Todo: log cleanup failure
    });
}
