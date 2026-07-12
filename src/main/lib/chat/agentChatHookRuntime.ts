import { MessageHelper, type Message } from '@shared/types/chatTypes';

import { AgentHookManager } from '../agentHooks/agentHookManager';
import type { AgentHookEvent, AgentHookInput, AgentHookRunContext, AggregatedHookResult } from '../agentHooks/types';
import { CancellationError, type CancellationToken } from '../cancellation';
import { createLogger } from '../unifiedLogger';
import { getChatSessionFilePath } from '../userDataADO/pathUtils';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getChatAgents, getChatPrimaryAgent, getChatWorkspace } from '../userDataADO/agentAccessor';
import type { ChatAgent, ChatConfig } from '../userDataADO/types/profile';
import type { AgentChatInteractionPolicy } from './agentChatInteractionPolicy';
import type { QueuedPromptHookOutcome } from './steeringQueueConsumption';
import type { StreamingChunk } from '@shared/types/streamingTypes';

const logger = createLogger();
const MAX_OBSERVATIONAL_HOOK_CONTEXTS = 32;
const MAX_SESSION_HOOK_CONTEXTS = 32;
const MAX_TURN_HOOK_CONTEXTS = 32;
const MAX_HOOK_CONTEXT_CHARS = 4096;

type ToolCallForHooks = { id: string; function: { name: string; arguments: string } };

/** A tool call that a PreToolUse hook flagged with `permissionDecision: ask`. */
export type HookApprovalRequestItem = { toolCallId: string; toolName: string; reason?: string };

interface AgentChatHookRuntimeDeps {
  getCurrentUserAlias(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getAgentName(): string;
  getInteractionPolicy(): AgentChatInteractionPolicy;
  getCurrentCancellationToken(): CancellationToken | undefined;
  setHookAdditionalContexts(contexts: string[]): void;
  setHookSystemMessages(messages: string[]): void;
  addMessageToSession(message: Message): Promise<void>;
  emitStreamingChunk(chunk: StreamingChunk): void;
  setIdle(): void;
  getDisplayMessages(): Message[];
  batchValidateAndRequestApproval(toolCalls: ToolCallForHooks[]): Promise<Map<string, boolean>>;
  requestHookApproval(items: HookApprovalRequestItem[]): Promise<Map<string, boolean>>;
  executeToolCall(toolCall: any, approved?: boolean): Promise<any>;
  postProcessToolResult(toolCall: any, toolResult: any): Promise<any>;
}

export class AgentChatHookRuntime {
  readonly blockedToolCallReasons = new Map<string, string>();
  readonly mutatedToolArgs = new Map<string, string>();
  readonly effectiveToolInput = new Map<string, Record<string, unknown>>();
  readonly hookApprovedToolCallIds = new Set<string>();

  private sessionHookContexts: string[] = [];
  private turnHookContexts: string[] = [];
  private observationalHookContexts: string[] = [];
  private sessionHookSystemMessages: string[] = [];
  private turnHookSystemMessages: string[] = [];
  private observationalHookSystemMessages: string[] = [];
  private sessionStartHookFired = false;
  private pendingSessionStartTrigger: 'new' | 'resume' | null = null;

  constructor(private readonly deps: AgentChatHookRuntimeDeps) {}

  getSessionHookContexts(): string[] {
    return this.sessionHookContexts;
  }

  replaceSessionHookContexts(contexts: string[]): void {
    this.sessionHookContexts = this.trimHookBuffer(contexts, MAX_SESSION_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  getTurnHookContexts(): string[] {
    return this.turnHookContexts;
  }

  replaceTurnHookContexts(contexts: string[]): void {
    this.turnHookContexts = this.trimHookBuffer(contexts, MAX_TURN_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  getObservationalHookContexts(): string[] {
    return this.observationalHookContexts;
  }

  replaceObservationalHookContexts(contexts: string[]): void {
    this.observationalHookContexts = this.trimHookBuffer(contexts, MAX_OBSERVATIONAL_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  getHookAgentSnapshot(): { chatId: string; agentName: string; workspacePath?: string; hookIds: string[] } {
    const chatConfig = profileCacheManager.getChatConfig(this.deps.getCurrentUserAlias(), this.deps.getChatId());
    const agentName = this.deps.getAgentName();
    const agent = this.resolveActiveAgent(chatConfig, agentName);
    const workspace = getChatWorkspace(chatConfig);
    return {
      chatId: this.deps.getChatId(),
      agentName,
      workspacePath: typeof workspace === 'string' && workspace.trim() ? workspace : undefined,
      hookIds: this.normalizeHookIds(agent?.hooks),
    };
  }

  private resolveActiveAgent(chatConfig: ChatConfig | null, agentName: string): ChatAgent | undefined {
    if (!chatConfig) {
      return undefined;
    }
    if (chatConfig.chat_type === 'multi_agent') {
      const matched = getChatAgents(chatConfig).find(agent => agent.name === agentName);
      if (matched) {
        return matched;
      }
    }
    return getChatPrimaryAgent(chatConfig);
  }

  private normalizeHookIds(hooks: unknown): string[] {
    return Array.isArray(hooks)
      ? hooks.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
  }

  buildHookRunContext(signal?: AbortSignal): AgentHookRunContext {
    const snap = this.getHookAgentSnapshot();
    const context: AgentHookRunContext = {
      userAlias: this.deps.getCurrentUserAlias(),
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      agentName: snap.agentName,
      hookIds: snap.hookIds,
    };
    if (snap.workspacePath) context.workspacePath = snap.workspacePath;
    if (signal) context.signal = signal;
    return context;
  }

  hookInputBase(): Pick<
    AgentHookInput,
    | 'session_id'
    | 'user_alias'
    | 'chat_id'
    | 'chat_session_id'
    | 'agent_id'
    | 'agent_name'
    | 'agent_type'
    | 'transcript_path'
    | 'cwd'
    | 'permission_mode'
  > {
    const snap = this.getHookAgentSnapshot();
    const base: Pick<
      AgentHookInput,
      | 'session_id'
      | 'user_alias'
      | 'chat_id'
      | 'chat_session_id'
      | 'agent_id'
      | 'agent_name'
      | 'agent_type'
      | 'transcript_path'
      | 'cwd'
      | 'permission_mode'
    > = {
      session_id: this.deps.getChatSessionId(),
      user_alias: this.deps.getCurrentUserAlias(),
      chat_id: this.deps.getChatId(),
      chat_session_id: this.deps.getChatSessionId(),
      // Deprecated alias of chat_id; carries the chat-scoped id for back-compat.
      agent_id: snap.chatId,
      agent_name: snap.agentName,
      agent_type: snap.agentName,
      permission_mode: this.getHookPermissionMode(),
    };
    const transcriptPath = this.getHookTranscriptPath();
    if (transcriptPath) base.transcript_path = transcriptPath;
    if (snap.workspacePath) base.cwd = snap.workspacePath;
    return base;
  }

  async runAgentHooks(event: AgentHookEvent, input: AgentHookInput, token?: CancellationToken): Promise<AggregatedHookResult> {
    return this.withAbortSignal(token, (signal) =>
      AgentHookManager.getInstance().runHooks(event, input, this.buildHookRunContext(signal)),
    );
  }

  async runSessionStartHook(trigger: 'new' | 'resume', token?: CancellationToken): Promise<AggregatedHookResult> {
    return this.runAgentHooks('SessionStart', {
      ...this.hookInputBase(),
      hook_event_name: 'SessionStart',
      source: trigger === 'new' ? 'startup' : 'resume',
      trigger,
    }, token);
  }

  capturePendingSessionStartTrigger(chatHistoryLength: number): void {
    if (!this.sessionStartHookFired && this.pendingSessionStartTrigger === null) {
      this.pendingSessionStartTrigger = chatHistoryLength > 0 ? 'resume' : 'new';
    }
  }

  clearPendingSessionStartTriggerIfFired(): void {
    if (this.sessionStartHookFired) {
      this.pendingSessionStartTrigger = null;
    }
  }

  isSessionStartHookFired(): boolean {
    return this.sessionStartHookFired;
  }

  getPendingSessionStartTrigger(): 'new' | 'resume' | null {
    return this.pendingSessionStartTrigger;
  }

  async runSessionStartLifecycle(chatHistoryLength: number, token?: CancellationToken): Promise<boolean> {
    this.throwIfSessionStartCancelled(token, 'before SessionStart hook');
    if (this.sessionStartHookFired) {
      return true;
    }

    const trigger = this.pendingSessionStartTrigger ?? (chatHistoryLength > 0 ? 'resume' : 'new');
    this.pendingSessionStartTrigger = trigger;

    this.throwIfSessionStartCancelled(token, 'before Agent SessionStart hook');
    const agentHookResult = await this.runSessionStartHook(trigger, token);
    this.throwIfSessionStartCancelled(token, 'during Agent SessionStart hook');

    if (agentHookResult.blockingError || agentHookResult.preventContinuation) {
      await this.surfaceBlockResult(agentHookResult);
      return false;
    }

    this.applySessionHookResult(agentHookResult);
    this.sessionStartHookFired = true;
    this.pendingSessionStartTrigger = null;
    return true;
  }

  async runUserPromptSubmitHook(prompt: string, token?: CancellationToken): Promise<AggregatedHookResult> {
    return this.runAgentHooks('UserPromptSubmit', {
      ...this.hookInputBase(),
      hook_event_name: 'UserPromptSubmit',
      prompt,
    }, token);
  }

  async runUserPromptSubmitLifecycle(
    prompt: string,
    token?: CancellationToken,
    options?: { idleOnBlock?: boolean },
  ): Promise<Message[] | null> {
    const submitResult = await this.runUserPromptSubmitHook(prompt, token);
    if (submitResult.blockingError || submitResult.preventContinuation) {
      // `idleOnBlock` defaults to true (a block ends the interactive turn). Callers
      // that still have queued-steering prompts to drain after the block pass
      // `{ idleOnBlock: false }` so the session stays SENDING_RESPONSE and the drain
      // keeps its mutex against a concurrent idle pump; those callers idle later.
      return await this.surfaceBlockResult(submitResult, options);
    }
    this.applyHookResultIfActive(submitResult, token);
    return null;
  }

  /**
   * Queued-drain variant of the UserPromptSubmit lifecycle. Runs the hook but does
   * NOT surface a block or apply its context yet — the drain defers both until it
   * has confirmed (at its commit point) that the prompt is still queued, so a prompt
   * the user cancelled during the hook window leaves no stray "blocked" message and
   * leaks no hook context. `surfaceBlock()` persists + emits the block notice
   * WITHOUT idling the session (the drain holds SENDING_RESPONSE across queued
   * prompts, so idling mid-drain would break that mutex).
   */
  async runQueuedUserPromptSubmitHook(prompt: string, token?: CancellationToken): Promise<QueuedPromptHookOutcome> {
    const submitResult = await this.runUserPromptSubmitHook(prompt, token);
    const blocked = !!(submitResult.blockingError || submitResult.preventContinuation);
    return {
      blocked,
      surfaceBlock: () => this.surfaceBlockResult(submitResult, { idleOnBlock: false }),
      applyAllowed: () => this.applyHookResultIfActive(submitResult, token),
    };
  }

  async runStopHook(token?: CancellationToken): Promise<void> {
    const result = await this.runAgentHooks('Stop', {
      ...this.hookInputBase(),
      hook_event_name: 'Stop',
    }, token);
    this.applyObservationalHookResult(result);
  }

  async runCompactionHook(event: 'PreCompact' | 'PostCompact', trigger: 'auto' | 'manual', token?: CancellationToken): Promise<void> {
    await this.runCompactionHookWithSignal(event, trigger, undefined, token);
  }

  async runCompactionHookWithSignal(
    event: 'PreCompact' | 'PostCompact',
    trigger: 'auto' | 'manual',
    signal?: AbortSignal,
    token?: CancellationToken,
  ): Promise<void> {
    await this.withAbortSignal(token, async (effectiveSignal) => {
      const result = await AgentHookManager.getInstance().runHooks(event, {
        ...this.hookInputBase(),
        hook_event_name: event,
        trigger,
      }, this.buildHookRunContext(effectiveSignal));

      if (!effectiveSignal?.aborted) {
        this.applyObservationalHookResult(result);
      }
    }, signal);
  }

  parseToolArgs(args: unknown): Record<string, unknown> {
    if (typeof args !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  async preToolUseAndApprove(toolCalls: ToolCallForHooks[], token?: CancellationToken): Promise<Map<string, boolean>> {
    this.blockedToolCallReasons.clear();
    this.mutatedToolArgs.clear();
    this.effectiveToolInput.clear();
    this.hookApprovedToolCallIds.clear();

    if (!AgentHookManager.getInstance().isEnabled(this.deps.getCurrentUserAlias())) {
      return this.deps.batchValidateAndRequestApproval(toolCalls);
    }

    const hookResults = await Promise.all(toolCalls.map(async (toolCall) => {
      const toolInput = this.parseToolArgs(toolCall.function.arguments);
      this.effectiveToolInput.set(toolCall.id, toolInput);
      const result = await this.runToolHook('PreToolUse', {
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        tool_input: toolInput,
      }, token);
      return { toolCall, toolInput, result };
    }));

    const askApprovalRequests: HookApprovalRequestItem[] = [];
    const askToolCallIds = new Set<string>();

    for (const { toolCall, result } of hookResults) {
      if (result.blockingError || result.preventContinuation) {
        this.blockedToolCallReasons.set(toolCall.id, result.blockingError || result.stopReason || 'Blocked by Agent Hook');
      } else if (result.updatedInput !== undefined) {
        let serialized: string | undefined;
        try {
          serialized = JSON.stringify(result.updatedInput);
        } catch {
          serialized = undefined;
        }
        if (serialized === undefined) {
          this.blockedToolCallReasons.set(toolCall.id, 'Agent Hook returned tool input that could not be serialized');
        } else {
          this.mutatedToolArgs.set(toolCall.id, serialized);
          toolCall.function.arguments = serialized;
          this.effectiveToolInput.set(toolCall.id, result.updatedInput);
        }
      }
      if (!this.blockedToolCallReasons.has(toolCall.id)) {
        if (!this.mutatedToolArgs.has(toolCall.id) && result.approvalDecision === 'allow') {
          this.hookApprovedToolCallIds.add(toolCall.id);
        } else if (result.approvalDecision === 'ask') {
          askToolCallIds.add(toolCall.id);
          askApprovalRequests.push({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            reason: result.approvalDecisionReason,
          });
        }
      }
      this.applyHookResultIfActive(result);
    }

    const hadChanges =
      this.blockedToolCallReasons.size > 0 ||
      this.mutatedToolArgs.size > 0 ||
      this.hookApprovedToolCallIds.size > 0 ||
      askToolCallIds.size > 0;
    const approvalInput = !hadChanges
      ? toolCalls
      : toolCalls
        .filter(tc =>
          !this.blockedToolCallReasons.has(tc.id) &&
          !this.hookApprovedToolCallIds.has(tc.id) &&
          !askToolCallIds.has(tc.id))
        .map(tc => this.mutatedToolArgs.has(tc.id)
          ? { ...tc, function: { ...tc.function, arguments: this.mutatedToolArgs.get(tc.id)! } }
          : tc);

    const approvalMap = approvalInput.length > 0
      ? await this.deps.batchValidateAndRequestApproval(approvalInput)
      : new Map<string, boolean>();

    if (askApprovalRequests.length > 0) {
      const askDecisions = await this.deps.requestHookApproval(askApprovalRequests);
      for (const { toolCallId } of askApprovalRequests) {
        approvalMap.set(toolCallId, askDecisions.get(toolCallId) === true);
      }
    }

    for (const id of this.blockedToolCallReasons.keys()) {
      approvalMap.set(id, false);
    }
    for (const id of this.hookApprovedToolCallIds.keys()) {
      approvalMap.set(id, true);
    }
    return approvalMap;
  }

  async executeToolCallWithHooks(toolCall: any, approved?: boolean, token?: CancellationToken): Promise<any> {
    if (!AgentHookManager.getInstance().isEnabled(this.deps.getCurrentUserAlias())) {
      return this.deps.executeToolCall(toolCall, approved);
    }

    const reason = this.blockedToolCallReasons.get(toolCall.id);
    if (reason) {
      return {
        success: false,
        error: 'Blocked by Agent Hook',
        message: reason,
        tool_call_id: toolCall.id,
        tool_name: toolCall.function?.name,
        denied: true,
        blockedByHook: true,
      };
    }

    const mutated = this.mutatedToolArgs.get(toolCall.id);
    const effectiveCall = mutated
      ? { ...toolCall, function: { ...toolCall.function, arguments: mutated } }
      : toolCall;

    try {
      return await this.deps.executeToolCall(effectiveCall, approved);
    } catch (err) {
      if (err instanceof CancellationError) {
        throw err;
      }
      const failResult = await this.runToolHook('PostToolUseFailure', {
        tool_name: toolCall.function?.name,
        tool_call_id: toolCall.id,
        tool_input: this.effectiveToolInput.get(toolCall.id) ?? {},
        error: err instanceof Error ? err.message : String(err),
        ...this.getFailureFlags(err),
      }, token);
      this.applyHookResultIfActive(failResult);
      throw err;
    }
  }

  async postProcessToolResultWithHooks(toolCall: any, toolResult: any, token?: CancellationToken): Promise<any> {
    if (!AgentHookManager.getInstance().isEnabled(this.deps.getCurrentUserAlias())) {
      return this.deps.postProcessToolResult(toolCall, toolResult);
    }

    if (this.blockedToolCallReasons.has(toolCall.id)) {
      return this.deps.postProcessToolResult(toolCall, toolResult);
    }

    const isErrorResult = typeof toolResult === 'object' && toolResult !== null && (
      toolResult.denied === true ||
      toolResult.truncated === true ||
      toolResult.parseError === true ||
      toolResult.success === false
    );

    if (isErrorResult) {
      const failResult = await this.runToolHook('PostToolUseFailure', {
        tool_name: toolCall.function?.name,
        tool_call_id: toolCall.id,
        tool_input: this.effectiveToolInput.get(toolCall.id) ?? {},
        error: typeof toolResult.error === 'string' ? toolResult.error : 'Tool execution returned a failure result',
        ...this.getFailureFlags(toolResult),
      }, token);
      this.applyHookResultIfActive(failResult);
      return await this.deps.postProcessToolResult(toolCall, toolResult);
    }

    const postResult = await this.runToolHook('PostToolUse', {
      tool_name: toolCall.function?.name,
      tool_call_id: toolCall.id,
      tool_input: this.effectiveToolInput.get(toolCall.id) ?? {},
      tool_output: toolResult,
    }, token);
    this.applyHookResultIfActive(postResult);

    if (postResult.blockingError || postResult.preventContinuation) {
      const reason = postResult.blockingError || postResult.stopReason || 'Blocked by Agent Hook';
      return {
        success: false,
        error: 'Blocked by Agent Hook',
        message: reason,
        tool_call_id: toolCall.id,
        tool_name: toolCall.function?.name,
        denied: true,
        blockedByHook: true,
      };
    }

    let effectiveResult = toolResult;
    if (!this.isTurnCancelled()) {
      if ('updatedToolOutput' in postResult && postResult.updatedToolOutput !== undefined) {
        effectiveResult = postResult.updatedToolOutput;
      } else if ('updatedMCPToolOutput' in postResult && postResult.updatedMCPToolOutput !== undefined) {
        effectiveResult = postResult.updatedMCPToolOutput;
      }
    }

    try {
      return await this.deps.postProcessToolResult(toolCall, effectiveResult);
    } catch (err) {
      if (err instanceof CancellationError) {
        throw err;
      }
      const failResult = await this.runToolHook('PostToolUseFailure', {
        tool_name: toolCall.function?.name,
        tool_call_id: toolCall.id,
        tool_input: this.effectiveToolInput.get(toolCall.id) ?? {},
        error: err instanceof Error ? err.message : String(err),
        ...this.getFailureFlags(err),
      }, token);
      this.applyHookResultIfActive(failResult);
      throw err;
    }
  }

  addSessionHookContexts(contexts: string[]): void {
    if (!contexts || contexts.length === 0) {
      return;
    }
    this.sessionHookContexts = this.trimHookBuffer([...this.sessionHookContexts, ...contexts], MAX_SESSION_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  applySessionHookResult(result: AggregatedHookResult): void {
    this.addSessionHookContexts(result.additionalContexts ?? []);
    this.addSessionHookSystemMessages(result.systemMessages ?? []);
  }

  applyHookResultIfActive(result: AggregatedHookResult, token?: CancellationToken): void {
    if (this.isTurnCancelled(token)) {
      return;
    }
    this.addTurnHookContexts(result.additionalContexts ?? []);
    this.addTurnHookSystemMessages(result.systemMessages ?? []);
  }

  clearTurnHookBuffers(): void {
    if (this.turnHookContexts.length === 0 && this.turnHookSystemMessages.length === 0) {
      return;
    }
    this.turnHookContexts = [];
    this.turnHookSystemMessages = [];
    this.syncHookBuffersToPrompt();
  }

  private async runToolHook(
    event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure',
    payload: {
      tool_name: string;
      tool_call_id: string;
      tool_input: Record<string, unknown>;
      tool_output?: unknown;
      error?: string;
      is_interrupt?: boolean;
      is_timeout?: boolean;
    },
    token?: CancellationToken,
  ): Promise<AggregatedHookResult> {
    const aliasedPayload = {
      ...payload,
      tool_use_id: payload.tool_call_id,
      ...('tool_output' in payload ? { tool_response: payload.tool_output } : {}),
    };
    const input = { ...this.hookInputBase(), hook_event_name: event, ...aliasedPayload } as AgentHookInput;
    return this.runAgentHooks(event, input, token);
  }

  private getFailureFlags(value: unknown): { is_interrupt: boolean; is_timeout: boolean } {
    const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    const message = value instanceof Error
      ? `${value.name} ${value.message}`
      : typeof value === 'string'
        ? value
        : typeof record.error === 'string'
          ? record.error
          : typeof record.message === 'string'
            ? record.message
            : '';
    return {
      is_interrupt: record.is_interrupt === true ||
        record.interrupted === true ||
        record.cancelled === true ||
        record.canceled === true ||
        /\b(interrupted|cancelled|canceled|aborted)\b/i.test(message),
      is_timeout: record.is_timeout === true ||
        record.timedOut === true ||
        record.timeout === true ||
        /\b(time(?:d)?\s*out|timeout)\b/i.test(message),
    };
  }

  private applyObservationalHookResult(result: AggregatedHookResult): void {
    this.addObservationalHookContexts(result.additionalContexts ?? []);
    this.addObservationalHookSystemMessages(result.systemMessages ?? []);
  }

  private getHookTranscriptPath(): string | undefined {
    try {
      return getChatSessionFilePath(this.deps.getCurrentUserAlias(), this.deps.getChatId(), this.deps.getChatSessionId());
    } catch (err) {
      logger.warn('[AgentChat] Unable to derive Agent Hook transcript_path', 'hookInputBase', {
        chatId: this.deps.getChatId(),
        chatSessionId: this.deps.getChatSessionId(),
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  private getHookPermissionMode(): AgentHookInput['permission_mode'] {
    return this.deps.getInteractionPolicy() === 'allow-ui' ? 'default' : 'dontAsk';
  }

  private isTurnCancelled(token?: CancellationToken): boolean {
    return (token ?? this.deps.getCurrentCancellationToken())?.isCancellationRequested === true;
  }

  private addTurnHookContexts(contexts: string[]): void {
    if (contexts.length === 0) {
      return;
    }
    this.turnHookContexts = this.trimHookBuffer([...this.turnHookContexts, ...contexts], MAX_TURN_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  private addTurnHookSystemMessages(messages: string[]): void {
    if (messages.length === 0) {
      return;
    }
    this.turnHookSystemMessages = this.trimHookBuffer([...this.turnHookSystemMessages, ...messages], MAX_TURN_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  private addSessionHookSystemMessages(messages: string[]): void {
    if (messages.length === 0) {
      return;
    }
    this.sessionHookSystemMessages = this.trimHookBuffer([...this.sessionHookSystemMessages, ...messages], MAX_SESSION_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  private addObservationalHookContexts(contexts: string[]): void {
    if (contexts.length === 0) {
      return;
    }
    this.observationalHookContexts = this.trimHookBuffer([...this.observationalHookContexts, ...contexts], MAX_OBSERVATIONAL_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  private addObservationalHookSystemMessages(messages: string[]): void {
    if (messages.length === 0) {
      return;
    }
    this.observationalHookSystemMessages = this.trimHookBuffer([...this.observationalHookSystemMessages, ...messages], MAX_OBSERVATIONAL_HOOK_CONTEXTS);
    this.syncHookBuffersToPrompt();
  }

  private trimHookBuffer(values: string[], maxCount: number): string[] {
    return values
      .filter(value => typeof value === 'string' && value.length > 0)
      .map(value => value.length > MAX_HOOK_CONTEXT_CHARS ? value.slice(0, MAX_HOOK_CONTEXT_CHARS) : value)
      .slice(-maxCount);
  }

  private syncHookBuffersToPrompt(): void {
    this.deps.setHookAdditionalContexts([
      ...this.sessionHookContexts,
      ...this.observationalHookContexts,
      ...this.turnHookContexts,
    ]);
    this.deps.setHookSystemMessages([
      ...this.sessionHookSystemMessages,
      ...this.observationalHookSystemMessages,
      ...this.turnHookSystemMessages,
    ]);
  }

  private throwIfSessionStartCancelled(token: CancellationToken | undefined, stage: string): void {
    if (token?.isCancellationRequested) {
      throw new CancellationError(`Operation cancelled ${stage}`);
    }
  }

  private async surfaceBlockResult(
    result: AggregatedHookResult,
    options?: { idleOnBlock?: boolean },
  ): Promise<Message[]> {
    return await surfaceUserPromptBlockResult({
      result,
      agentName: this.deps.getAgentName(),
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      addMessageToSession: (message) => this.deps.addMessageToSession(message),
      emitStreamingChunk: (chunk) => this.deps.emitStreamingChunk(chunk),
      // Omit setIdle for the queued drain (idleOnBlock === false): the drain holds
      // SENDING_RESPONSE across queued prompts, so idling on a block would break the
      // mutex and let a concurrent send/steer interleave mid-drain.
      setIdle: options?.idleOnBlock === false ? undefined : () => this.deps.setIdle(),
      getDisplayMessages: () => this.deps.getDisplayMessages(),
    });
  }

  private async withAbortSignal<T>(
    token: CancellationToken | undefined,
    fn: (signal?: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    if (!token && !parentSignal) {
      return fn(undefined);
    }
    const controller = new AbortController();
    if (token?.isCancellationRequested || parentSignal?.aborted) {
      controller.abort();
      return fn(controller.signal);
    }
    // Keep the listener for the token lifetime. Hook execution can intentionally
    // dispatch async fire-and-forget actions; disposing as soon as runHooks()
    // returns would orphan those actions from later turn cancellation.
    if (parentSignal) {
      parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    token?.onCancellationRequested(() => controller.abort());
    return await fn(controller.signal);
  }
}

export function getUserPromptBlockReason(result: AggregatedHookResult): string {
  return result.blockingError || result.stopReason || 'Your message was blocked by an Agent Hook.';
}

export async function surfaceUserPromptBlockResult(deps: {
  result: AggregatedHookResult;
  agentName: string;
  chatId: string;
  chatSessionId: string;
  addMessageToSession(message: Message): Promise<void>;
  emitStreamingChunk(chunk: StreamingChunk): void;
  /**
   * Return the session to idle after surfacing the block. Omit it (queued drain) to
   * keep the session busy: the drain holds SENDING_RESPONSE across queued prompts,
   * so idling on a block would break that mutex and let a concurrent turn interleave.
   */
  setIdle?: () => void;
  getDisplayMessages(): Message[];
}): Promise<Message[]> {
  const reason = getUserPromptBlockReason(deps.result);
  logger.info('[AgentChat] UserPromptSubmit hook blocked the prompt', 'streamMessage', {
    agentName: deps.agentName,
    chatSessionId: deps.chatSessionId,
  });
  const assistantMessage = MessageHelper.createTextMessage(reason, 'assistant');
  await deps.addMessageToSession(assistantMessage);
  deps.emitStreamingChunk({
    chunkId: `${assistantMessage.id}_block`,
    messageId: assistantMessage.id,
    chatId: deps.chatId,
    chatSessionId: deps.chatSessionId,
    timestamp: Date.now(),
    type: 'content',
    contentDelta: { text: reason },
  });
  deps.emitStreamingChunk({
    chunkId: `${assistantMessage.id}_complete`,
    messageId: assistantMessage.id,
    chatId: deps.chatId,
    chatSessionId: deps.chatSessionId,
    timestamp: Date.now(),
    type: 'complete',
    complete: { messageId: assistantMessage.id, hasToolCalls: false },
  });
  deps.setIdle?.();
  return deps.getDisplayMessages();
}
