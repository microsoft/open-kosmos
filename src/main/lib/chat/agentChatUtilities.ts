// src/main/lib/chat/agentChatUtilities.ts
// AgentChat utility methods — helper methods extracted from agentChat.ts

import { Message, ToolCall, MessageHelper, UserMessage, SystemMessage, AssistantMessage } from '@shared/types/chatTypes';
import {
  ResponseInputImageContent,
  ResponseInputItem,
  ResponseInputTextContent,
} from '@shared/types/ghcChatTypes';
import { createLogger } from '../unifiedLogger';
import { formatFileSize } from '../utilities/contentUtils';
import { GhcApiError } from '../utilities/errors';
import { FullModeCompressor } from '../compression/fullModeCompressor';
import { TokenCounter } from '../token';
import {
  sanitizeFormattedToolReplayMessages,
  sanitizeIncompleteToolCallMessages,
} from './agentChatToolReplaySanitizer';
import { compressMessageImagesForStorage } from "../utilities/imageStorageCompression";

const logger = createLogger();

// ===== API Message intermediate format types =====

interface ApiTextContent {
  type: 'text';
  text: string;
}

interface ApiImageContent {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' };
}

type ApiMultipartContent = Array<ApiTextContent | ApiImageContent>;

interface ApiUserMessage {
  role: 'user';
  content: string | ApiMultipartContent;
}

interface ApiAssistantMessage {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

interface ApiSystemMessage {
  role: 'system';
  content: string;
}

interface ApiToolMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
  name?: string;
}

export type ApiMessage = ApiUserMessage | ApiAssistantMessage | ApiSystemMessage | ApiToolMessage;

// ====== Tool argument processing methods ======

/**
 * Normalize tool calls
 */
export function normalizeToolCalls(toolCalls?: any[]): any[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return toolCalls;
  }

  let changesDetected = false;
  const normalizedCalls: any[] = [];

  toolCalls.forEach((toolCall: any, index: number) => {
    if (!toolCall || typeof toolCall !== 'object') {
      normalizedCalls.push(toolCall);
      return;
    }

    if (!toolCall.function || typeof toolCall.function !== 'object') {
      normalizedCalls.push({ ...toolCall });
      return;
    }

    const clonedCall = {
      ...toolCall,
      function: { ...toolCall.function }
    };

    const rawArgs = clonedCall.function.arguments;

    if (typeof rawArgs === 'string') {
      const result = normalizeToolArguments(
        clonedCall.function.name || 'unknown_tool',
        rawArgs,
        index
      );

      if (result.didChange) {
        changesDetected = true;
      }

      const argumentStrings = result.argumentsList.length > 0
        ? result.argumentsList
        : [rawArgs];

      argumentStrings.forEach((argsString, argIndex) => {
        const callClone = argIndex === 0
          ? clonedCall
          : {
              ...clonedCall,
              id: generateSyntheticToolCallId(clonedCall, index, argIndex),
              function: { ...clonedCall.function }
            };

        callClone.function.arguments = argsString;
        normalizedCalls.push(callClone);

        if (argIndex > 0) {
          changesDetected = true;
        }
      });
    } else if (rawArgs !== undefined) {
      try {
        clonedCall.function.arguments = JSON.stringify(rawArgs);
        changesDetected = true;
      } catch (error) {
        logger.warn('[AgentChatUtilities] Failed to stringify non-string arguments');
      }
      normalizedCalls.push(clonedCall);
    } else {
      normalizedCalls.push(clonedCall);
    }
  });

  if (changesDetected) {
    logger.info('[AgentChatUtilities] Tool calls normalized with changes');
  }

  return normalizedCalls;
}

/**
 * Normalize tool arguments
 */
export function normalizeToolArguments(
  toolName: string,
  rawArgs: string,
  index: number
): { argumentsList: string[]; didChange: boolean } {
  if (typeof rawArgs !== 'string') {
    return { argumentsList: [JSON.stringify(rawArgs)], didChange: true };
  }

  let cleaned = rawArgs.trim();
  let didChange = cleaned !== rawArgs;

  if (!cleaned) {
    return { argumentsList: ['{}'], didChange: true };
  }

  const withoutFence = stripJsonCodeFence(cleaned);
  if (withoutFence !== cleaned) {
    cleaned = withoutFence;
    didChange = true;
  }

  const directParse = tryParseJson(cleaned);
  if (directParse.ok) {
    return {
      argumentsList: [JSON.stringify(directParse.value)],
      didChange: didChange || cleaned !== rawArgs
    };
  }

  const segments = splitConcatenatedJsonObjects(cleaned);
  const successfulSegments = segments
    .map(segment => {
      const parsed = tryParseJson(segment);
      return parsed.ok ? { ok: true as const, value: parsed.value } : { ok: false as const };
    })
    .filter((segment): segment is { ok: true; value: any } => segment.ok);

  if (successfulSegments.length > 1) {
    return {
      argumentsList: successfulSegments.map(segment => JSON.stringify(segment.value)),
      didChange: true
    };
  }

  if (successfulSegments.length === 1) {
    return {
      argumentsList: [JSON.stringify(successfulSegments[0].value)],
      didChange: true
    };
  }

  const fallbackExtract = extractFirstJsonStructure(cleaned);
  if (fallbackExtract) {
    const fallbackParse = tryParseJson(fallbackExtract);
    if (fallbackParse.ok) {
      return {
        argumentsList: [JSON.stringify(fallbackParse.value)],
        didChange: true
      };
    }
  }

  return { argumentsList: [rawArgs], didChange };
}

export function detectTruncatedToolCalls(toolCalls: any[]): any[] {
  const truncated: any[] = [];

  for (const toolCall of toolCalls || []) {
    const toolName = toolCall?.function?.name || '';
    const rawArgs = toolCall?.function?.arguments;
    const requiredFields = getCriticalToolCallFields(toolName);

    if (typeof rawArgs !== 'string') {
      if (requiredFields.length > 0) {
        truncated.push(toolCall);
      }
      continue;
    }

    const args = rawArgs.trim();
    if (!args) {
      if (requiredFields.length > 0) {
        truncated.push(toolCall);
      }
      continue;
    }

    let openBraces = 0;
    let closeBraces = 0;
    let openBrackets = 0;
    let closeBrackets = 0;
    let inString = false;
    let escaped = false;
    let unbalancedQuotes = 0;

    for (let i = 0; i < args.length; i++) {
      const ch = args[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          unbalancedQuotes--;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        unbalancedQuotes++;
        continue;
      }

      if (ch === '{') openBraces++;
      else if (ch === '}') closeBraces++;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') closeBrackets++;
    }

    if (openBraces !== closeBraces || openBrackets !== closeBrackets || unbalancedQuotes !== 0) {
      truncated.push(toolCall);
      continue;
    }

    const parsed = tryParseJson(args);
    if (!parsed.ok) {
      truncated.push(toolCall);
      continue;
    }

    if (isMissingCriticalToolCallFields(toolName, parsed.value)) {
      truncated.push(toolCall);
    }
  }

  return truncated;
}

/**
 * Strip JSON code fences
 */
export function stripJsonCodeFence(content: string): string {
  const codeFenceMatch = content.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (codeFenceMatch) {
    return codeFenceMatch[1].trim();
  }
  return content;
}

/**
 * Split concatenated JSON objects
 */
export function splitConcatenatedJsonObjects(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const segments: string[] = [];
  let depth = 0;
  let segmentStart = -1;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) segmentStart = i;
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0 && segmentStart !== -1) {
        segments.push(trimmed.slice(segmentStart, i + 1));
        segmentStart = -1;
      }
    }
  }

  return segments.length === 0 ? [trimmed] : segments;
}

/**
 * Generate a synthetic tool call ID
 */
export function generateSyntheticToolCallId(
  originalCall: any,
  callIndex: number,
  segmentIndex: number
): string {
  const baseId = (typeof originalCall.id === 'string' && originalCall.id.trim().length > 0)
    ? originalCall.id.trim()
    : `${originalCall.function?.name || 'tool_call'}_${callIndex}`;
  return `${baseId}_part${segmentIndex + 1}`;
}

/**
 * Extract the first JSON structure from a string
 */
export function extractFirstJsonStructure(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let depth = 0;
  let start = -1;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Attempt to parse JSON
 */
export function tryParseJson(value: string): { ok: boolean; value?: any } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

// ====== Compression-related methods ======

/**
 * Returns the compression threshold appropriate for this model's context window size.
 *
 * Tiers (applied to raw contextWindowSize, not effectiveContextWindow):
 *   ≥ 500K  →  0.40  (1M models: compress early, cycles repeat cheaply after shrink)
 *   ≥ 200K  →  0.50  (mid-range: balanced trade-off)
 *   <  200K  →  0.70  (small models: preserve history, avoid premature compression)
 *
 * After first compression, context shrinks to [summary + 5 recent msgs] (~5–15K tokens),
 * so the threshold will not re-fire until substantial new history accumulates — the
 * aggressive lower tiers do not cause runaway compression cycles.
 */
export function getCompressionThreshold(contextWindowSize: number): number {
  if (contextWindowSize >= 500_000) return 0.40;
  if (contextWindowSize >= 200_000) return 0.50;
  return 0.70;
}

/**
 * Check whether compression is needed.
 * Uses adaptive thresholds based on the model's context window size.
 */
export async function checkCompressionNeeds(
  contextHistory: Message[],
  contextWindowSize: number,
  agentName: string,
  calculateTokensFn: () => Promise<{ totalTokens: number }>,
  outputTokenReserve: number = 0
): Promise<boolean> {
  try {
    if (contextWindowSize <= 0) {
      logger.warn('[AgentChatUtilities] Cannot determine model context window size, falling back to message count', 'checkCompressionNeeds', {
        contextWindowSize,
        agentName
      });

      return contextHistory.length > 15;
    }

    // Calculate the current total token usage
    const tokens = await calculateTokensFn();

    // Reserve space for output tokens
    const effectiveContextWindow = contextWindowSize - outputTokenReserve;

    // Adaptive compression check: threshold is tiered by model context window size
    const tokenUsageRatio = tokens.totalTokens / effectiveContextWindow;
    const compressionThreshold = getCompressionThreshold(contextWindowSize);
    const needsCompression = tokenUsageRatio >= compressionThreshold;

    logger.debug('[AgentChatUtilities] Compression threshold check', 'checkCompressionNeeds', {
      agentName,
      contextWindowSize,
      effectiveContextWindow,
      totalTokens: tokens.totalTokens,
      tokenUsageRatio: Number(tokenUsageRatio.toFixed(4)),
      compressionThreshold,
      needsCompression,
    });

    return needsCompression;
  } catch (error) {
    logger.error('[AgentChatUtilities] Error in checkCompressionNeeds', 'checkCompressionNeeds', {
      error: error instanceof Error ? error.message : String(error),
      agentName
    });
    return false;
  }
}

/**
 * Compress context history using FullModeCompressor
 */
export async function compressContextHistoryWithFullMode(
  contextHistory: Message[],
  fullModeCompressor: FullModeCompressor,
  agentName: string
): Promise<{ success: boolean; compressedMessages: Message[] }> {
  try {
    const compressionResult = await fullModeCompressor.compressMessages(contextHistory);
    const compressedMessages = compressionResult.compressedMessages;
    const compressionMethod = compressionResult.metadata.compressionMethod;
    const hasUsableSummary = compressionMethod !== 'summary' || Boolean(compressionResult.summary?.trim());
    const canInstallResult = compressionResult.success || compressionMethod === 'fallback';

    if (compressedMessages.length < contextHistory.length && canInstallResult && hasUsableSummary) {
      logger.info('[AgentChatUtilities] Context history compressed successfully', 'compressContextHistoryWithFullMode', {
        agentName,
        originalCount: contextHistory.length,
        compressedCount: compressedMessages.length,
        compressionStrategy: compressionResult.strategy,
        compressionMethod: compressionResult.metadata.compressionMethod,
        compressionSuccess: compressionResult.success,
        processingTimeMs: compressionResult.processingTime,
        chunkSummaryCallCount: compressionResult.metadata.chunkSummaryCallCount,
        totalLlmCallCount: compressionResult.metadata.totalLlmCallCount,
      });
      return {
        success: true,
        compressedMessages
      };
    }

    if (compressedMessages.length < contextHistory.length) {
      logger.warn('[AgentChatUtilities] Rejected compressed result due to failed summary validation or unsupported failure mode', 'compressContextHistoryWithFullMode', {
        agentName,
        originalCount: contextHistory.length,
        compressedCount: compressedMessages.length,
        compressionStrategy: compressionResult.strategy,
        compressionMethod,
        compressionSuccess: compressionResult.success,
        hasUsableSummary,
      });
    }

    return { success: false, compressedMessages: contextHistory };
  } catch (error) {
    logger.error('[AgentChatUtilities] Full Mode compression failed', 'compressContextHistoryWithFullMode', {
      error: error instanceof Error ? error.message : String(error),
      agentName
    });
    return { success: false, compressedMessages: contextHistory };
  }
}

/**
 * Apply storage compression to recent messages
 */
export async function applyStorageCompressionToRecentMessages(
  chatHistory: Message[],
  agentName: string
): Promise<{ success: boolean; compressedMessage?: Message }> {
  const startTime = Date.now();

  try {
    // Get the last user message
    const userMessages = chatHistory.filter((msg: Message) => msg.role === 'user');

    if (userMessages.length === 0) {
      return { success: false };
    }

    const lastUserMessage = userMessages[userMessages.length - 1];

    // Check whether it contains images
    if (!MessageHelper.hasImages(lastUserMessage)) {
      return { success: false };
    }

    const images = MessageHelper.getImages(lastUserMessage);

    // Check whether compression has already been applied
    const needsCompression = images.some(img => !img.metadata.storageCompressed);
    if (!needsCompression) {
      return { success: false };
    }

    // Compress directly using the main-process compression utility
    const compressedMessage = await compressMessageImagesForStorage(lastUserMessage);

    // Calculate compression effectiveness
    const oldImages = MessageHelper.getImages(lastUserMessage);
    const newImages = MessageHelper.getImages(compressedMessage);
    const compressedImagesCount = newImages.filter(img => img.metadata.storageCompressed).length;

    const oldTotalSize = oldImages.reduce((sum, img) => sum + img.metadata.fileSize, 0);
    const newTotalSize = newImages.reduce((sum, img) => sum + img.metadata.fileSize, 0);
    const savedBytes = oldTotalSize - newTotalSize;

    const duration = Date.now() - startTime;

    logger.info('[AgentChatUtilities] Storage compression completed', 'applyStorageCompressionToRecentMessages', {
      agentName,
      messageId: lastUserMessage.id,
      compressedCount: compressedImagesCount,
      totalImages: newImages.length,
      savedBytes,
      durationMs: duration
    });

    return { success: true, compressedMessage };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('[AgentChatUtilities] Storage compression failed', 'applyStorageCompressionToRecentMessages', {
      agentName,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: duration
    });
    return { success: false };
  }
}

// ====== Message formatting methods ======

/**
 * Format messages for API calls
 */
export async function formatMessagesForApi(
  systemMessages: Message[],
  contextHistory: Message[],
  supportsTools: boolean,
  endpoint: string = '/chat/completions'
): Promise<ApiMessage[] | ResponseInputItem[]> {
  const sanitizedContextHistory = sanitizeIncompleteToolCallMessages(contextHistory, sanitizeToolCallsForApi);

  const validToolCallIds = new Set<string>();
  const formattedMessages: ApiMessage[] = [];

  // Collect all valid tool call IDs
  for (const msg of systemMessages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        if (toolCall.id) {
          validToolCallIds.add(toolCall.id);
        }
      }
    }
  }

  for (const msg of sanitizedContextHistory) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        if (toolCall.id) {
          validToolCallIds.add(toolCall.id);
        }
      }
    }
  }

  function handleRestMsg(msg: UserMessage | SystemMessage | AssistantMessage) {
    const content = MessageHelper.getText(msg);
    if (msg.role === 'assistant') {
      const tool_calls = supportsTools ? msg.tool_calls : undefined;
      if (content || tool_calls?.length) {
        formattedMessages.push({ role: 'assistant', content, tool_calls });
      }
      return;
    }
    if (!content) return;
    formattedMessages.push({ role: msg.role, content });
  }

  // Format system messages
  for (const msg of systemMessages) {
    if (msg.role === 'tool') {
      if (!msg.tool_call_id || !validToolCallIds.has(msg.tool_call_id)) {
        continue;
      }

      const toolContent = MessageHelper.getText(msg);
      const apiMessage: ApiToolMessage = {
        role: msg.role,
        content: toolContent,
        tool_call_id: msg.tool_call_id,
      };

      if (msg.name) {
        apiMessage.name = msg.name;
      }

      formattedMessages.push(apiMessage);
      continue;
    }
    handleRestMsg(msg);
  }

  // Format context history
  for (const msg of sanitizedContextHistory) {
    if (msg.role === 'tool') {
      if (!msg.tool_call_id || !validToolCallIds.has(msg.tool_call_id)) {
        continue;
      }

      const toolContent = MessageHelper.getText(msg);
      const apiMessage: ApiToolMessage = {
        role: msg.role,
        content: toolContent,
        tool_call_id: msg.tool_call_id
      };

      if (msg.name) {
        apiMessage.name = msg.name;
      }

      formattedMessages.push(apiMessage);
      continue;
    }

    // Handle unified-format messages including file references, Office documents, images, and other file types.
    // Only user message content can contain images/files/Office/other attachments.
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const hasImages = MessageHelper.hasImages(msg);
      const hasFiles = MessageHelper.hasFiles(msg);
      const hasOffice = MessageHelper.hasOffice(msg);
      const hasOthers = MessageHelper.hasOthers(msg);

      if (hasImages || hasFiles || hasOffice || hasOthers) {
        // Handle the case where images coexist with files, Office documents, or other file types
        if (hasImages && (hasFiles || hasOffice || hasOthers)) {
          const textContent = MessageHelper.getText(msg);
          const fileParts = MessageHelper.getFiles(msg);
          const officeParts = MessageHelper.getOffice(msg);
          const othersParts = MessageHelper.getOthers(msg);
          const imageParts = MessageHelper.getImages(msg);

          let enhancedContent = textContent;

          // Handle text file references
          if (fileParts.length > 0) {
            enhancedContent += '\n\n📁 **Text Files List:**\n';
            fileParts.forEach((filePart, index) => {
              enhancedContent += `${index + 1}. **${filePart.file.fileName}** (${formatFileSize(filePart.metadata.fileSize)})\n`;
              enhancedContent += `   - Path: \`${filePart.file.filePath}\`\n`;
              enhancedContent += `   - Type: ${filePart.file.mimeType}\n`;
              if (filePart.metadata.lines) {
                enhancedContent += `   - Lines: ${filePart.metadata.lines}\n`;
              }
            });
          }

          // Handle Office document references
          if (officeParts.length > 0) {
            enhancedContent += '\n\n📄 **Office Files List:**\n';
            officeParts.forEach((officePart, index) => {
              const rawExtension = officePart.file.extension || officePart.file.fileName?.split('.').pop();
              const extensionDisplay = rawExtension ? rawExtension.toUpperCase() : 'UNKNOWN';
              enhancedContent += `${index + 1}. **${officePart.file.fileName}** (${formatFileSize(officePart.metadata.fileSize)})\n`;
              enhancedContent += `   - Path: \`${officePart.file.filePath}\`\n`;
              enhancedContent += `   - Type: ${officePart.file.mimeType}\n`;
              enhancedContent += `   - Extension: ${extensionDisplay}\n`;
              if (typeof officePart.metadata.pages === 'number') {
                enhancedContent += `   - Pages: ${officePart.metadata.pages}\n`;
              }
              if (typeof officePart.metadata.lines === 'number') {
                enhancedContent += `   - Lines: ${officePart.metadata.lines}\n`;
              }
            });
          }

          // Handle other file type references
          if (othersParts.length > 0) {
            enhancedContent += '\n\n📎 **Other Files List:**\n';
            othersParts.forEach((othersPart, index) => {
              enhancedContent += `${index + 1}. **${othersPart.file.fileName}** (${formatFileSize(othersPart.metadata.fileSize)})\n`;
              enhancedContent += `   - Type: ${othersPart.file.mimeType}\n`;
              enhancedContent += `   - Extension: ${othersPart.metadata.fileExtension?.toUpperCase() || 'UNKNOWN'}\n`;
              enhancedContent += `   - Description: ${othersPart.metadata.description || 'Other file type'}\n`;
            });
          }

          enhancedContent += `\n🖼️ **Image Content**: The message contains ${imageParts.length} image(s), please analyze the information in the images carefully`;
          if (fileParts.length > 0) {
            enhancedContent += '\n💡 *Tip: Please analyze both image content and text files comprehensively. You can use the `read_file` tool to read text file details*';
          }
          if (officeParts.length > 0) {
            enhancedContent += '\n📄 *Tip: You can call the `read_office_file` tool to extract structured information from these Office documents*';
          }
          if (othersParts.length > 0) {
            enhancedContent += '\n📎 *Note: Other file types only provide metadata information and cannot be read directly*';
          }

          // Build an API-format content array containing text and images
          const content: ApiMultipartContent = [{ type: 'text', text: enhancedContent }];

          // Add image content
          for (const imagePart of imageParts) {
            const imageUrl = imagePart.image_url.url;
            const originalDetail = imagePart.image_url.detail;
            let imageDetail: 'low' | 'high' | undefined;

            if (originalDetail === 'low' || originalDetail === 'high') {
              imageDetail = originalDetail;
            } else {
              imageDetail = undefined;
            }

            content.push({
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: imageDetail
              }
            });
          }

          formattedMessages.push({
            role: 'user',
            content: content
          });
          continue;
        }

        // Handle the case where only files/Office documents/other file types are present (no images)
        if ((hasFiles || hasOffice || hasOthers) && !hasImages) {
          const textContent = MessageHelper.getText(msg);
          const fileParts = MessageHelper.getFiles(msg);
          const officeParts = MessageHelper.getOffice(msg);
          const othersParts = MessageHelper.getOthers(msg);

          let enhancedContent = textContent;

          // Handle text file references
          if (fileParts.length > 0) {
            enhancedContent += '\n\n📁 **Text Files List:**\n';
            fileParts.forEach((filePart, index) => {
              enhancedContent += `${index + 1}. **${filePart.file.fileName}** (${formatFileSize(filePart.metadata.fileSize)})\n`;
              enhancedContent += `   - Path: \`${filePart.file.filePath}\`\n`;
              enhancedContent += `   - Type: ${filePart.file.mimeType}\n`;
              if (filePart.metadata.lines) {
                enhancedContent += `   - Lines: ${filePart.metadata.lines}\n`;
              }
            });
            enhancedContent += '\n💡 *Tip: You can use the `read_file` tool to read the contents of these text files*';
          }

          // Handle Office document references
          if (officeParts.length > 0) {
            enhancedContent += '\n\n📄 **Office Documents List:**\n';
            officeParts.forEach((officePart, index) => {
              const rawExtension = officePart.file.extension || officePart.file.fileName?.split('.').pop();
              const extensionDisplay = rawExtension ? rawExtension.toUpperCase() : 'UNKNOWN';
              enhancedContent += `${index + 1}. **${officePart.file.fileName}** (${formatFileSize(officePart.metadata.fileSize)})\n`;
              enhancedContent += `   - Path: \`${officePart.file.filePath}\`\n`;
              enhancedContent += `   - Type: ${officePart.file.mimeType}\n`;
              enhancedContent += `   - Extension: ${extensionDisplay}\n`;
              if (typeof officePart.metadata.pages === 'number') {
                enhancedContent += `   - Pages: ${officePart.metadata.pages}\n`;
              }
              if (typeof officePart.metadata.lines === 'number') {
                enhancedContent += `   - Lines: ${officePart.metadata.lines}\n`;
              }
            });
            enhancedContent += '\n📄 *Tip: You can call the `read_office_file` tool to extract structured information from these Office documents*';
          }

          // Handle other file type references
          if (othersParts.length > 0) {
            enhancedContent += '\n\n📎 **Other Files List:**\n';
            othersParts.forEach((othersPart, index) => {
              enhancedContent += `${index + 1}. **${othersPart.file.fileName}** (${formatFileSize(othersPart.metadata.fileSize)})\n`;
              enhancedContent += `   - Type: ${othersPart.file.mimeType}\n`;
              enhancedContent += `   - Extension: ${othersPart.metadata.fileExtension?.toUpperCase() || 'UNKNOWN'}\n`;
              enhancedContent += `   - Description: ${othersPart.metadata.description || 'Other file type'}\n`;
            });
            enhancedContent += '\n📎 *Note: Other file types only provide metadata information and cannot be read directly*';
          }

          formattedMessages.push({
            role: msg.role,
            content: enhancedContent
          });
          continue;
        }

        // Handle the case where only images are present (no files, Office, or other types)
        if (hasImages && !hasFiles && !hasOffice && !hasOthers) {
          const textContent = MessageHelper.getText(msg);

          const content: ApiMultipartContent = [{ type: 'text', text: textContent }];

          const imageParts = MessageHelper.getImages(msg);
          for (const imagePart of imageParts) {
            const imageUrl = imagePart.image_url.url;
            const originalDetail = imagePart.image_url.detail;
            let imageDetail: 'low' | 'high' | undefined;

            if (originalDetail === 'low' || originalDetail === 'high') {
              imageDetail = originalDetail;
            } else {
              imageDetail = undefined;
            }

            content.push({
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: imageDetail
              }
            });
          }

          formattedMessages.push({
            role: 'user',
            content: content
          });
          continue;
        }
      }
    }

    handleRestMsg(msg);
  }

  const sanitizedFormattedMessages = sanitizeFormattedToolReplayMessages(formattedMessages) as ApiMessage[];

  // Merge consecutive user messages — some providers reject adjacent user messages.
  const mergedMessages = mergeConsecutiveUserMessages(sanitizedFormattedMessages);

  // Warn if the last message is assistant (prefill) — causes 400 on some models.
  if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === 'assistant') {
    logger.warn('[AgentChatUtilities] Final formatted messages end with assistant role — may cause prefill error', 'formatMessagesForApi', {
      totalMessages: mergedMessages.length, endpoint,
    });
  }

  if (endpoint === '/responses') {
    return convertMessagesToResponseInput(mergedMessages);
  }

  return mergedMessages;
}

/**
 * Merge consecutive user messages into one (some providers reject adjacent user messages).
 */
function toMultipartContent(content: string | ApiMultipartContent): ApiMultipartContent {
  return typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;
}

/** @internal — exported for testing */
export function mergeConsecutiveUserMessages(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length <= 1) return messages;
  const result: ApiMessage[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (msg.role === 'user' && last?.role === 'user') {
      const merged = [...toMultipartContent(last.content), ...toMultipartContent((msg as ApiUserMessage).content)];
      const allText = merged.every(p => p.type === 'text');
      result[result.length - 1] = {
        ...last,
        content: allText ? merged.map(p => (p as ApiTextContent).text).join('\n\n') : merged,
      } as ApiUserMessage;
    } else {
      result.push(msg);
    }
  }
  if (result.length < messages.length) {
    logger.info('[AgentChatUtilities] Merged consecutive user messages', 'mergeConsecutiveUserMessages', {
      originalCount: messages.length, mergedCount: messages.length - result.length,
    });
  }
  return result;
}

export function sanitizeToolCallsForApi(toolCalls: ToolCall[]): { toolCalls: ToolCall[]; sanitizedCount: number } {
  let sanitizedCount = 0;

  const sanitizedToolCalls = toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== 'object' || !toolCall.function || typeof toolCall.function !== 'object') {
      return toolCall;
    }

    const { value: sanitizedArguments, didSanitize } = sanitizeToolCallArgumentsForApi(
      toolCall.function.arguments
    );

    if (!didSanitize) {
      return toolCall;
    }

    sanitizedCount += 1;
    return {
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: sanitizedArguments,
      },
    };
  });

  return { toolCalls: sanitizedToolCalls, sanitizedCount };
}

function sanitizeToolCallArgumentsForApi(rawArgs: unknown): { value: string; didSanitize: boolean } {
  if (typeof rawArgs !== 'string') {
    return {
      value: JSON.stringify(rawArgs ?? {}),
      didSanitize: true,
    };
  }

  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return { value: '{}', didSanitize: true };
  }

  const withoutFence = stripJsonCodeFence(trimmed);
  const directParse = tryParseJson(withoutFence);
  if (directParse.ok) {
    const normalized = JSON.stringify(directParse.value);
    return {
      value: normalized,
      didSanitize: normalized !== rawArgs,
    };
  }

  const firstJsonStructure = extractFirstJsonStructure(withoutFence);
  if (firstJsonStructure) {
    const extractedParse = tryParseJson(firstJsonStructure);
    if (extractedParse.ok) {
      return {
        value: JSON.stringify(extractedParse.value),
        didSanitize: true,
      };
    }
  }

  return { value: '{}', didSanitize: true };
}

function getCriticalToolCallFields(toolName: string): string[] {
  const criticalFieldsMap: Record<string, string[]> = {
    write_file: ['filePath', 'content'],
    create_file: ['filePath', 'content'],
    append_file: ['filePath', 'content'],
    execute_command: ['command'],
    web_fetch: ['url'],
    bing_web_search: ['query'],
  };

  return criticalFieldsMap[toolName] || [];
}

export function isMissingCriticalToolCallFields(toolName: string, parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') return false;

  const requiredFields = getCriticalToolCallFields(toolName);
  if (requiredFields.length === 0) return false;

  return requiredFields.some((field) => !(field in parsed));
}

/**
 * Convert a standard Message array to the ResponseInputItem array required by the /responses endpoint
 */
function convertMessagesToResponseInput(messages: ApiMessage[]): ResponseInputItem[] {
  const inputItems: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      inputItems.push({
        type: 'message',
        role: 'system',
        content: convertResponseMessageContent(msg.content)
      });
    } else if (msg.role === 'user') {
      inputItems.push({
        type: 'message',
        role: 'user',
        content: convertResponseMessageContent(msg.content)
      });
    } else if (msg.role === 'assistant') {
      const item: ResponseInputItem = {
        type: 'message',
        role: 'assistant',
        content: convertResponseMessageContent(msg.content)
      };

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Add the assistant message first (if it has content)
        if (item.content) {
          inputItems.push(item);
        }

        // Then add the function calls
        for (const toolCall of msg.tool_calls) {
          inputItems.push({
            type: 'function_call',
            call_id: toolCall.id, // Note: /responses API uses call_id instead of id
            name: toolCall.function.name,
            arguments: toolCall.function.arguments
          });
        }
      } else {
        inputItems.push(item);
      }
    } else if (msg.role === 'tool') {
      // Convert tool output to function_call_output
      inputItems.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id || '', // Note: /responses API uses call_id instead of id
        output: msg.content,
      });
    }
  }

  return inputItems;
}

function convertResponseMessageContent(
  content: string | ApiMultipartContent
): string | Array<ResponseInputTextContent | ResponseInputImageContent> {
  if (!Array.isArray(content)) {
    return content;
  }

  const convertedContent: Array<ResponseInputTextContent | ResponseInputImageContent> = [];

  for (const part of content) {
    if (part.type === 'text') {
      convertedContent.push({
        type: 'input_text',
        text: part.text,
      });
    } else if (part.type === 'image_url') {
      const detail = part.image_url.detail;
      convertedContent.push({
        type: 'input_image',
        image_url: part.image_url.url,
        detail: detail === 'low' || detail === 'high' ? detail : undefined,
      });
    }
  }

  if (convertedContent.length > 0) {
    return convertedContent;
  }

  return JSON.stringify(content);
}

// ====== Image detection methods ======

/**
 * Detect whether the messages contain any image content
 */
export function hasImageContentInMessages(messages: Array<ApiMessage | ResponseInputItem>): boolean {
  if (!messages || !Array.isArray(messages)) {
    return false;
  }

  for (const message of messages) {
    if ('content' in message && Array.isArray(message.content)) {
      for (const contentPart of message.content) {
        if (typeof contentPart === 'object' && contentPart !== null && 'type' in contentPart) {
          if (contentPart.type === 'image_url' || contentPart.type === 'input_image') {
            return true;
          }
        }
      }
    }
  }

  return false;
}

// ====== Tool format conversion methods ======

/**
 * Convert MCP tools to OpenAI function tool format
 */
export function convertMcpToolsToOpenAiFormat(mcpTools: any[]): any[] {
  return mcpTools.map((tool): any => {
    const toolName = tool.name;
    const toolDescription = tool.description;
    const toolInputSchema = tool.inputSchema;

    if (!toolName || !toolName.match(/^[\w-]+$/)) {
      throw new GhcApiError(`Invalid tool name "${toolName}"`, 400);
    }

    const functionDef: any = {
      name: toolName,
      description: toolDescription || `Tool: ${toolName}`,
      parameters: toolInputSchema && Object.keys(toolInputSchema).length > 0 ? toolInputSchema : undefined
    };

    return {
      type: 'function',
      function: functionDef
    };
  });
}

/**
 * Validate a tools request
 */
export function validateToolsRequest(tools: any[]): void {
  if (tools.length > 128) {
    throw new GhcApiError(`Cannot have more than 128 tools. Current: ${tools.length}`, 400);
  }

  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (!tool.function?.name) {
      throw new GhcApiError('Tool must have a function name', 400);
    }

    if (toolNames.has(tool.function.name)) {
      throw new GhcApiError(`Duplicate tool name: ${tool.function.name}`, 400);
    }
    toolNames.add(tool.function.name);

    if (!tool.function.name.match(/^[\w-]+$/)) {
      throw new GhcApiError(`Invalid tool name "${tool.function.name}"`, 400);
    }
  }
}

/**
 * Determine the tool choice mode
 */
export function determineToolChoice(tools: any[], toolMode: string = 'auto'): string | { type: 'function'; function: { name: string } } | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  switch (toolMode) {
    case 'none':
      return 'none';
    case 'required':
      if (tools.length > 1) {
        throw new GhcApiError('ToolMode.Required not supported with multiple tools', 400);
      }
      return { type: 'function', function: { name: tools[0].function.name } };
    case 'auto':
    default:
      return 'auto';
  }
}
