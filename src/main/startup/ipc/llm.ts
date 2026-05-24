import { ipcMain } from 'electron';

import { getAdvancedLogger } from '../lazy';
import type { Context } from './shared';
import { SystemPromptLlmWriter } from "../../lib/llm/systemPromptLlmWritter";
import { McpConfigLlmFormatter } from "../../lib/llm/mcpConfigLlmFormatter";
import { ChatSessionTitleLlmSummarizer } from "../../lib/llm/chatSessionTitleLlmSummarizer";
import { FileNameLlmGenerator } from "../../lib/llm/fileNameLlmGenerator";
import { DocumentSummaryLlmGenerator } from "../../lib/llm/documentSummaryLlmGenerator";
import { ensureModelsReady, getAllModels, getAllOpenKosmosUsedModels, getModelById, getModelCapabilities, validateModelId, getDefaultModel, isReasoningModel } from "../../lib/llm/ghcModelsManager";

export default function(ctx: Context) {

  // ===============================
  // LLM related IPC handlers
  // ===============================

  // System Prompt optimization
  ipcMain.handle('llm:improveSystemPrompt', async (event, userInputPrompt: string) => {
    try {
      const result = await SystemPromptLlmWriter.improveSystemPrompt(userInputPrompt);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // MCP config formatting
  ipcMain.handle('llm:formatMcpConfig', async (event, userInputMcpConfig: string) => {
    try {
      const result = await McpConfigLlmFormatter.formatMcpConfig(userInputMcpConfig);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Chat session title generation
  ipcMain.handle('llm:generateChatTitle', async (event, userMessage: string) => {
    try {
      const result = await ChatSessionTitleLlmSummarizer.generateTitle(userMessage);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // File name generation (auto-generate file name and extension based on content)
  ipcMain.handle('llm:generateFileName', async (event, content: string) => {
    try {
      const result = await FileNameLlmGenerator.generateFileName(content);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[DocSummary] ❌ IPC error — fileName="${fileName}", error="${errorMsg}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      return { success: false, error: errorMsg };
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get list of models used by OpenKosmos
  ipcMain.handle('models:getAllOpenKosmosUsedModels', async () => {
    try {
      await ensureModelsReady();
      const models = getAllOpenKosmosUsedModels();
      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get a single model by ID
  ipcMain.handle('models:getModelById', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const model = getModelById(modelId);
      return { success: true, data: model };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get model capability information
  ipcMain.handle('models:getModelCapabilities', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const capabilities = getModelCapabilities(modelId);
      return { success: true, data: capabilities };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Validate whether model ID is valid
  ipcMain.handle('models:validateModelId', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const isValid = validateModelId(modelId);
      return { success: true, data: isValid };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get default model ID
  ipcMain.handle('models:getDefaultModel', async () => {
    try {
      const defaultModel = getDefaultModel();
      return { success: true, data: defaultModel };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Determine if it is a reasoning model
  ipcMain.handle('models:isReasoningModel', async (event, modelId: string) => {
    try {
      await ensureModelsReady();
      const isReasoning = isReasoningModel(modelId);
      return { success: true, data: isReasoning };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

