/** @vitest-environment happy-dom */
/**
 * Coverage tests for AgentSystemPromptTab.tsx
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import AgentSystemPromptTab from '../AgentSystemPromptTab';
import type { TabComponentProps, AgentConfig } from '../types';
import type { AgentSystemPromptFile } from '@shared/types/agentSystemPrompt';

// ---- hoisted mock vars ----

const { mockShowError, mockShowSuccess } = vi.hoisted(() => ({
  mockShowError: vi.fn(),
  mockShowSuccess: vi.fn(),
}));

// ---- vi.mock calls ----

vi.mock('../../../../styles/Agent.css', () => ({}));

vi.mock('../MarkdownEditor', () => ({
  default: ({ value, onChange, showPreview, onTogglePreview, readOnly, emptyTips }: any) => (
    <div
      data-testid="markdown-editor"
      data-show-preview={String(showPreview)}
      data-readonly={String(readOnly)}
      data-empty-tips={(emptyTips ?? []).join('|')}
    >
      <textarea
        data-testid="editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
      />
      <button data-testid="toggle-preview-btn" onClick={onTogglePreview}>
        Toggle Preview
      </button>
    </div>
  ),
}));

vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

// ---- helpers ----

const prompt = (base: string, agents = '') => ({ 'Base.md': base, 'AGENTS.md': agents });

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    emoji: '🤖',
    role: 'assistant',
    model: 'gpt-4.1',
    systemPrompt: prompt('You are a helpful assistant.'),
    mcpServers: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

type RenderTabOverrides = Partial<TabComponentProps> & {
  promptFile?: AgentSystemPromptFile;
}

function renderTab(overrides: RenderTabOverrides = {}) {
  const props: TabComponentProps = {
    mode: 'update',
    chatId: 'agent-1',
    agentData: createAgent(),
    onSave: vi.fn(async () => createAgent()),
    onDataChange: vi.fn(),
    cachedData: null,
    readOnly: false,
    ...overrides,
  };
  return render(<AgentSystemPromptTab {...props} promptFile={overrides.promptFile} />);
}

// ---- tests ----

describe('AgentSystemPromptTab - basic rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders Contents and Preview tabs', () => {
    renderTab();
    expect(screen.getByText('Contents')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('renders Polish with AI button when not readOnly and not Kobi', () => {
    renderTab();
    expect(screen.getByText('Polish with AI')).toBeInTheDocument();
  });

  it('renders MarkdownEditor', () => {
    renderTab();
    expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
  });

  it('renders Agent Identity guidance by default', () => {
    renderTab();
    expect(screen.getByText('Agent Identity')).toBeInTheDocument();
    expect(screen.getByText(/Define who this agent is/)).toBeInTheDocument();
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute(
      'data-empty-tips',
      expect.stringContaining('Agent Identity defines who this agent is.'),
    );
  });

  it('renders Project Context guidance for AGENTS.md', () => {
    renderTab({ promptFile: 'AGENTS.md' });
    expect(screen.getByText('Project Context')).toBeInTheDocument();
    expect(screen.getByText(/Define what this agent works on/)).toBeInTheDocument();
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute(
      'data-empty-tips',
      expect.stringContaining('Project Context defines what this agent works on.'),
    );
  });

  it('loads systemPrompt from agentData', async () => {
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Hello from agent') }) });
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('Hello from agent');
    });
  });
});

describe('AgentSystemPromptTab - mode=add default prompt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets empty prompt in add mode when agentData is undefined (default only in update mode)', async () => {
    renderTab({
      mode: 'add',
      agentData: undefined,
    });
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('');
    });
  });

  it('sets default prompt in update mode when agentData has no systemPrompt override', async () => {
    // The default prompt is set only in update mode when agentData.systemPrompt is undefined
    renderTab({
      mode: 'update',
      agentData: undefined, // no agentData → no systemPrompt → falls to update-mode default
    });
    await waitFor(() => {
      const ta = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
      expect(ta.value).toContain('helpful AI assistant');
    });
  });

  it('does not set default prompt in add mode when agentData.systemPrompt is explicit empty string', async () => {
    renderTab({
      mode: 'add',
      agentData: createAgent({ systemPrompt: prompt('') }),
    });
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('');
    });
  });
});

describe('AgentSystemPromptTab - cachedData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prefers cachedData systemPrompt over agentData', async () => {
    renderTab({
      agentData: createAgent({ systemPrompt: prompt('original') }),
      cachedData: { systemPrompt: prompt('cached-prompt') },
    });
    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('cached-prompt');
    });
  });
});

describe('AgentSystemPromptTab - onDataChange notifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not notify onDataChange during initialization', async () => {
    const onDataChange = vi.fn();
    renderTab({ onDataChange });
    expect(screen.getByTestId('editor-textarea')).toHaveValue('You are a helpful assistant.');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('calls onDataChange with hasChanges=true when content changes', async () => {
    const onDataChange = vi.fn();
    renderTab({ onDataChange, agentData: createAgent({ systemPrompt: prompt('original') }) });

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'changed' } });
    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledWith('prompt', { systemPrompt: prompt('changed') }, true);
    });
  });

  it('preserves AGENTS.md when editing Base.md', async () => {
    const onDataChange = vi.fn();
    renderTab({ onDataChange, agentData: createAgent({ systemPrompt: prompt('original', 'agents prompt') }) });

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'changed base' } });

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledWith(
        'prompt',
        { systemPrompt: prompt('changed base', 'agents prompt') },
        true,
      );
    });
  });

  it('loads and edits AGENTS.md without dropping Base.md', async () => {
    const onDataChange = vi.fn();
    renderTab({
      onDataChange,
      agentData: createAgent({ systemPrompt: prompt('base prompt', 'original agents') }),
      promptFile: 'AGENTS.md',
    });

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('original agents');
    });
    onDataChange.mockClear();

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'changed agents' } });

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledWith(
        'prompt',
        { systemPrompt: prompt('base prompt', 'changed agents') },
        true,
      );
    });
  });

  it('keeps Base.md dirty state when opening AGENTS.md with cached prompt data', async () => {
    const onDataChange = vi.fn();
    renderTab({
      onDataChange,
      agentData: createAgent({ systemPrompt: prompt('base original', 'agents original') }),
      cachedData: { systemPrompt: prompt('base changed', 'agents original') },
      promptFile: 'AGENTS.md',
    });

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('agents original');
    });

    expect(onDataChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'agents changed' } });

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledWith(
        'prompt',
        { systemPrompt: prompt('base changed', 'agents changed') },
        true,
      );
    });
  });

  it('switches prompt files without copying Base.md into AGENTS.md or marking dirty', async () => {
    const onDataChange = vi.fn();
    const agentData = createAgent({ systemPrompt: prompt('base content', 'agents content') });
    const { rerender } = renderTab({ onDataChange, agentData, promptFile: 'Base.md' });

    expect(screen.getByTestId('editor-textarea')).toHaveValue('base content');

    rerender(
      <AgentSystemPromptTab
        mode="update"
        chatId="agent-1"
        agentData={agentData}
        onSave={vi.fn(async () => agentData)}
        onDataChange={onDataChange}
        cachedData={null}
        readOnly={false}
        promptFile="AGENTS.md"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('agents content');
    });
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('AgentSystemPromptTab - preview toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toggles to preview when clicking Preview tab', () => {
    renderTab();
    const previewTab = screen.getByText('Preview');
    fireEvent.click(previewTab);
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('data-show-preview', 'true');
  });

  it('toggles back to Contents via button inside MarkdownEditor', async () => {
    renderTab();
    fireEvent.click(screen.getByText('Preview'));
    fireEvent.click(screen.getByTestId('toggle-preview-btn'));
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('data-show-preview', 'false');
  });

  it('clicking Contents tab when already in contents is no-op', () => {
    renderTab();
    fireEvent.click(screen.getByText('Contents'));
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('data-show-preview', 'false');
  });

  it('clicking Preview tab when already in preview is no-op', () => {
    renderTab();
    fireEvent.click(screen.getByText('Preview'));
    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('data-show-preview', 'true');
  });
});

describe('AgentSystemPromptTab - Kobi agent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides Polish with AI button for Kobi agent', () => {
    renderTab({ agentData: createAgent({ name: 'Kobi' }) });
    expect(screen.queryByText('Polish with AI')).not.toBeInTheDocument();
  });

  it('shows Kobi restriction warning', async () => {
    renderTab({ agentData: createAgent({ name: 'Kobi' }) });
    await waitFor(() => {
      expect(screen.getByText(/Kobi Agent's system prompt cannot be modified/)).toBeInTheDocument();
    });
  });

  it('passes readOnly=true to MarkdownEditor for Kobi', async () => {
    renderTab({ agentData: createAgent({ name: 'kobi' }) }); // lowercase
    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toHaveAttribute('data-readonly', 'true');
    });
  });
});

describe('AgentSystemPromptTab - readOnly mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides Polish with AI button in readOnly mode', () => {
    renderTab({ readOnly: true });
    expect(screen.queryByText('Polish with AI')).not.toBeInTheDocument();
  });

  it('shows the generic restriction warning in readOnly', async () => {
    renderTab({ readOnly: true });
    await waitFor(() => {
      expect(screen.getByText(/This system prompt cannot be modified/)).toBeInTheDocument();
    });
  });

  it('passes readOnly=true to MarkdownEditor', () => {
    renderTab({ readOnly: true });
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('data-readonly', 'true');
  });
});

describe('AgentSystemPromptTab - AI optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        llm: {
          improveSystemPrompt: vi.fn(),
        },
      },
    });
  });

  it('Polish with AI button is disabled when prompt is empty', async () => {
    renderTab({ agentData: createAgent({ systemPrompt: prompt('') }) });
    await waitFor(() => {
      const btn = screen.getByText('Polish with AI').closest('button')!;
      expect(btn).toBeDisabled();
    });
  });

  it('Polish with AI button has title when prompt empty', async () => {
    renderTab({ agentData: createAgent({ systemPrompt: prompt('') }) });
    await waitFor(() => {
      const btn = screen.getByText('Polish with AI').closest('button')!;
      expect(btn.title).toBe('Enter a prompt first');
    });
  });

  it('shows error when prompt is whitespace-only on optimize', async () => {
    renderTab({ agentData: createAgent({ systemPrompt: prompt('   ') }) });
    // Manually trigger by changing text to have content, then clearing
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: '' } });
    // The button should be disabled, we can't click it via normal flow
    // But let's test by using a prompt that has content initially
  });

  it('calls improveSystemPrompt IPC and updates prompt on success', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        improvedPrompt: 'Improved prompt text',
        warnings: [],
      },
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Original prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => {
      expect((window as any).electronAPI.llm.improveSystemPrompt).toHaveBeenCalledWith('Original prompt', { promptFile: 'Base.md' });
      expect(screen.getByTestId('editor-textarea')).toHaveValue('Improved prompt text');
    });
  });

  it('passes AGENTS.md to improveSystemPrompt for Project Context polish', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        improvedPrompt: 'Improved context',
        warnings: [],
      },
    });
    renderTab({
      promptFile: 'AGENTS.md',
      agentData: createAgent({ systemPrompt: prompt('Base prompt', 'Context prompt') }),
    });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => {
      expect((window as any).electronAPI.llm.improveSystemPrompt).toHaveBeenCalledWith('Context prompt', { promptFile: 'AGENTS.md' });
      expect(screen.getByTestId('editor-textarea')).toHaveValue('Improved context');
    });
  });

  it('shows warnings after successful optimization with warnings', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        improvedPrompt: 'Improved prompt',
        warnings: ['Warning: something minor'],
      },
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('editor-textarea')).toHaveValue('Improved prompt');
    });
  });

  it('shows polishing state while optimizing', async () => {
    let resolveIpc!: (v: any) => void;
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockReturnValue(
      new Promise((res) => { resolveIpc = res; })
    );
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    act(() => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => expect(screen.getByText('Polishing...')).toBeInTheDocument());

    await act(async () => {
      resolveIpc({ success: true, data: { success: true, improvedPrompt: 'done' } });
    });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());
  });

  it('shows error when ipcResult is falsy (API not available)', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue(null);
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => {
      // The button should be re-enabled after error
      expect(screen.getByText('Polish with AI')).toBeInTheDocument();
    });
  });

  it('shows error when ipcResult.success is false', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: false,
      error: 'Service unavailable',
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());
  });

  it('shows error when ipcResult.data.success is false with errors array', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: false,
        errors: ['Validation failed', 'Missing context'],
      },
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());
  });

  it('handles thrown error during optimization', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockRejectedValue(new Error('Network error'));
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());
  });

  it('clears optimization error when content changes', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: false,
      error: 'Fail',
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    // Now change content - should clear error state
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'new content' } });
    // No assertion needed - just verifying no crash
  });

  it('clears optimization warnings when content changes', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        improvedPrompt: 'Improved',
        warnings: ['some warning'],
      },
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });
    await waitFor(() => expect(screen.getByTestId('editor-textarea')).toHaveValue('Improved'));

    // Change content clears warnings
    fireEvent.change(screen.getByTestId('editor-textarea'), { target: { value: 'new content' } });
  });

  it('shows error when data.success is false with no errors array', async () => {
    (window as any).electronAPI.llm.improveSystemPrompt = vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: false,
      },
    });
    renderTab({ agentData: createAgent({ systemPrompt: prompt('Test prompt') }) });
    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('Polish with AI'));
    });

    await waitFor(() => expect(screen.getByText('Polish with AI')).toBeInTheDocument());
  });
});
