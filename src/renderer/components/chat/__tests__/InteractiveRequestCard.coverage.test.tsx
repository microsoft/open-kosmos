/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../styles/InteractiveRequestCard.css', () => ({}));

import InteractiveRequestCard, { InteractiveRequestHistoryItem } from '../InteractiveRequestCard';
import type { InteractiveRequest, InteractionHistoryEntry } from '@shared/types/interactiveRequestTypes';

function makeApprovalRequest(overrides: Partial<any> = {}): InteractiveRequest {
  return {
    interactionId: 'req-1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    requestType: 'approval',
    status: 'pending',
    title: 'Approval Request',
    createdAt: Date.now(),
    items: [
      {
        itemId: 'item-1',
        toolName: 'read_file',
        message: 'Read a file',
        paths: [{ path: '/tmp/test.txt', normalizedPath: '/tmp/test.txt' }],
      },
    ],
    ...overrides,
  };
}

function makeChoiceRequest(overrides: Partial<any> = {}): InteractiveRequest {
  return {
    interactionId: 'choice-1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    requestType: 'choice',
    status: 'pending',
    title: 'Choose an option',
    createdAt: Date.now(),
    mode: 'single',
    options: [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B', description: 'B desc' },
    ],
    ...overrides,
  };
}

function makeFormRequest(overrides: Partial<any> = {}): InteractiveRequest {
  return {
    interactionId: 'form-1',
    chatId: 'chat-1',
    chatSessionId: 'session-1',
    requestType: 'form',
    status: 'pending',
    title: 'Fill out form',
    createdAt: Date.now(),
    fields: [
      { key: 'name', label: 'Name', type: 'string', required: true },
    ],
    ...overrides,
  };
}

describe('InteractiveRequestCard - Approval', () => {
  it('renders title and approve/reject buttons', () => {
    render(<InteractiveRequestCard request={makeApprovalRequest()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Approval Request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('shows path in approval item', () => {
    render(<InteractiveRequestCard request={makeApprovalRequest()} onSubmit={vi.fn()} />);
    expect(screen.getByText('/tmp/test.txt')).toBeInTheDocument();
  });

  it('auto-submits after approve is clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<InteractiveRequestCard request={makeApprovalRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve' })));
  });

  it('auto-submits with reject action', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<InteractiveRequestCard request={makeApprovalRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'reject' })));
  });

  it('shows Approve All and Reject All for multiple items', () => {
    const req = makeApprovalRequest({
      items: [
        { itemId: 'i1', toolName: 'read', message: 'msg1', paths: [] },
        { itemId: 'i2', toolName: 'write', message: 'msg2', paths: [] },
      ],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Approve All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject All' })).toBeInTheDocument();
  });

  it('Approve All sets all decisions and auto-submits', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const req = makeApprovalRequest({
      items: [
        { itemId: 'i1', toolName: 'read', message: 'msg1', paths: [] },
        { itemId: 'i2', toolName: 'write', message: 'msg2', paths: [] },
      ],
    });
    render(<InteractiveRequestCard request={req} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve All' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].action).toBe('approve');
  });

  it('Reject All sets all decisions and auto-submits', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const req = makeApprovalRequest({
      items: [
        { itemId: 'i1', toolName: 'read', message: 'msg1', paths: [] },
        { itemId: 'i2', toolName: 'write', message: 'msg2', paths: [] },
      ],
    });
    render(<InteractiveRequestCard request={req} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject All' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].action).toBe('reject');
  });

  it('renders description as HTML', () => {
    const req = makeApprovalRequest({ description: '<b>Important</b> notice' });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    // The description should be rendered
    expect(document.querySelector('.interactive-request-description')).toBeTruthy();
  });
});

describe('InteractiveRequestCard - Choice (single)', () => {
  it('renders choice options', () => {
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('Continue button disabled until selection', () => {
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('Continue button enabled after option selected', async () => {
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Option A').closest('button')!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled());
  });

  it('submits selected value on Continue', async () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Option A').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'submit',
      selectedValues: ['a'],
    })));
  });

  it('Skip button calls onSubmit with skip action', async () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'skip' }));
  });

  it('shows custom input when Other is selected', async () => {
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByText('Other').closest('button')!);
    await waitFor(() => expect(screen.getByPlaceholderText('Enter a custom value')).toBeInTheDocument());
  });

  it('submits custom value for single mode', async () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={makeChoiceRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Other').closest('button')!);
    const input = await screen.findByPlaceholderText('Enter a custom value');
    fireEvent.change(input, { target: { value: 'my-custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ selectedValues: ['my-custom'] }));
  });
});

describe('InteractiveRequestCard - Choice (multi)', () => {
  const multiRequest = () => makeChoiceRequest({ mode: 'multi' });

  it('allows multiple selections', async () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={multiRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Option A').closest('button')!);
    fireEvent.click(screen.getByText('Option B').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ selectedValues: ['a', 'b'] }));
  });

  it('toggling deselects an option in multi mode', async () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={multiRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Option A').closest('button')!);
    fireEvent.click(screen.getByText('Option A').closest('button')!); // deselect
    fireEvent.click(screen.getByText('Option B').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ selectedValues: ['b'] }));
  });
});

describe('InteractiveRequestCard - Form', () => {
  it('renders form fields', () => {
    render(<InteractiveRequestCard request={makeFormRequest()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
  });

  it('shows validation error for required empty field', async () => {
    render(<InteractiveRequestCard request={makeFormRequest()} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('This field is required')).toBeInTheDocument());
  });

  it('submits form with filled required field', async () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={makeFormRequest()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'submit' }));
  });

  it('Skip calls onSubmit with skip action', () => {
    const onSubmit = vi.fn();
    render(<InteractiveRequestCard request={makeFormRequest()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'skip' }));
  });

  it('renders textarea control', () => {
    const req = makeFormRequest({
      fields: [{ key: 'bio', label: 'Bio', type: 'string', control: 'textarea' }],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders boolean checkbox control', () => {
    const req = makeFormRequest({
      fields: [{ key: 'enabled', label: 'Enabled', type: 'boolean', control: 'checkbox' }],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders boolean select control', () => {
    const req = makeFormRequest({
      fields: [{ key: 'active', label: 'Active', type: 'boolean' }],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders select field with options', () => {
    const req = makeFormRequest({
      fields: [{
        key: 'color', label: 'Color', type: 'string', control: 'select',
        options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }],
      }],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();
  });

  it('uses custom submitLabel and skipLabel', () => {
    const req = makeFormRequest({ submitLabel: 'Apply', skipLabel: 'Dismiss' });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('renders int field as number input', () => {
    const req = makeFormRequest({
      fields: [{ key: 'age', label: 'Age', type: 'int' }],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('renders time control', () => {
    const req = makeFormRequest({
      fields: [{ key: 'alarm', label: 'Alarm', type: 'string', control: 'time' }],
    });
    render(<InteractiveRequestCard request={req} onSubmit={vi.fn()} />);
    // time inputs don't have a named role but exist
    expect(document.querySelector('input[type="time"]')).toBeTruthy();
  });
});

describe('InteractiveRequestHistoryItem', () => {
  const makeEntry = (overrides: Partial<InteractionHistoryEntry> = {}): InteractionHistoryEntry => ({
    interactionId: 'h-1',
    requestType: 'approval',
    title: 'History Title',
    status: 'submitted',
    summaryText: 'Approved 2/2 items',
    ...overrides,
  } as any);

  it('renders history entry', () => {
    render(<InteractiveRequestHistoryItem entry={makeEntry()} />);
    expect(screen.getByText('History Title')).toBeInTheDocument();
    expect(screen.getByText('submitted')).toBeInTheDocument();
    expect(screen.getByText('Approved 2/2 items')).toBeInTheDocument();
  });

  it('renders description stripping HTML tags', () => {
    render(<InteractiveRequestHistoryItem entry={makeEntry({ description: '<b>Note</b>' })} />);
    expect(screen.getByText('Note')).toBeInTheDocument();
  });

  it('renders choice history icon', () => {
    render(<InteractiveRequestHistoryItem entry={makeEntry({ requestType: 'choice' })} />);
    expect(document.querySelector('.interactive-history-card')).toBeTruthy();
  });

  it('renders form history icon', () => {
    render(<InteractiveRequestHistoryItem entry={makeEntry({ requestType: 'form' })} />);
    expect(document.querySelector('.interactive-history-card')).toBeTruthy();
  });
});
