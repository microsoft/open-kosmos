import React, { useEffect, useState } from 'react';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import '../../styles/ContentView.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/AboutAppView.css';
import { appIcon as brandIcon } from '../../lib/brandIcon';
import { createLogger } from '../../lib/utilities/logger';
import { useI18n } from '../../lib/i18n/useI18n';

const logger = createLogger('[AboutAppContentView]');

const AboutAppContentView: React.FC = () => {
  const [appVersion, setAppVersion] = useState('');
  const [platform, setPlatform] = useState('');
  const [arch, setArch] = useState('');
  const { t } = useI18n();
  const brandDisplayName = BRAND_CONFIG.productName || APP_NAME;

  useEffect(() => {
    const loadAppInfo = async () => {
      try {
        if (window.electronAPI?.getVersion) {
          setAppVersion(await window.electronAPI.getVersion());
        }
        if (window.electronAPI?.getPlatformInfo) {
          const info = await window.electronAPI.getPlatformInfo();
          setPlatform(info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : 'Linux');
          setArch(info.arch);
        }
      } catch (error) {
        logger.error('Failed to load app info:', error);
      }
    };
    void loadAppInfo();
  }, []);

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <div className="toolbar-settings-card">
              <div className="about-brand-row">
                {brandIcon && (
                  <img
                    src={brandIcon}
                    alt={brandDisplayName}
                    style={{ width: '48px', height: '48px', flexShrink: 0 }}
                  />
                )}
                <div className="about-brand-text">
                  <span className="about-brand-name">{brandDisplayName}</span>
                  {BRAND_CONFIG.feedbackLink && (
                    <a
                      href={BRAND_CONFIG.feedbackLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="about-link"
                    >
                      {t('settings.about.learnMore', { productName: brandDisplayName })}
                    </a>
                  )}
                </div>
              </div>
              <div className="toolbar-setting-item">
                <span>{t('settings.about.version')}</span>
                <span>{appVersion || '-'}</span>
              </div>
              <div className="toolbar-setting-item">
                <span>{t('settings.about.system')}</span>
                <span>{[platform, arch].filter(Boolean).join(' ') || '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutAppContentView;
