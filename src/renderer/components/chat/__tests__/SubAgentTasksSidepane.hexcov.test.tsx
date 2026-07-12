// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const hide = vi.fn();
  const backToList = vi.fn();
  const selectTask = vi.fn();
  const state = { visible: true, selectedTaskId: null };
  const atomUse = vi.fn(() => [state, { hide, backToList, selectTask }]);
  const useCurrentChatSessionId = vi.fn(() => 'session-abc');

  return { hide, backToList, selectTask, state, atomUse, useCurrentChatSessionId };
});

vi.mock('../chat-side.atom', () => ({
  SubAgentTasksSidepaneAtom: { use: mocks.atomUse },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: mocks.useCurrentChatSessionId,
}));

vi.mock('../SubAgentTaskDetailView', () => ({
  default: ({ taskId }: { taskId: string }) => <div data-testid="detail-view">{taskId}</div>,
}));

vi.mock('../../../styles/Sidepane.css', () => ({}));

import SubAgentTasksSidepane from '../SubAgentTasksSidepane';

const baseTask = {
  taskId: 'task-1',
  subAgentName: 'ResearchAgent',
  status: 'completed' as const,
  startTime: 100000,
  endTime: 165000,
  turnCount: 3,
  model: 'gpt-4o',
  title: 'My Task',
};

function makeTask(overrides = {}) {
  return { ...baseTask, ...overrides };
}

function setupElectronAPI(tasks = [], opts = {}) {
  const createdHandlers = [];
  const updatedHandlers = [];
  const unsubCreated = vi.fn();
  const unsubUpdated = vi.fn();
  const listForSession = opts.listForSession ?? vi.fn().mockResolvedValue({ success: true, data: tasks });

  window.electronAPI = {
    subAgentTask: {
      listForSession,
      onTaskCreated: vi.fn((handler) => {
        createdHandlers.push(handler);
        return unsubCreated;
      }),
      onTaskUpdated: vi.fn((handler) => {
        updatedHandlers.push(handler);
        return unsubUpdated;
      }),
    },
  };

  return { createdHandlers, updatedHandlers, unsubCreated, unsubUpdated, listForSession };
}

describe('SubAgentTasksSidepane hexcov coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.visible = true;
    mocks.state.selectedTaskId = null;
    mocks.useCurrentChatSessionId.mockReturnValue('session-abc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  it('does not load or subscribe without a current session id', async () => {
    mocks.useCurrentChatSessionId.mockReturnValue(undefined);
    const api = setupElectronAPI();

    await act(async () => {
      render(<SubAgentTasksSidepane />);
    });

    expect(api.listForSession).not.toHaveBeenCalled();
    expect(window.electronAPI.subAgentTask.onTaskCreated).not.toHaveBeenCalled();
    expect(screen.getByText('No sub-agent tasks in this session')).toBeTruthy();
  });

  it('sorts loaded tasks, handles hover, clicks, fallback titles, and short durations', async () => {
    setupElectronAPI([
      makeTask({ taskId: 'older', title: undefined, subAgentName: 'FallbackAgent', startTime: 1000, endTime: 1500, turnCount: 1 }),
      makeTask({ taskId: 'newer', title: 'Newest', startTime: 3000, endTime: 8000, turnCount: 2 }),
    ]);

    await act(async () => {
      render(<SubAgentTasksSidepane />);
    });

    await waitFor(() => expect(screen.getByText('Newest')).toBeTruthy());
    expect(screen.getByText('FallbackAgent')).toBeTruthy();
    expect(screen.getByText(/<1s/)).toBeTruthy();
    expect(screen.getByText(/5s/)).toBeTruthy();

    const buttons = screen.getAllByRole('button');
    const newestButton = buttons.find((button) => button.textContent?.includes('Newest'));
    const fallbackButton = buttons.find((button) => button.textContent?.includes('FallbackAgent'));
    expect(buttons.indexOf(newestButton)).toBeLessThan(buttons.indexOf(fallbackButton));

    fireEvent.mouseEnter(newestButton);
    expect(newestButton.style.backgroundColor).toBe('rgba(0, 0, 0, 0.05)');
    fireEvent.mouseLeave(newestButton);
    expect(newestButton.style.backgroundColor).toBe('var(--color-white)');
    fireEvent.click(newestButton);
    expect(mocks.selectTask).toHaveBeenCalledWith('newer');
  });

  it('keeps loading empty when the list IPC returns no data', async () => {
    setupElectronAPI([], { listForSession: vi.fn().mockResolvedValue({ success: true }) });

    await act(async () => {
      render(<SubAgentTasksSidepane />);
    });

    expect(screen.getByText('No sub-agent tasks in this session')).toBeTruthy();
  });

  it('applies created and updated push events only for the active session', async () => {
    const api = setupElectronAPI([makeTask({ taskId: 'existing', title: 'Existing', status: 'running', endTime: undefined })]);

    await act(async () => {
      render(<SubAgentTasksSidepane />);
    });

    await waitFor(() => expect(screen.getByText('Existing')).toBeTruthy());

    await act(async () => {
      api.createdHandlers[0]({
        parentSessionId: 'other-session',
        taskId: 'ignored',
        subAgentName: 'IgnoredAgent',
        status: 'running',
        startTime: 9000,
        turnCount: 1,
        model: 'gpt-4o',
      });
    });
    expect(screen.queryByText('IgnoredAgent')).toBeNull();

    await act(async () => {
      api.createdHandlers[0]({
        parentSessionId: 'session-abc',
        taskId: 'existing',
        subAgentName: 'DuplicateAgent',
        status: 'running',
        startTime: 9100,
        turnCount: 1,
        model: 'gpt-4o',
      });
    });
    expect(screen.queryByText('DuplicateAgent')).toBeNull();

    await act(async () => {
      api.createdHandlers[0]({
        parentSessionId: 'session-abc',
        taskId: 'created',
        subAgentName: 'CreatedAgent',
        status: 'running',
        startTime: 9200,
        turnCount: 2,
        model: 'gpt-4o',
        title: 'Created Task',
      });
    });
    expect(screen.getByText('Created Task')).toBeTruthy();

    await act(async () => {
      api.updatedHandlers[0]({
        parentSessionId: 'other-session',
        taskId: 'existing',
        status: 'failed',
        endTime: 10000,
        turnCount: 9,
        title: 'Wrong Session',
      });
    });
    expect(screen.queryByText('Wrong Session')).toBeNull();

    await act(async () => {
      api.updatedHandlers[0]({
        parentSessionId: 'session-abc',
        taskId: 'existing',
        status: 'completed',
        endTime: 11000,
        turnCount: 4,
        title: '',
      });
    });
    expect(screen.getByText('Existing')).toBeTruthy();
    expect(screen.getByText(/4 turns/)).toBeTruthy();
  });

  it('unsubscribes push listeners on unmount', async () => {
    const api = setupElectronAPI();

    let rendered;
    await act(async () => {
      rendered = render(<SubAgentTasksSidepane />);
    });

    rendered.unmount();
    expect(api.unsubCreated).toHaveBeenCalledTimes(1);
    expect(api.unsubUpdated).toHaveBeenCalledTimes(1);
  });

  it('renders selected task headers from retained list state and closes from detail mode', async () => {
    setupElectronAPI([makeTask({ taskId: 'selected', title: undefined, subAgentName: 'SelectedAgent' })]);
    const { rerender } = render(<SubAgentTasksSidepane />);

    await act(async () => {
      rerender(<SubAgentTasksSidepane />);
    });
    await waitFor(() => expect(screen.getByText('SelectedAgent')).toBeTruthy());

    mocks.state.selectedTaskId = 'selected';
    await act(async () => {
      rerender(<SubAgentTasksSidepane />);
    });

    expect(screen.getByText('SelectedAgent')).toBeTruthy();
    expect(screen.getByTestId('detail-view').textContent).toBe('selected');

    fireEvent.click(screen.getByLabelText('Close'));
    expect(mocks.hide).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Back'));
    expect(mocks.backToList).toHaveBeenCalledTimes(1);
  });

  it('renders detail mode without a matching retained task', () => {
    setupElectronAPI();
    mocks.state.selectedTaskId = 'missing';

    render(<SubAgentTasksSidepane />);

    expect(screen.getByTestId('detail-view').textContent).toBe('missing');
    expect(screen.queryByText('SelectedAgent')).toBeNull();
  });
});
