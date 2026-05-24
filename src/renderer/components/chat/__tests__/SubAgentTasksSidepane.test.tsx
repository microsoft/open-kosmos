// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── hoisted mock variables ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const hide = vi.fn();
  const backToList = vi.fn();
  const selectTask = vi.fn();

  const atomUse = vi.fn(() => [
    { visible: true, selectedTaskId: null },
    { hide, backToList, selectTask },
  ]);

  const useCurrentChatSessionId = vi.fn(() => 'session-abc');

  return { hide, backToList, selectTask, atomUse, useCurrentChatSessionId };
});

// ── module mocks ──────────────────────────────────────────────────────────────
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

// ── helpers ───────────────────────────────────────────────────────────────────
function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskId: 'task-1',
    subAgentName: 'ResearchAgent',
    status: 'completed' as const,
    startTime: 1700000000000,
    endTime: 1700000060000,
    turnCount: 3,
    model: 'gpt-4o',
    title: 'My Task',
    ...overrides,
  };
}

function setupElectronAPI(tasks: unknown[] = [], opts: { listError?: boolean } = {}) {
  (window as unknown as Record<string, unknown>).electronAPI = {
    subAgentTask: {
      listForSession: opts.listError
        ? vi.fn().mockRejectedValue(new Error('fail'))
        : vi.fn().mockResolvedValue({ success: true, data: tasks }),
      onTaskCreated: vi.fn(() => vi.fn()),
      onTaskUpdated: vi.fn(() => vi.fn()),
    },
  };
}

// ── import after mocks ────────────────────────────────────────────────────────
import SubAgentTasksSidepane from '../SubAgentTasksSidepane';

// ── tests ─────────────────────────────────────────────────────────────────────
describe('SubAgentTasksSidepane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.atomUse.mockReturnValue([
      { visible: true, selectedTaskId: null },
      { hide: mocks.hide, backToList: mocks.backToList, selectTask: mocks.selectTask },
    ]);
    mocks.useCurrentChatSessionId.mockReturnValue('session-abc');
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  // ── visibility ────────────────────────────────────────────────────────────
  it('returns null when not visible', () => {
    mocks.atomUse.mockReturnValue([
      { visible: false, selectedTaskId: null },
      { hide: mocks.hide, backToList: mocks.backToList, selectTask: mocks.selectTask },
    ]);
    setupElectronAPI();
    const { container } = render(<SubAgentTasksSidepane />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the list header when visible', async () => {
    setupElectronAPI();
    await act(async () => { render(<SubAgentTasksSidepane />); });
    expect(screen.getByText('Current Session Sub-Agent Tasks')).toBeTruthy();
  });

  // ── TaskStatusIcon ─────────────────────────────────────────────────────────
  describe('TaskStatusIcon — SVG rendering per status', () => {
    it('running → ExecutingIcon has spinning animation style', async () => {
      const task = makeTask({ taskId: 't-run', status: 'running', endTime: undefined });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // The ExecutingIcon SVG has animation: spin applied inline
      const svgs = document.querySelectorAll('svg');
      const spinSvg = Array.from(svgs).find(
        (s) => (s as SVGElement).style?.animation?.includes('spin')
      );
      expect(spinSvg).toBeTruthy();
    });

    it('completed → CompletedIcon: dark filled circle (fill #272320)', async () => {
      const task = makeTask({ taskId: 't-comp', status: 'completed' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // CompletedIcon contains a path with fill="#272320"
      const paths = document.querySelectorAll('svg path');
      const filled = Array.from(paths).find(
        (p) => p.getAttribute('fill') === '#272320'
      );
      expect(filled).toBeTruthy();
    });

    it('cancelled → CancelledIcon: grey circle with X strokes', async () => {
      const task = makeTask({ taskId: 't-can', status: 'cancelled' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // CancelledIcon: circle stroke #6B7280 and cross paths with stroke #4B5563
      const circles = document.querySelectorAll('svg circle');
      const greyCir = Array.from(circles).find(
        (c) => c.getAttribute('stroke') === '#6B7280'
      );
      expect(greyCir).toBeTruthy();
    });

    it('failed → FailedIcon: red-bordered circle with exclamation', async () => {
      const task = makeTask({ taskId: 't-fail', status: 'failed' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // FailedIcon circle has stroke="#DC2626"
      const circles = document.querySelectorAll('svg circle');
      const redCir = Array.from(circles).find(
        (c) => c.getAttribute('stroke') === '#DC2626'
      );
      expect(redCir).toBeTruthy();
    });
  });

  // ── TaskCard subtitle text ─────────────────────────────────────────────────
  describe('TaskCard subtitle text per status', () => {
    it('running → subtitle starts with "Running ·"', async () => {
      const task = makeTask({ taskId: 't-run', status: 'running', endTime: undefined, turnCount: 5 });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const subtitle = screen.getByText(/^Running · /);
      expect(subtitle).toBeTruthy();
      expect(subtitle.textContent).toMatch(/Running · .+ · 5 turns/);
    });

    it('failed → subtitle starts with "Failed ·" (no turn count)', async () => {
      const task = makeTask({ taskId: 't-fail', status: 'failed', turnCount: 2 });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const subtitle = screen.getByText(/^Failed · /);
      expect(subtitle).toBeTruthy();
      expect(subtitle.textContent).not.toMatch(/turns/);
    });

    it('cancelled → subtitle starts with "Cancelled ·" and includes turn count', async () => {
      const task = makeTask({ taskId: 't-can', status: 'cancelled', turnCount: 4 });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const subtitle = screen.getByText(/^Cancelled · /);
      expect(subtitle).toBeTruthy();
      expect(subtitle.textContent).toMatch(/Cancelled · .+ · 4 turns/);
    });

    it('completed → subtitle includes timestamp and turn count', async () => {
      const task = makeTask({ taskId: 't-comp', status: 'completed', turnCount: 3 });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // Completed subtitle: "timestamp · duration · N turns"
      const subtitle = screen.getByText(/· 3 turns/);
      expect(subtitle).toBeTruthy();
      // Should NOT start with Running/Failed/Cancelled
      expect(subtitle.textContent).not.toMatch(/^(Running|Failed|Cancelled)/);
    });
  });

  // ── TaskCard title color ───────────────────────────────────────────────────
  describe('TaskCard title color per status', () => {
    it('failed → title color is red (#B91C1C)', async () => {
      const task = makeTask({ taskId: 't-fail', status: 'failed', title: 'FailTask' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('FailTask');
      expect(titleEl.style.color).toBe('#B91C1C');
    });

    it('cancelled → title color is grey (#6B7280)', async () => {
      const task = makeTask({ taskId: 't-can', status: 'cancelled', title: 'CancelTask' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('CancelTask');
      expect(titleEl.style.color).toBe('#6B7280');
    });

    it('running → title color is default (#374151)', async () => {
      const task = makeTask({ taskId: 't-run', status: 'running', title: 'RunTask', endTime: undefined });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('RunTask');
      expect(titleEl.style.color).toBe('#374151');
    });

    it('completed → title color is default (#374151)', async () => {
      const task = makeTask({ taskId: 't-comp', status: 'completed', title: 'DoneTask' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('DoneTask');
      expect(titleEl.style.color).toBe('#374151');
    });
  });

  // ── empty / loading states ─────────────────────────────────────────────────
  it('shows empty message when no tasks', async () => {
    setupElectronAPI([]);
    await act(async () => { render(<SubAgentTasksSidepane />); });
    expect(screen.getByText('No sub-agent tasks in this session')).toBeTruthy();
  });

  // ── detail view ───────────────────────────────────────────────────────────
  it('renders detail view when selectedTaskId is set', async () => {
    mocks.atomUse.mockReturnValue([
      { visible: true, selectedTaskId: 'task-1' },
      { hide: mocks.hide, backToList: mocks.backToList, selectTask: mocks.selectTask },
    ]);
    const task = makeTask({ taskId: 'task-1', title: 'DetailTask' });
    setupElectronAPI([task]);
    await act(async () => { render(<SubAgentTasksSidepane />); });

    expect(screen.getByTestId('detail-view')).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
  });
});
