import {
  DEFAULT_APP_CONFIG,
  isAppConfig,
} from '../types/app';

describe('AppConfig defaults', () => {
  it('has a defined default app config', () => {
    expect(DEFAULT_APP_CONFIG).toBeDefined();
  });

  it('accepts a valid AppConfig object', () => {
    expect(isAppConfig({})).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(isAppConfig(null)).toBe(false);
    expect(isAppConfig('string')).toBe(false);
    expect(isAppConfig(42)).toBe(false);
  });
});
