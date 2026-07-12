import { en, type LocaleCatalog, type TranslationKey, type TranslationParams } from './locales/en';
import { zhCN } from './locales/zh-CN';

export const SUPPORTED_UI_LANGUAGES = ['en', 'zh-CN'] as const;
export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en';

const catalogs = {
  en,
  'zh-CN': zhCN,
} satisfies Record<UiLanguage, LocaleCatalog>;

export type { TranslationKey, TranslationParams };

export function translate(
  language: UiLanguage,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  const template = catalogs[language]?.[key] ?? catalogs[DEFAULT_UI_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, paramName: string) => {
    const value = params[paramName];
    return value === undefined || value === null ? match : String(value);
  });
}
