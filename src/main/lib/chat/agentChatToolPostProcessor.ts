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

    if (toolName === 'get_mcp_template_from_library') {
      return this.postProcessForGetMcpTemplateFromLibraryTool(toolResult);
    }

    if (toolName === 'get_agent_template_from_library') {
      return this.postProcessForGetAgentTemplateFromLibraryTool(toolResult);
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

  async postProcessForGetMcpTemplateFromLibraryTool(toolResult: any): Promise<any> {
    try {
      let configData: any;
      if (typeof toolResult === 'string') {
        try {
          configData = JSON.parse(toolResult);
        } catch {
          return toolResult;
        }
      } else if (typeof toolResult === 'object') {
        configData = toolResult;
      } else {
        return toolResult;
      }

      const actualConfig = (configData.config && typeof configData.config === 'object') ? configData.config : configData;

      if (!actualConfig.env || typeof actualConfig.env !== 'object') {
        const currentAuth = mainAuthManager.getCurrentAuth();
        const currentUserAlias = currentAuth?.ghcAuth?.alias || '';
        if (currentUserAlias && actualConfig.url && typeof actualConfig.url === 'string' && containsOpenKosmosPlaceholder(actualConfig.url)) {
          actualConfig.url = openkosmosPlaceholderManager.replacePlaceholders(actualConfig.url, { alias: currentUserAlias });
          logger.info('[AgentChat] Replaced OpenKosmos placeholders in MCP config url', 'postProcessForGetMcpTemplateFromLibraryTool', {
            agentName: this.deps.getAgentName(),
          });
        }
        return typeof toolResult === 'string' ? JSON.stringify(configData, null, 2) : configData;
      }

      const currentAuth = mainAuthManager.getCurrentAuth();
      const currentUserAlias = currentAuth?.ghcAuth?.alias || '';

      if (currentUserAlias) {
        const envEntries = Object.entries(actualConfig.env);
        let hasOpenKosmosPlaceholder = false;
        for (const [, value] of envEntries) {
          if (typeof value === 'string' && containsOpenKosmosPlaceholder(value)) {
            hasOpenKosmosPlaceholder = true;
            break;
          }
        }

        const urlHasPlaceholder = actualConfig.url && typeof actualConfig.url === 'string' && containsOpenKosmosPlaceholder(actualConfig.url);

        if (hasOpenKosmosPlaceholder) {
          actualConfig.env = openkosmosPlaceholderManager.replacePlaceholdersInObject(actualConfig.env, { alias: currentUserAlias });
          logger.info('[AgentChat] Replaced OpenKosmos placeholders in MCP config env', 'postProcessForGetMcpTemplateFromLibraryTool', {
            agentName: this.deps.getAgentName(),
          });
        }

        if (urlHasPlaceholder) {
          actualConfig.url = openkosmosPlaceholderManager.replacePlaceholders(actualConfig.url, { alias: currentUserAlias });
          logger.info('[AgentChat] Replaced OpenKosmos placeholders in MCP config url', 'postProcessForGetMcpTemplateFromLibraryTool', {
            agentName: this.deps.getAgentName(),
          });
        }
      }

      const configForUserInput = { env: actualConfig.env, url: actualConfig.url || '' };
      const parseResult = userInputPlaceholderParser.parseConfig(configForUserInput);
      if (!parseResult.hasUserInputFields) {
        return typeof toolResult === 'string' ? JSON.stringify(configData, null, 2) : configData;
      }

      const mcpServerName = actualConfig.name || 'MCP Server';
      const mcpServerContact = actualConfig.contact || '';
      logger.info('[AgentChat] Found user input fields in MCP config, requesting user info', 'postProcessForGetMcpTemplateFromLibraryTool', {
        userInputFieldsCount: parseResult.fields.length,
        mcpServerName,
        mcpServerContact,
        fields: parseResult.fields.map((field: UserInputField) => ({
          key: field.key,
          type: field.type,
          control: field.control,
          varName: field.varName,
        })),
        agentName: this.deps.getAgentName(),
      });

      const bodyDescription = mcpServerContact
        ? `Please fill in the following environment variables to complete the MCP server setup. Contact <strong class="contact-highlight">${mcpServerContact}</strong> for assistance if you need help.`
        : 'Please fill in the following environment variables to complete the MCP server setup.';

      const infoInputRequestData = {
        fields: parseResult.fields.map((field: UserInputField) => ({
          key: field.key,
          label: field.label,
          type: field.type.toLowerCase(),
          control: field.control,
          varName: field.varName,
          required: field.isRequired,
          defaultValue: field.defaultValue,
        })),
        header: { title: `Configure ${mcpServerName}` },
        body: { description: bodyDescription },
      };

      const userInputs = await this.deps.requestUserInfoInput(infoInputRequestData);

      if (userInputs === null) {
        const resultWithoutEnv = JSON.parse(JSON.stringify(configData));
        const targetToModify = (resultWithoutEnv.config && typeof resultWithoutEnv.config === 'object') ? resultWithoutEnv.config : resultWithoutEnv;
        delete targetToModify.env;
        logger.info('[AgentChat] User skipped info input, removing env from config', 'postProcessForGetMcpTemplateFromLibraryTool', {
          agentName: this.deps.getAgentName(),
        });
        return typeof toolResult === 'string' ? JSON.stringify(resultWithoutEnv, null, 2) : resultWithoutEnv;
      }

      const updatedResult = JSON.parse(JSON.stringify(configData));
      const targetToModify = (updatedResult.config && typeof updatedResult.config === 'object') ? updatedResult.config : updatedResult;
      const updatedEnv = { ...targetToModify.env };
      for (const field of parseResult.fields) {
        const inputValue = userInputs[field.key];
        const isInputEmpty = inputValue === null || inputValue === undefined || String(inputValue).trim() === '';
        if (!field.isRequired && isInputEmpty) {
          delete updatedEnv[field.key];
        } else if (Object.prototype.hasOwnProperty.call(userInputs, field.key)) {
          updatedEnv[field.key] = String(inputValue);
        }
      }
      targetToModify.env = updatedEnv;
      logger.info('[AgentChat] User provided info input, updated config with user values', 'postProcessForGetMcpTemplateFromLibraryTool', {
        updatedFields: Object.keys(userInputs),
        agentName: this.deps.getAgentName(),
      });
      return typeof toolResult === 'string' ? JSON.stringify(updatedResult, null, 2) : updatedResult;
    } catch (error) {
      this.rethrowBlockedInteractionError(error);

      logger.error('[AgentChat] Error in postProcessForGetMcpTemplateFromLibraryTool', 'postProcessForGetMcpTemplateFromLibraryTool', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.deps.getAgentName(),
      });
      return toolResult;
    }
  }

  async postProcessForGetAgentTemplateFromLibraryTool(toolResult: any): Promise<any> {
    try {
      let configData: any;
      if (typeof toolResult === 'string') {
        try {
          configData = JSON.parse(toolResult);
        } catch {
          return toolResult;
        }
      } else if (typeof toolResult === 'object') {
        configData = toolResult;
      } else {
        return toolResult;
      }

      const actualConfig = (configData.config && typeof configData.config === 'object') ? configData.config : configData;
      if (!actualConfig.configuration || typeof actualConfig.configuration !== 'object') {
        return toolResult;
      }

      const configuration = actualConfig.configuration;
      const currentAuth = mainAuthManager.getCurrentAuth();
      const currentUserAlias = currentAuth?.ghcAuth?.alias || '';

      if (currentUserAlias && configuration.workspace && typeof configuration.workspace === 'string') {
        if (containsOpenKosmosPlaceholder(configuration.workspace)) {
          configuration.workspace = openkosmosPlaceholderManager.replacePlaceholders(configuration.workspace, { alias: currentUserAlias });
          logger.info('[AgentChat] Replaced OpenKosmos placeholders in Agent workspace', 'postProcessForGetAgentTemplateFromLibraryTool', {
            agentName: this.deps.getAgentName(),
            newWorkspace: configuration.workspace,
          });
        }
      }

      if (configuration.workspace && typeof configuration.workspace === 'string') {
        const parseResult = userInputPlaceholderParser.parseConfig({ workspace: configuration.workspace });
        if (parseResult.hasUserInputFields) {
          const agentName = actualConfig.name || 'Agent';
          const agentContact = actualConfig.contact || '';
          logger.info('[AgentChat] Found user input fields in Agent workspace, requesting user info', 'postProcessForGetAgentTemplateFromLibraryTool', {
            userInputFieldsCount: parseResult.fields.length,
            agentName,
            agentContact,
            fields: parseResult.fields.map((field: UserInputField) => ({
              key: field.key,
              type: field.type,
              control: field.control,
              varName: field.varName,
            })),
          });

          const bodyDescription = agentContact
            ? `Please fill in the following configuration to complete the Agent setup. Contact <strong class="contact-highlight">${agentContact}</strong> for assistance if you need help.`
            : 'Please fill in the following configuration to complete the Agent setup.';

          const infoInputRequestData = {
            fields: parseResult.fields.map((field: UserInputField) => ({
              key: field.key,
              label: field.label,
              type: field.type.toLowerCase(),
              control: field.control,
              varName: field.varName,
              required: field.isRequired,
              defaultValue: field.defaultValue,
            })),
            header: { title: `Configure ${agentName}` },
            body: { description: bodyDescription },
          };

          const userInputs = await this.deps.requestUserInfoInput(infoInputRequestData);
          if (userInputs === null) {
            configuration.workspace = '';
            logger.info('[AgentChat] User skipped workspace input, setting workspace to empty', 'postProcessForGetAgentTemplateFromLibraryTool', {
              agentName: this.deps.getAgentName(),
            });
          } else {
            for (const field of parseResult.fields) {
              const inputValue = userInputs[field.key];
              const isInputEmpty = inputValue === null || inputValue === undefined || String(inputValue).trim() === '';
              if (!field.isRequired && isInputEmpty) {
                configuration.workspace = '';
              } else if (Object.prototype.hasOwnProperty.call(userInputs, field.key)) {
                configuration.workspace = String(inputValue);
              }
            }

            logger.info('[AgentChat] User provided workspace input, updated Agent config', 'postProcessForGetAgentTemplateFromLibraryTool', {
              updatedFields: Object.keys(userInputs),
              agentName: this.deps.getAgentName(),
            });
          }
        }
      }

      return typeof toolResult === 'string' ? JSON.stringify(configData, null, 2) : configData;
    } catch (error) {
      this.rethrowBlockedInteractionError(error);

      logger.error('[AgentChat] Error in postProcessForGetAgentTemplateFromLibraryTool', 'postProcessForGetAgentTemplateFromLibraryTool', {
        error: error instanceof Error ? error.message : String(error),
        agentName: this.deps.getAgentName(),
      });
      return toolResult;
    }
  }
}