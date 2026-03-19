import { LLM, LLMResponse } from '../mem0-core/llms/base';
import { Message } from '../mem0-core/types';
import { GhcModelApi } from '../../llm/ghcModelApi';
import { MainAuthManager } from '../../auth/authManager';
import { getModelById } from '../../llm/ghcModels';

export class KosmosLLM implements LLM {
  private ghcModelApi: GhcModelApi;
  private authManager: MainAuthManager;
  private readonly model = 'gpt-4.1';

  constructor() {
    const initId = `kosmos-llm-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    const startTime = Date.now();

    
    // Initialize GhcModelApi and AuthManager
    const apiInitStart = Date.now();
    this.ghcModelApi = new GhcModelApi();
    const apiInitDuration = Date.now() - apiInitStart;

    const authInitStart = Date.now();
    this.authManager = MainAuthManager.getInstance();
    const authInitDuration = Date.now() - authInitStart;

    
    // Validate model configuration
    const modelValidationStart = Date.now();
    const modelConfig = getModelById(this.model);
    const modelValidationDuration = Date.now() - modelValidationStart;

    if (!modelConfig) {
    } else {
    }

    const totalInitDuration = Date.now() - startTime;
  }

  /**
   * Get current authentication session
   */
  private async getCurrentSession(): Promise<any> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();


    try {
      const session = this.authManager.getCurrentAuth();
      const sessionRetrievalDuration = Date.now() - startTime;


      if (!session || session.authProvider !== 'ghc') {
        throw new Error('GitHub Copilot authentication required for LLM operations');
      }
      
      
      return session;
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      throw error;
    }
  }

  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    responseFormat?: { type: string },
    tools?: any[]
  ): Promise<any> {
    const responseId = `response-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    const startTime = Date.now();

    // Analyze memory-related content in messages
    const memoryKeywords = /memory|fact|extract|remember|search|retrieve|personal|context|history|learn|store|recall/i;
    const hasMemoryContent = messages.some(m => memoryKeywords.test(m.content));
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
    const isMemoryOperation = memoryKeywords.test(systemPrompt);


    try {
      // Validate authentication status
      const authStart = Date.now();
      await this.getCurrentSession();
      const authDuration = Date.now() - authStart;


      // Extract system and user messages
      const analysisStart = Date.now();
      const systemMessage = messages.find(m => m.role === 'system')?.content;
      const userMessages = messages.filter(m => m.role === 'user');
      const assistantMessages = messages.filter(m => m.role === 'assistant');
      const analysisDuration = Date.now() - analysisStart;
      
      
      // Build conversation context
      const contextBuildStart = Date.now();
      let contextualPrompt = '';
      if (userMessages.length > 1 || assistantMessages.length > 0) {
        // If there are multi-turn conversations, build context
        const conversationHistory = messages
          .filter(m => m.role !== 'system')
          .map(m => `${m.role}: ${m.content}`)
          .join('\n');
        contextualPrompt = `Previous conversation:\n${conversationHistory}\n\nPlease respond to the latest user message.`;
        
      }

      const lastUserMessage = userMessages[userMessages.length - 1]?.content;
      if (!lastUserMessage) {
        throw new Error('No user message found');
      }

      const finalPrompt = contextualPrompt ?
        `${contextualPrompt}\n\nLatest message: ${lastUserMessage}` :
        lastUserMessage;

      const contextBuildDuration = Date.now() - contextBuildStart;


      // Use main process GhcModelApi to call GPT-4.1

      const llmCallStart = Date.now();
      // Use gpt-4.1 model for mem0 memory processing
      const response = await this.ghcModelApi.callModel(
        'gpt-4.1',
        finalPrompt,
        systemMessage,
        4000, // maxTokens
        0.7   // temperature
      );
      const llmCallDuration = Date.now() - llmCallStart;

      // Analyze response content
      const responseAnalysisStart = Date.now();
      const responseHasMemoryKeywords = memoryKeywords.test(response);
      const responseHasStructuredData = /\{|\[|\||```/.test(response);
      const responseAnalysisDuration = Date.now() - responseAnalysisStart;

      const totalDuration = Date.now() - startTime;


      return {
        content: response,
        role: 'assistant'
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      throw new Error(`LLM response generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateChat(messages: Message[]): Promise<LLMResponse> {
    const chatId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    const startTime = Date.now();

    // Analyze memory-related content in messages
    const memoryKeywords = /memory|fact|extract|remember|search|retrieve|personal|context|history|learn|store|recall/i;
    const hasMemoryContent = messages.some(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return memoryKeywords.test(content);
    });


    try {
      // Convert message format
      const formatStart = Date.now();
      const formattedMessages = messages.map((msg, index) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const hasMemoryKeywordsInMessage = memoryKeywords.test(content);
        

        return {
          role: msg.role,
          content: content
        };
      });
      const formatDuration = Date.now() - formatStart;


      // Generate response
      const responseStart = Date.now();
      const result = await this.generateResponse(formattedMessages);
      const responseDuration = Date.now() - responseStart;

      const totalDuration = Date.now() - startTime;

      
      return {
        content: result.content,
        role: result.role
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      throw new Error(`Chat generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get LLM configuration information
   */
  getConfig() {
    const configId = `config-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    

    const config = {
      provider: 'kosmos',
      model: this.model,
      supportsStreaming: false, // mem0 currently does not support streaming output
      supportsTools: false,     // mem0 currently does not support tool calling
      authenticationRequired: true,
      // Additional mem0-specific configuration
      optimizedForMemoryOperations: true,
      supportsFactExtraction: true,
      supportsMemorySearch: true,
      supportsContextEnhancement: true
    };


    return config;
  }

  /**
   * Check if LLM is available
   */
  async isAvailable(): Promise<boolean> {
    const availabilityId = `availability-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();


    try {
      const sessionCheckStart = Date.now();
      const session = this.authManager.getCurrentAuth();
      const sessionCheckDuration = Date.now() - sessionCheckStart;
      
      const isAvailable = !!(session && session.authProvider === 'ghc' && session.ghcAuth.copilotTokens.token);
      const totalDuration = Date.now() - startTime;


      return isAvailable;
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      
      
      return false;
    }
  }
}