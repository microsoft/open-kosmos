import React, { useEffect, useState } from 'react';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import { useUpdate } from '../autoUpdate/UpdateProvider';
import '../../styles/ContentView.css';
import '../../styles/SettingsShared.css';
import '../../styles/AboutAppView.css';
import { appIcon as brandIcon } from '../../lib/brandIcon';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[AboutAppContentView]');

interface AboutAppContentViewProps {}

const AboutAppContentView: React.FC<AboutAppContentViewProps> = () => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [arch, setArch] = useState<string>('');
  const [isLatest, setIsLatest] = useState<boolean>(true);
  const [newVersion, setNewVersion] = useState<string>('');

  // Use UpdateProvider's silent check for updates method
  const { silentCheckForUpdates, updateInfo, status, progress, installUpdate } = useUpdate();

  // Get brand configuration info
  const brandDisplayName = BRAND_CONFIG.productName || APP_NAME;
  const brandHomepage = 'https://github.com/microsoft/open-kosmos';
  useEffect(() => {
    const loadAppInfo = async () => {
      try {
        // Get app version
        if (window.electronAPI?.getVersion) {
          const version = await window.electronAPI.getVersion();
          setAppVersion(version);
        }

        // Get platform info
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

        // Each time About page loads, trigger silent update check (same as Agent Page 30-second auto-check)
        logger.debug('[AboutAppContentView] Triggering silent update check');
        silentCheckForUpdates();
      } catch (error) {
        logger.error('Failed to load app info:', error);
      }
    };

    loadAppInfo();
  }, [silentCheckForUpdates]);

  // Listen to UpdateProvider update status changes
  useEffect(() => {
    if (updateInfo && (status === 'available' || status === 'downloading' || status === 'downloaded')) {
      setIsLatest(false);
      setNewVersion(updateInfo.version || '');
    } else if (status === 'no-update') {
      setIsLatest(true);
      setNewVersion('');
    }
  }, [updateInfo, status]);

  const handleRestartToUpdate = async () => {
    // Use UpdateProvider's installUpdate method, which contains the correct file path
    await installUpdate();
  };

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">

            {/* ── Card 1: Brand info + version/update status ── */}
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

              {/* Version status row */}
              <div className="toolbar-setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <div className="about-version-status">
                  {/* Checking for updates */}
                  {status === 'checking' && (
                    <>
                      <svg
                        width="20" height="20" viewBox="0 0 20 20" fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="about-spinner"
                      >
                        <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                        <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <span className="about-version-status-text">Checking for updates...</span>
                    </>
                  )}

                  {/* Downloading update */}
                  {status === 'downloading' && (
                    <>
                      <svg
                        width="20" height="20" viewBox="0 0 20 20" fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="about-spinner"
                      >
                        <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                        <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <span className="about-version-status-text">
                        Downloading update {newVersion}... {progress?.percent ? `${Math.round(progress.percent)}%` : ''}
                      </span>
                    </>
                  )}

                  {/* Update downloaded, ready to install */}
                  {status === 'downloaded' && (
                    <>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flexShrink: 0 }}>
                        <path d="M0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10Z" fill="#272320"/>
                        <mask id="mask0_about_downloaded" style={{maskType: 'alpha'}} maskUnits="userSpaceOnUse" x="4" y="4" width="12" height="12">
                          <path d="M13.765 7.20474C14.0661 7.48915 14.0797 7.96383 13.7953 8.26497L9.54526 12.765C9.40613 12.9123 9.21332 12.997 9.01071 12.9999C8.8081 13.0028 8.61295 12.9236 8.46967 12.7803L6.21967 10.5303C5.92678 10.2374 5.92678 9.76257 6.21967 9.46967C6.51256 9.17678 6.98744 9.17678 7.28033 9.46967L8.98463 11.174L12.7047 7.23503C12.9891 6.9339 13.4638 6.92033 13.765 7.20474Z" fill="#242424"/>
                        </mask>
                        <g mask="url(#mask0_about_downloaded)">
                          <rect width="12" height="12" transform="translate(4 4)" fill="#E2DDD9"/>
                        </g>
                      </svg>
                      <span className="about-version-status-text">
                        Update {newVersion} is ready to install.
                      </span>
                      <button className="about-update-btn" onClick={handleRestartToUpdate}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                          <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.8273 3 17.35 4.30367 19 6.34267" stroke="#333" strokeWidth="2" strokeLinecap="round"/>
                          <path d="M21 3V7H17" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Install Update Now
                      </button>
                    </>
                  )}

                  {/* Update available (not yet downloading) */}
                  {status === 'available' && (
                    <>
                      <svg
                        width="20" height="20" viewBox="0 0 20 20" fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ color: 'var(--smtc-status-warning-default, #bc4b09)', flexShrink: 0 }}
                      >
                        <path d="M10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2ZM10 6C10.5523 6 11 6.44772 11 7V11C11 11.5523 10.5523 12 10 12C9.44772 12 9 11.5523 9 11V7C9 6.44772 9.44772 6 10 6ZM10 14C9.44772 14 9 13.5523 9 13C9 12.4477 9.44772 12 10 12C10.5523 12 11 12.4477 11 13C11 13.5523 10.5523 14 10 14Z" fill="currentColor"/>
                      </svg>
                      <span className="about-version-status-text">
                        New version {newVersion} is available.
                      </span>
                    </>
                  )}

                  {/* No update / Up to date */}
                  {(status === 'no-update' || (status !== 'checking' && status !== 'downloading' && status !== 'downloaded' && status !== 'available' && isLatest)) && (
                    <>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flexShrink: 0 }}>
                        <path d="M0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10Z" fill="#272320"/>
                        <mask id="mask0_about_uptodate" style={{maskType: 'alpha'}} maskUnits="userSpaceOnUse" x="4" y="4" width="12" height="12">
                          <path d="M13.765 7.20474C14.0661 7.48915 14.0797 7.96383 13.7953 8.26497L9.54526 12.765C9.40613 12.9123 9.21332 12.997 9.01071 12.9999C8.8081 13.0028 8.61295 12.9236 8.46967 12.7803L6.21967 10.5303C5.92678 10.2374 5.92678 9.76257 6.21967 9.46967C6.51256 9.17678 6.98744 9.17678 7.28033 9.46967L8.98463 11.174L12.7047 7.23503C12.9891 6.9339 13.4638 6.92033 13.765 7.20474Z" fill="#242424"/>
                        </mask>
                        <g mask="url(#mask0_about_uptodate)">
                          <rect width="12" height="12" transform="translate(4 4)" fill="#E2DDD9"/>
                        </g>
                      </svg>
                      <span className="about-version-status-text">
                        {brandDisplayName} is up to date.
                      </span>
                    </>
                  )}

                  {/* Error state */}
                  {status === 'error' && (
                    <>
                      <svg
                        width="20" height="20" viewBox="0 0 20 20" fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ color: 'var(--smtc-status-danger-default, #c42b1c)', flexShrink: 0 }}
                      >
                        <path d="M10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2ZM7.70711 7.70711C7.31658 7.31658 7.31658 6.68342 7.70711 6.29289C8.09763 5.90237 8.73079 5.90237 9.12132 6.29289L10 7.17157L10.8787 6.29289C11.2692 5.90237 11.9024 5.90237 12.2929 6.29289C12.6834 6.68342 12.6834 7.31658 12.2929 7.70711L11.4142 8.58579L12.2929 9.46447C12.6834 9.85499 12.6834 10.4882 12.2929 10.8787C11.9024 11.2692 11.2692 11.2692 10.8787 10.8787L10 10L9.12132 10.8787C8.73079 11.2692 8.09763 11.2692 7.70711 10.8787C7.31658 10.4882 7.31658 9.85499 7.70711 9.46447L8.58579 8.58579L7.70711 7.70711Z" fill="currentColor"/>
                      </svg>
                      <span className="about-version-status-text">
                        Failed to check for updates.
                      </span>
                    </>
                  )}
                </div>

                {/* Version details */}
                <div className="about-version-detail">
                  Version {appVersion || 'N/A'} (Official build) ({arch})
                </div>
              </div>

            </div>{/* /Card 1 */}

            {/* ── Card 2: Copyright & legal info ── */}
            <div className="toolbar-settings-card">

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
