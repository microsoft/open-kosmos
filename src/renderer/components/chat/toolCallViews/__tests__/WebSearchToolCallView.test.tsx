/**
 * @vitest-environment happy-dom
 */

/**
 * WebSearchToolCallView rendering tests
 *
 * Covers: argument parsing, query grouping, result display, executing/interrupted
 * states, error display, edge cases (empty args, malformed JSON, missing query field).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebSearchToolCallView } from '../WebSearchToolCallView';
import type { ToolCallViewProps, ToolCallExecutionStatus } from '../types';
import type { ToolCall, Message } from '@shared/types/chatTypes';

// ========== Helper factories ==========

function makeToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: 'tc_search_001',
    type: 'function',
    function: {
      name: 'bing_web_search',
      arguments: JSON.stringify(args),
    },
  };
}

function makeToolResult(resultObj: unknown): Message {
  return {
    id: 'tr_001',
    timestamp: Date.now(),
    role: 'tool',
    tool_call_id: 'tc_search_001',
    name: 'bing_web_search',
    content: [{ type: 'text', text: JSON.stringify(resultObj) }],
  };
}

function renderView(
  toolCall: ToolCall,
  toolResult: Message | null = null,
  executionStatus: ToolCallExecutionStatus = 'completed',
) {
  return render(
    <WebSearchToolCallView
      toolCall={toolCall}
      toolResult={toolResult}
      executionStatus={executionStatus}
    />,
  );
}

// ========== Tests ==========

describe('WebSearchToolCallView', () => {
  describe('rendering with no / invalid args', () => {
    it('returns null when arguments string is empty', () => {
      const toolCall: ToolCall = {
        id: 'tc_empty',
        type: 'function',
        function: { name: 'bing_web_search', arguments: '' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when arguments is malformed JSON', () => {
      const toolCall: ToolCall = {
        id: 'tc_bad_json',
        type: 'function',
        function: { name: 'bing_web_search', arguments: '{not valid json' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when queries array is empty', () => {
      const toolCall = makeToolCall({ queries: [] });
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when queries field is missing', () => {
      const toolCall = makeToolCall({ something: 'else' });
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('executing state', () => {
    it('shows Searching... indicator for the first query when executing', () => {
      const toolCall = makeToolCall({ queries: ['typescript basics'] });
      renderView(toolCall, null, 'executing');
      expect(screen.getByText('Searching...')).toBeInTheDocument();
      expect(screen.getByText('typescript basics')).toBeInTheDocument();
    });

    it('only shows Searching... on the first query when multiple queries exist', () => {
      const toolCall = makeToolCall({ queries: ['query A', 'query B'] });
      renderView(toolCall, null, 'executing');
      const loadingEls = screen.getAllByText('Searching...');
      expect(loadingEls).toHaveLength(1);
    });
  });

  describe('interrupted state', () => {
    it('shows Interrupted indicator for the first query', () => {
      const toolCall = makeToolCall({ queries: ['some query'] });
      renderView(toolCall, null, 'interrupted');
      expect(screen.getByText('Interrupted')).toBeInTheDocument();
    });
  });

  describe('completed with results', () => {
    it('renders query and result count', () => {
      const toolCall = makeToolCall({ queries: ['react hooks'] });
      const result = makeToolResult({
        results: [
          { query: 'react hooks', title: 'React Docs', url: 'https://react.dev', site: 'react.dev' },
          { query: 'react hooks', title: 'Blog Post', url: 'https://blog.com', site: 'blog.com' },
        ],
      });
      renderView(toolCall, result);
      expect(screen.getByText('react hooks')).toBeInTheDocument();
      expect(screen.getByText('2 results')).toBeInTheDocument();
      expect(screen.getByText('React Docs')).toBeInTheDocument();
      expect(screen.getByText('Blog Post')).toBeInTheDocument();
    });

    it('assigns results without query field to first query', () => {
      const toolCall = makeToolCall({ queries: ['test query'] });
      const result = makeToolResult({
        results: [
          { title: 'Some Result', url: 'https://example.com', site: 'example.com' },
        ],
      });
      renderView(toolCall, result);
      expect(screen.getByText('Some Result')).toBeInTheDocument();
      expect(screen.getByText('1 results')).toBeInTheDocument();
    });

    it('shows domain site labels for results', () => {
      const toolCall = makeToolCall({ queries: ['query'] });
      const result = makeToolResult({
        results: [
          { query: 'query', title: 'My Page', url: 'https://example.com/page', site: 'example.com' },
        ],
      });
      renderView(toolCall, result);
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    it('opens URL in new tab when result row is clicked', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const toolCall = makeToolCall({ queries: ['query'] });
      const result = makeToolResult({
        results: [
          { query: 'query', title: 'Click Me', url: 'https://clickable.com', site: 'clickable.com' },
        ],
      });
      renderView(toolCall, result);
      fireEvent.click(screen.getByText('Click Me').closest('.web-search-result-row')!);
      expect(openSpy).toHaveBeenCalledWith('https://clickable.com', '_blank', 'noopener,noreferrer');
      openSpy.mockRestore();
    });

    it('renders multiple query groups', () => {
      const toolCall = makeToolCall({ queries: ['alpha', 'beta'] });
      const result = makeToolResult({
        results: [
          { query: 'alpha', title: 'Alpha Result', url: 'https://alpha.com', site: 'alpha.com' },
          { query: 'beta', title: 'Beta Result', url: 'https://beta.com', site: 'beta.com' },
        ],
      });
      renderView(toolCall, result);
      expect(screen.getByText('alpha')).toBeInTheDocument();
      expect(screen.getByText('beta')).toBeInTheDocument();
      expect(screen.getByText('Alpha Result')).toBeInTheDocument();
      expect(screen.getByText('Beta Result')).toBeInTheDocument();
    });
  });

  describe('error display', () => {
    it('renders search errors when present', () => {
      const toolCall = makeToolCall({ queries: ['something'] });
      const result = makeToolResult({
        results: [],
        errors: ['Rate limit exceeded', 'Network timeout'],
      });
      renderView(toolCall, result);
      expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
      expect(screen.getByText('Network timeout')).toBeInTheDocument();
    });
  });

  describe('completed with no results', () => {
    it('shows no result count indicator when there are no results for a query', () => {
      const toolCall = makeToolCall({ queries: ['empty query'] });
      const result = makeToolResult({ results: [] });
      renderView(toolCall, result);
      expect(screen.getByText('empty query')).toBeInTheDocument();
      // No "results" count label shown when empty
      expect(screen.queryByText(/\d+ results/)).toBeNull();
    });
  });

  describe('result with null toolResult', () => {
    it('renders query without results when toolResult is null', () => {
      const toolCall = makeToolCall({ queries: ['hello world'] });
      renderView(toolCall, null, 'completed');
      expect(screen.getByText('hello world')).toBeInTheDocument();
    });
  });

  describe('favicon image error handling', () => {
    it('hides favicon image on load error', () => {
      const toolCall = makeToolCall({ queries: ['test'] });
      const result = makeToolResult({
        results: [
          { query: 'test', title: 'Favicon Test', url: 'https://favicon-test.com', site: 'favicon-test.com' },
        ],
      });
      renderView(toolCall, result);
      const img = document.querySelector('.web-search-result-favicon') as HTMLImageElement;
      expect(img).not.toBeNull();
      fireEvent.error(img);
      expect(img.style.display).toBe('none');
    });
  });
});
