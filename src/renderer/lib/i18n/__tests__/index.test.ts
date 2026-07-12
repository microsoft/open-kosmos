import { describe, expect, it } from 'vitest';
import { translate } from '../index';
import { en } from '../locales/en';
import { zhCN } from '../locales/zh-CN';

describe('i18n translate', () => {
  it('returns English translations by default language key', () => {
    expect(translate('en', 'settings.language.title')).toBe('Language');
  });

  it('returns Simplified Chinese translations', () => {
    expect(translate('zh-CN', 'settings.language.title')).toBe('语言');
  });

  it('interpolates named parameters', () => {
    expect(translate('en', 'settings.page.skillDeleted', { name: 'Search' })).toBe('Skill "Search" deleted successfully');
  });

  it('preserves missing interpolation placeholders', () => {
    expect(translate('en', 'settings.page.skillDeleted')).toBe('Skill "{name}" deleted successfully');
  });

  it('falls back to the key when a translation key is unknown', () => {
    expect(translate('en', 'missing.key' as any)).toBe('missing.key');
  });

  it('keeps locale key sets aligned at runtime', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses public GitHub Copilot device-auth copy in both locales', () => {
    expect(translate('en', 'auth.ghcAuthenticationDescription')).toBe(
      'Sign in with your GitHub account to access GitHub Copilot AI models',
    );
    expect(translate('zh-CN', 'auth.ghcAuthenticationDescription')).toBe(
      '使用你的 GitHub 账号登录以访问 GitHub Copilot AI 模型',
    );
  });
});
