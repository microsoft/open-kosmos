/**
 * @vitest-environment happy-dom
 */

/**
 * WriteFileToolCallView rendering tests
 *
 * Covers: null/empty args, executing with content preview, interrupted state,
 * success state (file link + open overlay), failure state, image vs non-image files.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WriteFileToolCallView } from '../WriteFileToolCallView';
import type { ToolCallExecutionStatus } from '../types';
import type { ToolCall, Message } from '@shared/types/chatTypes';

// Mock FileTypeIcon so it doesn't need complex setup
vi.mock('../../../ui/FileTypeIcon', () => ({
  default: ({ fileName }: { fileName: string }) => <span data-testid="file-icon">{fileName}</span>,
}));

// Mock streamingJsonParser
vi.mock('@renderer/lib/utils/streamingJsonParser', () => ({
  parseStreamingJson: <T,>(str: string): T | undefined => {
    try { return JSON.parse(str) as T; } catch { return undefined; }
  },
}));

// ========== Helper factories ==========

function makeToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: 'tc_write_001',
    type: 'function',
    function: {
      name: 'write_file',
      arguments: JSON.stringify(args),
    },
  };
}

function makeToolResult(resultObj: unknown): Message {
  return {
    id: 'tr_write_001',
    timestamp: Date.now(),
    role: 'tool',
    tool_call_id: 'tc_write_001',
    name: 'write_file',
    content: [{ type: 'text', text: JSON.stringify(resultObj) }],
  };
}

function renderView(
  toolCall: ToolCall,
  toolResult: Message | null = null,
  executionStatus: ToolCallExecutionStatus = 'completed',
) {
  return render(
    <WriteFileToolCallView
      toolCall={toolCall}
      toolResult={toolResult}
      executionStatus={executionStatus}
    />,
  );
}

// ========== Tests ==========

describe('WriteFileToolCallView', () => {
  describe('null / missing args', () => {
    it('returns null when arguments string is empty', () => {
      const toolCall: ToolCall = {
        id: 'tc_empty',
        type: 'function',
        function: { name: 'write_file', arguments: '' },
      };
      const { container } = renderView(toolCall);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when filePath is missing in completed state', () => {
      const toolCall = makeToolCall({ content: 'some content' });
      const { container } = renderView(toolCall, null, 'completed');
      expect(container.firstChild).toBeNull();
    });

    it('returns null when filePath is missing in interrupted state', () => {
      const toolCall = makeToolCall({ content: 'some content' });
      const { container } = renderView(toolCall, null, 'interrupted');
      expect(container.firstChild).toBeNull();
    });
  });

  describe('executing state (streaming preview)', () => {
    it('shows Writing... indicator with file name and content', () => {
      const toolCall = makeToolCall({ filePath: '/home/user/app.ts', content: 'const x = 1;' });
      renderView(toolCall, null, 'executing');
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('app.ts');
      expect(screen.getByText('Writing...')).toBeInTheDocument();
      expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    });

    it('does not show content preview when content is absent during executing', () => {
      // Without content, falls through to null
      const toolCall = makeToolCall({ filePath: '/home/user/app.ts' });
      const { container } = renderView(toolCall, null, 'executing');
      // No streaming container, falls through to null
      expect(container.querySelector('.write-file-streaming-container')).toBeNull();
    });

    it('renders streaming preview when content arrives before filePath (regression)', () => {
      // Simulates LLM streaming JSON where "content" key appears before "filePath"
      const toolCall = makeToolCall({ content: 'export default function hello() {}' });
      renderView(toolCall, null, 'executing');
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('Generating file...');
      expect(screen.getByText('export default function hello() {}')).toBeInTheDocument();
    });

    it('shows actual file name once filePath arrives during executing', () => {
      const toolCall = makeToolCall({ content: 'const x = 1;', filePath: '/src/index.ts' });
      renderView(toolCall, null, 'executing');
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('index.ts');
    });
  });

  describe('interrupted state', () => {
    it('shows interrupted message', () => {
      const toolCall = makeToolCall({ filePath: '/tmp/file.txt' });
      renderView(toolCall, null, 'interrupted');
      expect(screen.getByText('Interrupted before file write result was recorded')).toBeInTheDocument();
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('file.txt');
    });
  });

  describe('success state', () => {
    it('shows file name and triggers fileViewer:open for non-image file', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const toolCall = makeToolCall({ filePath: '/output/report.md' });
      const result = makeToolResult({ success: true, filePath: '/output/report.md' });
      renderView(toolCall, result);
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('report.md');

      fireEvent.click(document.querySelector('.write-file-success-container')!);
      expect(dispatchSpy).toHaveBeenCalled();
      const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('fileViewer:open');
      expect(event.detail.file.name).toBe('report.md');
      dispatchSpy.mockRestore();
    });

    it('triggers imageViewer:open for image files', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const toolCall = makeToolCall({ filePath: '/screenshots/capture.png' });
      const result = makeToolResult({ success: true, filePath: '/screenshots/capture.png' });
      renderView(toolCall, result);
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('capture.png');

      fireEvent.click(document.querySelector('.write-file-success-container')!);
      expect(dispatchSpy).toHaveBeenCalled();
      const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('imageViewer:open');
      expect(event.detail.images[0].alt).toBe('capture.png');
      dispatchSpy.mockRestore();
    });

    it('detects various image extensions', () => {
      const imageExts = ['jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'avif'];
      for (const ext of imageExts) {
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        const toolCall = makeToolCall({ filePath: `/img/photo.${ext}` });
        const result = makeToolResult({ success: true, filePath: `/img/photo.${ext}` });
        const { unmount } = renderView(toolCall, result);
        fireEvent.click(document.querySelector('.write-file-success-container')!);
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe('imageViewer:open');
        dispatchSpy.mockRestore();
        unmount();
      }
    });
  });

  describe('failure state', () => {
    it('shows error message from result', () => {
      const toolCall = makeToolCall({ filePath: '/tmp/data.json' });
      const result = makeToolResult({ success: false, error: 'Permission denied', filePath: '/tmp/data.json' });
      renderView(toolCall, result);
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('data.json');
    });

    it('shows default error text when error field is absent', () => {
      const toolCall = makeToolCall({ filePath: '/tmp/data.json' });
      const result = makeToolResult({ success: false, filePath: '/tmp/data.json' });
      renderView(toolCall, result);
      expect(screen.getByText('Failed to write file')).toBeInTheDocument();
    });
  });

  describe('no result yet (not executing, not interrupted)', () => {
    it('renders null when no result and status is completed', () => {
      const toolCall = makeToolCall({ filePath: '/tmp/pending.txt' });
      const { container } = renderView(toolCall, null, 'completed');
      expect(container.firstChild).toBeNull();
    });
  });

  describe('file name extraction', () => {
    it('extracts Windows-style path file name', () => {
      const toolCall = makeToolCall({ filePath: 'C:\\Users\\test\\document.txt' });
      const result = makeToolResult({ success: true, filePath: 'C:\\Users\\test\\document.txt' });
      renderView(toolCall, result);
      expect(document.querySelector('.write-file-filename')?.textContent).toBe('document.txt');
    });
  });
});
