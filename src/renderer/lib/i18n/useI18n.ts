import { useCallback } from 'react';
import { UiLanguageAtom } from '@/states/i18n.atom';
import { translate, type TranslationKey, type TranslationParams } from './index';

export function useI18n() {
  const [language, actions] = UiLanguageAtom.use();

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
    [language],
  );

  return {
    language,
    setLanguage: actions.setLanguage,
    t,
  };
}
