import {
  DEFAULT_APP_CONFIG,
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_UI_LANGUAGE,
  SUPPORTED_UI_LANGUAGES,
  isAppConfig,
  isAppearanceConfig,
  isThemeSource,
  isUiLanguage,
} from '../types/app';

describe('app-level UI language config', () => {
  it('defaults uiLanguage to English', () => {
    expect(DEFAULT_UI_LANGUAGE).toBe('en');
    expect(DEFAULT_APP_CONFIG.uiLanguage).toBe('en');
  });

  it('accepts supported UI language values', () => {
    expect(SUPPORTED_UI_LANGUAGES).toEqual(['en', 'zh-CN']);
    expect(isUiLanguage('en')).toBe(true);
    expect(isUiLanguage('zh-CN')).toBe(true);
  });

  it('rejects unsupported UI language values', () => {
    expect(isUiLanguage('fr')).toBe(false);
    expect(isUiLanguage('zh')).toBe(false);
    expect(isUiLanguage(null)).toBe(false);
  });

  it('accepts app config with a valid uiLanguage', () => {
    expect(isAppConfig({ uiLanguage: 'zh-CN' })).toBe(true);
  });

  it('rejects app config with an invalid uiLanguage', () => {
    expect(isAppConfig({ uiLanguage: 'fr' })).toBe(false);
  });
});

describe('app-level appearance config defaults', () => {
  describe('app-level appearance config defaults', () => {
    it('defaults themeSource to light', () => {
      expect(DEFAULT_APPEARANCE_CONFIG.themeSource).toBe('light');
      expect(DEFAULT_APP_CONFIG.appearance?.themeSource).toBe('light');
    });

    it('accepts valid theme sources', () => {
      expect(isThemeSource('light')).toBe(true);
      expect(isThemeSource('dark')).toBe(true);
      expect(isThemeSource('system')).toBe(true);
    });

    it('rejects invalid theme sources', () => {
      expect(isThemeSource('sepia')).toBe(false);
      expect(isThemeSource(null)).toBe(false);
    });

    it('accepts a valid AppearanceConfig object', () => {
      expect(isAppearanceConfig({ themeSource: 'dark' })).toBe(true);
    });

    it('rejects invalid AppearanceConfig objects', () => {
      expect(isAppearanceConfig({ themeSource: 'sepia' })).toBe(false);
      expect(isAppearanceConfig(null)).toBe(false);
    });

    it('rejects app config with invalid appearance preference shape', () => {
      expect(isAppConfig({
        appearance: { themeSource: 'sepia' },
      })).toBe(false);
    });
  });

});