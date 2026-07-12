/**
 * @vitest-environment happy-dom
 *
 * Interaction tests for SchedulesContentView.tsx — covers hover/focus/click
 * style changes on InlineEditableMessage, ScheduleSessionList, Run Now,
 * Edit, and Delete buttons.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SchedulesContentView from '../SchedulesContentView';
import type { SchedulerJob } from '@shared/ipc/scheduler';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockGetJobSessions = vi.fn();

vi.mock('../../../ipc/scheduler', () => ({
  schedulerApi: {
    getJobSessions: (...args: any[]) => mockGetJobSessions(...args),
    cleanupAllSessionHistory: vi.fn().mockResolvedValue({ success: true, data: { totalDeleted: 0, jobsProcessed: 0, orphansDeleted: 0, errors: 0 } }),
  },
}));

vi.mock('../../lib/scheduler/cronDescriptions', () => ({
  describeCronExpression: vi.fn((expr: string) => `Cron: ${expr}`),
}));

vi.mock('../../styles/ContentView.css', () => ({}));
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<SchedulerJob> = {}): SchedulerJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: 'Test',
    scheduleType: 'cron',
    cronExpression: '0 9 * * *',
    enabled: true,
    chat_id: 'agent-1',
    message: 'hello world',
    status: 'pending',
    lastRunAt: '2026-06-01T09:00:00Z',
    lastFinishedAt: '2026-06-01T09:01:00Z',
    ...overrides,
  };
}

const noop = () => {};
const asyncNoop = async () => true;

const emptySessionsResponse = { success: true, data: { sessions: [], total: 0, hasMore: false } };

function renderView(jobs: SchedulerJob[] = [], extra: Record<string, any> = {}) {
  return render(
    <MemoryRouter>
      <SchedulesContentView
        jobs={jobs}
        agentNames={{ 'agent-1': 'My Agent' }}
        error={null}
        onToggle={noop}
        onDelete={noop}
        onUpdate={noop}
        onRunNow={asyncNoop}
        chatId="agent-1"
        {...extra}
      />
    </MemoryRouter>
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('InlineEditableMessage — focus and hover interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobSessions.mockResolvedValue(emptySessionsResponse);
  });

  it('input onFocus changes border color to blue', async () => {
    const job = makeJob({ message: 'Focus me' });
    renderView([job]);

    // Expand card
    fireEvent.click(screen.getByText('Test Job'));
    await waitFor(() => expect(screen.getByText('Focus me')).toBeTruthy());

    // Click to edit
    fireEvent.click(screen.getByText('Focus me'));
    const input = screen.getByDisplayValue('Focus me');

    // Trigger focus
    fireEvent.focus(input);
    expect(input.style.borderColor).toBe('var(--color-accent)');
  });

  it('div hover changes background when not disabled', async () => {
    const job = makeJob({ message: 'Hover me' });
    renderView([job]);

    fireEvent.click(screen.getByText('Test Job'));
    await waitFor(() => expect(screen.getByText('Hover me')).toBeTruthy());

    const msgDiv = screen.getByText('Hover me');

    // mouseEnter
    fireEvent.mouseEnter(msgDiv);
    expect(msgDiv.style.backgroundColor).toBe('var(--color-neutral-100)');

    // mouseLeave
    fireEvent.mouseLeave(msgDiv);
    expect(msgDiv.style.backgroundColor).toBe('var(--color-neutral-50)');
  });

  it('div hover does NOT change background when disabled (readOnly)', async () => {
    const job = makeJob({ message: 'Cannot hover' });
    renderView([job], { readOnly: true });

    fireEvent.click(screen.getByText('Test Job'));
    await waitFor(() => expect(screen.getByText('Cannot hover')).toBeTruthy());

    const msgDiv = screen.getByText('Cannot hover');
    const originalBg = msgDiv.style.backgroundColor;

    fireEvent.mouseEnter(msgDiv);
    // Should not change
    expect(msgDiv.style.backgroundColor).toBe(originalBg);

    fireEvent.mouseLeave(msgDiv);
    expect(msgDiv.style.backgroundColor).toBe(originalBg);
  });
});

describe('ScheduleSessionList — expand, formatDate, hover, click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function expandCard() {
    fireEvent.click(screen.getByText('Test Job'));
    await screen.findByText('Scheduled runs', {}, { timeout: 2000 });
  }

  async function clickScheduledRuns() {
    const btn = await screen.findByText('Scheduled runs', {}, { timeout: 2000 });
    await act(async () => {
      fireEvent.click(btn);
      // Let microtasks (Promise resolution) and state updates settle
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it('toggle button hover changes color', async () => {
    mockGetJobSessions.mockResolvedValue(emptySessionsResponse);
    const job = makeJob();
    renderView([job]);

    await expandCard();

    const toggleBtn = screen.getByText('Scheduled runs').closest('button')!;

    fireEvent.mouseEnter(toggleBtn);
    expect(toggleBtn.style.color).toBe('var(--color-accent)');

    fireEvent.mouseLeave(toggleBtn);
    expect(toggleBtn.style.color).toBe('var(--color-neutral-600)');
  });

  });

describe('Run Now button — hover interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobSessions.mockResolvedValue(emptySessionsResponse);
  });

  it('hover changes background and border when enabled', () => {
    const job = makeJob({ enabled: true });
    renderView([job]);

    const runBtn = screen.getByTitle('Run this schedule immediately');

    fireEvent.mouseEnter(runBtn);
    expect(runBtn.style.backgroundColor).toBe('var(--color-neutral-50)');
    expect(runBtn.style.borderColor).toBe('var(--color-neutral-400)');

    fireEvent.mouseLeave(runBtn);
    expect(runBtn.style.backgroundColor).toBe('var(--color-white)');
    expect(runBtn.style.borderColor).toBe('var(--color-neutral-300)');
  });

  it('hover does NOT change styles when disabled (job not enabled)', () => {
    const job = makeJob({ enabled: false });
    renderView([job]);

    const runBtn = screen.getByTitle('Enable this schedule before running it now');
    const originalBg = runBtn.style.backgroundColor;
    const originalBorder = runBtn.style.borderColor;

    fireEvent.mouseEnter(runBtn);
    expect(runBtn.style.backgroundColor).toBe(originalBg);
    expect(runBtn.style.borderColor).toBe(originalBorder);
  });

  it('hover does NOT change styles when readOnly', () => {
    const job = makeJob({ enabled: true });
    renderView([job], { readOnly: true });

    const runBtn = screen.getByTitle('Run this schedule immediately');
    const originalBg = runBtn.style.backgroundColor;

    fireEvent.mouseEnter(runBtn);
    // readOnly guard prevents style change
    expect(runBtn.style.backgroundColor).toBe(originalBg);
  });
});

describe('Edit button — hover interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobSessions.mockResolvedValue(emptySessionsResponse);
  });

  it('hover changes color when not readOnly', () => {
    const onEdit = vi.fn();
    const job = makeJob();
    renderView([job], { onEdit });

    const editBtn = screen.getByTitle('Edit schedule');

    fireEvent.mouseEnter(editBtn);
    expect(editBtn.style.color).toBe('var(--color-neutral-600)');

    fireEvent.mouseLeave(editBtn);
    expect(editBtn.style.color).toBe('var(--color-neutral-400)');
  });

  it('hover does NOT change color when readOnly', () => {
    const onEdit = vi.fn();
    const job = makeJob();
    renderView([job], { onEdit, readOnly: true });

    const editBtn = screen.getByTitle('Edit schedule');
    const originalColor = editBtn.style.color;

    fireEvent.mouseEnter(editBtn);
    expect(editBtn.style.color).toBe(originalColor);

    fireEvent.mouseLeave(editBtn);
    expect(editBtn.style.color).toBe(originalColor);
  });
});

describe('Delete button — hover interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobSessions.mockResolvedValue(emptySessionsResponse);
  });

  it('hover changes color to red when not readOnly', () => {
    const job = makeJob();
    renderView([job]);

    const deleteBtn = screen.getByTitle('Delete schedule');

    fireEvent.mouseEnter(deleteBtn);
    expect(deleteBtn.style.color).toBe('var(--color-danger-500)');

    fireEvent.mouseLeave(deleteBtn);
    expect(deleteBtn.style.color).toBe('var(--color-neutral-400)');
  });

  it('hover does NOT change color when readOnly', () => {
    const job = makeJob();
    renderView([job], { readOnly: true });

    const deleteBtn = screen.getByTitle('Delete schedule');
    const originalColor = deleteBtn.style.color;

    fireEvent.mouseEnter(deleteBtn);
    expect(deleteBtn.style.color).toBe(originalColor);

    fireEvent.mouseLeave(deleteBtn);
    expect(deleteBtn.style.color).toBe(originalColor);
  });
});

describe('ScheduleSessionList — session item interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Run Now button calls onRunNow when clicked', async () => {
    const mockRunNow = vi.fn().mockResolvedValue(true);
    const job = makeJob({ enabled: true });
    render(
      <MemoryRouter>
        <SchedulesContentView
          jobs={[job]}
          agentNames={{ 'agent-1': 'My Agent' }}
          error={null}
          onDelete={noop}
          onToggle={noop}
          onUpdate={noop}
          onRunNow={mockRunNow}
          chatId="agent-1"
        />
      </MemoryRouter>,
    );

    const runBtn = screen.getByTitle('Run this schedule immediately');
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(mockRunNow).toHaveBeenCalledWith('job-1');
  });

  it('Run Now button debounces rapid clicks', async () => {
    const mockRunNow = vi.fn().mockResolvedValue(true);
    const job = makeJob({ enabled: true });
    render(
      <MemoryRouter>
        <SchedulesContentView
          jobs={[job]}
          agentNames={{ 'agent-1': 'My Agent' }}
          error={null}
          onDelete={noop}
          onToggle={noop}
          onUpdate={noop}
          onRunNow={mockRunNow}
          chatId="agent-1"
        />
      </MemoryRouter>,
    );

    const runBtn = screen.getByTitle('Run this schedule immediately');
    await act(async () => {
      fireEvent.click(runBtn);
    });
    await act(async () => {
      fireEvent.click(runBtn);
    });

    // Should only be called once due to debounce
    expect(mockRunNow).toHaveBeenCalledTimes(1);
  });

  it('session items render with hover and click handlers', async () => {
    mockGetJobSessions.mockResolvedValue({
      success: true,
      data: {
        sessions: [
          { chatSession_id: 'sess-1', title: 'Run Alpha', last_updated: '2026-06-15T14:30:00Z' },
        ],
        total: 1,
        hasMore: false,
      },
    });

    const job = makeJob();
    renderView([job]);

    // Expand card
    fireEvent.click(screen.getByText('Test Job'));
    await waitFor(() => screen.getByText('Scheduled runs'));

    // Expand sessions
    fireEvent.click(screen.getByText('Scheduled runs'));
    await waitFor(() => expect(screen.getByText('Run Alpha')).toBeTruthy());

    // Session item button
    const sessionBtn = screen.getByTitle('Open session: Run Alpha');

    // Hover handlers
    fireEvent.mouseEnter(sessionBtn);
    expect(sessionBtn.style.backgroundColor).toBe('var(--color-neutral-100)');
    fireEvent.mouseLeave(sessionBtn);
    expect(sessionBtn.style.backgroundColor).toBe('var(--color-neutral-50)');

    // Click
    fireEvent.click(sessionBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/agent-1/sess-1');
  });
});
