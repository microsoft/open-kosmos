vi.mock('../agentChatSessionCacheManager', async () => ({
  agentChatSessionCacheManager: {
    replaceFilePathInMessages: vi.fn(),
  },
}));

vi.mock('../workspaceOps', async () => ({
  workspaceOps: {
    clearFileTreeCache: vi.fn(),
    triggerRefresh: vi.fn(),
  },
}));

import { isPathInKnowledgeBase, shouldShowMoveToKnowledgeBaseOption } from '../moveToKnowledgeBase';

describe('isPathInKnowledgeBase', () => {
  it('returns true for files directly inside knowledge base', () => {
    expect(isPathInKnowledgeBase('/workspace/knowledge/file.md', '/workspace/knowledge')).toBe(true);
  });

  it('returns true for files inside nested knowledge base directories', () => {
    expect(isPathInKnowledgeBase('/workspace/knowledge/nested/file.md', '/workspace/knowledge')).toBe(true);
  });

  it('returns false for sibling paths that only share a prefix', () => {
    expect(isPathInKnowledgeBase('/workspace/knowledge-archive/file.md', '/workspace/knowledge')).toBe(false);
  });

  it('normalizes path separators before comparison', () => {
    expect(isPathInKnowledgeBase('C:\\workspace\\knowledge\\file.md', 'C:/workspace/knowledge')).toBe(true);
  });

  it('returns false when knowledge base path is missing', () => {
    expect(isPathInKnowledgeBase('/workspace/knowledge/file.md', '')).toBe(false);
  });
});

describe('shouldShowMoveToKnowledgeBaseOption', () => {
  it('returns true for files outside the knowledge base when session is idle', () => {
    expect(shouldShowMoveToKnowledgeBaseOption('/workspace/output/file.md', '/workspace/knowledge', true)).toBe(true);
  });

  it('returns false for files already in the knowledge base', () => {
    expect(shouldShowMoveToKnowledgeBaseOption('/workspace/knowledge/file.md', '/workspace/knowledge', true)).toBe(false);
  });

  it('returns false when the session is not idle', () => {
    expect(shouldShowMoveToKnowledgeBaseOption('/workspace/output/file.md', '/workspace/knowledge', false)).toBe(false);
  });
});