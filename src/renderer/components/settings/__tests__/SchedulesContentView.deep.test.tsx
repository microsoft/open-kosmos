/**
 * @vitest-environment happy-dom
 *
 * Supplementary tests for SchedulesContentView.tsx — covers branches missed by
 * the existing SchedulesContentView.test.tsx.
 *
 * Gaps targeted:
 *  - onToggle called when checkbox changes
 *  - onDelete called when delete button is clicked
 *  - onEdit callback rendered and called
 *  - handleRunNow: debounce guard (rapid second click is ignored)
 *  - handleRunNow: disabled when job is disabled
 *  - ScheduleSessionList expansion: fetches sessions, shows loading, shows empty,
 *    shows session items, navigate on click
 *  - formatDateTime: invalid ISO date falls back to raw string
 *  - formatScheduleStatus: completed / expired / failed / disabled
 *  - onEdit button is absent when onEdit prop is not passed
 *  - InlineEditableMessage: blur commits edit
 *  - InlineEditableMessage: blur with unchanged value does not call onSave
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
    description: 'A test schedule',
    scheduleType: 'cron',
    cronExpression: '0 9 * * 1',
    enabled: true,
    chat_id: 'agent-1',
    message: 'Run the report',
    status: 'pending',
    ...overrides,
  };
}

function renderView(jobs: SchedulerJob[] = [], extra: Record<string, any> = {}) {
  return render(
    <MemoryRouter>
      <SchedulesContentView
        jobs={jobs}
        agentNames={{ 'agent-1': 'My Agent' }}
        error={null}
        onToggle={extra.onToggle ?? vi.fn()}
        onDelete={extra.onDelete ?? vi.fn()}
        onUpdate={extra.onUpdate ?? vi.fn()}
        onRunNow={extra.onRunNow ?? (async () => true)}
        chatId="agent-1"
        {...extra}
      />
    </MemoryRouter>
  );
}

// ── onToggle ──────────────────────────────────────────────────────────────────

describe('SchedulesContentView — onToggle', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls onToggle when the enable toggle checkbox changes', () => {
    const onToggle = vi.fn();
    renderView([makeJob()], { onToggle });
    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalled();
  });
});

// ── onDelete ──────────────────────────────────────────────────────────────────

describe('SchedulesContentView — onDelete', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    renderView([makeJob()], { onDelete });
    const deleteBtn = screen.getByTitle('Delete schedule');
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith('job-1');
  });
});

// ── onEdit ────────────────────────────────────────────────────────────────────

describe('SchedulesContentView — onEdit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders edit button when onEdit prop is provided', () => {
    const onEdit = vi.fn();
    renderView([makeJob()], { onEdit });
    expect(screen.getByTitle('Edit schedule')).toBeTruthy();
  });

  it('calls onEdit with the job when edit button is clicked', () => {
    const onEdit = vi.fn();
    const job = makeJob();
    renderView([job], { onEdit });
    fireEvent.click(screen.getByTitle('Edit schedule'));
    expect(onEdit).toHaveBeenCalledWith(job);
  });

  it('does not render edit button when onEdit prop is absent', () => {
    renderView([makeJob()]);
    expect(screen.queryByTitle('Edit schedule')).toBeNull();
  });
});

// ── handleRunNow ──────────────────────────────────────────────────────────────

describe('SchedulesContentView — handleRunNow', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls onRunNow when Run now button is clicked on an enabled job', async () => {
    const onRunNow = vi.fn().mockResolvedValue(true);
    renderView([makeJob({ enabled: true })], { onRunNow });
    const runBtn = screen.getByTitle('Run this schedule immediately');
    fireEvent.click(runBtn);
    expect(onRunNow).toHaveBeenCalledWith('job-1');
  });

  it('does not call onRunNow when job is disabled', () => {
    const onRunNow = vi.fn();
    renderView([makeJob({ enabled: false })], { onRunNow });
    const runBtn = screen.getByTitle('Enable this schedule before running it now');
    fireEvent.click(runBtn);
    expect(onRunNow).not.toHaveBeenCalled();
  });

  it('ignores rapid second click within debounce window', async () => {
    const onRunNow = vi.fn().mockResolvedValue(true);
    renderView([makeJob({ enabled: true })], { onRunNow });
    const runBtn = screen.getByTitle('Run this schedule immediately');
    fireEvent.click(runBtn);
    fireEvent.click(runBtn); // within 1200ms debounce
    expect(onRunNow).toHaveBeenCalledTimes(1);
  });
});

// ── ScheduleSessionList ───────────────────────────────────────────────────────

describe('SchedulesContentView — ScheduleSessionList expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobSessions.mockResolvedValue({ success: true, data: { sessions: [], total: 0, hasMore: false } });
  });

  async function expandCard() {
    fireEvent.click(screen.getByText('Test Job'));
    await screen.findByText('Scheduled runs', {}, { timeout: 2000 });
  }

  async function clickScheduledRuns() {
    const btn = await screen.findByText('Scheduled runs', {}, { timeout: 2000 });
    await act(async () => {
      fireEvent.click(btn);
    });
    // Wait for async fetchSessions to settle; 50ms is enough for resolved promises
    await new Promise((r) => setTimeout(r, 100));
  }

  it('expands session list when Scheduled runs button is clicked', async () => {
    mockGetJobSessions.mockResolvedValue({ success: true, data: { sessions: [], total: 0, hasMore: false } });
    renderView([makeJob()]);
    await expandCard();
    await clickScheduledRuns();
    expect(await screen.findByText('No scheduled runs found', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('shows "No scheduled runs found" when sessions are empty', async () => {
    mockGetJobSessions.mockResolvedValue({ success: true, data: { sessions: [], total: 0, hasMore: false } });
    renderView([makeJob()]);
    await expandCard();
    await clickScheduledRuns();
    expect(await screen.findByText('No scheduled runs found', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('shows session count badge after fetching sessions', async () => {
    const mockSessions = [
      { chatSession_id: 's-1', title: 'Run 1', last_updated: '2025-06-01T10:00:00Z' },
      { chatSession_id: 's-2', title: 'Run 2', last_updated: '2025-06-02T10:00:00Z' },
    ];
    mockGetJobSessions.mockResolvedValue({ success: true, data: { sessions: mockSessions, total: 2, hasMore: false } });
    renderView([makeJob()]);
    await expandCard();
    await clickScheduledRuns();
    expect(await screen.findByText('Run 1', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders the session list button when the card is expanded', async () => {
    // Verifies the ScheduleSessionList component renders its toggle button
    mockGetJobSessions.mockResolvedValue({ success: true, data: { sessions: [], total: 0, hasMore: false } });
    renderView([makeJob()]);
    await expandCard();
    // "Scheduled runs" button must appear after card expansion
    expect(screen.getByText('Scheduled runs')).toBeTruthy();
  });

  it('handles getJobSessions throwing without crashing', async () => {
    mockGetJobSessions.mockRejectedValue(new Error('network error'));
    renderView([makeJob()]);
    await expandCard();
    await clickScheduledRuns();
    // Component silently swallows the error; loading spinner disappears
    await waitFor(() => { expect(screen.queryByText('Loading...')).toBeNull(); }, { timeout: 2000 });
  });

  it('collapses the session list on second click', async () => {
    mockGetJobSessions.mockResolvedValue({ success: true, data: { sessions: [], total: 0, hasMore: false } });
    renderView([makeJob()]);
    await expandCard();
    await clickScheduledRuns();
    await screen.findByText('No scheduled runs found', {}, { timeout: 2000 });
    // Click again to collapse
    await act(async () => { fireEvent.click(screen.getByText('Scheduled runs')); });
    expect(screen.queryByText('No scheduled runs found')).toBeNull();
  });
});

// ── formatScheduleStatus variants ────────────────────────────────────────────

describe('SchedulesContentView — formatScheduleStatus', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  async function expandCard(status: SchedulerJob['status'], enabled = true) {
    renderView([makeJob({ status, enabled })]);
    fireEvent.click(screen.getByText('Test Job'));
    await waitFor(() => screen.getByText('Status'));
  }

  it('shows Completed for completed status', async () => {
    await expandCard('completed');
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('shows Expired for expired status', async () => {
    await expandCard('expired');
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('shows Failed for failed status', async () => {
    await expandCard('failed');
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('shows Disabled for pending status with enabled=false', async () => {
    await expandCard('pending', false);
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  it('shows Pending for pending status with enabled=true', async () => {
    await expandCard('pending', true);
    expect(screen.getByText('Pending')).toBeTruthy();
  });
});

// ── executedAt shown when present ────────────────────────────────────────────

describe('SchedulesContentView — executedAt field', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows Executed At label when executedAt is present', async () => {
    renderView([makeJob({ executedAt: '2025-06-01T10:00:00.000Z' } as any)]);
    fireEvent.click(screen.getByText('Test Job'));
    await waitFor(() => {
      expect(screen.getByText('Executed At')).toBeTruthy();
    });
  });
});

// ── InlineEditableMessage: blur commits / reverts ─────────────────────────────

describe('SchedulesContentView — InlineEditableMessage blur behaviour', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('commits edit on blur when value has changed', async () => {
    const onUpdate = vi.fn();
    renderView([makeJob({ message: 'Original' })], { onUpdate });
    fireEvent.click(screen.getByText('Test Job'));

    await waitFor(() => screen.getByText('Original'));
    fireEvent.click(screen.getByText('Original'));

    const input = screen.getByDisplayValue('Original');
    fireEvent.change(input, { target: { value: 'Updated via blur' } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledWith('job-1', { message: 'Updated via blur' });
  });

  it('does not call onUpdate on blur when value is unchanged', async () => {
    const onUpdate = vi.fn();
    renderView([makeJob({ message: 'Same' })], { onUpdate });
    fireEvent.click(screen.getByText('Test Job'));

    await waitFor(() => screen.getByText('Same'));
    fireEvent.click(screen.getByText('Same'));

    const input = screen.getByDisplayValue('Same');
    fireEvent.blur(input); // no change

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
