/** @vitest-environment happy-dom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '../../../lib/userData/types';
import { WithStore } from '../../../atom';
import { appDataManager } from '../../../lib/userData/appDataManager';

const mocks = vi.hoisted(() => ({
  getScheduledSessionDisplayState: vi.fn(() => 'completed'),
  getScheduledSessionInterruptionReason: vi.fn(() => undefined as string | undefined),
}));

vi.mock('../SchedulesSidepane.utils', () => ({
  getScheduledSessionDisplayState: mocks.getScheduledSessionDisplayState,
  getScheduledSessionInterruptionReason: mocks.getScheduledSessionInterruptionReason,
}));

vi.mock('lucide-react', () => ({
  MoreHorizontal: ({ size, strokeWidth }: { size: number; strokeWidth: number }) => (
    <span data-testid="icon-more" data-size={size} data-stroke-width={strokeWidth} />
  ),
}));

import ScheduleSessionListItem from '../ScheduleSessionListItem';

const makeSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  chatSession_id: 'session-1',
  title: 'Test Session',
  last_updated: '2024-01-15T10:00:00.000Z',
  schedulerJobId: 'job-1',
  readStatus: 'read',
  ...overrides,
});

const renderItem = (
  session: ChatSession = makeSession(),
  props: Partial<React.ComponentProps<typeof ScheduleSessionListItem>> = {},
) => render(
  <WithStore>
    <ScheduleSessionListItem
      session={session}
      isActive={false}
      isUnread={false}
      isMenuOpen={false}
      {...props}
    />
  </WithStore>,
);

describe('ScheduleSessionListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appDataManager as any).cache = { uiLanguage: 'en' };
    mocks.getScheduledSessionDisplayState.mockReturnValue('completed');
    mocks.getScheduledSessionInterruptionReason.mockReturnValue(undefined);
  });

  it('renders completed sessions and invokes selection', () => {
    const onSelectSession = vi.fn();
    renderItem(makeSession({ readStatus: undefined }), {
      isActive: true,
      isMenuOpen: true,
      onSelectSession,
    });

    const item = screen.getByRole('button', { name: /Test Session/i });
    expect(item.className).toContain('menu-open');
    expect(item.getAttribute('data-read-status')).toBe('read');
    expect(screen.getByText(/2024/)).toBeTruthy();

    fireEvent.click(item);

    expect(onSelectSession).toHaveBeenCalledWith('session-1');
  });

  it('opens the menu without selecting the session', () => {
    const onSelectSession = vi.fn();
    const onOpenMenu = vi.fn();
    renderItem(makeSession(), { onSelectSession, onOpenMenu });

    const menuTrigger = document.querySelector('.chat-session-more-btn') as HTMLDivElement;
    fireEvent.click(menuTrigger);

    expect(onOpenMenu).toHaveBeenCalledWith(expect.objectContaining({
      chatSession_id: 'session-1',
    }), menuTrigger);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('adds schedule menu metadata for running sessions', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('running');
    const onOpenMenu = vi.fn();
    renderItem(makeSession(), { onOpenMenu });

    const menuTrigger = document.querySelector('.chat-session-more-btn') as HTMLDivElement;
    fireEvent.click(menuTrigger);

    expect(menuTrigger.dataset.scheduleRunning).toBe('true');
    expect(menuTrigger.dataset.scheduleRetryable).toBe('false');
    expect(menuTrigger.dataset.scheduleJobId).toBe('job-1');
  });

  it('adds schedule menu metadata for retryable interrupted sessions', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    const onOpenMenu = vi.fn();
    renderItem(makeSession(), { onOpenMenu });

    const menuTrigger = document.querySelector('.chat-session-more-btn') as HTMLDivElement;
    fireEvent.click(menuTrigger);

    expect(menuTrigger.dataset.scheduleRunning).toBe('false');
    expect(menuTrigger.dataset.scheduleRetryable).toBe('true');
    expect(menuTrigger.dataset.scheduleJobId).toBe('job-1');
  });

  it('renders running sessions and hover states', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('running');
    renderItem(makeSession({ readStatus: 'unread' }), { isUnread: true });

    const item = screen.getByRole('button', { name: /Test Session/i });
    const menuTrigger = document.querySelector('.chat-session-more-btn') as HTMLDivElement;

    fireEvent.mouseEnter(item);
    expect(menuTrigger.style.opacity).toBe('1');

    fireEvent.mouseLeave(item);
    expect(menuTrigger.style.opacity).toBe('0');
    expect(screen.getByText(/2024/)).toBeTruthy();
  });

  it('keeps the menu trigger visible when its menu is open', () => {
    renderItem(makeSession(), { isMenuOpen: true });

    const item = screen.getByRole('button', { name: /Test Session/i });
    const menuTrigger = document.querySelector('.chat-session-more-btn') as HTMLDivElement;

    fireEvent.mouseLeave(item);

    expect(menuTrigger.style.opacity).toBe('1');
  });

  it('renders failed sessions with and without error details', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');
    const { rerender } = renderItem(makeSession({ schedulerError: 'Tool crashed' }));

    expect(screen.getByText('Failed · Tool crashed')).toBeTruthy();
    expect(screen.getByText(/2024/)).toBeTruthy();
    expect(document.querySelector('svg circle[fill="var(--color-danger-50)"]')).toBeTruthy();

    rerender(
      <ScheduleSessionListItem
        session={makeSession({ schedulerError: undefined })}
        isActive={false}
        isUnread={false}
        isMenuOpen={false}
      />,
    );

    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('localizes failed and interrupted status labels', () => {
    (appDataManager as any).cache = { uiLanguage: 'zh-CN' };
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');
    const { rerender } = renderItem(makeSession({ schedulerError: 'Tool crashed' }));

    expect(screen.getByText('失败 · Tool crashed')).toBeTruthy();

    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getScheduledSessionInterruptionReason.mockReturnValue('MCP server not ready');
    rerender(
      <WithStore>
        <ScheduleSessionListItem
          session={makeSession()}
          isActive={false}
          isUnread={false}
          isMenuOpen={false}
        />
      </WithStore>,
    );

    expect(screen.getByText('已中断 · MCP server not ready')).toBeTruthy();
  });

  it('renders interrupted sessions with readable reason and completion time', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getScheduledSessionInterruptionReason.mockReturnValue('MCP server not ready');

    renderItem(makeSession({
      schedulerCompletedAt: '2024-01-15T10:05:00.000Z',
    }));

    expect(screen.getByText(/2024/)).toBeTruthy();
    expect(screen.getByText('Interrupted · MCP server not ready')).toBeTruthy();
  });

  it('keeps unread problem sessions bold across title, time, and status lines', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');

    renderItem(makeSession({
      readStatus: 'unread',
      schedulerError: 'Tool crashed',
    }), { isUnread: true });

    expect(screen.getByText('Test Session').style.fontWeight).toBe('600');
    expect(screen.getByText(/2024/).style.fontWeight).toBe('600');
    expect(screen.getByText('Failed · Tool crashed').style.fontWeight).toBe('600');
  });

  it('renders generic interrupted sessions with a readable reason', () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getScheduledSessionInterruptionReason.mockReturnValue('App closed before completion');

    renderItem(makeSession());

    expect(screen.getByText('Interrupted · App closed before completion')).toBeTruthy();
  });

  it('renders invalid timestamps unchanged and tolerates missing callbacks', () => {
    renderItem(makeSession({ last_updated: 'not-a-date' }));

    expect(screen.getByText('not-a-date')).toBeTruthy();

    const item = screen.getByRole('button', { name: /Test Session/i });
    const menuTrigger = document.querySelector('.chat-session-more-btn') as HTMLDivElement;

    expect(() => fireEvent.click(item)).not.toThrow();
    expect(() => fireEvent.click(menuTrigger)).not.toThrow();
  });
});
