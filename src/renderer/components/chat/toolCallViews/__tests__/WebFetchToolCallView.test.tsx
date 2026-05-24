/**
 * @vitest-environment happy-dom
 */

/**
 * WebFetchToolCallView rendering tests
 *
 * Covers: argument parsing, executing/interrupted states, success with results,
 * no-content fallback, error rows, clickable URL rows, favicon hiding on error.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebFetchToolCallView } from '../WebFetchToolCallView';
import type { ToolCallExecutionStatus } from '../types';
import type { ToolCall, Message } from '@shared/types/chatTypes';

// ========== Helper factories ==========

function makeToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: 'tc_fetch_001',
    type: 'function',
    function: {
      name: 'fetch_web_content',
      arguments: JSON.stringify(args),
    },
  };
}

function makeToolResult(resultObj: unknown): Message {
  return {
    id: 'tr_fetch_001',
    timestamp: Date.now(),
    role: 'tool',
    tool_call_id: 'tc_fetch_001',
    name: 'fetch_web_content',
    content: [{ type: 'text', text: JSON.stringify(resultObj) }],
  };
}

function renderView(
  toolCall: ToolCall,
  toolResult: Message | null = null,
  executionStatus: ToolCallExecutionStatus = 'completed',
) {
  return render(
    <WebFetchToolCallView
      toolCall={toolCall}
      toolResult={toolResult}
      executionStatus={executionStatus}
    />,
  );
}

// ========== Tests ==========

describe('WebFetchToolCallView', () => {
  describe('rendering with no / invalid args', () => {
    it('returns null when arguments string is empty', () => {
      const toolCall: ToolCall = {
        id: 'tc_empty',
        type: 'function',
        function: { name: 'fetch_web_content', arguments: '' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when arguments is malformed JSON', () => {
      const toolCall: ToolCall = {
        id: 'tc_bad',
        type: 'function',
        function: { name: 'fetch_web_content', arguments: 'not-json' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when urls array is empty', () => {
      const toolCall = makeToolCall({ urls: [] });
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when urls field is missing', () => {
      const toolCall = makeToolCall({ other: 'field' });
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('executing state', () => {
    it('shows fetching message for single URL', () => {
      const toolCall = makeToolCall({ urls: ['https://example.com'] });
      renderView(toolCall, null, 'executing');
      expect(screen.getByText('Fetching 1 page...')).toBeInTheDocument();
    });

    it('shows plural fetching message for multiple URLs', () => {
      const toolCall = makeToolCall({ urls: ['https://a.com', 'https://b.com'] });
      renderView(toolCall, null, 'executing');
      expect(screen.getByText('Fetching 2 pages...')).toBeInTheDocument();
    });
  });

  describe('interrupted state', () => {
    it('shows interrupted message', () => {
      const toolCall = makeToolCall({ urls: ['https://example.com'] });
      renderView(toolCall, null, 'interrupted');
      expect(screen.getByText('Fetch interrupted before results were recorded')).toBeInTheDocument();
    });
  });

  describe('completed with results', () => {
    it('renders result rows with title and domain', () => {
      const toolCall = makeToolCall({ urls: ['https://react.dev'] });
      const result = makeToolResult({
        results: [
          { url: 'https://react.dev', title: 'React Docs', content: 'some content' },
        ],
      });
      renderView(toolCall, result);
      expect(screen.getByText('React Docs')).toBeInTheDocument();
      expect(screen.getByText('react.dev')).toBeInTheDocument();
    });

    it('falls back to "Untitled" when title is missing', () => {
      const toolCall = makeToolCall({ urls: ['https://no-title.com'] });
      const result = makeToolResult({
        results: [
          { url: 'https://no-title.com', title: '', content: 'content' },
        ],
      });
      renderView(toolCall, result);
      expect(screen.getByText('Untitled')).toBeInTheDocument();
    });

    it('opens result URL in new tab on click', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const toolCall = makeToolCall({ urls: ['https://click-me.com'] });
      const result = makeToolResult({
        results: [
          { url: 'https://click-me.com', title: 'Click Me', content: 'content' },
        ],
      });
      renderView(toolCall, result);
      fireEvent.click(screen.getByText('Click Me').closest('.web-fetch-result-row')!);
      expect(openSpy).toHaveBeenCalledWith('https://click-me.com', '_blank', 'noopener,noreferrer');
      openSpy.mockRestore();
    });

    it('hides favicon image on load error', () => {
      const toolCall = makeToolCall({ urls: ['https://test.com'] });
      const result = makeToolResult({
        results: [{ url: 'https://test.com', title: 'Test', content: '' }],
      });
      renderView(toolCall, result);
      const img = document.querySelector('.web-fetch-result-favicon') as HTMLImageElement;
      expect(img).not.toBeNull();
      fireEvent.error(img);
      expect(img.style.display).toBe('none');
    });
  });

  describe('no content fallback', () => {
    it('shows no content message when results array is empty', () => {
      const toolCall = makeToolCall({ urls: ['https://empty.com'] });
      const result = makeToolResult({ results: [] });
      renderView(toolCall, result);
      expect(screen.getByText('No content fetched')).toBeInTheDocument();
    });

    it('shows no content message when toolResult is null', () => {
      const toolCall = makeToolCall({ urls: ['https://example.com'] });
      renderView(toolCall, null, 'completed');
      expect(screen.getByText('No content fetched')).toBeInTheDocument();
    });
  });

  describe('error rows', () => {
    it('renders errors with parsed URL and message', () => {
      const toolCall = makeToolCall({ urls: ['https://err.com'] });
      const result = makeToolResult({
        results: [],
        errors: ['URL "https://err.com": HTTP 403: Forbidden'],
      });
      renderView(toolCall, result);
      expect(screen.getByText('HTTP 403: Forbidden')).toBeInTheDocument();
      expect(screen.getByText('err.com')).toBeInTheDocument();
    });

    it('renders plain error text when error does not match URL pattern', () => {
      const toolCall = makeToolCall({ urls: ['https://err.com'] });
      const result = makeToolResult({
        results: [],
        errors: ['Unknown network error'],
      });
      renderView(toolCall, result);
      expect(screen.getByText('Unknown network error')).toBeInTheDocument();
    });

    it('opens error URL in new tab when clicked', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const toolCall = makeToolCall({ urls: ['https://err.com'] });
      const result = makeToolResult({
        results: [],
        errors: ['URL "https://err.com": HTTP 500: Server Error'],
      });
      renderView(toolCall, result);
      const errorRow = document.querySelector('.web-fetch-error-row.clickable')!;
      fireEvent.click(errorRow);
      expect(openSpy).toHaveBeenCalledWith('https://err.com', '_blank', 'noopener,noreferrer');
      openSpy.mockRestore();
    });

    it('does not navigate when error has no URL', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const toolCall = makeToolCall({ urls: ['https://x.com'] });
      const result = makeToolResult({
        results: [],
        errors: ['Plain error no URL'],
      });
      renderView(toolCall, result);
      const errorRow = document.querySelector('.web-fetch-error-row')!;
      fireEvent.click(errorRow);
      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe('combined results and errors', () => {
    it('renders both result rows and error rows together', () => {
      const toolCall = makeToolCall({ urls: ['https://ok.com', 'https://fail.com'] });
      const result = makeToolResult({
        results: [{ url: 'https://ok.com', title: 'OK Page', content: '' }],
        errors: ['URL "https://fail.com": HTTP 404: Not Found'],
      });
      renderView(toolCall, result);
      expect(screen.getByText('OK Page')).toBeInTheDocument();
      expect(screen.getByText('HTTP 404: Not Found')).toBeInTheDocument();
    });
  });
});
