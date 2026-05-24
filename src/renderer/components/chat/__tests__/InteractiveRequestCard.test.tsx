/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InteractiveRequestCard from '../InteractiveRequestCard';
import type { InteractiveRequest } from '@shared/types/interactiveRequestTypes';

vi.mock('../../../styles/InteractiveRequestCard.css', async () => ({}));

const otherOptionButtonName = /^Other\b/i;

describe('InteractiveRequestCard', () => {
  it('auto-submits a single approval decision without showing bulk actions', async () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'approval-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      createdAt: Date.now(),
      source: 'tool',
      items: [
        {
          itemId: 'item-1',
          toolCallId: 'tool-1',
          toolName: 'read_file',
          message: 'Needs access to one path.',
          paths: [{ path: 'C:/tmp/demo.txt' }],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    expect(screen.queryByRole('button', { name: 'Approve All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        interactionId: 'approval-1',
        chatSessionId: 'session-1',
        requestType: 'approval',
        action: 'approve',
        approvalItemDecisions: [{ itemId: 'item-1', approved: true }],
      });
    });
  });

  it('shows bulk approval actions only when there are multiple approval items and auto-submits them', async () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'approval-2',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'approval',
      status: 'pending',
      title: 'Review tool access requests',
      createdAt: Date.now(),
      source: 'tool',
      items: [
        {
          itemId: 'item-1',
          toolCallId: 'tool-1',
          toolName: 'read_file',
          message: 'Needs access to one path.',
          paths: [{ path: 'C:/tmp/demo.txt' }],
        },
        {
          itemId: 'item-2',
          toolCallId: 'tool-2',
          toolName: 'execute_command',
          message: 'Needs access to another path.',
          paths: [{ path: 'C:/tmp/other.txt' }],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: 'Approve All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject All' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve All' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        interactionId: 'approval-2',
        chatSessionId: 'session-1',
        requestType: 'approval',
        action: 'approve',
        approvalItemDecisions: [
          { itemId: 'item-1', approved: true },
          { itemId: 'item-2', approved: true },
        ],
      });
    });
  });

  it('requires a valid selection before submitting a choice request', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'choice-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      status: 'pending',
      title: 'Choose environments',
      createdAt: Date.now(),
      source: 'assistant',
      mode: 'multi',
      minSelections: 1,
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Staging' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'choice-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'submit',
      selectedValues: ['staging'],
    });
  });

  it('submits a custom value for single-choice requests when no preset fits', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'choice-custom-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      status: 'pending',
      title: 'Choose a chat',
      createdAt: Date.now(),
      source: 'assistant',
      mode: 'single',
      options: [
        { value: 'chat-a', label: 'Chat A' },
        { value: 'chat-b', label: 'Chat B' },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom option' }), { target: { value: 'Escalation thread' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'choice-custom-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'submit',
      selectedValues: ['Escalation thread'],
    });
  });

  it('shows the choice custom input only after Other is selected', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'choice-custom-visibility',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      status: 'pending',
      title: 'Choose chats',
      createdAt: Date.now(),
      source: 'assistant',
      mode: 'multi',
      options: [
        { value: 'group-1', label: 'Group 1' },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    expect(screen.queryByRole('textbox', { name: 'Custom option' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    expect(screen.getByRole('textbox', { name: 'Custom option' })).toBeInTheDocument();
  });

  it('deduplicates preset and custom entries for multi-choice requests', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'choice-custom-2',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'choice',
      status: 'pending',
      title: 'Choose chats',
      createdAt: Date.now(),
      source: 'assistant',
      mode: 'multi',
      minSelections: 1,
      options: [
        { value: 'group-1', label: 'Group 1' },
        { value: 'meeting-1', label: 'Meeting 1' },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Group 1' }));
    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom option' }), { target: { value: 'group-1, 1:1 Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'choice-custom-2',
      chatSessionId: 'session-1',
      requestType: 'choice',
      action: 'submit',
      selectedValues: ['group-1', '1:1 Alice'],
    });
  });

  it('validates required form fields before submitting', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Provide configuration',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'email',
          label: 'Email',
          type: 'string',
          control: 'text',
          required: true,
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('This field is required')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: { email: 'user@example.com' },
    });
  });

  it('submits form requests with textarea and select controls', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-2',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Configure analysis',
      submitLabel: 'Start analysis',
      skipLabel: 'Do later',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'targetProduct',
          label: 'Target Product',
          type: 'string',
          control: 'text',
          required: true,
        },
        {
          key: 'platform',
          label: 'Platform',
          type: 'string',
          control: 'select',
          required: true,
          options: [
            { value: 'ios', label: 'iOS' },
            { value: 'android', label: 'Android' },
          ],
        },
        {
          key: 'focusAreas',
          label: 'Focus Areas',
          type: 'string',
          control: 'textarea',
          required: false,
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: /target product/i }), { target: { value: 'Claude' } });
    fireEvent.click(screen.getByRole('button', { name: 'iOS' }));
    fireEvent.change(screen.getByRole('textbox', { name: /focus areas/i }), { target: { value: 'Pricing and onboarding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-2',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: {
        targetProduct: 'Claude',
        platform: 'ios',
        focusAreas: 'Pricing and onboarding',
      },
    });
  });

  it('submits custom values for single-select form fields', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-custom-1',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Pick a source',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'source',
          label: 'Source',
          type: 'string',
          control: 'select',
          required: true,
          options: [
            { value: 'email', label: 'Email' },
          ],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom option' }), { target: { value: 'Planner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-custom-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: {
        source: 'Planner',
      },
    });
  });

  it('shows the form custom input only after Other is selected', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-custom-visibility',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Pick a source',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'source',
          label: 'Source',
          type: 'string',
          control: 'select',
          required: true,
          options: [
            { value: 'email', label: 'Email' },
          ],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    expect(screen.queryByRole('textbox', { name: 'Custom option' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    expect(screen.getByRole('textbox', { name: 'Custom option' })).toBeInTheDocument();
  });

  it('submits multiselect form requests through wrapped option buttons', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-3',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Jiangsu residence history',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'cities',
          label: 'Cities',
          type: 'string',
          control: 'multiselect',
          required: true,
          minSelections: 1,
          options: [
            { value: 'nanjing', label: '南京市' },
            { value: 'wuxi', label: '无锡市' },
            { value: 'xuzhou', label: '徐州市' },
          ],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

  const nanjingButton = screen.getByRole('button', { name: '南京市' });
  const xuzhouButton = screen.getByRole('button', { name: '徐州市' });

  fireEvent.click(nanjingButton);
  fireEvent.click(xuzhouButton);

  expect(nanjingButton).toHaveClass('is-selected');
  expect(xuzhouButton).toHaveClass('is-selected');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-3',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: {
        cities: ['nanjing', 'xuzhou'],
      },
    });
  });

  it('combines custom entries with multiselect form submissions', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-custom-2',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Choose chats',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'chat_ids',
          label: 'Chats',
          type: 'string',
          control: 'multiselect',
          required: true,
          minSelections: 1,
          options: [
            { value: 'group-1', label: 'Group 1' },
            { value: 'meeting-1', label: 'Meeting 1' },
          ],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Group 1' }));
    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom option' }), { target: { value: '1:1 Alice, 1:1 Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-custom-2',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: {
        chat_ids: ['group-1', '1:1 Alice', '1:1 Bob'],
      },
    });
  });

  it('deduplicates overlapping preset and custom multiselect form entries', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-custom-3',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Choose chats',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'chat_ids',
          label: 'Chats',
          type: 'string',
          control: 'multiselect',
          required: true,
          minSelections: 1,
          options: [
            { value: 'group-1', label: 'Group 1' },
            { value: 'meeting-1', label: 'Meeting 1' },
          ],
        },
      ],
    };

    render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Group 1' }));
    fireEvent.click(screen.getByRole('button', { name: otherOptionButtonName }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom option' }), { target: { value: 'group-1, meeting-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-custom-3',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: {
        chat_ids: ['group-1', 'meeting-1'],
      },
    });
  });

  it('renders and submits time form controls with a native time input', () => {
    const onSubmit = vi.fn();
    const request: InteractiveRequest = {
      interactionId: 'form-4',
      chatId: 'chat-1',
      chatSessionId: 'session-1',
      requestType: 'form',
      status: 'pending',
      title: 'Confirm schedule time',
      createdAt: Date.now(),
      source: 'assistant',
      fields: [
        {
          key: 'run_time',
          label: 'Run time',
          type: 'string',
          control: 'time',
          required: true,
          defaultValue: '09:00',
        },
      ],
    };

    const { container } = render(<InteractiveRequestCard request={request} onSubmit={onSubmit} />);

    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement | null;
    expect(timeInput).not.toBeNull();
    expect(timeInput?.value).toBe('09:00');

    fireEvent.change(timeInput as HTMLInputElement, { target: { value: '13:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'form-4',
      chatSessionId: 'session-1',
      requestType: 'form',
      action: 'submit',
      formValues: {
        run_time: '13:30',
      },
    });
  });
});