import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../appKnowledge', () => ({
  APP_DETAIL_L2: 'mock app knowledge content',
}));

import { executeGetAppKnowledge, getAppKnowledgeToolDef } from '../getAppKnowledge';

describe('getAppKnowledge', () => {
  it('executeGetAppKnowledge returns the APP_DETAIL_L2 string', async () => {
    const result = await executeGetAppKnowledge();
    expect(result).toBe('mock app knowledge content');
  });

  it('tool definition has correct name', () => {
    expect(getAppKnowledgeToolDef.function.name).toBe('get_app_knowledge');
  });

  it('tool definition has no required parameters', () => {
    expect(getAppKnowledgeToolDef.function.parameters.required).toEqual([]);
  });
});
