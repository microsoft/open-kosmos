/**
 * SecurityValidator tests
 * Covers validateToolPaths, validateBatchToolCalls, extractApprovalRequests,
 * and the standalone validateToolPaths convenience export.
 */

import { SecurityValidator, validateToolPaths } from '../securityValidator';

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// FileSecurityValidator uses electron — already mocked in tests/setup.ts.
// The global mock provides getPath(() => '/tmp/test') which is our deterministic userData.
const WORKSPACE = '/workspace/project';

beforeEach(() => {
  delete (global as any).electron;
});

// ─────────────────────────────────────────────
// SecurityValidator.validateToolPaths
// ─────────────────────────────────────────────
describe('SecurityValidator.validateToolPaths', () => {
  it('approves paths inside workspace', () => {
    const result = SecurityValidator.validateToolPaths(
      'readFile',
      { filePath: '/workspace/project/src/app.ts' },
      WORKSPACE,
    );
    expect(result.approved).toBe(true);
    expect(result.pathsOutsideWorkspace).toHaveLength(0);
  });

  it('rejects paths outside workspace', () => {
    const result = SecurityValidator.validateToolPaths(
      'readFile',
      { filePath: '/etc/passwd' },
      WORKSPACE,
    );
    expect(result.approved).toBe(false);
    expect(result.pathsOutsideWorkspace.length).toBeGreaterThan(0);
  });

  it('approves when no workspace is set', () => {
    const result = SecurityValidator.validateToolPaths('readFile', { filePath: '/anywhere' }, undefined);
    expect(result.approved).toBe(true);
  });

  it('handles null toolArgs without crashing', () => {
    const result = SecurityValidator.validateToolPaths('noop', null, WORKSPACE);
    expect(result.approved).toBe(true);
  });
});

// ─────────────────────────────────────────────
// SecurityValidator.validateBatchToolCalls
// ─────────────────────────────────────────────
describe('SecurityValidator.validateBatchToolCalls', () => {
  it('returns allApproved=true for empty tool calls', () => {
    const result = SecurityValidator.validateBatchToolCalls([], WORKSPACE);
    expect(result.allApproved).toBe(true);
    expect(result.needsApproval).toBe(false);
    expect(result.validationResults).toHaveLength(0);
  });

  it('approves all valid paths', () => {
    const toolCalls = [
      {
        id: 'tc-1',
        function: {
          name: 'readFile',
          arguments: JSON.stringify({ filePath: '/workspace/project/README.md' }),
        },
      },
    ];
    const result = SecurityValidator.validateBatchToolCalls(toolCalls, WORKSPACE);
    expect(result.allApproved).toBe(true);
    expect(result.needsApproval).toBe(false);
    expect(result.validationResults[0].approved).toBe(true);
  });

  it('rejects tool call with path outside workspace', () => {
    const toolCalls = [
      {
        id: 'tc-2',
        function: {
          name: 'writeFile',
          arguments: JSON.stringify({ filePath: '/etc/cron.d/job' }),
        },
      },
    ];
    const result = SecurityValidator.validateBatchToolCalls(toolCalls, WORKSPACE);
    expect(result.allApproved).toBe(false);
    expect(result.needsApproval).toBe(true);
    expect(result.validationResults[0].approved).toBe(false);
  });

  it('handles JSON parse errors gracefully (approves the call)', () => {
    const toolCalls = [
      {
        id: 'tc-bad',
        function: {
          name: 'brokenTool',
          arguments: 'NOT_VALID_JSON',
        },
      },
    ];
    const result = SecurityValidator.validateBatchToolCalls(toolCalls, WORKSPACE);
    expect(result.allApproved).toBe(true);
    expect(result.validationResults[0].approved).toBe(true);
  });

  it('handles mixed valid and invalid tool calls', () => {
    const toolCalls = [
      {
        id: 'tc-ok',
        function: {
          name: 'readFile',
          arguments: JSON.stringify({ filePath: '/workspace/project/src/index.ts' }),
        },
      },
      {
        id: 'tc-bad',
        function: {
          name: 'writeFile',
          arguments: JSON.stringify({ filePath: '/usr/bin/override' }),
        },
      },
    ];
    const result = SecurityValidator.validateBatchToolCalls(toolCalls, WORKSPACE);
    expect(result.allApproved).toBe(false);
    expect(result.needsApproval).toBe(true);
    expect(result.validationResults.find(r => r.toolCallId === 'tc-ok')?.approved).toBe(true);
    expect(result.validationResults.find(r => r.toolCallId === 'tc-bad')?.approved).toBe(false);
  });

  it('approves all calls when no workspace is configured', () => {
    const toolCalls = [
      {
        id: 'tc-any',
        function: {
          name: 'readFile',
          arguments: JSON.stringify({ filePath: '/absolutely/anywhere.ts' }),
        },
      },
    ];
    const result = SecurityValidator.validateBatchToolCalls(toolCalls, undefined);
    expect(result.allApproved).toBe(true);
  });
});

// ─────────────────────────────────────────────
// SecurityValidator.extractApprovalRequests
// ─────────────────────────────────────────────
describe('SecurityValidator.extractApprovalRequests', () => {
  it('returns empty array when all approved', () => {
    const batchResult = {
      allApproved: true,
      needsApproval: false,
      validationResults: [
        { toolCallId: 'tc-1', toolName: 'readFile', approved: true, pathsOutsideWorkspace: [] },
      ],
    };
    expect(SecurityValidator.extractApprovalRequests(batchResult)).toHaveLength(0);
  });

  it('returns approval requests for disapproved tool calls', () => {
    const batchResult = {
      allApproved: false,
      needsApproval: true,
      validationResults: [
        {
          toolCallId: 'tc-1',
          toolName: 'writeFile',
          approved: false,
          pathsOutsideWorkspace: [
            { path: '/etc/cron', normalizedPath: '/etc/cron', error: 'outside workspace' },
          ],
        },
      ],
    };
    const requests = SecurityValidator.extractApprovalRequests(batchResult);
    expect(requests).toHaveLength(1);
    expect(requests[0].toolCallId).toBe('tc-1');
    expect(requests[0].toolName).toBe('writeFile');
    expect(requests[0].paths).toHaveLength(1);
  });

  it('deduplicates paths by normalizedPath', () => {
    const batchResult = {
      allApproved: false,
      needsApproval: true,
      validationResults: [
        {
          toolCallId: 'tc-1',
          toolName: 'writeFile',
          approved: false,
          pathsOutsideWorkspace: [
            { path: '/etc/cron', normalizedPath: '/etc/cron', error: 'outside' },
            { path: '/etc/cron', normalizedPath: '/etc/cron', error: 'outside' },
          ],
        },
      ],
    };
    const requests = SecurityValidator.extractApprovalRequests(batchResult);
    expect(requests[0].paths).toHaveLength(1);
  });

  it('falls back to path as key when normalizedPath absent', () => {
    const batchResult = {
      allApproved: false,
      needsApproval: true,
      validationResults: [
        {
          toolCallId: 'tc-2',
          toolName: 'exec',
          approved: false,
          pathsOutsideWorkspace: [
            { path: '/usr/bin/node', error: 'outside' },
            { path: '/usr/bin/node', error: 'outside' },
          ],
        },
      ],
    };
    const requests = SecurityValidator.extractApprovalRequests(batchResult);
    expect(requests[0].paths).toHaveLength(1);
  });

  it('skips approved results even if they have pathsOutsideWorkspace', () => {
    const batchResult = {
      allApproved: true,
      needsApproval: false,
      validationResults: [
        {
          toolCallId: 'tc-3',
          toolName: 'tool',
          approved: true,
          pathsOutsideWorkspace: [{ path: '/somewhere', error: 'x' }],
        },
      ],
    };
    expect(SecurityValidator.extractApprovalRequests(batchResult)).toHaveLength(0);
  });

  it('skips disapproved results with no pathsOutsideWorkspace entries', () => {
    const batchResult = {
      allApproved: false,
      needsApproval: true,
      validationResults: [
        {
          toolCallId: 'tc-4',
          toolName: 'tool',
          approved: false,
          pathsOutsideWorkspace: [],
        },
      ],
    };
    expect(SecurityValidator.extractApprovalRequests(batchResult)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// Convenience export: validateToolPaths
// ─────────────────────────────────────────────
describe('validateToolPaths (convenience export)', () => {
  it('delegates to SecurityValidator.validateToolPaths', () => {
    const result = validateToolPaths('myTool', { filePath: '/workspace/project/file.ts' }, WORKSPACE);
    expect(result.approved).toBe(true);
  });

  it('rejects outside paths', () => {
    const result = validateToolPaths('myTool', { filePath: '/outside/workspace.ts' }, WORKSPACE);
    expect(result.approved).toBe(false);
  });
});
