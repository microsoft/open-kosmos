import { describe, it, expect } from 'vitest';
import {
  isRuntimeMode,
  isRuntimeEnvironment,
  isThemeSource,
  isAppearanceConfig,
  isAppConfig,
  DEFAULT_APP_CONFIG,
  DEFAULT_RUNTIME_ENVIRONMENT,
  DEFAULT_VOICE_INPUT_CONFIG,
  DEFAULT_SCREENSHOT_SETTINGS,
  DEFAULT_APPEARANCE_CONFIG,
} from '../types/app';

describe('isRuntimeMode', () => {
  it('returns true for "system"', () => {
    expect(isRuntimeMode('system')).toBe(true);
  });

  it('returns true for "internal"', () => {
    expect(isRuntimeMode('internal')).toBe(true);
  });

  it('returns false for other strings', () => {
    expect(isRuntimeMode('docker')).toBe(false);
    expect(isRuntimeMode('')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(isRuntimeMode(null)).toBe(false);
    expect(isRuntimeMode(42)).toBe(false);
  });
});

describe('isRuntimeEnvironment', () => {
  const valid = {
    mode: 'internal',
    bunVersion: '1.3.6',
    uvVersion: '0.6.17',
  };

  it('returns true for valid environment', () => {
    expect(isRuntimeEnvironment(valid)).toBe(true);
  });

  describe('isThemeSource', () => {
    it('returns true for valid theme sources', () => {
      expect(isThemeSource('light')).toBe(true);
      expect(isThemeSource('dark')).toBe(true);
      expect(isThemeSource('system')).toBe(true);
    });

    it('returns false for invalid theme sources', () => {
      expect(isThemeSource('sepia')).toBe(false);
      expect(isThemeSource(null)).toBe(false);
    });
  });

  describe('isAppearanceConfig', () => {
    it('returns true for valid appearance config', () => {
      expect(isAppearanceConfig({ themeSource: 'system' })).toBe(true);
    });

    it('returns false for invalid appearance config', () => {
      expect(isAppearanceConfig({ themeSource: 'sepia' })).toBe(false);
      expect(isAppearanceConfig(null)).toBe(false);
    });
  });

  it('returns true with optional pinnedPythonVersion as string', () => {
    expect(isRuntimeEnvironment({ ...valid, pinnedPythonVersion: '3.10.12' })).toBe(true);
  });

  it('returns true with pinnedPythonVersion as null', () => {
    expect(isRuntimeEnvironment({ ...valid, pinnedPythonVersion: null })).toBe(true);
  });

  it('returns true with pinnedPythonVersion as undefined', () => {
    expect(isRuntimeEnvironment({ ...valid, pinnedPythonVersion: undefined })).toBe(true);
  });

  it('returns false when mode is invalid', () => {
    expect(isRuntimeEnvironment({ ...valid, mode: 'docker' })).toBe(false);
  });

  it('returns false when bunVersion is not string', () => {
    expect(isRuntimeEnvironment({ ...valid, bunVersion: 1 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRuntimeEnvironment(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isRuntimeEnvironment('string')).toBe(false);
  });
});

describe('isAppConfig', () => {
  it('returns true for empty object (all fields optional)', () => {
    expect(isAppConfig({})).toBe(true);
  });

  it('returns false for null', () => {
    expect(isAppConfig(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isAppConfig('string')).toBe(false);
  });

  it('returns false when updaterVersion is not string', () => {
    expect(isAppConfig({ updaterVersion: 123 })).toBe(false);
  });

  it('returns false when runtimeEnvironment is invalid', () => {
    expect(isAppConfig({ runtimeEnvironment: { mode: 'invalid', bunVersion: '', uvVersion: '' } })).toBe(false);
  });

  it('returns false when appearance is invalid', () => {
    expect(isAppConfig({ appearance: { themeSource: 'sepia' } })).toBe(false);
  });

  it('returns false when leftSidebarCollapsed is not boolean', () => {
    expect(isAppConfig({ leftSidebarCollapsed: 'yes' })).toBe(false);
  });

  it('returns false when zoomLevel is not finite number', () => {
    expect(isAppConfig({ zoomLevel: Infinity })).toBe(false);
  });

  it('returns false when mainWindowMaximized is not boolean', () => {
    expect(isAppConfig({ mainWindowMaximized: 1 })).toBe(false);
  });

  it('returns true for DEFAULT_APP_CONFIG', () => {
    expect(isAppConfig(DEFAULT_APP_CONFIG)).toBe(true);
  });
});

describe('defaults', () => {
  it('DEFAULT_RUNTIME_ENVIRONMENT has expected shape', () => {
    expect(DEFAULT_RUNTIME_ENVIRONMENT.mode).toBe('internal');
    expect(typeof DEFAULT_RUNTIME_ENVIRONMENT.bunVersion).toBe('string');
    expect(typeof DEFAULT_RUNTIME_ENVIRONMENT.uvVersion).toBe('string');
  });

  it('DEFAULT_VOICE_INPUT_CONFIG has expected shape', () => {
    expect(DEFAULT_VOICE_INPUT_CONFIG.voiceInputEnabled).toBe(false);
    expect(DEFAULT_VOICE_INPUT_CONFIG.recognitionLanguage).toBe('auto');
  });

  it('DEFAULT_APP_CONFIG has valid structure', () => {
    expect(DEFAULT_APP_CONFIG.leftSidebarCollapsed).toBe(false);
    expect(typeof DEFAULT_APP_CONFIG.zoomLevel).toBe('number');
    expect(DEFAULT_APP_CONFIG.appearance).toEqual(DEFAULT_APPEARANCE_CONFIG);
  });
});
