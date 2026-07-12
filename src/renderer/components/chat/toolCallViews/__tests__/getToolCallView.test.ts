/**
 * @vitest-environment happy-dom
 */

/**
 * toolCallViews/index.ts — getToolCallView & hasCustomView dispatch tests
 *
 * Validates that the ad-hoc sub_agent tool maps to its custom view.
 */

import { getToolCallView, hasCustomView } from '../index';
import { CodingAgentToolCallView } from '../CodingAgentToolCallView';
import { CreateScheduleToolCallView } from '../CreateScheduleToolCallView';
import { ExecuteCommandToolCallView } from '../ExecuteCommandToolCallView';
import { GetScheduleToolCallView } from '../GetScheduleToolCallView';
import { SubAgentToolCallView } from '../SubAgentToolCallView';
import { UpdateScheduleToolCallView } from '../UpdateScheduleToolCallView';
import { WebFetchToolCallView } from '../WebFetchToolCallView';
import { WebSearchToolCallView } from '../WebSearchToolCallView';
import { WriteFileToolCallView } from '../WriteFileToolCallView';

describe('getToolCallView', () => {
  // ========== Existing tools (regression) ==========

  describe('existing tools (regression)', () => {
    it.each([
      ['bing_web_search', WebSearchToolCallView],
      ['fetch_web_content', WebFetchToolCallView],
      ['execute_command', ExecuteCommandToolCallView],
      ['write_file', WriteFileToolCallView],
      ['create_file', WriteFileToolCallView],
      ['create_schedule', CreateScheduleToolCallView],
      ['get_schedule', GetScheduleToolCallView],
      ['update_schedule', UpdateScheduleToolCallView],
      ['coding_agent', CodingAgentToolCallView],
    ])('should return the custom view for %s', (toolName, expectedView) => {
      expect(getToolCallView(toolName)).toBe(expectedView);
    });

    it('should return null for present_deliverables', () => {
      expect(getToolCallView('present_deliverables')).toBeNull();
    });

    it('should return null for unknown tool', () => {
      expect(getToolCallView('unknown_tool')).toBeNull();
    });
  });

  // ========== Ad-hoc Sub-Agent tool ==========

  describe('sub-agent tool', () => {
    it('should return SubAgentToolCallView for sub_agent', () => {
      const view = getToolCallView('sub_agent');
      expect(view).toBe(SubAgentToolCallView);
    });

  });
});

describe('hasCustomView', () => {
  it('should return true for sub_agent', () => {
    expect(hasCustomView('sub_agent')).toBe(true);
  });

  it('should return false for unknown tool', () => {
    expect(hasCustomView('unknown_tool')).toBe(false);
  });
});
