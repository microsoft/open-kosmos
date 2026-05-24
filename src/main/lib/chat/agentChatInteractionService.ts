import {
  ApprovalInteractionRequest,
  ChoiceInteractionOption,
  ChoiceInteractionRequest,
  FormInteractionField,
  FormInteractionRequest,
  InteractionHistoryEntry,
  InteractiveRequest,
  InteractiveResponse,
} from '@shared/types/interactiveRequestTypes';
import { createLogger } from '../unifiedLogger';
import { interactiveRequestManager } from './interactiveRequestManager';
import type { ApprovalRequestItem } from '../security/securityValidator';
import type { ChatSessionFile } from '../userDataADO/chatSessionFileOps';
import {
  type AgentChatInteractionPolicy,
  type BlockedInteractionDetails,
  createBlockedInteractionMessage,
  NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED,
  NonInteractiveRuntimeInteractionError,
} from './agentChatInteractionPolicy';

const logger = createLogger();

type UserInfoInputRequest = {
  fields: Array<{
    key: string;
    label: string;
    type: string;
    control: string;
    varName: string;
    required: boolean;
    defaultValue?: string;
  }>;
  header: { title: string };
  body: { description: string };
};

export interface AgentChatInteractionServiceDeps {
  getChatId(): string;
  getChatSessionId(): string;
  getAgentName(): string;
  getEventSender(): Electron.WebContents | null;
  getCurrentChatSession(): ChatSessionFile | null;
  saveChatSession(): Promise<{ success: boolean; error?: string }>;
  safeEmitEvent(eventName: string, data: any): void;
  getPendingInteractiveRequest(): InteractiveRequest | null;
  setPendingInteractiveRequest(request: InteractiveRequest | null): void;
  getInteractionPolicy(): AgentChatInteractionPolicy;
  reportBlockedInteraction(details: BlockedInteractionDetails): void;
}

export class AgentChatInteractionService {
  constructor(private readonly deps: AgentChatInteractionServiceDeps) {}

  private assertInteractionAllowed(requestType: 'approval' | 'choice' | 'form', title?: string): void {
    const policy = this.deps.getInteractionPolicy();
    if (policy !== 'forbid') {
      return;
    }

    const details: BlockedInteractionDetails = {
      code: NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED,
      policy,
      requestType,
      title,
      message: createBlockedInteractionMessage(policy),
    };
    this.deps.reportBlockedInteraction(details);

    logger.warn('[AgentChat] Interactive request blocked by runtime policy', 'assertInteractionAllowed', {
      chatSessionId: this.deps.getChatSessionId(),
      agentName: this.deps.getAgentName(),
      requestType,
      policy,
      title,
    });

    throw new NonInteractiveRuntimeInteractionError(details);
  }

  buildInteractionId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  buildInteractionHistoryEntry(
    request: InteractiveRequest,
    response: InteractiveResponse,
  ): InteractionHistoryEntry {
    let status: InteractionHistoryEntry['status'];
    if (response.action === 'expire') {
      status = 'expired';
    } else if (response.action === 'skip') {
      status = 'skipped';
    } else if (response.requestType === 'approval' && response.action === 'reject') {
      status = 'rejected';
    } else {
      status = 'resolved';
    }

    return {
      interactionId: request.interactionId,
      requestType: request.requestType,
      title: request.title,
      description: request.description,
      source: request.source,
      resolutionSource: response.resolutionSource,
      createdAt: request.createdAt,
      resolvedAt: Date.now(),
      status,
      summaryText: this.buildInteractionSummary(request, response),
    };
  }

  buildInteractionSummary(request: InteractiveRequest, response: InteractiveResponse): string {
    if (response.action === 'expire') {
      return 'Interaction expired before the user responded.';
    }

    if (response.resolutionSource === 'chat-cancelled') {
      return 'The chat was cancelled while waiting for user input.';
    }

    if (response.resolutionSource === 'system-fallback') {
      if (request.requestType === 'choice') {
        return 'The selection request could not be delivered to an active UI receiver, so the system returned a fallback result.';
      }

      if (request.requestType === 'form') {
        return 'The form request could not be delivered to an active UI receiver, so the system returned a fallback result.';
      }
    }

    if (request.requestType === 'approval') {
      const total = request.items.length;
      const approvedCount = response.approvalItemDecisions?.filter((item) => item.approved).length || 0;
      const rejectedCount = total - approvedCount;
      if (approvedCount === total) {
        return `Approved ${approvedCount} tool request${approvedCount === 1 ? '' : 's'}.`;
      }
      if (rejectedCount === total) {
        return `Rejected ${rejectedCount} tool request${rejectedCount === 1 ? '' : 's'}.`;
      }
      return `Approved ${approvedCount} and rejected ${rejectedCount} tool request${total === 1 ? '' : 's'}.`;
    }

    if (request.requestType === 'choice') {
      if (response.action === 'skip') {
        return 'Skipped the selection request.';
      }

      const selectedValues = response.selectedValues || [];
      return selectedValues.length > 0
        ? `Selected: ${selectedValues.join(', ')}`
        : 'Submitted the selection request without any selected value.';
    }

    if (response.action === 'skip') {
      return 'Skipped the form request.';
    }

    const keys = Object.keys(response.formValues || {});
    return keys.length > 0
      ? `Submitted form: ${keys.join(', ')}`
      : 'Submitted the form request.';
  }

  async finalizeInteractiveRequest(
    request: InteractiveRequest,
    response: InteractiveResponse,
  ): Promise<InteractiveResponse> {
    const historyEntry = this.buildInteractionHistoryEntry(request, response);

    this.deps.setPendingInteractiveRequest(null);

    const currentChatSession = this.deps.getCurrentChatSession();
    if (currentChatSession) {
      currentChatSession.interaction_history = currentChatSession.interaction_history || [];
      currentChatSession.interaction_history.push(historyEntry);
      await this.deps.saveChatSession();
    }

    this.deps.safeEmitEvent('agentChat:interactionProcessed', {
      interactionId: request.interactionId,
      status: historyEntry.status,
      summaryText: historyEntry.summaryText,
      historyEntry,
    });

    return response;
  }

  async requestUserInteraction(
    request: InteractiveRequest,
    fallbackResponse: InteractiveResponse,
  ): Promise<InteractiveResponse> {
    this.assertInteractionAllowed(request.requestType, request.title);

    logger.info('[AgentChat] Starting unified interactive request', 'requestUserInteraction', {
      interactionId: request.interactionId,
      requestType: request.requestType,
      chatSessionId: this.deps.getChatSessionId(),
      agentName: this.deps.getAgentName(),
    });

    if (!this.deps.getEventSender()) {
      logger.warn('[AgentChat] No event sender available, using fallback interaction response', 'requestUserInteraction', {
        interactionId: request.interactionId,
        requestType: request.requestType,
        agentName: this.deps.getAgentName(),
      });
      return this.finalizeInteractiveRequest(request, {
        ...fallbackResponse,
        resolutionSource: 'system-fallback',
      });
    }

    this.deps.setPendingInteractiveRequest(request);
    this.deps.safeEmitEvent('agentChat:interactionRequest', request);

    try {
      const response = await interactiveRequestManager.createPendingRequest(request);
      return this.finalizeInteractiveRequest(request, response);
    } catch (error) {
      this.deps.setPendingInteractiveRequest(null);
      interactiveRequestManager.clearSession(this.deps.getChatSessionId());
      throw error;
    }
  }

  async requestApprovalInteraction(requests: ApprovalRequestItem[]): Promise<Map<string, boolean>> {
    const interactionId = this.buildInteractionId('approval');
    const request: ApprovalInteractionRequest = {
      interactionId,
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      description: 'The assistant needs your approval before continuing with tools that access paths outside the workspace.',
      createdAt: Date.now(),
      source: 'tool',
      items: requests.map((item) => ({
        itemId: item.toolCallId,
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        message: `Tool "${item.toolName}" needs approval to access ${item.paths.length} path${item.paths.length > 1 ? 's' : ''} outside the workspace.`,
        paths: item.paths,
      })),
    };

    const fallbackResponse: InteractiveResponse = {
      interactionId,
      chatSessionId: this.deps.getChatSessionId(),
      requestType: 'approval',
      action: 'reject',
      approvalItemDecisions: request.items.map((item) => ({ itemId: item.itemId, approved: false })),
    };

    const response = await this.requestUserInteraction(request, fallbackResponse);
    const decisionMap = new Map<string, boolean>();
    for (const item of request.items) {
      const decision = response.approvalItemDecisions?.find((entry) => entry.itemId === item.itemId);
      decisionMap.set(item.toolCallId || item.itemId, decision?.approved === true);
    }
    return decisionMap;
  }

  async batchValidateAndRequestApproval(
    toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
  ): Promise<Map<string, boolean>> {
    logger.info('[AgentChat] Bypassing batch validation and approval request', 'batchValidateAndRequestApproval', {
      toolCallsCount: toolCalls.length,
      agentName: this.deps.getAgentName(),
    });
    const approvalMap = new Map<string, boolean>();
    for (const toolCall of toolCalls) {
      approvalMap.set(toolCall.id, true);
    }
    return approvalMap;
  }

  async requestUserInfoInput(request: UserInfoInputRequest): Promise<Record<string, any> | null> {
    this.assertInteractionAllowed('form', request.header.title);

    const interactionId = this.buildInteractionId('form');
    const formRequest: FormInteractionRequest = {
      interactionId,
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      requestType: 'form',
      status: 'pending',
      title: request.header.title,
      description: request.body.description,
      createdAt: Date.now(),
      source: 'assistant',
      fields: request.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type as 'string' | 'int' | 'double' | 'boolean',
        control: field.control as FormInteractionField['control'],
        varName: field.varName,
        required: field.required,
        defaultValue: field.defaultValue,
      })),
    };

    const response = await this.requestUserInteraction(formRequest, {
      interactionId,
      chatSessionId: this.deps.getChatSessionId(),
      requestType: 'form',
      action: 'skip',
    });

    if (response.action === 'submit') {
      return (response.formValues || {}) as Record<string, any>;
    }

    return null;
  }

  async requestUserChoice(
    title: string,
    description: string,
    options: ChoiceInteractionOption[],
    mode: 'single' | 'multi',
  ): Promise<string[] | null> {
    const interactionId = this.buildInteractionId('choice');
    const choiceRequest: ChoiceInteractionRequest = {
      interactionId,
      chatId: this.deps.getChatId(),
      chatSessionId: this.deps.getChatSessionId(),
      requestType: 'choice',
      status: 'pending',
      title,
      description,
      createdAt: Date.now(),
      source: 'assistant',
      mode,
      options,
      minSelections: mode === 'single' ? 1 : 0,
      maxSelections: mode === 'single' ? 1 : undefined,
    };

    const response = await this.requestUserInteraction(choiceRequest, {
      interactionId,
      chatSessionId: this.deps.getChatSessionId(),
      requestType: 'choice',
      action: 'skip',
    });

    if (response.action === 'submit') {
      return response.selectedValues || [];
    }

    return null;
  }
}