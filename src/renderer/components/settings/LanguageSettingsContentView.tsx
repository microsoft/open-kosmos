import React from 'react';
import { SUPPORTED_UI_LANGUAGES, type UiLanguage } from '../../lib/i18n';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/ContentView.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/RuntimeSettings.css';

interface LanguageSettingsContentViewProps {
  language: UiLanguage;
  error: string | null;
  onLanguageChange: (language: UiLanguage) => void;
}

const languageDescriptionKeys: Record<UiLanguage, 'settings.language.englishDescription' | 'settings.language.chineseDescription'> = {
  en: 'settings.language.englishDescription',
  'zh-CN': 'settings.language.chineseDescription',
};

const languageLabelKeys: Record<UiLanguage, 'common.language.english' | 'common.language.chinese'> = {
  en: 'common.language.english',
  'zh-CN': 'common.language.chinese',
};

const LanguageSettingsContentView: React.FC<LanguageSettingsContentViewProps> = ({
  language,
  error,
  onLanguageChange,
}) => {
  const { t } = useI18n();

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        {error && (
          <div className="toolbar-settings-error glass-surface">
            <div className="message-header">
              <div className="message-indicator"></div>
              <span className="message-label">{t('common.error')}</span>
            </div>
            <p className="message-text">{error}</p>
          </div>
        )}

        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>
                    {t('settings.language.displayLanguage')}
                  </label>
                  <p className="runtime-card-desc">
                    {t('settings.language.displayLanguageDescription')}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {SUPPORTED_UI_LANGUAGES.map((candidate) => (
                    <label
                      key={candidate}
                      className="toolbar-settings-card"
                      style={{
                        cursor: 'pointer',
                        borderColor: language === candidate ? 'var(--color-warm-700)' : undefined,
                      }}
                    >
                      <div className="toolbar-setting-item">
                        <div className="setting-label-container">
                          <span className="setting-label" style={{ fontWeight: 500 }}>
                            {t(languageLabelKeys[candidate])}
                          </span>
                          <p className="runtime-card-desc">
                            {t(languageDescriptionKeys[candidate])}
                          </p>
                        </div>
                        <input
                          type="radio"
                          name="ui-language"
                          value={candidate}
                          aria-label={t(languageLabelKeys[candidate])}
                          checked={language === candidate}
                          onChange={() => onLanguageChange(candidate)}
                        />
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LanguageSettingsContentView;
