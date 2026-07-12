import * as path from 'path';

import { MemexMemoryTool, type MemexMemoryToolArgs, type MemexToolContext, type MemexToolResult } from './memexMemoryTool';
import type { ToolExecutionContext } from '../../subAgent/types';
import { profileCacheManager } from '../../userDataADO';
import { agentIdOf, getChatPrimaryAgent, getChatWorkspace } from '../../userDataADO/agentAccessor';
import { extractMonthFromChatSessionId, getChatSessionFilePath } from '../../userDataADO/pathUtils';
import type { ChatConfig } from '../../userDataADO/types/profile';
import type { MemexCaptureSourceContext } from '../../memex/memexCaptureSourceResolver';

export async function executeMemexMemoryTool(
  args: MemexMemoryToolArgs,
  context: ToolExecutionContext | undefined,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError: boolean }> {
  const memexAlias = context?.userAlias ?? profileCacheManager.getCurrentUserAlias();
  if (!memexAlias || !profileCacheManager.getMemexSettings(memexAlias).enabled) {
    return toToolResult({
      success: false,
      operation: 'memex_memory',
      error: 'memex_memory tool is disabled (enable it in Settings -> Memex Memory)',
    });
  }

  if (!context) {
    return toToolResult({
      success: false,
      operation: 'memex_memory',
      error: 'No execution context available; cannot resolve this agent\'s memory.',
    });
  }

  const requestedScope = typeof args.scope === 'string' ? args.scope.trim() : undefined;
  const shouldResolveAgent = !requestedScope || requestedScope === 'current-agent';
  const isCapture = typeof args.operation === 'string' && args.operation.trim() === 'capture';
  const chatConfig = profileCacheManager.getChatConfig(context.userAlias, context.chatId);
  const primaryAgent = getChatPrimaryAgent(chatConfig);

  if (!shouldResolveAgent) {
    return toToolResult(await executeMemex(args, context, {
      signal,
      primaryAgent,
      chatConfig,
    }));
  }

  if (!primaryAgent) {
    return toToolResult({
      success: false,
      operation: 'memex_memory',
      error: 'No primary agent is bound to this chat; cannot resolve memory.',
    });
  }

  const agentId = agentIdOf(primaryAgent);
  const agentName = primaryAgent?.name;
  return toToolResult(await executeMemex(args, context, {
    signal,
    primaryAgent,
    chatConfig,
    agentId,
    agentName,
    includeSourceAgent: isCapture,
  }));
}

async function executeMemex(
  args: MemexMemoryToolArgs,
  context: ToolExecutionContext,
  options: {
    signal?: AbortSignal;
    primaryAgent?: ReturnType<typeof getChatPrimaryAgent>;
    chatConfig: ChatConfig | null;
    agentId?: string;
    agentName?: string;
    includeSourceAgent?: boolean;
  },
): Promise<MemexToolResult> {
  const isCapture = typeof args.operation === 'string' && args.operation.trim() === 'capture';
  const toolContext: MemexToolContext = {
    userAlias: context.userAlias,
    agentId: options.agentId,
    chatId: context.chatId,
    isSubAgent: context.isSubAgent,
    agentName: options.agentName,
    captureContext: isCapture ? buildCaptureContext(context, options) : undefined,
  };
  return isCapture
    ? MemexMemoryTool.executeDetailed(args, toolContext)
    : MemexMemoryTool.execute(args, toolContext);
}

function buildCaptureContext(
  context: ToolExecutionContext,
  options: {
    signal?: AbortSignal;
    primaryAgent?: ReturnType<typeof getChatPrimaryAgent>;
    chatConfig: ChatConfig | null;
    agentId?: string;
    agentName?: string;
    includeSourceAgent?: boolean;
  },
): MemexCaptureSourceContext {
  return {
    userAlias: context.userAlias,
    chatId: context.chatId,
    chatSessionId: context.chatSessionId,
    isSubAgent: context.isSubAgent,
    chatSessionFilePath: buildChatSessionFilePath(context.userAlias, context.chatId, context.chatSessionId),
    chatSessionFilesPath: buildChatSessionFilesPath(options.chatConfig, context.chatSessionId),
    chatHistory: context.chatHistory,
    currentUserMessageId: context.currentUserMessageId,
    ensureChatSessionSaved: context.ensureChatSessionSaved,
    abortSignal: options.signal,
    reportActivity: context.reportActivity,
    skipPersistence: context.skipPersistence,
    knowledgeBasePath: options.primaryAgent?.knowledge?.knowledgeBase ?? options.primaryAgent?.knowledgeBase,
    sourceAgentId: options.includeSourceAgent ? options.agentId : undefined,
    sourceAgentName: options.includeSourceAgent ? options.agentName : undefined,
  };
}

function buildChatSessionFilePath(
  userAlias: string,
  chatId: string,
  chatSessionId: string | undefined,
): string | undefined {
  return chatSessionId ? getChatSessionFilePath(userAlias, chatId, chatSessionId) : undefined;
}

function buildChatSessionFilesPath(chatConfig: ChatConfig | null, chatSessionId: string | undefined): string | undefined {
  if (!chatSessionId) {
    return undefined;
  }
  const workspace = getChatWorkspace(chatConfig);
  const yearMonth = extractMonthFromChatSessionId(chatSessionId);
  if (!workspace || !yearMonth) {
    return undefined;
  }
  return path.join(workspace, yearMonth, chatSessionId);
}

function toToolResult(memexResult: MemexToolResult): { content: Array<{ type: 'text'; text: string }>; isError: boolean } {
  const errorText = memexResult.hint
    ? `${memexResult.error}\n${memexResult.hint}`
    : (memexResult.error ?? 'Unknown error');
  return {
    content: [{ type: 'text', text: memexResult.success ? (memexResult.output ?? '') : errorText }],
    isError: !memexResult.success,
  };
}
