/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for CreateCustomAgentViewContent.tsx
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateCustomAgentViewContent from '../CreateCustomAgentViewContent';

// ---- mock variables ----

const mockNavigate = vi.fn();
const mockAddChat = vi.fn();
const mockShowToast = vi.fn();

const { mockGetDefaultModel, mockGetAllOpenKosmosUsedModels } = vi.hoisted(() => ({
  mockGetDefaultModel: vi.fn().mockReturnValue('gpt-4.1'),
  mockGetAllOpenKosmosUsedModels: vi.fn().mockReturnValue([
    {
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      capabilities: {
        family: 'gpt4',
        supports: { tool_calls: true, vision: true },
      },
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: {
        family: 'gpt4',
        supports: { tool_calls: false, vision: false },
      },
    },
  ]),
}));

const { mockProfileDataManager } = vi.hoisted(() => ({
  mockProfileDataManager: {
    getChatConfigs: vi.fn().mockReturnValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

const { mockChats } = vi.hoisted(() => ({
  mockChats: [] as any[],
}));

const { mockUseStableChats } = vi.hoisted(() => ({
  mockUseStableChats: { value: false },
}));

const mockUseScrollSelectedIntoView = vi.fn().mockReturnValue({ current: null });
const mockUseFeatureFlag = vi.fn().mockReturnValue(false);

// ---- vi.mock calls ----

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../userData/userDataProvider', () => ({
  useChats: () => ({
    addChat: mockAddChat,
    chats: mockUseStableChats.value ? mockChats : [...mockChats],
  }),
}));

vi.mock('../../../ui/ToastProvider', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('../../../../lib/models/ghcModels', () => ({
  getDefaultModel: () => mockGetDefaultModel(),
  getAllOpenKosmosUsedModels: () => mockGetAllOpenKosmosUsedModels(),
}));

vi.mock('../../../../lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('../../agent-editor/EmojiPicker', () => ({
  default: ({ isOpen, onClose, onEmojiSelect }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="emoji-picker">
        <button onClick={() => onEmojiSelect('🎉')}>Select Emoji</button>
        <button onClick={onClose}>Close Picker</button>
      </div>
    );
  },
}));

vi.mock('../../../../../shared/constants/builtinSkills', () => ({
  BUILTIN_SKILL_NAMES: ['skill-a', 'skill-b'],
  BUILTIN_DEFAULTS_VERSION: 1,
}));

vi.mock('../../../../styles/AgentChatCreation.css', () => ({}));

vi.mock('../../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../../lib/featureFlags', () => ({
  useFeatureFlag: (...args: any[]) => mockUseFeatureFlag(...args),
}));

vi.mock('../../../../lib/hooks/useScrollSelectedIntoView', () => ({
  useScrollSelectedIntoView: () => mockUseScrollSelectedIntoView(),
}));

// ---- tests ----

beforeEach(() => {
  mockUseStableChats.value = false;
});

describe('CreateCustomAgentViewContent - rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.length = 0;
    mockGetDefaultModel.mockReturnValue('gpt-4.1');
    mockGetAllOpenKosmosUsedModels.mockReturnValue([
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        capabilities: {
          family: 'gpt4',
          supports: { tool_calls: true, vision: true },
        },
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: {
          family: 'gpt4',
          supports: { tool_calls: false, vision: false },
        },
      },
    ]);
    mockAddChat.mockResolvedValue({ success: true, data: { chat_id: 'new-chat-1' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
    mockUseFeatureFlag.mockReturnValue(false);
  });

  it('renders basic form elements', () => {
    render(<CreateCustomAgentViewContent />);
    expect(screen.getByText('Agent Avatar')).toBeInTheDocument();
    expect(screen.getByText('Agent Name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter agent name...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create and Continue/ })).toBeInTheDocument();
  });

  it('shows model section when source is ON-DEVICE', () => {
    render(<CreateCustomAgentViewContent />);
    expect(screen.getByText('Agent Model')).toBeInTheDocument();
  });

  it('does not show agent source section when feature flag is off', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    render(<CreateCustomAgentViewContent />);
    expect(screen.queryByText('Agent Source')).toBeNull();
  });

  it('shows agent source section when feature flag is on', () => {
    mockUseFeatureFlag.mockReturnValue(true);
    render(<CreateCustomAgentViewContent />);
    // label text
    expect(screen.getByText('Agent Source')).toBeInTheDocument();
  });

  it('Create button is disabled initially (no name)', () => {
    render(<CreateCustomAgentViewContent />);
    expect(screen.getByRole('button', { name: /Create and Continue/ })).toBeDisabled();
  });

  it('shows Select Model when the default model is unavailable', () => {
    mockGetDefaultModel.mockReturnValueOnce('missing-model');

    render(<CreateCustomAgentViewContent />);

    expect(screen.getByText('Select Model')).toBeInTheDocument();
  });
});

describe('CreateCustomAgentViewContent - name input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.length = 0;
    mockAddChat.mockResolvedValue({ success: true, data: { chat_id: 'new-chat-1' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
    mockUseFeatureFlag.mockReturnValue(false);
  });

  it('enables Create button when valid name is entered', async () => {
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'My Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
  });

  it('accepts input value', () => {
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'TestAgent' },
    });
    expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('TestAgent');
  });

  it('shows a duplicate-name warning while typing an existing agent name', async () => {
    mockChats.push({ agent: { name: 'Duplicate Agent' } });

    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Duplicate Agent' },
    });

    expect(await screen.findByText('⚠️ This agent name already exists')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter agent name...')).toHaveClass('warning');
    expect(screen.getByRole('button', { name: /Create and Continue/ })).toBeDisabled();
  });
});

describe('CreateCustomAgentViewContent - emoji picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.length = 0;
    mockUseFeatureFlag.mockReturnValue(false);
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
  });

  it('opens emoji picker on avatar click', () => {
    render(<CreateCustomAgentViewContent />);
    const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
    fireEvent.click(emojiDisplay);
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument();
  });

  it('closes emoji picker on close button', () => {
    render(<CreateCustomAgentViewContent />);
    const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
    fireEvent.click(emojiDisplay);
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Picker'));
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
  });

  it('selects emoji and closes picker', () => {
    render(<CreateCustomAgentViewContent />);
    const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
    fireEvent.click(emojiDisplay);
    fireEvent.click(screen.getByText('Select Emoji'));
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
  });
});

describe('CreateCustomAgentViewContent - model dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.length = 0;
    mockUseFeatureFlag.mockReturnValue(false);
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
  });

  it('opens model dropdown on button click', () => {
    render(<CreateCustomAgentViewContent />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    // GPT-4o only appears in dropdown (GPT-4.1 appears in button too)
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
  });

  it('selects a model and closes dropdown', () => {
    render(<CreateCustomAgentViewContent />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    fireEvent.click(screen.getByText('GPT-4o'));
    // Dropdown should close - model-dropdown gone
    expect(document.querySelector('.model-dropdown')).toBeNull();
  });

  it('closes dropdown when clicking outside', () => {
    render(<CreateCustomAgentViewContent />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    expect(document.querySelector('.model-dropdown')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.model-dropdown')).toBeNull();
  });

  it('keeps dropdown open when clicking inside and renders reasoning badges', () => {
    mockGetAllOpenKosmosUsedModels.mockReturnValueOnce([
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        capabilities: { family: 'gpt4', supports: { tool_calls: true, vision: true } },
      },
      {
        id: 'o4-mini',
        name: 'o4-mini',
        capabilities: { family: 'o4', supports: { tool_calls: false, vision: false } },
      },
    ]);

    render(<CreateCustomAgentViewContent />);
    fireEvent.click(document.querySelector('.model-button') as HTMLElement);
    fireEvent.mouseDown(document.querySelector('.model-dropdown') as HTMLElement);

    expect(document.querySelector('.model-dropdown')).toBeTruthy();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
  });
});

describe('CreateCustomAgentViewContent - agent source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.length = 0;
    mockUseFeatureFlag.mockReturnValue(true);
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
  });

  it('selecting EXTERNAL source hides model section', async () => {
    render(<CreateCustomAgentViewContent />);
    // Click the External Agent button
    const externalBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('External Agent'));
    expect(externalBtn).toBeTruthy();
    fireEvent.click(externalBtn!);
    await waitFor(() => {
      expect(screen.queryByText('Agent Model')).toBeNull();
    });
  });

  it('selecting ON-DEVICE source shows model section', async () => {
    render(<CreateCustomAgentViewContent />);
    const externalBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('External Agent'));
    fireEvent.click(externalBtn!);
    await waitFor(() => {
      expect(screen.queryByText('Agent Model')).toBeNull();
    });
    const normalBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Normal Agent'));
    fireEvent.click(normalBtn!);
    expect(screen.getByText('Agent Model')).toBeInTheDocument();
  });
});

describe('CreateCustomAgentViewContent - create flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockChats.length = 0;
    mockAddChat.mockResolvedValue({ success: true, data: { chat_id: 'new-chat-1' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([{ chat_id: 'new-chat-1' }]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
    mockUseFeatureFlag.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call addChat when button is disabled', () => {
    render(<CreateCustomAgentViewContent />);
    const btn = screen.getByRole('button', { name: /Create and Continue/ });
    fireEvent.click(btn);
    expect(mockAddChat).not.toHaveBeenCalled();
  });

  it('calls addChat and navigates on success', async () => {
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'My New Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));
    await waitFor(() => {
      expect(mockAddChat).toHaveBeenCalled();
      expect(mockProfileDataManager.subscribe).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/new-chat-1/settings/workspace');
    });
  });

  it('creates an on-device agent with builtin tools and skills', async () => {
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Local Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));

    await waitFor(() => {
      expect(mockAddChat).toHaveBeenCalledWith(expect.objectContaining({
        agent: expect.objectContaining({
          source: 'ON-DEVICE',
          mcp_servers: [{ name: 'builtin-tools', tools: [] }],
          skills: ['skill-a', 'skill-b'],
        }),
      }));
    });
  });

  it('shows error toast when addChat fails', async () => {
    mockAddChat.mockResolvedValueOnce({ success: false, error: 'DB error' });
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'My New Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('DB error', 'error');
    });
  });

  it('shows the default error toast when addChat fails without an error message', async () => {
    mockAddChat.mockResolvedValueOnce({ success: false });
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'No Error Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to create agent', 'error');
    });
  });

  it('shows error toast when addChat throws', async () => {
    mockAddChat.mockRejectedValueOnce(new Error('Unexpected'));
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'My New Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to create agent', 'error');
    });
  });

  it('navigates on cancel', () => {
    render(<CreateCustomAgentViewContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation');
  });

  it('shows Creating... while creating', async () => {
    mockAddChat.mockReturnValue(new Promise(() => {}));
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Pending Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Creating...' })).toBeInTheDocument();
    });
  });

  it('navigates when the subscription reports the new chat in cache', async () => {
    mockAddChat.mockResolvedValueOnce({ success: true, data: { chat_id: 'sub-chat' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockImplementationOnce((callback) => {
      const timer = setTimeout(() => callback({ chats: [{ chat_id: 'sub-chat' }] }), 0);
      return () => clearTimeout(timer);
    });

    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Subscribed Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Agent "Subscribed Agent" created successfully!', 'success');
      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/sub-chat/settings/workspace');
    });
  });

  it('navigates anyway when the new chat never appears in cache', async () => {
    const unsubscribe = vi.fn();
    mockAddChat.mockResolvedValueOnce({ success: true, data: { chat_id: 'timeout-chat' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(unsubscribe);

    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Timeout Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(mockAddChat).toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Agent "Timeout Agent" created successfully!', 'success');
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/timeout-chat/settings/workspace');
  });

  it('guards against a duplicate name added after the form becomes valid', async () => {
    mockUseStableChats.value = true;
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Concurrent Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(document.querySelector('.model-button') as HTMLElement);
    fireEvent.click(screen.getByText('GPT-4o'));

    mockChats.push({ agent: { name: 'Concurrent Agent' } });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));

    expect(mockAddChat).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Agent name already exists. Please choose a different name.', 'error');
  });

  it('creates an external agent with external-only payload fields', async () => {
    mockUseFeatureFlag.mockReturnValue(true);
    mockAddChat.mockResolvedValueOnce({ success: true, data: { chat_id: 'external-chat' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([{ chat_id: 'external-chat' }]);

    render(<CreateCustomAgentViewContent />);
    fireEvent.click(screen.getByText('🐾 External Agent'));
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'External Agent Name' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));

    await waitFor(() => {
      expect(mockAddChat).toHaveBeenCalledWith(expect.objectContaining({
        agent: expect.objectContaining({
          source: 'EXTERNAL',
          mcp_servers: [],
          skills: [],
          authToken: expect.any(String),
        }),
      }));
      expect(screen.queryByText('Agent Model')).toBeNull();
    });
  });
});

describe('CreateCustomAgentViewContent - model cache update event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.length = 0;
    mockUseFeatureFlag.mockReturnValue(false);
    mockProfileDataManager.getChatConfigs.mockReturnValue([]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
  });

  it('reloads models on modelCacheUpdated event', async () => {
    render(<CreateCustomAgentViewContent />);
    const newModels = [
      {
        id: 'claude-3',
        name: 'Claude 3',
        capabilities: { family: 'claude', supports: { tool_calls: true, vision: false } },
      },
    ];
    mockGetAllOpenKosmosUsedModels.mockReturnValueOnce(newModels);
    act(() => {
      window.dispatchEvent(new Event('modelCacheUpdated'));
    });
    // Open dropdown to verify new model
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    await waitFor(() => {
      expect(screen.getByText('Claude 3')).toBeInTheDocument();
    });
  });
});
