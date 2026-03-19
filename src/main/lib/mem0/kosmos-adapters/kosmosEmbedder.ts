import { Embedder } from '../mem0-core/embeddings/base';
import { TextLlmEmbedder } from '../../llm/textLlmEmbedder';
import { MainAuthManager } from '../../auth/authManager';
import { getModelById } from '../../llm/ghcModels';

export class KosmosEmbedder implements Embedder {
  private textLlmEmbedder: TextLlmEmbedder;
  private authManager: MainAuthManager;
  private readonly model = 'text-embedding-3-small';
  private readonly dimensions = 1536;

  constructor() {
    
    // Initialize TextLlmEmbedder and AuthManager
    this.textLlmEmbedder = new TextLlmEmbedder();
    this.authManager = MainAuthManager.getInstance();
    
    // Validate embedding model configuration
    const embeddingModel = getModelById(this.model);
    if (!embeddingModel) {
    } else {
    }
  }

  /**
   * Get current authentication session
   */
  private async getCurrentSession(): Promise<any> {
    const session = this.authManager.getCurrentAuth();
    if (!session || session.authProvider !== 'ghc') {
      throw new Error('GitHub Copilot authentication required for embedding operations');
    }
    
    
    return session;
  }

  async embed(text: string): Promise<number[]> {

    try {
      // Validate authentication status
      await this.getCurrentSession();

      // Use main process textLlmEmbedder
      const result = await this.textLlmEmbedder.embed(text);
      

      return result;
    } catch (error) {
      throw new Error(`Embedding operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {

    try {
      // Validate authentication status
      await this.getCurrentSession();

      // Use main process textLlmEmbedder for batch embedding
      const results = await this.textLlmEmbedder.embedBatch(texts);
      

      return results;
    } catch (error) {
      throw new Error(`Batch embedding operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get embedding configuration information
   */
  getInfo(): { model: string; dimensions: number; provider: string } {
    return {
      model: this.model,
      dimensions: this.dimensions,
      provider: 'kosmos'
    };
  }

  /**
   * Get embedder configuration
   */
  getConfig() {
    return {
      provider: 'kosmos',
      model: this.model,
      dimensions: this.dimensions,
      authenticationRequired: true
    };
  }

  /**
   * Check if the embedder is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const session = this.authManager.getCurrentAuth();
      return !!(session && session.authProvider === 'ghc' && session.ghcAuth.copilotTokens.token);
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   * This is a utility method for comparing embedding vectors
   */
  static cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    return TextLlmEmbedder.cosineSimilarity(embedding1, embedding2);
  }
}