/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { ToolCallsSection } from '../ToolCallsSection';
import type { Message, ToolCall } from '@shared/types/chatTypes';

let mockMessages: Message[] = [];

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => mockMessages,
}));

// Stub ToolCallItem so per-item executionStatus is trivially assertable and the
// heavy custom-view rendering is out of scope for this section-level test.
vi.mock('../ToolCallItem', () => ({
  ToolCallItem: ({ executionStatus, itemKey }: { executionStatus: string; itemKey: string }) => (
    <div data-testid="tool-call-item" data-status={executionStatus} data-key={itemKey} />
  ),
}));

function tc(id: string, name = 'get_current_datetime'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

function toolResult(id: string, complete = true): Message {
  return {
    id: `res_${id}`,
    role: 'tool',
    content: [{ type: 'text', text: '{}' }],
    tool_call_id: id,
    name: 'get_current_datetime',
    streamingComplete: complete,
    timestamp: Date.now(),
  } as Message;
}

function assistant(id: string): Message {
  return { id, role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as Message;
}

const iconClass = (c: HTMLElement): string | null => {
  const el = c.querySelector('.tool-status-icon');
  return el ? el.className.replace('tool-status-icon', '').trim() : null;
};

describe('ToolCallsSection status computation and rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages = [];
  });

  it('renders completed when every tool has a finished result', () => {
    mockMessages = [toolResult('a')];
    const { container } = render(<ToolCallsSection toolCalls={[tc('a')]} chatStatus="idle" messageId="m" />);
    expect(iconClass(container)).toBe('completed');
  });

  it('renders interrupted when a finished/idle task still has unfinished tools', () => {
    mockMessages = [];
    const { container } = render(<ToolCallsSection toolCalls={[tc('a')]} chatStatus="idle" messageId="m" />);
    expect(iconClass(container)).toBe('interrupted');
  });

  it('renders interrupted when a later conversation message supersedes the tools', () => {
    mockMessages = [assistant('s0'), assistant('s1')];
    const { container } = render(
      <ToolCallsSection toolCalls={[tc('a')]} chatStatus="sending_response" sourceMessageIndex={0} messageId="m" />
    );
    expect(iconClass(container)).toBe('interrupted');
  });

  it('renders partial when some tools completed while still streaming', () => {
    mockMessages = [toolResult('a')];
    const { container } = render(
      <ToolCallsSection toolCalls={[tc('a'), tc('b')]} chatStatus="sending_response" messageId="m" />
    );
    expect(iconClass(container)).toBe('partial');
  });

  it('renders executing when nothing completed yet and still streaming', () => {
    mockMessages = [];
    const { container } = render(
      <ToolCallsSection toolCalls={[tc('a')]} chatStatus="sending_response" messageId="m" />
    );
    expect(iconClass(container)).toBe('executing');
  });

  it('treats tool calls without an id as completed in status computation', () => {
    mockMessages = [];
    const { container } = render(<ToolCallsSection toolCalls={[tc('   ')]} chatStatus="idle" messageId="m" />);
    // The component keeps the call (valid name) but status sees no valid ids -> completed.
    expect(iconClass(container)).toBe('completed');
  });

  it('renders nothing when no tool call has a valid name', () => {
    const { container } = render(
      <ToolCallsSection toolCalls={[{ id: 'x', type: 'function', function: { name: '', arguments: '{}' } }]} messageId="m" />
    );
    expect(container.querySelector('.tool-calls-section-new')).toBeNull();
  });

  it('expands to per-tool items with the correct execution status', () => {
    mockMessages = [toolResult('a', true), toolResult('b', false)];
    const { container } = render(
      <ToolCallsSection toolCalls={[tc('a'), tc('b'), tc('c')]} chatStatus="sending_response" messageId="m" />
    );
    fireEvent.click(container.querySelector('.tool-calls-row')!);

    const items = Array.from(container.querySelectorAll('[data-testid="tool-call-item"]'));
    const statuses = items.map(i => i.getAttribute('data-status'));
    expect(statuses).toEqual(['completed', 'executing', 'executing']);
  });

  it('marks unfinished tools as interrupted when the section is interrupted', () => {
    mockMessages = [];
    const { container } = render(
      <ToolCallsSection toolCalls={[tc('a')]} chatStatus="idle" messageId="m" />
    );
    fireEvent.click(container.querySelector('.tool-calls-row')!);
    expect(container.querySelector('[data-testid="tool-call-item"]')?.getAttribute('data-status')).toBe('interrupted');
  });

  it('adjusts scroll position to keep the header stable on toggle', () => {
    mockMessages = [toolResult('a')];
    const { container } = render(<ToolCallsSection toolCalls={[tc('a')]} chatStatus="idle" messageId="m" />);

    let call = 0;
    const gbcr = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ top: call++ === 0 ? 100 : 50, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });
    const scrollContainer = { scrollTop: 0 };
    const closest = vi.spyOn(Element.prototype, 'closest').mockReturnValue(scrollContainer as unknown as Element);

    fireEvent.click(container.querySelector('.tool-calls-row')!);

    expect(closest).toHaveBeenCalledWith('.chat-container-reverse');
    expect(scrollContainer.scrollTop).toBe(-50);
    expect(container.querySelector('[data-testid="tool-call-item"]')).toBeTruthy();

    gbcr.mockRestore();
    raf.mockRestore();
    closest.mockRestore();
  });

  it('does not adjust scroll when the header position is unchanged', () => {
    mockMessages = [toolResult('a')];
    const { container } = render(<ToolCallsSection toolCalls={[tc('a')]} chatStatus="idle" messageId="m" />);

    const gbcr = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ top: 100, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });
    const closest = vi.spyOn(Element.prototype, 'closest').mockReturnValue(null);

    fireEvent.click(container.querySelector('.tool-calls-row')!);

    // diff is 0, so the scrollable container is never queried.
    expect(closest).not.toHaveBeenCalled();

    gbcr.mockRestore();
    raf.mockRestore();
    closest.mockRestore();
  });

  it('tolerates a missing scrollable ancestor on toggle', () => {
    mockMessages = [toolResult('a')];
    const { container } = render(<ToolCallsSection toolCalls={[tc('a')]} chatStatus="idle" messageId="m" />);

    let call = 0;
    const gbcr = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ top: call++ === 0 ? 100 : 50, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });
    const closest = vi.spyOn(Element.prototype, 'closest').mockReturnValue(null);

    expect(() => fireEvent.click(container.querySelector('.tool-calls-row')!)).not.toThrow();
    expect(closest).toHaveBeenCalledWith('.chat-container-reverse');

    gbcr.mockRestore();
    raf.mockRestore();
    closest.mockRestore();
  });

  it('falls back to the item index for keys when a tool call has no id', () => {
    mockMessages = [];
    const { container } = render(
      <ToolCallsSection toolCalls={[{ id: '', type: 'function', function: { name: 'get_current_datetime', arguments: '{}' } }]} chatStatus="idle" messageId="m" />
    );
    fireEvent.click(container.querySelector('.tool-calls-row')!);
    const item = container.querySelector('[data-testid="tool-call-item"]');
    expect(item?.getAttribute('data-key')).toBe('m_tool_0');
  });
});
