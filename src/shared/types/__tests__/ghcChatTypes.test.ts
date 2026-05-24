import { ToolMode } from '../ghcChatTypes';

describe('ghcChatTypes', () => {
  describe('ToolMode enum', () => {
    it('has the expected values', () => {
      expect(ToolMode.Auto).toBe('auto');
      expect(ToolMode.None).toBe('none');
      expect(ToolMode.Required).toBe('required');
    });

    it('covers all three enum members', () => {
      const values = Object.values(ToolMode);
      expect(values).toContain('auto');
      expect(values).toContain('none');
      expect(values).toContain('required');
      expect(values).toHaveLength(3);
    });
  });
});
