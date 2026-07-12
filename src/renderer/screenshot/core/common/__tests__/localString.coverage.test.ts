import { beforeEach, describe, expect, it, vi } from 'vitest';

const configState = vi.hoisted(() => ({
  config: {} as { uiLanguage?: string },
}));

vi.mock('@/lib/userData/appDataManager', () => ({
  appDataManager: {
    getConfig: () => configState.config,
  },
}));

import { getString, setScreenshotStringLanguage, updateString } from '../localString';

describe('screenshot localString', () => {
  beforeEach(() => {
    configState.config = {};
    setScreenshotStringLanguage(null);
  });

  it('uses English by default and for unsupported languages', () => {
    expect(getString('save')).toBe('Save');

    configState.config = { uiLanguage: 'fr-FR' };
    expect(getString('save')).toBe('Save');
  });

  it('uses Simplified Chinese for the active app language', () => {
    configState.config = { uiLanguage: 'zh-CN' };

    expect(getString('save')).toBe('保存');
    expect(getString('renderRect')).toBe('渲染矩形');
  });

  it('uses the explicit screenshot language before app config catches up', () => {
    configState.config = { uiLanguage: 'en' };
    setScreenshotStringLanguage('zh-CN');

    expect(getString('save')).toBe('保存');
  });

  it('accepts runtime string overrides without breaking translated lookups', () => {
    updateString({ save: 'Custom Save' });

    expect(getString('save')).toBe('Save');
  });
});
