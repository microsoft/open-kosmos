/**
 * @vitest-environment happy-dom
 */

/**
 * toolCallViews/index.ts — getToolCallView & hasCustomView dispatch tests
 *
 * Validates that the Phase 5 spawn_subagent / spawn_subagents
 * tool names correctly map to their corresponding view components.
 */

import { getToolCallView, hasCustomView } from '../index';
import { SubAgentToolCallView, ParallelSubAgentsToolCallView } from '../SubAgentToolCallView';

describe('getToolCallView', () => {
  // ========== Existing tools (regression) ==========

  describe('existing tools (regression)', () => {
    it('should return a view for bing_web_search', () => {
      expect(getToolCallView('bing_web_search')).not.toBeNull();
    });

    it('should return a view for execute_command', () => {
      expect(getToolCallView('execute_command')).not.toBeNull();
    });

    it('should return null for present_deliverables', () => {
      expect(getToolCallView('present_deliverables')).toBeNull();
    });

    it('should return null for unknown tool', () => {
      expect(getToolCallView('unknown_tool')).toBeNull();
    });
  });

  // ========== Sub-Agent tools (Phase 5) ==========

  describe('sub-agent tools (Phase 5)', () => {
    it('should return SubAgentToolCallView for spawn_subagent', () => {
      const view = getToolCallView('spawn_subagent');
      expect(view).toBe(SubAgentToolCallView);
    });

    it('should return ParallelSubAgentsToolCallView for spawn_subagents', () => {
      const view = getToolCallView('spawn_subagents');
      expect(view).toBe(ParallelSubAgentsToolCallView);
    });
  });
});

describe('hasCustomView', () => {
  it('should return true for spawn_subagent', () => {
    expect(hasCustomView('spawn_subagent')).toBe(true);
  });

  it('should return true for spawn_subagents', () => {
    expect(hasCustomView('spawn_subagents')).toBe(true);
  });

  it('should return false for unknown tool', () => {
    expect(hasCustomView('unknown_tool')).toBe(false);
  });
});
