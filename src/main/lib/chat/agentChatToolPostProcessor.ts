import type { RequestInteractiveInputArgs, RequestInteractiveInputToolResult } from '@shared/types/requestInteractiveInputTypes';
import type { ChoiceInteractionRequest, FormInteractionRequest, InteractiveResponse } from '@shared/types/interactiveRequestTypes';
import { createLogger } from '../unifiedLogger';
import { mainAuthManager } from '../auth/authManager';
import { containsOpenKosmosPlaceholder, openkosmosPlaceholderManager } from '../userDataADO/openkosmosPlaceholders';
import { userInputPlaceholderParser, UserInputField } from '../userDataADO/userInputPlaceholderParser';
import {
  isNonInteractiveRuntimeInteractionError,
  type AgentChatInteractionPolicy,
} from './agentChatInteractionPolicy';

const logger = createLogger();

export interface AgentChatToolPostProcessorDeps {
  getAgentName(): string;
  getChatId(): string;
  getChatSessionId(): string;
  isRemoteSession(): boolean;
  getInteractionPolicy(): AgentChatInteractionPolicy;
  buildInteractionId(prefix: string): string;
  requestUserInteraction(request: ChoiceInteractionRequest | FormInteractionRequest, fallbackResponse: InteractiveResponse): Promise<InteractiveResponse>;
  requestUserInfoInput(request: {
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
  }): Promise<Record<string, any> | null>;
}

export class AgentChatToolPostProcessor {
  constructor(private readonly deps: AgentChatToolPostProcessorDeps) {}

  private buildNonUserInteractiveInputResult(
    requestType: 'choice' | 'form',
    responseAction: 'skip' | 'expire',
    resolutionSource?: InteractiveResponse['resolutionSource'],
  ) {
    if (responseAction === 'expire' || resolutionSource === 'timeout') {
      return {
        success: true,
        status: 'expired',
        request_type: requestType,
        skipped_by_user: false,
        user_action: 'expire',
        message: 'This interactive input request expired before the user responded. Do not claim that the user declined it; decide whether to continue with a fallback or explain that the input was not provided in time.',
      };
    }

    if (resolutionSource === 'system-fallback') {
      return {
        success: true,
        status: 'skipped',
        request_type: requestType,
        skipped_by_user: false,
        user_action: 'system_fallback',
        message: 'This interactive input request could not be delivered to an active UI receiver, so the runtime returned a fallback result. Do not treat this as an explicit user decline.',
      };
    }

    if (resolutionSource === 'chat-cancelled') {
      return {
        success: true,
        status: 'skipped',
        request_type: requestType,
        skipped_by_user: false,
        user_action: 'chat_cancelled',
        message: 'The chat was cancelled while waiting for this interactive input request, so no user response was collected. Do not treat this as an explicit user decline.',
      };
    }

    return {
      success: true,
      status: 'skipped',
      request_type: requestType,
      skipped_by_user: true,
      user_action: 'skip',
      message: 'The user explicitly skipped or cancelled this interactive input request. Do not ask the same interactive question again unless the user later reopens the topic or provides new context.',
    };
  }

  private rethrowBlockedInteractionError(error: unknown): never | void {
    if (isNonInteractiveRuntimeInteractionError(error)) {
      throw error;
    }
  }

  async postProcessToolResult(toolCall: any, toolResult: any): Promise<any> {
    const toolName = toolCall.function?.name;

    if (toolName === 'request_interactive_input') {
      return this.postProcessForRequestInteractiveInputTool(toolResult);
    }

    return toolResult;
  }

  async postProcessForRequestInteractiveInputTool(toolResult: any): Promise<any> {
    if (this.deps.isRemoteSession()) {
      return {
        success: true,
        status: 'skipped',
        skipped_by_user: false,
        user_action: 'unavailable_in_remote_session',
        message: 'This tool is unavailable because the user is interacting via a remote IM channel which does not support interactive UI components. Please ask the user directly in plain text instead.',
      };
    }

    try {
      const parsedResult: RequestInteractiveInputToolResult = typeof toolResult === 'string'
        ? JSON.parse(toolResult)
        : toolResult;

      if (!parsedResult?.success || !parsedResult.interactive_request) {
        return toolResult;
      }

      const requestArgs: RequestInteractiveInputArgs = parsedResult.interactive_request;

      if (requestArgs.schema.kind === 'choice') {
        const interactionId = this.deps.buildInteractionId('choice');
        const choiceRequest: ChoiceInteractionRequest = {
          interactionId,
          chatId: this.deps.getChatId(),
          chatSessionId: this.deps.getChatSessionId(),
          requestType: 'choice',
          status: 'pending',
          title: requestArgs.title,
          description: requestArgs.description,
          submitLabel: requestArgs.submitLabel,
          skipLabel: requestArgs.skipLabel,
          createdAt: Date.now(),
          source: requestArgs.source,
          mode: requestArgs.schema.mode,
          options: requestArgs.schema.options,
          minSelections: requestArgs.schema.minSelections,
          maxSelections: requestArgs.schema.maxSelections,
        };

        const response = await this.deps.requestUserInteraction(choiceRequest, {
          interactionId,
          chatSessionId: this.deps.getChatSessionId(),
          requestType: 'choice',
          action: 'skip',
        });

        if (response.action === 'skip' || response.action === 'expire') {
          return {
            ...this.buildNonUserInteractiveInputResult('choice', response.action, response.resolutionSource),
            selected_values: [],
          };
        }

        return {
          success: true,
          status: 'submitted',
          request_type: 'choice',
          skipped_by_user: false,
          user_action: 'submit',
          message: 'The user submitted a response to this interactive input request.',
          selected_values: response.selectedValues || [],
        };
      }

      const interactionId = this.deps.buildInteractionId('form');
      const formRequest: FormInteractionRequest = {
        interactionId,
        chatId: this.deps.getChatId(),
        chatSessionId: this.deps.getChatSessionId(),
        requestType: 'form',
        status: 'pending',
        title: requestArgs.title,
        description: requestArgs.description,
        submitLabel: requestArgs.submitLabel,
        skipLabel: requestArgs.skipLabel,
        createdAt: Date.now(),
        source: requestArgs.source,
        fields: requestArgs.schema.fields.map((field) => ({
          key: field.key,
          label: field.label,
          control: field.control,
          type: field.control === 'checkbox' ? 'boolean' : field.control === 'number' ? 'double' : 'string',
          required: field.required,
          defaultValue: field.defaultValue,
          placeholder: field.placeholder,
          description: field.description,
          options: field.options,
          minSelections: field.minSelections,
          maxSelections: field.maxSelections,
        })),
      };

      const response = await this.deps.requestUserInteraction(formRequest, {
        interactionId,
        chatSessionId: this.deps.getChatSessionId(),
        requestType: 'form',
        action: 'skip',
      });

      if (response.action === 'skip' || response.action === 'expire') {
        return {
          ...this.buildNonUserInteractiveInputResult('form', response.action, response.resolutionSource),
          form_values: null,
        };
      }

      return {
        success: true,
        status: 'submitted',
        request_type: 'form',
        skipped_by_user: false,
        user_action: 'submit',
        message: 'The user submitted a response to this interactive input request.',
        form_values: response.formValues || {},
      };
    } catch (error) {
      this.rethrowBlockedInteractionError(error);

      logger.error('[AgentChat] Error in postProcessForRequestInteractiveInputTool', 'postProcessForRequestInteractiveInputTool', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.deps.getAgentName(),
      });

      return {
        success: false,
        error: 'INTERACTIVE_INPUT_POST_PROCESS_FAILED',
        message: error instanceof Error ? error.message : 'Failed to process interactive input request',
      };
    }
  }
}
