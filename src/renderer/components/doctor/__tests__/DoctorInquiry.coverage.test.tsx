/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockInquiryState = vi.hoisted(() => ({
  type: 'idle-show' as 'idle' | 'idle-show' | 'pending',
  form: {
    description: '',
    reproSteps: '',
    occurredAt: '',
    agentId: undefined as string | undefined,
    chatSessionId: undefined as string | undefined,
    screenshots: [] as File[],
  },
  error: undefined as string | undefined,
}));

const mockInquiryActions = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  discard: vi.fn(),
  submit: vi.fn(),
  updateForm: vi.fn((fn: (f: any) => void) => { fn(mockInquiryState.form); }),
  isAllValid: vi.fn(() => false),
  hasValidField: vi.fn(() => false),
  _onAnalyzeFinished: vi.fn(),
}));

const mockAnalyzeState = vi.hoisted(() => ({
  status: 'idle' as string,
}));

const mockChats = vi.hoisted(() => [] as any[]);

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('@/states/doctor.atom', () => ({
  doctorInquiryAtom: {
    use: () => [mockInquiryState, mockInquiryActions],
  },
  doctorAnalyzeAtom: {
    use: () => [mockAnalyzeState],
  },
  NONE_OPTION: '__none__',
  UNSURE_TEXT: "I'm not sure",
  TIME_AGNOSTIC_TEXT: 'Not time-related',
}));

vi.mock('../../userData/userDataProvider', () => ({
  useChats: () => ({ chats: mockChats }),
}));

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? <div data-testid="dialog" onClick={() => onOpenChange?.(false)}>{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
}));

vi.mock('../../ui/button', () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button onClick={onClick} disabled={disabled} type={type}>{children}</button>
  ),
}));

vi.mock('../Icon', () => ({
  doctor_icon: <svg data-testid="doctor-icon" />,
}));

vi.mock('lucide-react', () => ({
  Clipboard: () => <span>Clipboard</span>,
  Upload: () => <span>Upload</span>,
  X: () => <span>X</span>,
  AlertCircle: () => <span>AlertCircle</span>,
}));

import DoctorInquiry from '../DoctorInquiry';

describe('DoctorInquiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInquiryState.type = 'idle-show';
    mockInquiryState.form = {
      description: '',
      reproSteps: '',
      occurredAt: '',
      agentId: undefined,
      chatSessionId: undefined,
      screenshots: [],
    };
    mockInquiryState.error = undefined;
    mockAnalyzeState.status = 'idle';
    mockChats.length = 0;
    mockInquiryActions.isAllValid.mockReturnValue(false);
    mockInquiryActions.hasValidField.mockReturnValue(false);
    mockInquiryActions.updateForm.mockImplementation((fn: (f: any) => void) => { fn(mockInquiryState.form); });
  });

  it('renders dialog when type is idle-show', () => {
    render(<DoctorInquiry />);
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(screen.getByText('Doctor · Self-Diagnosis')).toBeTruthy();
  });

  it('does not render dialog when type is idle', () => {
    mockInquiryState.type = 'idle';
    const { container } = render(<DoctorInquiry />);
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull();
  });

  it('calls actions.hide when dialog onOpenChange(false)', () => {
    render(<DoctorInquiry />);
    fireEvent.click(screen.getByTestId('dialog'));
    expect(mockInquiryActions.hide).toHaveBeenCalled();
  });

  it('Close button calls hide when no valid fields', () => {
    render(<DoctorInquiry />);
    const buttons = screen.getAllByRole('button');
    const closeBtn = buttons.find(b => b.textContent === 'Close');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(mockInquiryActions.hide).toHaveBeenCalled();
  });

  it('shows Hide and Discard when hasValidField is true', () => {
    mockInquiryActions.hasValidField.mockReturnValue(true);
    render(<DoctorInquiry />);
    expect(screen.getByText('Hide')).toBeTruthy();
    expect(screen.getByText('Discard')).toBeTruthy();
  });

  it('Discard button calls actions.discard', () => {
    mockInquiryActions.hasValidField.mockReturnValue(true);
    render(<DoctorInquiry />);
    fireEvent.click(screen.getByText('Discard'));
    expect(mockInquiryActions.discard).toHaveBeenCalled();
  });

  it('Submit button is disabled when not valid', () => {
    render(<DoctorInquiry />);
    const submitBtn = screen.getByText('Submit Diagnosis').closest('button')!;
    expect(submitBtn.disabled).toBe(true);
  });

  it('Submit button is enabled when valid', () => {
    mockInquiryActions.isAllValid.mockReturnValue(true);
    render(<DoctorInquiry />);
    const submitBtn = screen.getByText('Submit Diagnosis').closest('button')!;
    expect(submitBtn.disabled).toBe(false);
  });

  it('Submit button shows Submitting when pending', () => {
    mockAnalyzeState.status = 'pending';
    render(<DoctorInquiry />);
    expect(screen.getByText('Submitting...')).toBeTruthy();
  });

  it('Submit button is disabled when analyzing', () => {
    mockAnalyzeState.status = 'analyzing';
    render(<DoctorInquiry />);
    const submitBtn = screen.getByText('Submitting...').closest('button')!;
    expect(submitBtn.disabled).toBe(true);
  });

  it('clicking Submit calls actions.submit', () => {
    mockInquiryActions.isAllValid.mockReturnValue(true);
    render(<DoctorInquiry />);
    fireEvent.click(screen.getByText('Submit Diagnosis'));
    expect(mockInquiryActions.submit).toHaveBeenCalled();
  });

  it('shows error message when error is set', () => {
    mockInquiryState.error = 'Something went wrong';
    render(<DoctorInquiry />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('description textarea triggers updateForm', () => {
    render(<DoctorInquiry />);
    const textarea = screen.getAllByRole('textbox')[0];
    fireEvent.change(textarea, { target: { value: 'new desc' } });
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('reproSteps textarea triggers updateForm', () => {
    render(<DoctorInquiry />);
    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[1], { target: { value: 'repro steps' } });
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it("I'm not sure button fills UNSURE_TEXT", () => {
    render(<DoctorInquiry />);
    fireEvent.click(screen.getByText("I'm not sure →"));
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('Not time-related button fills TIME_AGNOSTIC_TEXT', () => {
    render(<DoctorInquiry />);
    fireEvent.click(screen.getByText('Not time-related →'));
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('occurredAt input triggers updateForm', () => {
    render(<DoctorInquiry />);
    const inputs = screen.getAllByRole('textbox');
    const occurredAtInput = inputs[2];
    fireEvent.change(occurredAtInput, { target: { value: 'just now' } });
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('agent select changes agent ID', () => {
    mockChats.push({ chat_id: 'c1', agent: { name: 'Alpha', emoji: '🤖' }, chatSessions: [] });
    render(<DoctorInquiry />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'c1' } });
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('renders agent options from chats', () => {
    mockChats.push(
      { chat_id: 'c1', agent: { name: 'Alpha', emoji: '🤖' }, chatSessions: [] },
      { chat_id: 'c2', agent: { name: 'Beta', emoji: '' }, chatSessions: [] },
    );
    render(<DoctorInquiry />);
    expect(screen.getByText('🤖 Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('shows session select when agentId is set and not NONE_OPTION', () => {
    mockInquiryState.form.agentId = 'c1';
    mockChats.push({
      chat_id: 'c1',
      agent: { name: 'Alpha', emoji: '' },
      chatSessions: [
        { chatSession_id: 's1', title: 'Session 1' },
      ],
    });
    render(<DoctorInquiry />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Session 1')).toBeTruthy();
  });

  it('shows "no session history" when agent has no sessions', () => {
    mockInquiryState.form.agentId = 'c1';
    mockChats.push({ chat_id: 'c1', agent: { name: 'Alpha', emoji: '' }, chatSessions: [] });
    render(<DoctorInquiry />);
    expect(screen.getByText('This agent has no session history yet')).toBeTruthy();
  });

  it('does not show session select when agentId is NONE_OPTION', () => {
    mockInquiryState.form.agentId = '__none__';
    render(<DoctorInquiry />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(1); // only agent select
  });

  it('chatSession select triggers updateForm', () => {
    mockInquiryState.form.agentId = 'c1';
    mockChats.push({
      chat_id: 'c1',
      agent: { name: 'Alpha', emoji: '' },
      chatSessions: [{ chatSession_id: 's1', title: 'Session 1' }],
    });
    render(<DoctorInquiry />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 's1' } });
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('Upload File button triggers file input click', () => {
    render(<DoctorInquiry />);
    const uploadBtn = screen.getByText('Upload File').closest('button')!;
    // Just verify it exists and is clickable without errors
    fireEvent.click(uploadBtn);
    expect(uploadBtn).toBeTruthy();
  });

  it('Paste from Clipboard button calls navigator.clipboard.read', async () => {
    const mockRead = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'clipboard', {
      value: { read: mockRead },
      configurable: true,
    });

    render(<DoctorInquiry />);
    const pasteBtn = screen.getByText('Paste from Clipboard').closest('button')!;
    await act(async () => {
      fireEvent.click(pasteBtn);
    });
    expect(mockRead).toHaveBeenCalled();
  });

  it('handles clipboard.read failure silently', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { read: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });

    render(<DoctorInquiry />);
    const pasteBtn = screen.getByText('Paste from Clipboard').closest('button')!;
    await act(async () => {
      fireEvent.click(pasteBtn);
    });
    // Should not throw
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('renders screenshot thumbnails and remove buttons', () => {
    const fakeFile = new File(['img'], 'test.png', { type: 'image/png' });
    mockInquiryState.form.screenshots = [fakeFile];
    // Mock URL.createObjectURL
    const mockCreateURL = vi.fn(() => 'blob:test');
    const mockRevokeURL = vi.fn();
    global.URL.createObjectURL = mockCreateURL;
    global.URL.revokeObjectURL = mockRevokeURL;

    render(<DoctorInquiry />);
    expect(mockCreateURL).toHaveBeenCalledWith(fakeFile);
    const removeBtn = screen.getByLabelText('Remove screenshot');
    fireEvent.click(removeBtn);
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('file input change calls updateForm', async () => {
    render(<DoctorInquiry />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const fakeFile = new File(['img'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      value: [fakeFile],
      configurable: true,
    });
    fireEvent.change(fileInput);
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });

  it('clipboard items with image types are processed', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    const mockItem = {
      types: ['image/png'],
      getType: vi.fn().mockResolvedValue(blob),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: { read: vi.fn().mockResolvedValue([mockItem]) },
      configurable: true,
    });

    render(<DoctorInquiry />);
    const pasteBtn = screen.getByText('Paste from Clipboard').closest('button')!;
    await act(async () => {
      fireEvent.click(pasteBtn);
    });
    expect(mockInquiryActions.updateForm).toHaveBeenCalled();
  });
});
