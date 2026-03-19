import { LlmApiSettings, Message, MessageHelper } from '../types/chatTypes';

/**
 * Simplified Azure OpenAI model API class
 * Specifically for single calls to GPT 4.1 model
 * Does not support tools, streaming output, or message history management
 */
export class AzureOpenAIModelApi {
  private config: LlmApiSettings;

  constructor() {
    // Load GPT 4.1 configuration from environment variables
    this.config = {
      apiKey: process.env.PRESET_MODEL_GPT41_API_KEY || '',
      endpoint: process.env.PRESET_MODEL_GPT41_ENDPOINT || '',
      deploymentName: process.env.PRESET_MODEL_GPT41_DEPLOYMENT_NAME || 'gpt-4.1',
      apiVersion: process.env.PRESET_MODEL_GPT41_API_VERSION || '2025-01-01-preview'
    };

    // Validate configuration completeness
    if (!this.config.apiKey || !this.config.endpoint) {
    }
  }

  /**
   * Single call to Azure OpenAI GPT 4.1 model
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
      // Validate configuration
      if (!this.config.apiKey || !this.config.endpoint) {
        throw new Error('Azure OpenAI GPT 4.1 API configuration incomplete');
      }

      // Build request messages
      const messages: Message[] = [];
      
      // Add system message if provided
      if (systemPrompt) {
        messages.push(MessageHelper.createTextMessage(
          systemPrompt,
          'system',
          (Date.now() - 1).toString()
        ));
      }
      
      // Add user message
      messages.push(MessageHelper.createTextMessage(
        userPrompt,
        'user',
        Date.now().toString()
      ));

      // Build request body
      const requestBody = {
        messages,
        max_tokens: maxTokens,
        temperature: temperature
      };

      // Build API URL
      const url = `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=${this.config.apiVersion}`;


      const requestStartTime = Date.now();

      // Make API request
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        body: JSON.stringify(requestBody)
      });

      const requestDuration = Date.now() - requestStartTime;


      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
      }

      // Parse response
      const result = await response.json();


      // Extract response content
      const message = result.choices?.[0]?.message;
      if (!message || !message.content) {
        throw new Error('API response format invalid or no content');
      }

      const responseContent = message.content;


      return responseContent;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Update API configuration
   * @param newConfig New configuration
   */
  updateConfig(newConfig: Partial<LlmApiSettings>): void {
    this.config = {
      ...this.config,
      ...newConfig
    };

  }

  /**
   * Get current configuration (hide sensitive information)
   */
  getConfig(): Omit<LlmApiSettings, 'apiKey'> & { hasApiKey: boolean } {
    return {
      endpoint: this.config.endpoint,
      deploymentName: this.config.deploymentName,
      apiVersion: this.config.apiVersion,
      hasApiKey: !!this.config.apiKey
    };
  }

  /**
   * Validate configuration completeness
   */
  isConfigValid(): boolean {
    return !!(this.config.apiKey && this.config.endpoint && this.config.deploymentName);
  }
}

// Create and export singleton instance
export const azureOpenAIModelApi = new AzureOpenAIModelApi();
export default azureOpenAIModelApi;