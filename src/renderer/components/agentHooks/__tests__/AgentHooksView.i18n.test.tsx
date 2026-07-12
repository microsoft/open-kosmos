/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HookDefinition } from '@shared/ipc/agentHooks';
import AgentHooksView from '../AgentHooksView';

const api = vi.hoisted(() => ({
  listHooks: vi.fn(),
  getMasterSwitch: vi.fn(),
  setMasterSwitch: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());
const i18nState = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'agent.hooks.loadingHooks': 'Loading hooks...',
    'agent.hooks.title': 'Hooks',
    'agent.hooks.count': '{count} hooks',
    'agent.hooks.enabledCount': '{count} enabled',
    'agent.hooks.addHook': 'Add Hook',
    'agent.hooks.addHookAria': 'Add hook',
    'agent.hooks.enableHooks': 'Enable hooks',
  };
  const makeTranslator = () => (key: string, params?: Record<string, unknown>) => {
    const template = messages[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
  };

  return {
    language: 'en',
    translators: {
      en: makeTranslator(),
      zh: makeTranslator(),
    },
  };
});

vi.mock('../../../ipc/agentHooks', () => ({ agentHooksApi: api }));
vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: vi.fn() },
}));
vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: i18nState.translators[i18nState.language as 'en' | 'zh'],
  }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../HooksIcon', () => ({
  default: () => <span data-testid="hooks-icon" />,
}));
vi.mock('../HookListPanel', () => ({
  default: (props: {
    hooks: HookDefinition[];
    selectedHookId: string | null;
    onSelect: (hook: HookDefinition) => void;
  }) => (
    <div data-testid="hook-list" data-selected={props.selectedHookId ?? ''}>
      {props.hooks.map(hook => (
        <button key={hook.id} type="button" onClick={() => props.onSelect(hook)}>
          {hook.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../HookDetailPanel', () => ({
  default: ({ hook }: { hook: HookDefinition | null }) => (
    <div data-testid="hook-detail">{hook?.name ?? 'No hook selected'}</div>
  ),
}));
vi.mock('../HookDropdownMenu', () => ({
  default: () => null,
}));

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: 'h1',
    name: 'First Hook',
    description: '',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  };
}

describe('AgentHooksView i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = 'en';
    api.listHooks.mockResolvedValue({
      success: true,
      data: [
        makeHook(),
        makeHook({ id: 'h2', name: 'Second Hook' }),
      ],
    });
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: true });
  });

  it('does not reload hooks or reset the selected hook when language changes', async () => {
    const { rerender } = render(<AgentHooksView />);
    await waitFor(() => expect(screen.getByTestId('hook-detail')).toHaveTextContent('First Hook'));

    fireEvent.click(screen.getByText('Second Hook'));
    expect(screen.getByTestId('hook-detail')).toHaveTextContent('Second Hook');
    expect(api.listHooks).toHaveBeenCalledTimes(1);
    expect(api.getMasterSwitch).toHaveBeenCalledTimes(1);

    await act(async () => {
      i18nState.language = 'zh';
      rerender(<AgentHooksView />);
    });

    expect(api.listHooks).toHaveBeenCalledTimes(1);
    expect(api.getMasterSwitch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('hook-detail')).toHaveTextContent('Second Hook');
  });
});
