// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentChatEditingLayout from '../AgentChatEditingLayout';

vi.mock('../../agent-editor/AgentBasicTab', () => ({
  default: (props) => (
    <button data-testid="tab-basic" onClick={() => { props.onDataChange('basic', { name: 'changed' }); props.onSave('basic'); }}>
      Basic Tab {props.readOnly ? 'read-only' : 'editable'} {props.cachedData?.name ?? 'no-cache'}
    </button>
  ),
}));

vi.mock('../../agent-editor/AgentKnowledgeBaseTab', () => ({
  default: (props) => (
    <button data-testid="tab-knowledge" onClick={() => { props.onDataChange('knowledge', { files: [] }); props.onSave('knowledge'); }}>
      Knowledge Tab {props.readOnly ? 'read-only' : 'editable'}
    </button>
  ),
}));

vi.mock('../../agent-editor/AgentMcpServersTab', () => ({
  default: (props) => (
    <button data-testid="tab-mcp" onClick={() => { props.onDataChange('mcp', { servers: [] }); props.onSave('mcp'); }}>
      MCP Tab {props.readOnly ? 'read-only' : 'editable'}
    </button>
  ),
}));

vi.mock('../../agent-editor/AgentSkillsTab', () => ({
  default: (props) => (
    <button data-testid="tab-skills" onClick={() => { props.onDataChange('skills', { skills: [] }); props.onSave('skills'); }}>
      Skills Tab {props.readOnly ? 'read-only' : 'editable'}
    </button>
  ),
}));

vi.mock('../../agent-editor/AgentHooksTab', () => ({
  default: (props) => (
    <button data-testid="tab-hooks" onClick={() => { props.onDataChange('hooks', { hooks: [] }); props.onSave('hooks'); }}>
      Hooks Tab {props.readOnly ? 'read-only' : 'editable'}
    </button>
  ),
}));

vi.mock('../../agent-editor/AgentSchedulesTab', () => ({
  default: (props) => (
    <button data-testid="tab-schedules" onClick={() => { props.onDataChange('schedules', { schedules: [] }); props.onSave('schedules'); }}>
      Schedules Tab {props.readOnly ? 'read-only' : 'editable'}
    </button>
  ),
}));


vi.mock('../../agent-editor/AgentSystemPromptTab', () => ({
  default: (props) => (
    <button data-testid="tab-prompt" onClick={() => { props.onDataChange('prompt', { prompt: 'new' }); props.onSave('prompt'); }}>
      Prompt Tab {props.readOnly ? 'read-only' : 'editable'}
    </button>
  ),
}));

vi.mock('../../agent-editor/ErrorHandler', () => ({
  default: ({ error, onDismiss }) => <button data-testid="error-handler" onClick={onDismiss}>{error}</button>,
}));

const baseTabsEnabled = {
  basic: true,
  knowledge: true,
  mcp: true,
  skills: true,
  hooks: true,
  schedules: true,
  prompt: true,
};

const basePendingChanges = {
  basic: false,
  knowledge: false,
  mcp: false,
  skills: false,
  hooks: false,
  schedules: false,
  prompt: false,
};

const baseReadOnlyFlags = {
  basic: false,
  knowledge: false,
  mcp: false,
  skills: false,
  hooks: false,
  schedules: false,
  prompt: false,
};

const baseTabChangesCache = {
  basic: { name: 'cached-basic' },
  knowledge: { folders: [] },
  mcp: { servers: [] },
  skills: { skills: [] },
  hooks: { hooks: [] },
  schedules: { schedules: [] },
  prompt: { prompt: 'cached prompt' },
};

function makeProps(overrides = {}) {
  return {
    chatId: 'agent-1',
    agentData: { id: 'agent-1', name: 'Demo Agent' },
    error: '',
    isLoading: false,
    fieldErrors: { name: 'Required' },
    tabResetKey: 7,
    tabState: {
      activeTab: 'basic',
      tabsEnabled: { ...baseTabsEnabled },
    },
    pendingChanges: { ...basePendingChanges },
    tabChangesCache: { ...baseTabChangesCache },
    isKnowledgeGroupExpanded: true,
    isPromptGroupExpanded: true,
    activePromptFile: 'Base.md',
    readOnlyFlags: { ...baseReadOnlyFlags },
    schedulerEnabled: true,
    showKnowledgeSourcesGroup: true,
    canSaveAll: false,
    handleTabSwitch: vi.fn(),
    handleKnowledgeGroupToggle: vi.fn(),
    handlePromptGroupToggle: vi.fn(),
    handlePromptFileSwitch: vi.fn(),
    handleClearError: vi.fn(),
    handleSave: vi.fn(),
    handleSaveAll: vi.fn(),
    handleBackToChat: vi.fn(),
    handleTabDataChange: vi.fn(),
    navigateToChatList: vi.fn(),
    ...overrides,
  };
}

function renderLayout(overrides = {}) {
  const props = makeProps(overrides);
  return { props, ...render(<AgentChatEditingLayout {...props} />) };
}

describe('AgentChatEditingLayout', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the no-agent fallback and navigates back to chat list', () => {
    const { props } = renderLayout({ chatId: '' });

    expect(screen.getByText('No agent selected. Please select an agent from the left navigation.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Chat' }));

    expect(props.navigateToChatList).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Agent Settings')).not.toBeInTheDocument();
  });

  it('shows editable agent settings, tab indicators, and neutral save styles when there are no changes', () => {
    const pendingChanges = Object.fromEntries(Object.keys(basePendingChanges).map((key) => [key, true]));
    const { props, container } = renderLayout({
      pendingChanges,
      readOnlyFlags: { ...baseReadOnlyFlags, basic: true },
    });

    expect(screen.getByText('Demo Agent - Settings')).toBeInTheDocument();
    expect(screen.getByTestId('tab-basic')).toHaveTextContent('read-only');
    expect(screen.getAllByText('●')).toHaveLength(7);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute('title', 'No Changes to Save');
    expect(saveButton.style.backgroundColor).toBe('var(--button-disabled-bg)');
    expect(saveButton.style.color).toBe('var(--button-disabled-fg)');
    expect(saveButton.style.cursor).toBe('not-allowed');
    expect(saveButton.style.opacity).toBe('1');
    expect(container.querySelector('.btn-save')?.className).toBe('btn-save ');

    fireEvent.click(screen.getByTitle('Back to Chat'));
    fireEvent.click(screen.getByTestId('tab-basic'));

    expect(props.handleBackToChat).toHaveBeenCalledTimes(1);
    expect(props.handleTabDataChange).toHaveBeenCalledWith('basic', { name: 'changed' });
    expect(props.handleSave).toHaveBeenCalledWith('basic');
  });

  it('enables saving, shows loading and errors, and dispatches header actions', () => {
    const { props, container } = renderLayout({
      agentData: null,
      error: 'Save failed',
      isLoading: true,
      canSaveAll: true,
    });

    expect(screen.getByText('Agent Settings')).toBeInTheDocument();
    expect(screen.getAllByText('Saving...')).toHaveLength(2);
    expect(screen.getByText('🔄')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'Saving...' });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute('title', 'Saving...');
    expect(saveButton.style.backgroundColor).toBe('var(--color-danger-600)');
    expect(saveButton.style.color).toBe('white');
    expect(saveButton.style.cursor).toBe('not-allowed');
    expect(saveButton.style.opacity).toBe('0.7');
    expect(container.querySelector('.btn-save')?.className).toBe('btn-save has-changes');

    fireEvent.click(screen.getByTestId('error-handler'));
    expect(props.handleClearError).toHaveBeenCalledTimes(1);
  });

  it('saves all changes when enabled and routes top-level navigation tabs', () => {
    const { props } = renderLayout({ canSaveAll: true });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveAttribute('title', 'Save All Changes');
    expect(saveButton.style.cursor).toBe('pointer');
    fireEvent.click(saveButton);
    expect(props.handleSaveAll).toHaveBeenCalledTimes(1);

    for (const tabName of ['Basic', 'MCP Servers', 'Skills', 'Hooks', 'Schedules']) {
      fireEvent.click(screen.getByText(tabName));
    }
    fireEvent.click(screen.getByText('System Prompt'));
    fireEvent.click(screen.getByText('Project Context'));

    expect(props.handleTabSwitch).toHaveBeenCalledWith('basic');
    expect(props.handleTabSwitch).toHaveBeenCalledWith('mcp');
    expect(props.handleTabSwitch).toHaveBeenCalledWith('skills');
    expect(props.handleTabSwitch).toHaveBeenCalledWith('hooks');
    expect(props.handleTabSwitch).toHaveBeenCalledWith('schedules');
    expect(props.handlePromptGroupToggle).toHaveBeenCalledTimes(1);
    expect(props.handlePromptFileSwitch).toHaveBeenCalledWith('AGENTS.md');
  });
  it('renders grouped knowledge navigation and toggles the group', () => {
    const { props, container } = renderLayout({
      tabState: { activeTab: 'knowledge', tabsEnabled: { ...baseTabsEnabled, knowledge: true } },
      pendingChanges: { ...basePendingChanges, knowledge: true },
    });

    expect(screen.getByTestId('tab-knowledge')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.nav-group-trigger')!);
    fireEvent.click(screen.getByRole('button', { name: /Knowledge Folder/ }));

    expect(props.handleKnowledgeGroupToggle).toHaveBeenCalledTimes(1);
    expect(props.handleTabSwitch).toHaveBeenCalledWith('knowledge');
  });

  it('renders flat knowledge navigation when the group is hidden', () => {
    const { props } = renderLayout({
      showKnowledgeSourcesGroup: false,
      isKnowledgeGroupExpanded: false,
      tabState: { activeTab: 'knowledge', tabsEnabled: { ...baseTabsEnabled, knowledge: true } },
    });

    fireEvent.click(screen.getByText('Knowledge'));

    expect(props.handleTabSwitch).toHaveBeenCalledWith('knowledge');
    expect(screen.queryByText('Knowledge Folder')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-knowledge')).toBeInTheDocument();
  });

  it('hides optional tabs and omits disabled selected tab content', () => {
    renderLayout({
      schedulerEnabled: false,
      showKnowledgeSourcesGroup: false,
      tabState: {
        activeTab: 'knowledge',
        tabsEnabled: { ...baseTabsEnabled, knowledge: false },
      },
    });
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument();
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-knowledge')).not.toBeInTheDocument();
    expect(screen.getByText('Knowledge').className).toContain('disabled');
  });

  it('renders every enabled tab panel and forwards tab callbacks', () => {
    const cases = [
      ['mcp', 'tab-mcp', 'mcp'],
      ['skills', 'tab-skills', 'skills'],
      ['hooks', 'tab-hooks', 'hooks'],
      ['schedules', 'tab-schedules', 'schedules'],
      ['prompt', 'tab-prompt', 'prompt'],
    ];

    for (const [activeTab, testId, saveKey] of cases) {
      cleanup();
      const { props } = renderLayout({
        tabState: { activeTab, tabsEnabled: { ...baseTabsEnabled } },
        readOnlyFlags: { ...baseReadOnlyFlags, [activeTab]: true },
      });

      const panel = screen.getByTestId(testId);
      expect(panel).toHaveTextContent('read-only');
      fireEvent.click(panel);
      expect(props.handleSave).toHaveBeenCalledWith(saveKey);
    }
  });

  it('does not render optional selected panels when their feature flags are disabled', () => {
    const cases = [
      ['schedules', 'tab-schedules', { schedulerEnabled: false }],
      ['prompt', 'tab-prompt', { tabState: { activeTab: 'prompt', tabsEnabled: { ...baseTabsEnabled, prompt: false } } }],
    ];

    for (const [activeTab, testId, overrides] of cases) {
      cleanup();
      renderLayout({
        tabState: { activeTab, tabsEnabled: { ...baseTabsEnabled } },
        ...overrides,
      });
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });
});
