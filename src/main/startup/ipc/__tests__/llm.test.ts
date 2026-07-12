import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockHandle = vi.fn();

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: any[]) => (mockHandle as any)(...args) },
}));

// --- Lazy logger ---
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../lazy', () => ({
  getAdvancedLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}));

// --- LLM service mocks ---
vi.mock('../../../lib/llm/systemPromptLlmWritter', () => ({
  SystemPromptLlmWriter: {
    improveSystemPrompt: vi.fn().mockResolvedValue('improved prompt'),
  },
}));

vi.mock('../../../lib/llm/mcpConfigLlmFormatter', () => ({
  McpConfigLlmFormatter: {
    formatMcpConfig: vi.fn().mockResolvedValue('{ "key": "val" }'),
  },
}));

vi.mock('../../../lib/llm/chatSessionTitleLlmSummarizer', () => ({
  ChatSessionTitleLlmSummarizer: {
    generateTitle: vi.fn().mockResolvedValue('Chat about cats'),
  },
}));

vi.mock('../../../lib/llm/fileNameLlmGenerator', () => ({
  FileNameLlmGenerator: {
    generateFileName: vi.fn().mockResolvedValue('document.md'),
  },
}));

vi.mock('../../../lib/llm/documentSummaryLlmGenerator', () => ({
  DocumentSummaryLlmGenerator: {
    generateSummary: vi.fn().mockResolvedValue({ success: true, summary: 'A summary' }),
  },
}));

const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockEmbedBatch = vi.fn().mockResolvedValue([[0.1], [0.2]]);

vi.mock('../../../lib/llm/textLlmEmbedder', () => ({
  textLlmEmbedder: {
    embed: (...args: any[]) => (mockEmbed as any)(...args),
    embedBatch: (...args: any[]) => (mockEmbedBatch as any)(...args),
  },
}));

// --- Models manager mocks ---
const mockEnsureModelsReady = vi.fn().mockResolvedValue(undefined);
const mockGetAllModels = vi.fn(() => [{ id: 'gpt-4o' }]);
const mockGetAllOpenKosmosUsedModels = vi.fn(() => [{ id: 'gpt-4o' }]);
const mockGetModelById = vi.fn(() => ({ id: 'gpt-4o', name: 'GPT-4o' }));
const mockGetModelCapabilities = vi.fn(() => ({ vision: true }));
const mockValidateModelId = vi.fn(() => true);
const mockGetDefaultModel = vi.fn(() => ({ id: 'gpt-4o' }));
const mockIsReasoningModel = vi.fn(() => false);

vi.mock('../../../lib/llm/ghcModelsManager', () => ({
  ensureModelsReady: (...args: any[]) => (mockEnsureModelsReady as any)(...args),
  getAllModels: (...args: any[]) => (mockGetAllModels as any)(...args),
  getAllOpenKosmosUsedModels: (...args: any[]) => (mockGetAllOpenKosmosUsedModels as any)(...args),
  getModelById: (...args: any[]) => (mockGetModelById as any)(...args),
  getModelCapabilities: (...args: any[]) => (mockGetModelCapabilities as any)(...args),
  validateModelId: (...args: any[]) => (mockValidateModelId as any)(...args),
  getDefaultModel: (...args: any[]) => (mockGetDefaultModel as any)(...args),
  isReasoningModel: (...args: any[]) => (mockIsReasoningModel as any)(...args),
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for ${channel}`);
  return call[1];
}

describe('startup/ipc/llm', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: registerLlmIPC } = await import('../llm');
    registerLlmIPC({} as any);
  });

  // --- System prompt ---

  it('llm:improveSystemPrompt returns improved prompt', async () => {
    const { SystemPromptLlmWriter } = await import('../../../lib/llm/systemPromptLlmWritter');
    const result = await getHandler('llm:improveSystemPrompt')({}, 'raw prompt', { promptFile: 'AGENTS.md' });
    expect(SystemPromptLlmWriter.improveSystemPrompt).toHaveBeenCalledWith('raw prompt', { promptFile: 'AGENTS.md' });
    expect(result).toEqual({ success: true, data: 'improved prompt' });
  });

  it('llm:improveSystemPrompt returns error on failure', async () => {
    const { SystemPromptLlmWriter } = await import('../../../lib/llm/systemPromptLlmWritter');
    (SystemPromptLlmWriter.improveSystemPrompt as any).mockRejectedValueOnce(new Error('llm fail'));
    const result = await getHandler('llm:improveSystemPrompt')({}, 'prompt');
    expect(result).toEqual({ success: false, error: 'llm fail' });
  });

  it('llm:improveSystemPrompt returns unknown error for non-error failures', async () => {
    const { SystemPromptLlmWriter } = await import('../../../lib/llm/systemPromptLlmWritter');
    (SystemPromptLlmWriter.improveSystemPrompt as any).mockRejectedValueOnce('llm fail');
    const result = await getHandler('llm:improveSystemPrompt')({}, 'prompt');
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  // --- MCP config formatting ---

  it('llm:formatMcpConfig returns formatted config', async () => {
    const result = await getHandler('llm:formatMcpConfig')({}, 'raw config');
    expect(result).toEqual({ success: true, data: '{ "key": "val" }' });
  });

  it('llm:formatMcpConfig returns error on failure', async () => {
    const { McpConfigLlmFormatter } = await import('../../../lib/llm/mcpConfigLlmFormatter');
    (McpConfigLlmFormatter.formatMcpConfig as any).mockRejectedValueOnce(new Error('format fail'));
    const result = await getHandler('llm:formatMcpConfig')({}, 'config');
    expect(result).toEqual({ success: false, error: 'format fail' });
  });

  // --- Chat title ---

  it('llm:generateChatTitle returns title', async () => {
    const result = await getHandler('llm:generateChatTitle')({}, 'Tell me about cats');
    expect(result).toEqual({ success: true, data: 'Chat about cats' });
  });

  it('llm:generateChatTitle returns error on failure', async () => {
    const { ChatSessionTitleLlmSummarizer } = await import('../../../lib/llm/chatSessionTitleLlmSummarizer');
    (ChatSessionTitleLlmSummarizer.generateTitle as any).mockRejectedValueOnce(new Error('title fail'));
    const result = await getHandler('llm:generateChatTitle')({}, 'message');
    expect(result).toEqual({ success: false, error: 'title fail' });
  });

  // --- File name ---

  it('llm:generateFileName returns file name', async () => {
    const result = await getHandler('llm:generateFileName')({}, 'some content');
    expect(result).toEqual({ success: true, data: 'document.md' });
  });

  // --- Document summary ---

  it('llm:generateDocumentSummary returns summary on success', async () => {
    const result = await getHandler('llm:generateDocumentSummary')({}, 'doc.pdf', 'content here', false);
    expect(result).toEqual({ success: true, data: { success: true, summary: 'A summary' } });
    expect(mockLoggerInfo).toHaveBeenCalled();
  });

  it('llm:generateDocumentSummary logs zero lengths for missing content and summary', async () => {
    const { DocumentSummaryLlmGenerator } = await import('../../../lib/llm/documentSummaryLlmGenerator');
    (DocumentSummaryLlmGenerator.generateSummary as any).mockResolvedValueOnce({ success: true });

    const result = await getHandler('llm:generateDocumentSummary')({}, 'empty.pdf', undefined, false);

    expect(result).toEqual({ success: true, data: { success: true } });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('contentLength=0'),
      'llm:generateDocumentSummary',
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('summaryLength=0'),
      'llm:generateDocumentSummary',
    );
  });

  it('llm:generateDocumentSummary truncates long summary snippets in logs', async () => {
    const { DocumentSummaryLlmGenerator } = await import('../../../lib/llm/documentSummaryLlmGenerator');
    const longSummary = 'x'.repeat(121);
    (DocumentSummaryLlmGenerator.generateSummary as any).mockResolvedValueOnce({
      success: true,
      summary: longSummary,
    });

    const result = await getHandler('llm:generateDocumentSummary')({}, 'long.pdf', 'content', false);

    expect(result).toEqual({ success: true, data: { success: true, summary: longSummary } });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining(`summary="${'x'.repeat(120)}..."`),
      'llm:generateDocumentSummary',
    );
  });

  it('llm:generateDocumentSummary logs warning when generation fails', async () => {
    const { DocumentSummaryLlmGenerator } = await import('../../../lib/llm/documentSummaryLlmGenerator');
    (DocumentSummaryLlmGenerator.generateSummary as any).mockResolvedValueOnce({
      success: false,
      warnings: ['too short'],
      errors: [],
    });
    const result = await getHandler('llm:generateDocumentSummary')({}, 'doc.pdf', 'short', false);
    expect(result.success).toBe(true);
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it('llm:generateDocumentSummary returns error on exception', async () => {
    const { DocumentSummaryLlmGenerator } = await import('../../../lib/llm/documentSummaryLlmGenerator');
    (DocumentSummaryLlmGenerator.generateSummary as any).mockRejectedValueOnce(new Error('crash'));
    const result = await getHandler('llm:generateDocumentSummary')({}, 'doc.pdf', 'text', false);
    expect(result).toEqual({ success: false, error: 'crash' });
    expect(mockLoggerError).toHaveBeenCalled();
  });

  // --- Embeddings ---

  it('llm:embedText returns embedding', async () => {
    const result = await getHandler('llm:embedText')({}, 'hello');
    expect(mockEmbed).toHaveBeenCalledWith('hello');
    expect(result).toEqual({ success: true, data: [0.1, 0.2, 0.3] });
  });

  it('llm:embedText returns error on failure', async () => {
    mockEmbed.mockRejectedValueOnce(new Error('embed fail'));
    const result = await getHandler('llm:embedText')({}, 'hello');
    expect(result).toEqual({ success: false, error: 'embed fail' });
  });

  it('llm:embedBatch returns batch embeddings', async () => {
    const result = await getHandler('llm:embedBatch')({}, ['hello', 'world']);
    expect(mockEmbedBatch).toHaveBeenCalledWith(['hello', 'world']);
    expect(result).toEqual({ success: true, data: [[0.1], [0.2]] });
  });

  // --- Models ---

  it('models:getAllModels ensures ready and returns models', async () => {
    const result = await getHandler('models:getAllModels')();
    expect(mockEnsureModelsReady).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [{ id: 'gpt-4o' }] });
  });

  it('models:getAllModels returns error on failure', async () => {
    mockEnsureModelsReady.mockRejectedValueOnce(new Error('models fail'));
    const result = await getHandler('models:getAllModels')();
    expect(result).toEqual({ success: false, error: 'models fail' });
  });

  it('models:getAllOpenKosmosUsedModels returns openkosmos models', async () => {
    const result = await getHandler('models:getAllOpenKosmosUsedModels')();
    expect(result).toEqual({ success: true, data: [{ id: 'gpt-4o' }] });
  });

  it('models:getModelById returns model', async () => {
    const result = await getHandler('models:getModelById')({}, 'gpt-4o');
    expect(mockGetModelById).toHaveBeenCalledWith('gpt-4o');
    expect(result).toEqual({ success: true, data: { id: 'gpt-4o', name: 'GPT-4o' } });
  });

  it('models:getModelCapabilities returns capabilities', async () => {
    const result = await getHandler('models:getModelCapabilities')({}, 'gpt-4o');
    expect(mockGetModelCapabilities).toHaveBeenCalledWith('gpt-4o');
    expect(result).toEqual({ success: true, data: { vision: true } });
  });

  it('models:validateModelId returns true for valid model', async () => {
    const result = await getHandler('models:validateModelId')({}, 'gpt-4o');
    expect(result).toEqual({ success: true, data: true });
  });

  it('models:validateModelId returns false for invalid model', async () => {
    mockValidateModelId.mockReturnValueOnce(false);
    const result = await getHandler('models:validateModelId')({}, 'bad-model');
    expect(result).toEqual({ success: true, data: false });
  });

  it('models:getDefaultModel returns default model', async () => {
    const result = await getHandler('models:getDefaultModel')();
    expect(result).toEqual({ success: true, data: { id: 'gpt-4o' } });
  });

  it('models:isReasoningModel returns false for non-reasoning model', async () => {
    const result = await getHandler('models:isReasoningModel')({}, 'gpt-4o');
    expect(result).toEqual({ success: true, data: false });
  });

  it('models:isReasoningModel returns true for reasoning model', async () => {
    mockIsReasoningModel.mockReturnValueOnce(true);
    const result = await getHandler('models:isReasoningModel')({}, 'o1');
    expect(result).toEqual({ success: true, data: true });
  });

  it('models:isReasoningModel returns error on failure', async () => {
    mockEnsureModelsReady.mockRejectedValueOnce(new Error('ready fail'));
    const result = await getHandler('models:isReasoningModel')({}, 'o1');
    expect(result).toEqual({ success: false, error: 'ready fail' });
  });
});
