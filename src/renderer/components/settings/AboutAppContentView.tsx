import React, { useEffect, useState } from 'react';
import { APP_NAME, BRAND_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import '../../styles/ContentView.css';
import '../../styles/SettingsComponents.css';
import '../../styles/ToolbarSettings.css';
import '../../styles/AboutAppView.css';
import { appIcon as brandIcon } from '../../lib/brandIcon';

interface AboutAppContentViewProps {}

const AboutAppContentView: React.FC<AboutAppContentViewProps> = () => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [arch, setArch] = useState<string>('');

  // Get brand configuration info
  const brandDisplayName = BRAND_CONFIG.productName || APP_NAME;
  const brandHomepage = 'https://www.kosmos-ai.com';

  useEffect(() => {
    const loadAppInfo = async () => {
      try {
        if (window.electronAPI?.getVersion) {
          const version = await window.electronAPI.getVersion();
          setAppVersion(version);
        }
        if (window.electronAPI?.getPlatformInfo) {
          const platformInfo = await window.electronAPI.getPlatformInfo();
          const platformName = platformInfo.platform === 'darwin'
            ? 'macOS'
            : platformInfo.platform === 'win32'
            ? 'Windows'
            : 'Linux';
          setPlatform(platformName);
          setArch(platformInfo.arch);
        }
      } catch (error) {
        // ignore
      }
    };
    loadAppInfo();
  }, []);

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">

            {/* ── Card 1: Brand info + version ── */}
            <div className="toolbar-settings-card">

              {/* Brand row */}
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
                  <a
                    href={brandHomepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-link"
                  >
                    Learn more about {brandDisplayName}
                  </a>
                </div>
              </div>

              {/* Version details */}
              <div className="toolbar-setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <div className="about-version-detail">
                  Version {appVersion || 'N/A'} (Official build) ({arch})
                </div>
              </div>

            </div>{/* /Card 1 */}

            {/* ── Card 2: Copyright & legal info ── */}
            <div className="toolbar-settings-card">

              {/* "Made possible by" — only shown for non-openkosmos brands */}
              {BRAND_NAME !== 'openkosmos' && (
                <div className="toolbar-setting-item">
                  <div className="setting-label-container">
                    <p className="about-legal-text">
                      This app is made possible by the{' '}
                      <a
                        href="https://www.kosmos-ai.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="about-link"
                      >
                        OpenKosmos AI Studio
                      </a>
                      {' '}project.
                    </p>
                  </div>
                </div>
              )}

              {/* Copyright */}
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <span className="about-legal-text">
                    {`Copyright © 2025-${new Date().getFullYear()} ${brandDisplayName} Team. All rights reserved.`}
                  </span>
                </div>
              </div>

            </div>{/* /Card 2 */}

          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutAppContentView;
