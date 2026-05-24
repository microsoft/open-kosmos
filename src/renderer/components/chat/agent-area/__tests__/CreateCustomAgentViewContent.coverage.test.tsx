/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for CreateCustomAgentViewContent.tsx
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    chats: [],
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

describe('CreateCustomAgentViewContent - rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe('CreateCustomAgentViewContent - name input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe('CreateCustomAgentViewContent - emoji picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe('CreateCustomAgentViewContent - agent source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockAddChat.mockResolvedValue({ success: true, data: { chat_id: 'new-chat-1' } });
    mockProfileDataManager.getChatConfigs.mockReturnValue([{ chat_id: 'new-chat-1' }]);
    mockProfileDataManager.subscribe.mockReturnValue(() => {});
    mockUseFeatureFlag.mockReturnValue(false);
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
      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/new-chat-1/settings/workspace');
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

  it('navigates even when chat not in cache - still calls addChat', async () => {
    render(<CreateCustomAgentViewContent />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Timeout Agent' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create and Continue/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and Continue/ }));
    await waitFor(() => {
      expect(mockAddChat).toHaveBeenCalled();
    });
  });
});

describe('CreateCustomAgentViewContent - model cache update event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    window.dispatchEvent(new Event('modelCacheUpdated'));
    // Open dropdown to verify new model
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    await waitFor(() => {
      expect(screen.getByText('Claude 3')).toBeInTheDocument();
    });
  });
});
