/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import HookEditorView from '../HookEditorView';
import type { HookDefinition } from '@shared/ipc/agentHooks';

const api = vi.hoisted(() => ({
  listHooks: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const routerParams = vi.hoisted(() => ({ editHookId: 'h1' as string | undefined }));
const i18nState = vi.hoisted(() => ({
  t: ((key: string) => {
    const labels: Record<string, string> = {
      'agent.hooks.editor.editTitle': 'Edit Hook',
      'agent.hooks.editor.loadingHook': 'Loading hook...',
    };
    return labels[key] ?? key;
  }) as (key: string, params?: Record<string, unknown>) => string,
}));

vi.mock('../../../ipc/agentHooks', () => ({ agentHooksApi: api }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => routerParams,
}));
vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({ language: 'en', setLanguage: vi.fn(), t: i18nState.t }),
}));
vi.mock('../HookEditor', () => ({
  default: (props: { initial: { name: string } }) => (
    <input aria-label="Hook name" value={props.initial.name} readOnly />
  ),
}));
vi.mock('../ApplyHookToAgentsDialog', () => ({
  default: () => null,
}));

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: 'h1',
    name: 'Loaded Hook',
    description: 'd',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

describe('HookEditorView i18n stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerParams.editHookId = 'h1';
    i18nState.t = (key: string) => {
      const labels: Record<string, string> = {
        'agent.hooks.editor.editTitle': 'Edit Hook',
        'agent.hooks.editor.loadingHook': 'Loading hook...',
      };
      return labels[key] ?? key;
    };
    api.listHooks
      .mockResolvedValueOnce({ success: true, data: [makeHook({ name: 'Loaded Hook' })] })
      .mockResolvedValue({ success: true, data: [makeHook({ name: 'Reloaded Hook' })] });
  });

  it('does not reload and reset the edit form when only the active language changes', async () => {
    const { rerender } = render(<HookEditorView />);

    await waitFor(() => expect((screen.getByLabelText('Hook name') as HTMLInputElement).value).toBe('Loaded Hook'));

    i18nState.t = (key: string) => `zh:${key}`;
    rerender(<HookEditorView />);

    expect(api.listHooks).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Hook name') as HTMLInputElement).value).toBe('Loaded Hook');
  });
});
