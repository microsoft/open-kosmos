import { ghcModelApi } from './ghcModelApi';
import { getGlobalLogger } from '../unifiedLogger';

/**
 * Document Summary Generator response interface
 */
export interface DocumentSummaryGeneratorResponse {
  success: boolean;
  summary?: string;
  fileName?: string;
  warnings?: string[];
  errors?: string[];
}

/**
 * Document Summary LLM Generator
 * Uses GitHub Copilot LLM API (claude-haiku-4.5) to generate concise document summaries
 * from extracted text content.
 *
 * This module is called from the renderer process via IPC:
 *   window.electronAPI.llm.generateDocumentSummary(fileName, content, truncated)
 */
export class DocumentSummaryLlmGenerator {
  // System prompt for generating document summaries
  private static readonly SYSTEM_PROMPT =
    'You are a document summarizer. Given the text content of a document, provide a clear, concise summary in 1-2 sentences. ' +
    'Focus on the main topic and key points. Do NOT use markdown formatting. Respond with only the summary text, nothing else. ' +
    'If the document language is non-English, write the summary in the same language as the document.';

  private static readonly LOG_SOURCE = 'DocumentSummaryLlmGenerator';

  /**
   * Generate a concise summary for a document based on its extracted text content.
   *
   * @param fileName  Original document filename (provides context for the model)
   * @param content   Extracted text content (may be truncated)
   * @param truncated Whether the content was truncated during extraction
   * @returns         Summary generation result
   */
  static async generateSummary(
    fileName: string,
    content: string,
    truncated: boolean = false,
  ): Promise<DocumentSummaryGeneratorResponse> {
    const logger = getGlobalLogger();
    const startTime = Date.now();

    // Validate input
    const trimmedContent = content.trim();

    logger.info(
      `[DocSummary] 🚀 generateSummary called — fileName="${fileName}", rawContentLength=${content.length}, trimmedContentLength=${trimmedContent.length}, truncated=${truncated}`,
      this.LOG_SOURCE,
    );

    if (!trimmedContent || trimmedContent.length < 20) {
      logger.warn(
        `[DocSummary] ⏩ Content too short — fileName="${fileName}", trimmedLength=${trimmedContent.length} (min=20), skipping LLM call`,
        this.LOG_SOURCE,
      );
      return {
        success: false,
        fileName,
        warnings: ['Content too short to generate meaningful summary'],
      };
    }

    try {
      const userPrompt =
        `Document filename: "${fileName}"\n\n` +
        `Document content (${truncated ? 'truncated' : 'full'}):\n` +
        `${trimmedContent}`;

      logger.info(
        `[DocSummary] 🤖 Calling LLM (claude-haiku-4.5) — fileName="${fileName}", userPromptLength=${userPrompt.length}, maxTokens=200, temperature=0.3`,
        this.LOG_SOURCE,
      );

      // Use claude-haiku-4.5 — fast, low-cost, good at summarization
      const rawResponse = await ghcModelApi.callModel(
        'claude-haiku-4.5',
        userPrompt,
        this.SYSTEM_PROMPT,
        200,   // maxTokens — short summary
        0.3,   // temperature — focused
      );

      const durationMs = Date.now() - startTime;
      const summary = rawResponse.trim();

      if (!summary) {
        logger.warn(
          `[DocSummary] ⚠️ LLM returned empty response — fileName="${fileName}", rawResponseLength=${rawResponse.length}, duration=${durationMs}ms`,
          this.LOG_SOURCE,
        );
        return {
          success: false,
          fileName,
          errors: ['LLM returned empty response'],
        };
      }

      logger.info(
        `[DocSummary] ✅ Summary generated — fileName="${fileName}", summaryLength=${summary.length}, duration=${durationMs}ms, summary="${summary.substring(0, 150)}${summary.length > 150 ? '...' : ''}"`,
        this.LOG_SOURCE,
      );

      return {
        success: true,
        summary,
        fileName,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      logger.error(
        `[DocSummary] ❌ LLM call failed — fileName="${fileName}", error="${errorMsg}", duration=${durationMs}ms`,
        this.LOG_SOURCE,
      );

      return {
        success: false,
        fileName,
        errors: [`Summary generation failed: ${errorMsg}`],
      };
    }
  }
}

// Export for convenience
export const documentSummaryLlmGenerator = DocumentSummaryLlmGenerator;
export default documentSummaryLlmGenerator;
