import { LlmApiSettings, Message, MessageHelper } from '../types/chatTypes';
import { getModelById } from './ghcModels';
import { GHC_CONFIG } from '../auth/ghcConfig';

/**
 * Determine the API endpoint to use based on model configuration
 * @param modelId Model ID
 * @returns API endpoint path
 */
export function getEndpointForModel(modelId: string): string {
  const model = getModelById(modelId);
  
  if (model && model.supported_endpoints && model.supported_endpoints.length > 0) {
    // Prefer /chat/completions (OpenAI compatible format), avoid /v1/messages (Anthropic native format requires a different tool_choice structure)
    if (model.supported_endpoints.includes('/chat/completions')) {
      return '/chat/completions';
    }
    // When /chat/completions is not supported (e.g., Codex series only has /responses), use the first one
    return model.supported_endpoints[0];
  }
  
  // Default to /chat/completions endpoint
  return '/chat/completions';
}

/**
 * GitHub Copilot model API class
 * Specifically for single calls to GPT 4.1 model via GitHub Copilot
 * Does not support tools, streaming output, or message history management
 */
export class GhcModelApi {
  private config: LlmApiSettings;
  private currentModel: string;

  constructor() {
    // Load GPT 4.1 configuration from ghcModels
    this.currentModel = 'gpt-4.1';
    const modelInfo = getModelById(this.currentModel);
    
    this.config = {
      apiKey: '', // Will be set from session token
      endpoint: GHC_CONFIG.API_ENDPOINT,
      deploymentName: this.currentModel,
      apiVersion: '2025-01-01-preview'
    };
  }

  /**
   * Single call to GitHub Copilot GPT 4.1 model
   * @param userPrompt User input prompt
   * @param systemPrompt System prompt for setting context (optional)
   * @param maxTokens Maximum token count, default 4000
   * @param temperature Temperature parameter, default 0.7
   * @returns Model response content
   */
  async callGPT41(
    userPrompt: string,
    systemPrompt?: string,
    maxTokens: number = 4000,
    temperature: number = 0.7
  ): Promise<string> {
    try {
      // Get session from auth manager
      const session = await this.getSessionFromAuthManager();
      if (!session) {
        throw new Error('GitHub Copilot authentication required');
      }

      // Build request messages
      const messages: Message[] = [];
      
      // Add system message if provided
      if (systemPrompt) {
        const systemMessage = MessageHelper.createTextMessage(
          systemPrompt,
          'system',
          (Date.now() - 1).toString()
        );
        messages.push(systemMessage);
      }
      
      // Add user message
      const userMessage = MessageHelper.createTextMessage(
        userPrompt,
        'user',
        Date.now().toString()
      );
      messages.push(userMessage);

      // Format messages for API
      const formattedMessages = this.formatMessagesForApi(messages);

      // Build request body
      const requestBody = {
        model: this.currentModel,
        messages: formattedMessages,
        max_tokens: maxTokens,
        temperature: temperature,
        stream: false
      };

      // Build API URL
      const url = `${GHC_CONFIG.API_ENDPOINT}/chat/completions`;

      // Make API request with GitHub Copilot headers
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.ghcAuth.copilotTokens.token}`,
          'Content-Type': 'application/json',
          'User-Agent': GHC_CONFIG.USER_AGENT,
          'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
          'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
        },
        body: JSON.stringify(requestBody)
      });

      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText}`);
      }

      // Parse response
      const result = await response.json();

      // Extract response content
      const message = result.choices?.[0]?.message;
      if (!message || !message.content) {
        throw new Error('API response format invalid or no content');
      }

      // Handle content format (string or array)
      let responseContent: string;
      if (Array.isArray(message.content)) {
        // Extract text content from array format
        const textParts = message.content.filter((part: any) => part && typeof part === 'object' && part.type === 'text');
        responseContent = textParts.map((part: any) => part.text || '').join('');
      } else {
        responseContent = String(message.content || '');
      }

      return responseContent;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Generic GitHub Copilot API call method
   * @param modelId Model ID (e.g., 'gpt-4.1', 'claude-3.5-sonnet', etc.)
   * @param userPrompt User input prompt
   * @param systemPrompt System prompt (optional)
   * @param maxTokens Maximum token count, default 4000
   * @param temperature Temperature parameter, default 0.7
   * @returns Model response content
   */
  async callModel(
    modelId: string,
    userPrompt: string,
    systemPrompt?: string,
    maxTokens: number = 4000,
    temperature: number = 0.7
  ): Promise<string> {
    try {
      // Get session authentication info
      const session = await this.getSessionFromAuthManager();
      if (!session) {
        throw new Error('GitHub Copilot authentication required');
      }

      // Build request messages
      const messages: Message[] = [];
      
      // Add system message (if provided)
      if (systemPrompt) {
        const systemMessage = MessageHelper.createTextMessage(
          systemPrompt,
          'system',
          (Date.now() - 1).toString()
        );
        messages.push(systemMessage);
      }
      
      // Add user message
      const userMessage = MessageHelper.createTextMessage(
        userPrompt,
        'user',
        Date.now().toString()
      );
      messages.push(userMessage);

      // Format messages for API usage
      const formattedMessages = this.formatMessagesForApi(messages);

      // Determine endpoint based on model
      const endpoint = getEndpointForModel(modelId);

      // Build request body
      const requestBody = {
        model: modelId,
        messages: formattedMessages,
        max_tokens: maxTokens,
        temperature: temperature,
        stream: false
      };

      // Build API URL
      const url = `${this.config.endpoint}${endpoint}`;

      // Make API request with GitHub Copilot headers
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.ghcAuth.copilotTokens.token}`,
          'Content-Type': 'application/json',
          'User-Agent': GHC_CONFIG.USER_AGENT,
          'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
          'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
        },
        body: JSON.stringify(requestBody)
      });

      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText}`);
      }

      // Parse response
      const result = await response.json();

      // Extract response content
      const message = result.choices?.[0]?.message;
      if (!message || !message.content) {
        throw new Error('API response format invalid or no content');
      }

      // Handle content format (string or array)
      let responseContent: string;
      if (Array.isArray(message.content)) {
        // Extract text content from array format
        const textParts = message.content.filter((part: any) => part && typeof part === 'object' && part.type === 'text');
        responseContent = textParts.map((part: any) => part.text || '').join('');
      } else {
        responseContent = String(message.content || '');
      }

      return responseContent;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Get session from auth manager - direct token usage, validity managed by token monitor
   */
  private async getSessionFromAuthManager(): Promise<any | null> {
    try {
      const { MainAuthManager } = await import('../auth/authManager');
      const authManager = MainAuthManager.getInstance();
      
      // ✅ Per user requirements: retrieve session directly without self-judging refresh
      // Token validity is monitored by TokenMonitor and guaranteed by AuthManager
      const currentSession = await authManager.getCurrentAuth();
      
      if (currentSession && currentSession.authProvider === 'ghc') {
        return currentSession;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Format messages for API (simplified version from agentChat.ts)
   */
  private formatMessagesForApi(messages: Message[]): any[] {
    const formattedMessages = [];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      if (!msg.content && msg.role !== 'system') {
        continue;
      }
      
      // Extract text content using MessageHelper
      const messageContent = MessageHelper.getText(msg);
      
      const apiMessage: any = {
        role: msg.role,
        content: messageContent
      };

      formattedMessages.push(apiMessage);
    }

    return formattedMessages;
  }
}

// Create and export singleton instance
export const ghcModelApi = new GhcModelApi();
export default ghcModelApi;