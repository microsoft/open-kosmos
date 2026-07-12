// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for AgentBasicTab.tsx
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentBasicTab from '../AgentBasicTab';

// ---- mock variables ----

const mockOnSave = vi.fn();
const mockOnDataChange = vi.fn();
const mockOnAgentCreated = vi.fn();

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
      id: 'o3-mini',
      name: 'o3 mini',
      capabilities: {
        family: 'o3',
        supports: { tool_calls: true, vision: false },
      },
    },
  ]),
}));

const mockUseScrollSelectedIntoView = vi.fn().mockReturnValue({ current: null });

// Mutable chat list so individual tests can drive duplicate-name detection.
const { mockChats } = vi.hoisted(() => ({ mockChats: { value: [] as any[] } }));

// ---- vi.mock calls ----

vi.mock('../../../../styles/Agent.css', () => ({}));

vi.mock('../../../../lib/models/ghcModels', () => ({
  getDefaultModel: () => mockGetDefaultModel(),
  getAllOpenKosmosUsedModels: () => mockGetAllOpenKosmosUsedModels(),
}));

vi.mock('../../../userData/userDataProvider', () => ({
  useChats: () => ({
    chats: mockChats.value,
  }),
}));

vi.mock('../../../common/AgentAvatar', () => ({
  AgentAvatar: ({ emoji, name }: any) => (
    <div data-testid="agent-avatar" data-emoji={emoji}>{name || emoji}</div>
  ),
}));

vi.mock('../EmojiPicker', () => ({
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

vi.mock('../ExternalAgentConnectionConfig', () => ({
  default: ({ token }: any) => (
    <div data-testid="external-agent-config">token: {token}</div>
  ),
}));

vi.mock('../../../../lib/hooks/useScrollSelectedIntoView', () => ({
  useScrollSelectedIntoView: () => mockUseScrollSelectedIntoView(),
}));

// ---- helpers ----

const defaultProps = {
  mode: 'add' as const,
  chatId: undefined,
  agentData: undefined,
  onSave: mockOnSave,
  onDataChange: mockOnDataChange,
  onAgentCreated: mockOnAgentCreated,
  cachedData: undefined,
  fieldErrors: undefined,
  readOnly: false,
};

// ---- tests ----

describe('AgentBasicTab - rendering in add mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders avatar, name, and model sections', () => {
    render(<AgentBasicTab {...defaultProps} />);
    expect(screen.getByText('Agent Avatar')).toBeInTheDocument();
    expect(screen.getByText('Agent Name')).toBeInTheDocument();
    expect(screen.getByText('Agent Model')).toBeInTheDocument();
  });

  it('renders agent avatar component', () => {
    render(<AgentBasicTab {...defaultProps} />);
    expect(screen.getByTestId('agent-avatar')).toBeInTheDocument();
  });

  it('name input is empty initially in add mode', () => {
    render(<AgentBasicTab {...defaultProps} />);
    expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('');
  });
});

describe('AgentBasicTab - update mode with agentData', () => {
  const agentData = {
    id: 'agent-1',
    name: 'TestAgent',
    emoji: '🤖',
    avatar: '',
    role: '',
    model: 'gpt-4.1',
    version: '1.0.0',
    source: 'ON-DEVICE' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads agent data in update mode', async () => {
    render(<AgentBasicTab {...defaultProps} mode="update" chatId="agent-1" agentData={agentData} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('TestAgent');
    });
  });

  it('shows version and source metadata', async () => {
    render(<AgentBasicTab {...defaultProps} mode="update" chatId="agent-1" agentData={agentData} />);
    await waitFor(() => {
      expect(screen.getByText('Agent Info')).toBeInTheDocument();
      expect(screen.getByText('1.0.0')).toBeInTheDocument();
    });
  });

  it('shows version and source as ON-DEVICE', async () => {
    render(<AgentBasicTab {...defaultProps} mode="update" chatId="agent-1" agentData={agentData} />);
    await waitFor(() => {
      expect(screen.getByText(/💻 On Device/)).toBeInTheDocument();
    });
  });

  it('notifies onDataChange when data loaded', async () => {
    render(<AgentBasicTab {...defaultProps} mode="update" chatId="agent-1" agentData={agentData} />);
    await waitFor(() => {
      expect(mockOnDataChange).toHaveBeenCalledWith('basic', expect.any(Object), expect.any(Boolean));
    });
  });
});

describe('AgentBasicTab - legacy source metadata', () => {
  const legacyMetadataAgent = {
    id: 'legacy-agent-1',
    name: 'LegacyAgent',
    emoji: '📚',
    avatar: 'https://example.com/avatar.png',
    role: '',
    model: 'gpt-4.1',
    version: '2.0.0',
    source: 'IN-LIBRARY' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders legacy source metadata with local semantics', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="legacy-agent-1"
        agentData={legacyMetadataAgent}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/💻 On Device/)).toBeInTheDocument();
    });
  });

  it('keeps agents with legacy source metadata editable', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="legacy-agent-1"
        agentData={legacyMetadataAgent}
      />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toBeEnabled();
    });
  });

  it('does not lock the avatar for agents with legacy source metadata', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="legacy-agent-1"
        agentData={legacyMetadataAgent}
      />
    );
    await waitFor(() => {
      const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
      expect(emojiDisplay.title).toBe('Click to change avatar');
    });
  });
});

describe('AgentBasicTab - EXTERNAL agent', () => {
  const externalAgentData = {
    id: 'ext-agent-1',
    name: 'ExtAgent',
    emoji: '🌐',
    avatar: '',
    role: '',
    model: '',
    version: '1.0.0',
    source: 'EXTERNAL' as const,
    authToken: 'my-auth-token',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides model section for external agent', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="ext-agent-1"
        agentData={externalAgentData}
      />
    );
    await waitFor(() => {
      expect(screen.queryByText('Agent Model')).toBeNull();
    });
  });

  it('shows external agent config with token', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="ext-agent-1"
        agentData={externalAgentData}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('external-agent-config')).toBeInTheDocument();
      expect(screen.getByText(/my-auth-token/)).toBeInTheDocument();
    });
  });

  it('shows External source badge', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="ext-agent-1"
        agentData={externalAgentData}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/🌐 External/)).toBeInTheDocument();
    });
  });
});

describe('AgentBasicTab - readOnly mode', () => {
  const agentData = {
    id: 'agent-ro',
    name: 'ReadOnlyAgent',
    emoji: '🔒',
    avatar: '',
    role: '',
    model: 'gpt-4.1',
    version: '1.0.0',
    source: 'ON-DEVICE' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables name input in readOnly mode', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="agent-ro"
        agentData={agentData}
        readOnly={true}
      />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toBeDisabled();
    });
  });

  it('disables model button in readOnly mode', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="agent-ro"
        agentData={agentData}
        readOnly={true}
      />
    );
    await waitFor(() => {
      const modelBtn = document.querySelector('.model-button') as HTMLButtonElement;
      expect(modelBtn).toBeDisabled();
    });
  });
});

describe('AgentBasicTab - emoji picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens emoji picker on avatar click', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
    fireEvent.click(emojiDisplay);
    expect(screen.getByTestId('emoji-picker')).toBeInTheDocument();
  });

  it('closes emoji picker on close button', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
    fireEvent.click(emojiDisplay);
    fireEvent.click(screen.getByText('Close Picker'));
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
  });

  it('selects emoji and closes picker', async () => {
    render(<AgentBasicTab {...defaultProps} />);
    const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
    fireEvent.click(emojiDisplay);
    fireEvent.click(screen.getByText('Select Emoji'));
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
    await waitFor(() => {
      expect(mockOnDataChange).toHaveBeenCalled();
    });
  });
});

describe('AgentBasicTab - model dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens model dropdown on button click', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    expect(screen.getByText('o3 mini')).toBeInTheDocument();
  });

  it('shows reasoning badge for o3 models', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
  });

  it('shows Tools badge when tool_calls supported', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    expect(screen.getAllByText('Tools').length).toBeGreaterThan(0);
  });

  it('selects model and closes dropdown', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    fireEvent.click(screen.getByText('o3 mini'));
    expect(screen.queryByText('GPT-4.1')).toBeNull();
  });

  it('closes dropdown on outside click', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    expect(document.querySelector('.model-dropdown')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.model-dropdown')).toBeNull();
  });
});

describe('AgentBasicTab - name input interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onDataChange when name is typed', async () => {
    render(<AgentBasicTab {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'New Agent' },
    });
    await waitFor(() => {
      expect(mockOnDataChange).toHaveBeenCalledWith('basic', expect.objectContaining({ name: 'New Agent' }), expect.any(Boolean));
    });
  });

  it('shows fieldErrors when provided', () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        fieldErrors={{ name: 'Name is required' }}
      />
    );
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  it('reloads models on modelCacheUpdated event', () => {
    render(<AgentBasicTab {...defaultProps} />);
    const newModels = [
      {
        id: 'claude-3',
        name: 'Claude 3',
        capabilities: { family: 'claude', supports: { tool_calls: false, vision: false } },
      },
    ];
    mockGetAllOpenKosmosUsedModels.mockReturnValueOnce(newModels);
    window.dispatchEvent(new Event('modelCacheUpdated'));
    const modelBtn = document.querySelector('.model-button') as HTMLElement;
    fireEvent.click(modelBtn);
    expect(screen.getByText('Claude 3')).toBeInTheDocument();
  });
});

describe('AgentBasicTab - Kobi agent', () => {
  const kobiAgentData = {
    id: 'kobi-agent',
    name: 'Kobi',
    emoji: '🐾',
    avatar: '',
    role: '',
    model: 'gpt-4.1',
    version: '1.0.0',
    source: 'ON-DEVICE' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables emoji for Kobi agent', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="kobi-agent"
        agentData={kobiAgentData}
      />
    );
    await waitFor(() => {
      const emojiDisplay = document.querySelector('.emoji-display') as HTMLElement;
      expect(emojiDisplay.title).toContain("Kobi");
    });
  });
});

describe('AgentBasicTab - cachedData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses cachedData in add mode', async () => {
    render(
      <AgentBasicTab
        {...defaultProps}
        cachedData={{ name: 'CachedAgent', emoji: '⭐', avatar: '', role: '', model: 'gpt-4.1' }}
      />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('CachedAgent');
    });
  });

  it('falls back to defaults for fields missing from a partial cachedData (add mode)', async () => {
    // Only `name` provided; the remaining fields exercise the `: defaultInitialData.X` arm.
    render(
      <AgentBasicTab
        {...defaultProps}
        cachedData={{ name: 'PartialAgent' }}
      />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('PartialAgent');
    });
    // Default emoji is preserved when cachedData omits it.
    const avatar = screen.getByTestId('agent-avatar');
    expect(avatar.getAttribute('data-emoji')).toBe('🤖');
  });

  it('prefers cachedData over agent data in update mode', async () => {
    const agentData = {
      id: 'agent-with-cache',
      name: 'Original Name',
      emoji: '🤖',
      avatar: '',
      role: '',
      model: 'gpt-4.1',
      version: '2.0.0',
      source: 'ON-DEVICE' as const,
    };
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="agent-with-cache"
        agentData={agentData}
        cachedData={{ name: 'Edited Name', emoji: '🚀', avatar: '', role: '', model: 'o3-mini' }}
      />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('Edited Name');
    });
  });

  it('treats add mode with an already-created agent id like update mode', async () => {
    // mode==='add' but agentData.id present -> the `mode === 'add' && agentData.id` arm.
    // version/source omitted -> the `|| ''` fallback arms.
    const agentData = {
      id: 'created-in-add',
      name: 'Created Agent',
      emoji: '🤖',
      avatar: '',
      role: '',
      model: 'gpt-4.1',
    };
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="add"
        chatId="created-in-add"
        agentData={agentData}
      />
    );
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter agent name...')).toHaveValue('Created Agent');
    });
  });
});

describe('AgentBasicTab - duplicate name detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChats.value = [];
  });

  afterEach(() => {
    mockChats.value = [];
  });

  it('warns when a typed name matches an existing agent (add mode)', async () => {
    mockChats.value = [{ agent: { name: 'Existing Agent' } }];
    render(<AgentBasicTab {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Enter agent name...'), {
      target: { value: 'Existing Agent' },
    });
    await waitFor(() => {
      expect(screen.getByText(/This agent name already exists/)).toBeInTheDocument();
    });
  });

  it('does not warn when the name matches only the agent currently being edited (update mode)', async () => {
    const currentAgent = {
      id: 'current-agent',
      name: 'Current Agent',
      emoji: '🤖',
      avatar: '',
      role: '',
      model: 'gpt-4.1',
      version: '1.0.0',
      source: 'ON-DEVICE' as const,
    };
    mockChats.value = [
      { agent: { name: 'Current Agent' } },
      { agent: { name: 'Other Agent' } },
    ];
    render(
      <AgentBasicTab
        {...defaultProps}
        mode="update"
        chatId="current-agent"
        agentData={currentAgent}
      />,
    );
    const input = screen.getByPlaceholderText('Enter agent name...');
    // Type a brand-new value (differs from the loaded name so onChange fires). The
    // current agent's own entry must be skipped, and no other entry collides.
    fireEvent.change(input, { target: { value: 'Renamed Agent' } });
    await waitFor(() => {
      expect(screen.queryByText(/This agent name already exists/)).toBeNull();
    });
  });

  it('clears the warning once the typed name no longer collides', async () => {
    mockChats.value = [{ agent: { name: 'Existing Agent' } }];
    render(<AgentBasicTab {...defaultProps} />);
    const input = screen.getByPlaceholderText('Enter agent name...');
    fireEvent.change(input, { target: { value: 'Existing Agent' } });
    await waitFor(() => {
      expect(screen.getByText(/This agent name already exists/)).toBeInTheDocument();
    });
    fireEvent.change(input, { target: { value: 'Unique Agent' } });
    await waitFor(() => {
      expect(screen.queryByText(/This agent name already exists/)).toBeNull();
    });
  });
});
