import { GHC_CONFIG } from '../auth/ghcConfig';
import { getModelById } from './ghcModels';

/**
 * Text LLM Embedder class
 * Pure text embedding functionality using text-embedding-3-small model via GitHub Copilot
 * Configuration is fixed for Kosmos app - no external config needed
 */
export class TextLlmEmbedder {
  private readonly model = 'text-embedding-3-small';
  private readonly baseUrl = GHC_CONFIG.API_ENDPOINT;
  private readonly embeddingDims = 1536; // Fixed dimensions for text-embedding-3-small
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  constructor() {
    // Get text-embedding-3-small model config from ghcModels for validation
    const embeddingModel = getModelById(this.model);
    
  }

  /**
   * Get embedding for the given text
   * @param text The text to embed
   * @returns Promise<number[]> The embedding vector
   */
  async embed(text: string): Promise<number[]> {
    const embedId = `embed-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    const startTime = Date.now();

    // Analyze memory-related content in the text
    const memoryKeywords = /memory|fact|extract|remember|search|retrieve|personal|context|history|learn|store|recall|knowledge|conversation|chat/i;
    const hasMemoryContent = memoryKeywords.test(text);
    const memoryKeywordMatches = text.match(memoryKeywords) || [];


    try {
      // Preprocess text with memory-aware cleaning
      const preprocessStart = Date.now();
      const processedText = text.replace(/\n/g, ' ').trim();
      const preprocessDuration = Date.now() - preprocessStart;

      // Enhanced validation for memory content
      if (!processedText) {
        throw new Error('Text cannot be empty');
      }

      // Analyze processed text characteristics
      const processedHasMemoryContent = memoryKeywords.test(processedText);
      const processedMemoryMatches = processedText.match(memoryKeywords) || [];


      // Get session for authentication
      const authStart = Date.now();
      const session = await this.getSessionFromAuthManager();
      const authDuration = Date.now() - authStart;

      if (!session) {
        throw new Error('GitHub Copilot authentication required for embedding');
      }


      // Make embedding request with memory context tracking

      const embeddingStart = Date.now();
      const embedding = await this.requestEmbedding(processedText, session);
      const embeddingDuration = Date.now() - embeddingStart;

      const totalDuration = Date.now() - startTime;

      // Validate embedding quality for memory operations
      const isValidMemoryEmbedding = embedding && embedding.length === this.embeddingDims &&
        embedding.every(val => typeof val === 'number' && !isNaN(val));


      return embedding;

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      
      
      throw new Error(`Embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Batch embedding for multiple texts
   * @param texts Array of texts to embed
   * @returns Promise<number[][]> Array of embedding vectors
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    const startTime = Date.now();

    // Analyze memory content across all texts
    const memoryKeywords = /memory|fact|extract|remember|search|retrieve|personal|context|history|learn|store|recall|knowledge|conversation|chat/i;
    const memoryAnalysis = texts.map((text, index) => ({
      index,
      hasMemoryContent: memoryKeywords.test(text),
      memoryKeywordCount: (text.match(memoryKeywords) || []).length,
      textLength: text.length
    }));

    const memoryTextsCount = memoryAnalysis.filter(analysis => analysis.hasMemoryContent).length;
    const totalMemoryKeywords = memoryAnalysis.reduce((sum, analysis) => sum + analysis.memoryKeywordCount, 0);


    const embeddings: number[][] = [];
    const processingResults: Array<{
      index: number;
      success: boolean;
      duration: number;
      hasMemoryContent: boolean;
      error?: string;
    }> = [];
    
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const textAnalysis = memoryAnalysis[i];
      
      
      const textProcessingStart = Date.now();
      
      try {
        const embedding = await this.embed(text);
        const textProcessingDuration = Date.now() - textProcessingStart;
        
        embeddings.push(embedding);
        
        processingResults.push({
          index: i,
          success: true,
          duration: textProcessingDuration,
          hasMemoryContent: textAnalysis.hasMemoryContent
        });

        
      } catch (error) {
        const textProcessingDuration = Date.now() - textProcessingStart;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        processingResults.push({
          index: i,
          success: false,
          duration: textProcessingDuration,
          hasMemoryContent: textAnalysis.hasMemoryContent,
          error: errorMessage
        });

        
        throw error;
      }

      // Small delay to avoid rate limiting, with longer delay for memory-heavy content
      if (i < texts.length - 1) {
        const delayMs = textAnalysis.hasMemoryContent ? 150 : 100;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const totalDuration = Date.now() - startTime;
    const successfulEmbeddings = processingResults.filter(result => result.success);
    const memorySuccessfulEmbeddings = successfulEmbeddings.filter(result => result.hasMemoryContent);


    return embeddings;
  }

  /**
   * Request embedding from API with retry logic
   */
  private async requestEmbedding(text: string, session: any): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {

        // Build request body
        const requestBody = {
          model: this.model,
          input: [text],
          dimensions: this.embeddingDims
        };

        // Build API URL
        const url = `${this.baseUrl}/embeddings`;

        const requestStartTime = Date.now();

        // Make API request
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

        const requestDuration = Date.now() - requestStartTime;


        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        // Parse response
        const result = await response.json();

        // Extract embedding from response
        if (!result.data || !Array.isArray(result.data) || result.data.length === 0) {
          throw new Error('Invalid API response format');
        }

        const embedding = result.data[0]?.embedding;
        if (!Array.isArray(embedding)) {
          throw new Error('Invalid embedding format in response');
        }

        // Validate embedding dimensions
        if (embedding.length !== this.embeddingDims) {
        }

        return embedding;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    throw new Error(`Embedding failed after ${this.maxRetries} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Get session from auth manager - direct token usage, validity managed by token monitor
   */
  private async getSessionFromAuthManager(): Promise<any | null> {
    const sessionRequestId = `session-req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();


    try {
      const importStart = Date.now();
      const { MainAuthManager } = await import('../auth/authManager');
      const authManager = MainAuthManager.getInstance();
      const importDuration = Date.now() - importStart;

      // ✅ Per user requirements: retrieve session directly without self-judging refresh
      // Token validity is monitored by TokenMonitor and guaranteed by AuthManager
      const sessionRetrievalStart = Date.now();
      const currentSession = await authManager.getCurrentAuth();
      const sessionRetrievalDuration = Date.now() - sessionRetrievalStart;
      const totalDuration = Date.now() - startTime;

      
      if (currentSession && currentSession.authProvider === 'ghc') {
        
        return currentSession;
      } else {
        
        return null;
      }
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      
      
      return null;
    }
  }

  /**
   * Get current configuration info
   */
  getInfo() {
    return {
      model: this.model,
      baseUrl: this.baseUrl,
      embeddingDims: this.embeddingDims,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    };
  }

  /**
   * Calculate cosine similarity between two embeddings
   * Utility method for comparing embeddings
   * @param embedding1 First embedding vector
   * @param embedding2 Second embedding vector
   * @returns Cosine similarity score (-1 to 1)
   */
  static cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }
}

// Create and export singleton instance
export const textLlmEmbedder = new TextLlmEmbedder();
export default textLlmEmbedder;