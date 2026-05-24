import {
  BUILTIN_SKILL_NAMES,
  BUILTIN_SKILL_CHANGELOG,
  BUILTIN_DEFAULTS_VERSION,
  isBuiltinSkill,
} from '../builtinSkills';

describe('builtinSkills', () => {
  describe('BUILTIN_SKILL_NAMES', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(BUILTIN_SKILL_NAMES)).toBe(true);
      expect(BUILTIN_SKILL_NAMES.length).toBeGreaterThan(0);
      BUILTIN_SKILL_NAMES.forEach(name => {
        expect(typeof name).toBe('string');
      });
    });
  });

  describe('BUILTIN_SKILL_CHANGELOG', () => {
    it('has keys from 1 to BUILTIN_DEFAULTS_VERSION', () => {
      for (let i = 1; i <= BUILTIN_DEFAULTS_VERSION; i++) {
        expect(BUILTIN_SKILL_CHANGELOG[i]).toBeDefined();
        expect(Array.isArray(BUILTIN_SKILL_CHANGELOG[i])).toBe(true);
      }
    });

    it('highest key equals BUILTIN_DEFAULTS_VERSION', () => {
      const keys = Object.keys(BUILTIN_SKILL_CHANGELOG).map(Number);
      expect(Math.max(...keys)).toBe(BUILTIN_DEFAULTS_VERSION);
    });
  });

  describe('isBuiltinSkill', () => {
    it('returns true for known built-in skills', () => {
      BUILTIN_SKILL_NAMES.forEach(name => {
        expect(isBuiltinSkill(name)).toBe(true);
      });
    });

    it('returns false for unknown skills', () => {
      expect(isBuiltinSkill('nonexistent-skill')).toBe(false);
      expect(isBuiltinSkill('')).toBe(false);
    });
  });
});
