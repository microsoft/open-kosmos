import { ipcMain } from 'electron';

import { getAdvancedLogger } from '../lazy';
import type { Context } from './shared';
import { SystemPromptLlmWriter, type SystemPromptWriterOptions } from "../../lib/llm/systemPromptLlmWritter";
import { McpConfigLlmFormatter } from "../../lib/llm/mcpConfigLlmFormatter";
import { ChatSessionTitleLlmSummarizer } from "../../lib/llm/chatSessionTitleLlmSummarizer";
import { FileNameLlmGenerator } from "../../lib/llm/fileNameLlmGenerator";
import { DocumentSummaryLlmGenerator } from "../../lib/llm/documentSummaryLlmGenerator";
import { textLlmEmbedder } from "../../lib/llm/textLlmEmbedder";
import { ensureModelsReady, getAllModels, getAllOpenKosmosUsedModels, getModelById, getModelCapabilities, validateModelId, getDefaultModel, isReasoningModel } from "../../lib/llm/ghcModelsManager";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export default function(ctx: Context) {

  // ===============================
  // LLM related IPC handlers
  // ===============================

  // System Prompt optimization
  ipcMain.handle('llm:improveSystemPrompt', async (event, userInputPrompt: string, options?: SystemPromptWriterOptions) => {
    try {
      const result = await SystemPromptLlmWriter.improveSystemPrompt(userInputPrompt, options);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // MCP config formatting
  ipcMain.handle('llm:formatMcpConfig', async (event, userInputMcpConfig: string) => {
    try {
      const result = await McpConfigLlmFormatter.formatMcpConfig(userInputMcpConfig);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Chat session title generation
  ipcMain.handle('llm:generateChatTitle', async (event, userMessage: string) => {
    try {
      const result = await ChatSessionTitleLlmSummarizer.generateTitle(userMessage);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // File name generation (auto-generate file name and extension based on content)
  ipcMain.handle('llm:generateFileName', async (event, content: string) => {
    try {
      const result = await FileNameLlmGenerator.generateFileName(content);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Document summary generation (generate LLM summary from extracted document text content)
  ipcMain.handle('llm:generateDocumentSummary', async (event, fileName: string, content: string, truncated: boolean = false) => {
    const logger = getAdvancedLogger();
    const startTime = Date.now();
    logger.info(`[DocSummary] 📥 IPC request — fileName="${fileName}", contentLength=${content?.length ?? 0}, truncated=${truncated}`, 'llm:generateDocumentSummary');
    try {
      const result = await DocumentSummaryLlmGenerator.generateSummary(fileName, content, truncated);
      const durationMs = Date.now() - startTime;
      if (result.success) {
        logger.info(`[DocSummary] ✅ IPC success — fileName="${fileName}", summaryLength=${result.summary?.length ?? 0}, summary="${(result.summary || '').substring(0, 120)}${(result.summary?.length ?? 0) > 120 ? '...' : ''}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      } else {
        logger.warn(`[DocSummary] ⚠️ IPC generation failed — fileName="${fileName}", warnings=${JSON.stringify(result.warnings)}, errors=${JSON.stringify(result.errors)}, duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      }
      return { success: true, data: result };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);
      logger.error(`[DocSummary] ❌ IPC error — fileName="${fileName}", error="${errorMsg}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      return { success: false, error: errorMsg };
    }
  });

  // Text embedding
  ipcMain.handle('llm:embedText', async (event, text: string) => {
    try {
      const result = await textLlmEmbedder.embed(text);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Batch text embedding
  ipcMain.handle('llm:embedBatch', async (event, texts: string[]) => {
    try {
      const result = await textLlmEmbedder.embedBatch(texts);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ===============================
  // Models related IPC handlers (GitHub Copilot Models)
  // ===============================

  // Get all GitHub Copilot models
  ipcMain.handle('models:getAllModels', async () => {
    try {
      await ensureModelsReady();
      const models = getAllModels();
      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get list of models used by OpenKosmos
  ipcMain.handle('models:getAllOpenKosmosUsedModels', async () => {
    try {
      await ensureModelsReady();
      const models = getAllOpenKosmosUsedModels();
      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get a single model by ID
  ipcMain.handle('models:getModelById', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const model = getModelById(modelId);
      return { success: true, data: model };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get model capability information
  ipcMain.handle('models:getModelCapabilities', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const capabilities = getModelCapabilities(modelId);
      return { success: true, data: capabilities };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Validate whether model ID is valid
  ipcMain.handle('models:validateModelId', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const isValid = validateModelId(modelId);
      return { success: true, data: isValid };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Get default model ID
  ipcMain.handle('models:getDefaultModel', async () => {
    try {
      const defaultModel = getDefaultModel();
      return { success: true, data: defaultModel };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Determine if it is a reasoning model
  ipcMain.handle('models:isReasoningModel', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const isReasoning = isReasoningModel(modelId);
      return { success: true, data: isReasoning };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });
}
