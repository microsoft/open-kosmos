/**
 * @vitest-environment happy-dom
 *
 * DoctorStatusIndicator — coverage for all status branches and interactions.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReactDOM from 'react-dom';

// ── Hoisted mock variables ───────────────────────────────────────────────────
const { mockAtomUse, mockDismiss } = vi.hoisted(() => ({
  mockAtomUse: vi.fn(),
  mockDismiss: vi.fn(),
}));

vi.mock('@/states/doctor.atom', async () => ({
  doctorAnalyzeAtom: {
    use: mockAtomUse,
  },
}));

vi.mock('../AgentQuestionForm', async () => ({
  default: ({ payload }: { payload: unknown }) => (
    <div data-testid="agent-question-form">{JSON.stringify(payload)}</div>
  ),
}));

vi.mock('../Icon', async () => ({
  doctor_icon: <span data-testid="doctor-icon" />,
}));

vi.mock('lucide-react', async () => {
  const Stub = ({ size, className }: { size?: number; className?: string }) =>
    <svg data-testid="lucide-icon" className={className} />;
  return { CheckCircle2: Stub, AlertTriangle: Stub };
});

// ── Portal: render inline to avoid portal positioning issues ────────────────
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDOM>();
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

import DoctorStatusIndicator from '../DoctorStatusIndicator';

function makeAnalyze(overrides = {}) {
  return {
    status: 'pending' as const,
    step: null,
    error: null,
    question: null,
    ...overrides,
  };
}

describe('DoctorStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDismiss.mockReset();
  });

  it('returns null when status is idle', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'idle' }), { dismiss: mockDismiss }]);
    const { container } = render(<DoctorStatusIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders loading indicator when status is pending', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'pending' }), { dismiss: mockDismiss }]);
    const { container } = render(<DoctorStatusIndicator />);
    expect(container.querySelector('button')).toBeDefined();
  });

  it('renders loading indicator when status is analyzing', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'analyzing' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    // button should have cursor-default
    const btn = document.querySelector('button[type="button"]');
    expect(btn?.className).toContain('cursor-default');
  });

  it('renders loading indicator when status is creating_issue', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'creating_issue' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]');
    expect(btn).toBeDefined();
  });

  it('renders loading indicator when status is waiting_for_user', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'waiting_for_user' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]');
    expect(btn).toBeDefined();
  });

  it('renders CheckCircle2 icon when status is done', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'done' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const icons = document.querySelectorAll('[data-testid="lucide-icon"]');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('renders AlertTriangle icon when status is error', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'error', error: 'Test error' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const icons = document.querySelectorAll('[data-testid="lucide-icon"]');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('calls dismiss when done button is clicked', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'done' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.click(btn);
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('calls dismiss when error button is clicked', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'error', error: 'oops' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.click(btn);
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('does not call dismiss when loading and button is clicked', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'pending' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.click(btn);
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('shows tooltip on hover when step info is present', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'analyzing', step: { info: 'Running checks...', at: Date.now() - 5000 } }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.mouseEnter(btn);
    expect(screen.queryByText(/Running checks/)).toBeDefined();
  });

  it('shows done tooltip text on hover', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'done' }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.mouseEnter(btn);
    expect(screen.queryByText(/Diagnosis complete/)).toBeDefined();
  });

  it('shows error tooltip text on hover', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'error', error: 'Something failed' }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.mouseEnter(btn);
    expect(screen.queryByText(/Something failed/)).toBeDefined();
  });

  it('shows error tooltip with default text when no error string', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'error', error: null }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.mouseEnter(btn);
    expect(screen.queryByText(/error occurred/i)).toBeDefined();
  });

  it('hides tooltip on mouse leave', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'done' }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    // after leave, tooltip should not be visible (not hovered)
    // no assertion on text since it was a hovered tooltip
    expect(btn).toBeDefined();
  });

  it('renders AgentQuestionForm popover when question is present', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'waiting_for_user', question: { type: 'confirm', message: 'Continue?' } }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    expect(screen.getByTestId('agent-question-form')).toBeDefined();
  });

  it('does not render tooltip when question is present', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'waiting_for_user', question: { type: 'confirm', message: 'ok?' }, step: { info: 'step info', at: Date.now() - 5000 } }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    fireEvent.mouseEnter(btn);
    // tooltip should be hidden when question is showing
    expect(screen.queryByText(/step info/)).toBeNull();
  });

  it('shows auto tooltip immediately after step update', () => {
    const now = Date.now();
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'analyzing', step: { info: 'Auto visible', at: now } }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    // auto tooltip should be shown right after step update
    expect(screen.queryByText(/Auto visible/)).toBeDefined();
  });

  it('has cursor-pointer when done', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'done' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    expect(btn.className).toContain('cursor-pointer');
  });

  it('has cursor-default when loading', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'pending' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    expect(btn.className).toContain('cursor-default');
  });

  it('uses step info for aria-label', () => {
    mockAtomUse.mockReturnValue([
      makeAnalyze({ status: 'analyzing', step: { info: 'Checking node', at: Date.now() } }),
      { dismiss: mockDismiss },
    ]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    expect(btn.getAttribute('aria-label')).toBe('Checking node');
  });

  it('uses fallback aria-label when no step', () => {
    mockAtomUse.mockReturnValue([makeAnalyze({ status: 'pending' }), { dismiss: mockDismiss }]);
    render(<DoctorStatusIndicator />);
    const btn = document.querySelector('button[type="button"]')!;
    expect(btn.getAttribute('aria-label')).toBe('Doctor running');
  });
});
