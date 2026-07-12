import React, { useCallback, useState } from 'react';
import type { UiLanguage } from '../../lib/userData/types';
import LanguageSettingsHeaderView from './LanguageSettingsHeaderView';
import LanguageSettingsContentView from './LanguageSettingsContentView';
import { useToast } from '../ui/ToastProvider';
import { translate } from '../../lib/i18n';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/RuntimeSettings.css';

const LanguageSettingsView: React.FC = () => {
  const { language, setLanguage, t } = useI18n();
  const { showSuccess, showError } = useToast();
  const [error, setError] = useState<string | null>(null);

  const handleLanguageChange = useCallback(async (nextLanguage: UiLanguage) => {
    /* v8 ignore next -- controlled radios do not dispatch onChange for the already-selected language; this guards direct child calls. */
    if (nextLanguage === language) return;

    setError(null);
    const result = await setLanguage(nextLanguage);
    if (result.success) {
      showSuccess(translate(nextLanguage, 'settings.language.updateSuccess'));
      return;
    }

    const message = t('settings.language.updateFailure', {
      error: result.error || t('common.unknownError'),
    });
    setError(message);
    showError(message);
  }, [language, setLanguage, showError, showSuccess, t]);

  return (
    <div className="runtime-settings-view">
      <LanguageSettingsHeaderView />
      <LanguageSettingsContentView
        language={language}
        error={error}
        onLanguageChange={handleLanguageChange}
      />
    </div>
  );
};

export default LanguageSettingsView;
