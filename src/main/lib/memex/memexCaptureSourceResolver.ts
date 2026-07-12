import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { MessageHelper, type Message } from '@shared/types/chatTypes';
import { extractMonthFromChatSessionIdValue } from '@shared/utils/idFormats';
import type { ChatSessionFile } from '../userDataADO/chatSessionFileOps';

export const MEMEX_CAPTURE_SOURCE_TYPES = ['chat-session', 'knowledge-file', 'session-deliverable'] as const;
export type MemexCaptureSourceType = (typeof MEMEX_CAPTURE_SOURCE_TYPES)[number];

export interface MemexCaptureSourceContext {
  userAlias: string;
  chatId: string;
  chatSessionId?: string;
  isSubAgent?: boolean;
  chatSessionFilePath?: string;
  chatSessionFilesPath?: string;
  chatHistory?: ChatSessionFile['chat_history'];
  currentUserMessageId?: string;
  ensureChatSessionSaved?: () => Promise<{ success: boolean; error?: string } | void>;
  abortSignal?: AbortSignal;
  reportActivity?: () => void;
  skipPersistence?: boolean;
  knowledgeBasePath?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
}

export interface ResolveCaptureSourceInput {
  scope: 'current-agent' | 'profile-memory';
  category: string;
  source_type?: string;
  source?: string;
  source_anchor?: string;
  profile_intent_quote?: string;
}

export interface ResolvedMemexCaptureSource {
  sourceType: MemexCaptureSourceType;
  sourcePath: string;
  sourceAnchor?: string;
  sourceRelpath?: string;
  sourceChatId?: string;
  sourceChatSessionId?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  userMessageText?: string;
}

export async function resolveMemexCaptureSource(
  input: ResolveCaptureSourceInput,
  ctx: MemexCaptureSourceContext,
): Promise<ResolvedMemexCaptureSource> {
  if (ctx.isSubAgent) {
    throw new Error('Sub-agents may read memory but cannot capture memory.');
  }

  const sourceType = normalizeSourceType(input.source_type);
  if (input.scope === 'profile-memory' && sourceType !== 'chat-session') {
    throw new Error('profile-memory capture only supports chat-session evidence in V1.');
  }

  if (sourceType === 'chat-session') {
    return resolveChatSessionSource(input, ctx);
  }

  if (input.source_anchor?.trim()) {
    throw new Error('source_anchor is only supported for chat-session capture in V1.');
  }

  if (sourceType === 'knowledge-file') {
    if (input.scope !== 'current-agent') {
      throw new Error('knowledge-file capture is only supported for current-agent memory.');
    }
    return resolveFileSource({
      rawSource: input.source,
      allowedRoot: ctx.knowledgeBasePath,
      prefix: '@knowledge-base:',
      missingRootError: 'The current agent does not have a configured knowledge base path.',
      missingSourceError: 'knowledge-file capture requires source.',
      sourceType,
      ctx,
    });
  }

  return resolveFileSource({
    rawSource: input.source,
    allowedRoot: ctx.chatSessionFilesPath,
    prefix: '@chat-session:',
    missingRootError: 'The current chat session deliverables directory is unavailable.',
    missingSourceError: 'session-deliverable capture requires source.',
    sourceType,
    ctx,
  });
}

function normalizeSourceType(raw: string | undefined): MemexCaptureSourceType {
  const trimmed = raw?.trim();
  if (!trimmed || !(MEMEX_CAPTURE_SOURCE_TYPES as readonly string[]).includes(trimmed)) {
    throw new Error(`capture requires source_type: ${MEMEX_CAPTURE_SOURCE_TYPES.join(', ')}.`);
  }
  return trimmed as MemexCaptureSourceType;
}

async function resolveChatSessionSource(
  input: ResolveCaptureSourceInput,
  ctx: MemexCaptureSourceContext,
): Promise<ResolvedMemexCaptureSource> {
  if (ctx.skipPersistence) {
    throw new Error('chat-session capture is unavailable when chat persistence is disabled.');
  }
  if (!ctx.chatSessionFilePath || !ctx.chatSessionId) {
    throw new Error('chat-session capture requires a persisted chat session path.');
  }
  if (input.source?.trim()) {
    throw new Error('chat-session capture uses the current chat session; omit source.');
  }
  const requestedAnchor = input.source_anchor?.trim();
  if (requestedAnchor && requestedAnchor !== 'message:user:latest') {
    throw new Error('chat-session capture only accepts source_anchor "message:user:latest" in V1.');
  }
  if (!ctx.currentUserMessageId) {
    throw new Error('No current persisted user message is available; cite a knowledge file or session deliverable instead.');
  }

  ctx.abortSignal?.throwIfAborted();
  const saveResult = await ctx.ensureChatSessionSaved?.();
  if (saveResult && saveResult.success === false) {
    throw new Error(saveResult.error || 'Failed to save chat session before capture.');
  }
  ctx.reportActivity?.();
  ctx.abortSignal?.throwIfAborted();

  const sourcePath = await canonicalRegularFile(ctx.chatSessionFilePath);
  const raw = await fs.readFile(sourcePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ChatSessionFile>;
  const messages = Array.isArray(parsed.chat_history) ? parsed.chat_history : [];
  const anchored = messages.find((message) => message.id === ctx.currentUserMessageId && message.role === 'user');
  if (!anchored) {
    throw new Error('The persisted chat session no longer contains the current user message anchor.');
  }

  const userMessageText = MessageHelper.getText(anchored as Message);
  validateProfileMemoryGate(input, userMessageText);

  return {
    sourceType: 'chat-session',
    sourcePath,
    sourceAnchor: `message:user:${ctx.currentUserMessageId}`,
    sourceRelpath: buildChatSessionSourceRelpath(ctx.chatId, ctx.chatSessionId),
    sourceChatId: ctx.chatId,
    sourceChatSessionId: ctx.chatSessionId,
    sourceAgentId: ctx.sourceAgentId,
    sourceAgentName: ctx.sourceAgentName,
    userMessageText,
  };
}

function buildChatSessionSourceRelpath(chatId: string, chatSessionId: string | undefined): string | undefined {
  if (!chatSessionId) {
    return undefined;
  }
  const month = extractMonthFromChatSessionIdValue(chatSessionId);
  return month
    ? `${chatId}/${month}/${chatSessionId}.json`
    : `${chatId}/${chatSessionId}.json`;
}

function validateProfileMemoryGate(input: ResolveCaptureSourceInput, userMessageText: string): void {
  if (input.scope !== 'profile-memory') {
    return;
  }
  if (!['preference', 'constraint', 'correction'].includes(input.category)) {
    throw new Error('profile-memory capture only accepts preference, constraint, or correction categories.');
  }
  const quote = input.profile_intent_quote?.trim();
  if (!quote) {
    throw new Error('profile-memory capture requires profile_intent_quote.');
  }
  if (!userMessageText.includes(quote)) {
    throw new Error('profile_intent_quote must appear in the anchored user message.');
  }
}

async function resolveFileSource(options: {
  rawSource?: string;
  allowedRoot?: string;
  prefix: string;
  missingRootError: string;
  missingSourceError: string;
  sourceType: 'knowledge-file' | 'session-deliverable';
  ctx: MemexCaptureSourceContext;
}): Promise<ResolvedMemexCaptureSource> {
  const raw = options.rawSource?.trim();
  if (!raw) {
    throw new Error(options.missingSourceError);
  }
  const root = options.allowedRoot?.trim();
  if (!root) {
    throw new Error(options.missingRootError);
  }
  if (!path.isAbsolute(root)) {
    throw new Error(options.missingRootError);
  }

  const rootReal = await canonicalDirectory(root);
  const candidate = raw.startsWith(options.prefix)
    ? path.join(rootReal, raw.slice(options.prefix.length))
    : raw;
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${options.sourceType} source must be an absolute path or ${options.prefix}{relative_path}.`);
  }

  const sourcePath = await canonicalRegularFile(candidate);
  assertPathInside(sourcePath, rootReal, `${options.sourceType} source must stay under its configured root.`);

  return {
    sourceType: options.sourceType,
    sourcePath,
    sourceRelpath: path.relative(rootReal, sourcePath).split(path.sep).join('/'),
    sourceChatId: options.ctx.chatId,
    sourceChatSessionId: options.ctx.chatSessionId,
    sourceAgentId: options.ctx.sourceAgentId,
    sourceAgentName: options.ctx.sourceAgentName,
  };
}

async function canonicalDirectory(root: string): Promise<string> {
  const real = await fs.realpath(root);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new Error(`Allowed source root is not a directory: ${root}`);
  }
  return real;
}

async function canonicalRegularFile(filePath: string): Promise<string> {
  const real = await fs.realpath(filePath);
  const stat = await fs.stat(real);
  if (!stat.isFile()) {
    throw new Error(`Capture source is not a regular file: ${filePath}`);
  }
  return real;
}

function assertPathInside(candidate: string, root: string, message: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return;
  }
  throw new Error(message);
}
