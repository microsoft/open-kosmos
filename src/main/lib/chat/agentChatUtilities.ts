// src/main/lib/chat/agentChatUtilities.ts
// AgentChat utility methods collection - helper methods extracted from agentChat.ts

import { Message, MessageHelper } from '../types/chatTypes';
import { ResponseInputItem } from '../types/ghcChatTypes';
import { createLogger } from '../unifiedLogger';
import { formatFileSize } from '../utilities/contentUtils';
import { FullModeCompressor } from '../compression/fullModeCompressor';
import { TokenCounter } from '../token';

const logger = createLogger();

// ====== Tool parameter processing methods ======

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

/**
 * Remove JSON code fences
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
 * Generate synthetic tool call ID
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
 * Extract first JSON structure
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
 * Try to parse JSON
 */
export function tryParseJson(value: string): { ok: boolean; value?: any } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

// ====== Compression related methods ======

/**
 * Check if compression is needed
 * Smart compression decision based on actual token usage rate (>= 0.85 * model context window)
 */
export async function checkCompressionNeeds(
  contextHistory: Message[],
  contextWindowSize: number,
  agentName: string,
  calculateTokensFn: () => Promise<{ totalTokens: number }>
): Promise<boolean> {
  try {
    if (contextWindowSize <= 0) {
      logger.warn('[AgentChatUtilities] Cannot determine model context window size, falling back to message count', 'checkCompressionNeeds', {
        contextWindowSize,
        agentName
      });
      
      return contextHistory.length > 15;
    }
    
    // Calculate current total token usage
    const tokens = await calculateTokensFn();
    
    // Smart compression decision: trigger compression when current token usage rate >= 85%
    const tokenUsageRatio = tokens.totalTokens / contextWindowSize;
    const compressionThreshold = 0.85;
    const needsCompression = tokenUsageRatio >= compressionThreshold;
    
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
 * Compress Context History using FullModeCompressor
 */
export async function compressContextHistoryWithFullMode(
  contextHistory: Message[],
  fullModeCompressor: FullModeCompressor,
  agentName: string
): Promise<{ success: boolean; compressedMessages: Message[] }> {
  try {
    const compressionResult = await fullModeCompressor.compressMessages(contextHistory);
    
    if (compressionResult.success && compressionResult.compressedMessages.length < contextHistory.length) {
      logger.info('[AgentChatUtilities] Context history compressed successfully', 'compressContextHistoryWithFullMode', {
        agentName,
        originalCount: contextHistory.length,
        compressedCount: compressionResult.compressedMessages.length
      });
      return {
        success: true,
        compressedMessages: compressionResult.compressedMessages
      };
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
    
    // Check if images are present
    if (!MessageHelper.hasImages(lastUserMessage)) {
      return { success: false };
    }
    
    const images = MessageHelper.getImages(lastUserMessage);
    
    // Check if already compressed
    const needsCompression = images.some(img => !img.metadata.storageCompressed);
    if (!needsCompression) {
      return { success: false };
    }
    
    // Use main process compression tool to compress directly
    const { compressMessageImagesForStorage } = await import('../utilities/imageStorageCompression');
    const compressedMessage = await compressMessageImagesForStorage(lastUserMessage);
    
    // Calculate compression results
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
): Promise<any[]> {
  // If /responses endpoint, use specific conversion logic
  if (endpoint === '/responses') {
    return convertMessagesToResponseInput([...systemMessages, ...contextHistory]);
  }

  const validToolCallIds = new Set<string>();
  const formattedMessages = [];
  
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
  
  for (const msg of contextHistory) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        if (toolCall.id) {
          validToolCallIds.add(toolCall.id);
        }
      }
    }
  }
  
  // Format system messages
  for (const msg of systemMessages) {
    if (!msg.content && msg.role !== 'tool' && msg.role !== 'system') {
      continue;
    }
    
    const messageContent = MessageHelper.getText(msg);
    const apiMessage: any = {
      role: msg.role,
      content: messageContent
    };

    if (supportsTools && msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      apiMessage.tool_calls = msg.tool_calls;
    }

    formattedMessages.push(apiMessage);
  }
  
  // Format context history
  for (const msg of contextHistory) {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const assistantContent = MessageHelper.getText(msg);
      const apiMessage: any = {
        role: msg.role,
        content: assistantContent,
        tool_calls: msg.tool_calls
      };
      formattedMessages.push(apiMessage);
      continue;
    }
    
    if (!msg.content && msg.role !== 'tool' && msg.role !== 'system') {
      continue;
    }
    
    if (msg.role === 'tool') {
      if (!msg.tool_call_id || !validToolCallIds.has(msg.tool_call_id)) {
        continue;
      }
      
      const toolContent = MessageHelper.getText(msg);
      const apiMessage: any = {
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
    
    // Process unified format messages, including file references, Office documents, images, and other file types
    if (Array.isArray(msg.content)) {
      const hasImages = MessageHelper.hasImages(msg);
      const hasFiles = MessageHelper.hasFiles(msg);
      const hasOffice = MessageHelper.hasOffice(msg);
      const hasOthers = MessageHelper.hasOthers(msg);

      if (hasImages || hasFiles || hasOffice || hasOthers) {
        // Handle cases with images, files, Office documents, and other file types simultaneously
        if (hasImages && (hasFiles || hasOffice || hasOthers)) {
          const textContent = MessageHelper.getText(msg);
          const fileParts = MessageHelper.getFiles(msg);
          const officeParts = MessageHelper.getOffice(msg);
          const othersParts = MessageHelper.getOthers(msg);
          const imageParts = MessageHelper.getImages(msg);

          let enhancedContent = textContent;

          // Process text file references
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
          
          // Process Office document references
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

          // Process other file type references
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

          // Create API format content array containing text and images
          const content: Array<{
            type: 'text' | 'image_url';
            text?: string;
            image_url?: {
              url: string;
              detail?: 'low' | 'high';
            };
          }> = [{ type: 'text', text: enhancedContent }];

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
            role: msg.role,
            content: content
          });
          continue;
        }
        
        // For cases with only file/Office/other file type references
        if ((hasFiles || hasOffice || hasOthers) && !hasImages) {
          const textContent = MessageHelper.getText(msg);
          const fileParts = MessageHelper.getFiles(msg);
          const officeParts = MessageHelper.getOffice(msg);
          const othersParts = MessageHelper.getOthers(msg);
          
          let enhancedContent = textContent;

          // Process text file references
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

          // Process Office document references
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
          
          // Process other file type references
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
        
        // For cases with only images
        if (hasImages && !hasFiles && !hasOffice && !hasOthers) {
          const textContent = MessageHelper.getText(msg);
          
          const content: Array<{
            type: 'text' | 'image_url';
            text?: string;
            image_url?: {
              url: string;
              detail?: 'low' | 'high';
            };
          }> = [{ type: 'text', text: textContent }];
          
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
            role: msg.role,
            content: content
          });
          continue;
        }
      }
    }
    
    const messageContent = MessageHelper.getText(msg);
    const apiMessage: any = {
      role: msg.role,
      content: messageContent
    };

    if (supportsTools && msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      apiMessage.tool_calls = msg.tool_calls;
    }

    formattedMessages.push(apiMessage);
  }

  return formattedMessages;
}

/**
 * Convert standard Message array to ResponseInputItem array required by /responses endpoint
 */
function convertMessagesToResponseInput(messages: Message[]): ResponseInputItem[] {
  const inputItems: ResponseInputItem[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      // Convert System prompt to message type
      inputItems.push({
        type: 'message',
        role: 'system',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    } else if (msg.role === 'user') {
      // Convert User message to message type
      let content = '';
      if (Array.isArray(msg.content)) {
        // Extract text parts
        content = msg.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('');
          
        // Process image parts - as separate input_image items
        for (const part of msg.content) {
          // Use type assertion to handle potentially different image format definitions
          const p = part as any;
          if (p.type === 'image_url' || p.type === 'image') {
            const url = p.image_url?.url || p.url;
            if (url) {
              inputItems.push({
                type: 'input_image',
                content: url,
                content_type: 'image/jpeg' // Simplified handling
              });
            }
          }
        }
      } else {
        content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      }
      
      inputItems.push({
        type: 'message',
        role: 'user',
        content: content
      });
    } else if (msg.role === 'assistant') {
      // Convert Assistant message to message type
      const item: any = {
        type: 'message',
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : ''
      };
      
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // First add assistant message (if it has content)
        if (item.content) {
          inputItems.push(item);
        }
        
        // Then add function calls
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
      // Convert Tool output to function_call_output
      inputItems.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id || '', // Note: /responses API uses call_id instead of id
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    }
  }
  
  return inputItems;
}

// ====== Image detection methods ======

/**
 * Detect if messages contain image content
 */
export function hasImageContentInMessages(messages: any[]): boolean {
  if (!messages || !Array.isArray(messages)) {
    return false;
  }
  
  for (const message of messages) {
    if (message.content && Array.isArray(message.content)) {
      for (const contentPart of message.content) {
        if (contentPart.type === 'image_url') {
          return true;
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
  const { GhcApiError } = require('../utilities/errors');
  
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
 * Validate tool request
 */
export function validateToolsRequest(tools: any[]): void {
  const { GhcApiError } = require('../utilities/errors');
  
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
 * Determine tool selection mode
 */
export function determineToolChoice(tools: any[], toolMode: string = 'auto'): string | { type: 'function'; function: { name: string } } | undefined {
  const { GhcApiError } = require('../utilities/errors');
  
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