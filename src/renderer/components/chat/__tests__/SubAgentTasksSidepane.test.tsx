// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WithStore } from '../../../atom';
import { appDataManager } from '../../../lib/userData/appDataManager';

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

function renderWithLanguage(ui: React.ReactElement, language: 'en' | 'zh-CN' = 'en') {
  (appDataManager as any).cache = { uiLanguage: language };
  return render(<WithStore>{ui}</WithStore>);
}

// ── import after mocks ────────────────────────────────────────────────────────
import SubAgentTasksSidepane from '../SubAgentTasksSidepane';

// ── tests ─────────────────────────────────────────────────────────────────────
describe('SubAgentTasksSidepane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appDataManager as any).cache = { uiLanguage: 'en' };
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

    it('completed → CompletedIcon: dark filled circle (fill var(--color-warm-900))', async () => {
      const task = makeTask({ taskId: 't-comp', status: 'completed' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // CompletedIcon contains a path with fill="var(--color-warm-900)"
      const paths = document.querySelectorAll('svg path');
      const filled = Array.from(paths).find(
        (p) => p.getAttribute('fill') === 'var(--color-warm-900)'
      );
      expect(filled).toBeTruthy();
    });

    it('cancelled → CancelledIcon: grey circle with X strokes', async () => {
      const task = makeTask({ taskId: 't-can', status: 'cancelled' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // CancelledIcon: circle stroke var(--color-neutral-500) and cross paths with stroke var(--color-neutral-600)
      const circles = document.querySelectorAll('svg circle');
      const greyCir = Array.from(circles).find(
        (c) => c.getAttribute('stroke') === 'var(--color-neutral-500)'
      );
      expect(greyCir).toBeTruthy();
    });

    it('failed → FailedIcon: red-bordered circle with exclamation', async () => {
      const task = makeTask({ taskId: 't-fail', status: 'failed' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      // FailedIcon circle has stroke="var(--color-danger-600)"
      const circles = document.querySelectorAll('svg circle');
      const redCir = Array.from(circles).find(
        (c) => c.getAttribute('stroke') === 'var(--color-danger-600)'
      );
      expect(redCir).toBeTruthy();
    });
  });

  it('localizes task status summaries', async () => {
    setupElectronAPI([
      makeTask({ taskId: 't-run', status: 'running', endTime: undefined, turnCount: 5 }),
      makeTask({ taskId: 't-fail', status: 'failed', turnCount: 2 }),
      makeTask({ taskId: 't-can', status: 'cancelled', turnCount: 4 }),
    ]);

    await act(async () => { renderWithLanguage(<SubAgentTasksSidepane />, 'zh-CN'); });

    expect(screen.getByText(/^运行中 · /).textContent).toMatch(/ · 5 轮$/);
    expect(screen.getByText(/^失败 · /)).toBeTruthy();
    expect(screen.getByText(/^已取消 · /).textContent).toMatch(/ · 4 轮$/);
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
    it('failed → title color is red (var(--color-danger-700))', async () => {
      const task = makeTask({ taskId: 't-fail', status: 'failed', title: 'FailTask' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('FailTask');
      expect(titleEl.style.color).toBe('var(--color-danger-700)');
    });

    it('cancelled → title color is grey (var(--color-neutral-500))', async () => {
      const task = makeTask({ taskId: 't-can', status: 'cancelled', title: 'CancelTask' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('CancelTask');
      expect(titleEl.style.color).toBe('var(--color-neutral-500)');
    });

    it('running → title color is default (var(--color-neutral-700))', async () => {
      const task = makeTask({ taskId: 't-run', status: 'running', title: 'RunTask', endTime: undefined });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('RunTask');
      expect(titleEl.style.color).toBe('var(--color-neutral-700)');
    });

    it('completed → title color is default (var(--color-neutral-700))', async () => {
      const task = makeTask({ taskId: 't-comp', status: 'completed', title: 'DoneTask' });
      setupElectronAPI([task]);
      await act(async () => { render(<SubAgentTasksSidepane />); });

      const titleEl = screen.getByText('DoneTask');
      expect(titleEl.style.color).toBe('var(--color-neutral-700)');
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
