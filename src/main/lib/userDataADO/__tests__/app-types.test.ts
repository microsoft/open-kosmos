import {
  DEFAULT_APP_CONFIG,
  isAppConfig,
} from '../types/app';

describe('app-level config defaults', () => {
  it('rejects app config with invalid runtimeEnvironment shape', () => {
    expect(isAppConfig({
      runtimeEnvironment: {
        mode: 42,
      },
    })).toBe(false);
  });

  it('accepts a minimal valid AppConfig', () => {
    expect(isAppConfig(DEFAULT_APP_CONFIG)).toBe(true);
  });
});