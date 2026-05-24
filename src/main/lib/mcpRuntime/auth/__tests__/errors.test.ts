import { createMcpAuthCancelledError, isMcpNeedsUserInteractionError } from '../errors';

describe('MCP auth errors', () => {
  it('does not classify cancelled auth as needing user interaction', () => {
    const error = createMcpAuthCancelledError('edge-growth-brain');

    expect(isMcpNeedsUserInteractionError(error)).toBe(false);
    expect(error.message).toContain('edge-growth-brain');
  });
});
