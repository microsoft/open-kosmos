import React, { useCallback, useEffect, useState } from 'react';
import { SunMoon } from 'lucide-react';
import { appDataManager } from '../../lib/userData/appDataManager';
import { DEFAULT_APPEARANCE_CONFIG } from '../../lib/userData/types';
import type { ThemeSource } from '../../lib/userData/types';
import { useI18n } from '../../lib/i18n/useI18n';
import type { TranslationKey } from '../../lib/i18n';
import { useToast } from '../ui/ToastProvider';
import '../../styles/Header.css';
import '../../styles/ContentView.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/RuntimeSettings.css';

const THEME_OPTIONS: Array<{
  value: ThemeSource;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}> = [
  {
    value: 'light',
    labelKey: 'settings.appearance.light',
    descriptionKey: 'settings.appearance.lightDescription',
  },
  {
    value: 'dark',
    labelKey: 'settings.appearance.dark',
    descriptionKey: 'settings.appearance.darkDescription',
  },
  {
    value: 'system',
    labelKey: 'settings.appearance.system',
    descriptionKey: 'settings.appearance.systemDescription',
  },
];

const THEME_OPTION_LABEL_KEYS: Record<ThemeSource, TranslationKey> = {
  light: 'settings.appearance.light',
  dark: 'settings.appearance.dark',
  system: 'settings.appearance.system',
};

function getStoredThemeSource(): ThemeSource {
  return appDataManager.getConfig().appearance?.themeSource ?? DEFAULT_APPEARANCE_CONFIG.themeSource;
}

const AppearanceSettingsView: React.FC = () => {
  const [themeSource, setThemeSource] = useState<ThemeSource>(getStoredThemeSource);
  const [savingThemeSource, setSavingThemeSource] = useState<ThemeSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();

  useEffect(() => {
    const unsubscribe = appDataManager.subscribe((config) => {
      setThemeSource(config.appearance?.themeSource ?? DEFAULT_APPEARANCE_CONFIG.themeSource);
    });

    return unsubscribe;
  }, []);

  const handleThemeChange = useCallback(async (nextThemeSource: ThemeSource) => {
    if (nextThemeSource === themeSource || savingThemeSource !== null) return;

    setError(null);
    setSavingThemeSource(nextThemeSource);

    try {
      const result = await appDataManager.updateConfig({
        appearance: { themeSource: nextThemeSource },
      });

      if (result.success) {
        setThemeSource(nextThemeSource);
        showSuccess(t('settings.appearance.updateSuccess', { mode: t(THEME_OPTION_LABEL_KEYS[nextThemeSource]) }));
      } else {
        const message = result.error || t('common.unknownError');
        const translatedError = t('settings.appearance.updateFailure', { error: message });
        setError(translatedError);
        showError(translatedError);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const translatedError = t('settings.appearance.updateFailure', { error: message });
      setError(translatedError);
      showError(translatedError);
    } finally {
      setSavingThemeSource(null);
    }
  }, [savingThemeSource, showError, showSuccess, t, themeSource]);

  return (
    <div className="runtime-settings-view">
      <div className="unified-header">
        <div className="header-title">
          <SunMoon size={20} />
          <span className="header-name">{t('settings.appearance.title')}</span>
        </div>
      </div>

      <div className="content-view-container">
        <div className="toolbar-settings-content">
          {error && (
            <div className="toolbar-settings-error glass-surface">
              <div className="message-header">
                <div className="message-indicator" />
                <span className="message-label">{t('common.error')}</span>
              </div>
              <p className="message-text">{error}</p>
            </div>
          )}

          <div className="toolbar-settings-form">
            <div className="toolbar-settings-form-inner">
              <div className="toolbar-settings-card">
                <div className="appearance-option-list" role="radiogroup" aria-label={t('settings.appearance.modeAriaLabel')}>
                  {THEME_OPTIONS.map((option) => {
                    const checked = themeSource === option.value;
                    const disabled = savingThemeSource !== null;

                    return (
                      <label
                        key={option.value}
                        className="appearance-option-row runtime-mode-row"
                        data-active={checked}
                      >
                        <div className="setting-label-container">
                          <span className="setting-label">{t(option.labelKey)}</span>
                          <p className="runtime-card-desc">{t(option.descriptionKey)}</p>
                        </div>
                        <input
                          className="runtime-radio"
                          type="radio"
                          name="appearance-theme-source"
                          value={option.value}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => handleThemeChange(option.value)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppearanceSettingsView;
