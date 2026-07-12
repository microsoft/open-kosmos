'use client'

import React, { useState } from 'react'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/RuntimeSettings.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface ComputerUsePermissions {
  screenRecording: string
  accessibility: boolean
  platformSupported?: boolean
  unsupportedReason?: string
}

interface ComputerUseSettingsContentViewProps {
  enabled: boolean
  requireConfirmation: boolean
  alwaysAllowedApps: string[]
  permissions: ComputerUsePermissions | null
  error: string | null
  platformSupported?: boolean
  unsupportedReason?: string | null
  onToggle: (enabled: boolean) => void
  onToggleRequireConfirmation: (value: boolean) => void
  onAddApp: (app: string) => void
  onRemoveApp: (app: string) => void
  onGrantPermissions: () => void
}

const ComputerUseSettingsContentView: React.FC<ComputerUseSettingsContentViewProps> = ({
  enabled,
  requireConfirmation,
  alwaysAllowedApps,
  permissions,
  error,
  platformSupported = true,
  unsupportedReason = null,
  onToggle,
  onToggleRequireConfirmation,
  onAddApp,
  onRemoveApp,
  onGrantPermissions,
}) => {
  const [appInput, setAppInput] = useState('')
  const { t } = useI18n()

  const permissionsMissing =
    permissions !== null &&
    (permissions.screenRecording !== 'granted' || permissions.accessibility !== true)
  const controlsEnabled = platformSupported && enabled

  const submitApp = () => {
    const value = appInput.trim()
    if (value.length === 0) return
    onAddApp(value)
    setAppInput('')
  }

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
            {!platformSupported && (
              <div className="toolbar-settings-error glass-surface" data-testid="unsupported-platform-card">
                <div className="message-header">
                  <div className="message-indicator"></div>
                  <span className="message-label">{t('settings.computerUse.unavailable')}</span>
                </div>
                <p className="message-text">
                  {unsupportedReason || t('settings.computerUse.unavailablePlatform')}
                </p>
              </div>
            )}

            {/* ── Computer Use Master Toggle ── */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.computerUse.enable')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.computerUse.enableDescription')}
                  </p>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={platformSupported && enabled}
                    disabled={!platformSupported}
                    onChange={(e) => onToggle(e.target.checked)}
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
            </div>

            {/* ── OS Permission Status (macOS) ── */}
            {permissionsMissing && (
              <div className="toolbar-settings-card" data-testid="permissions-card">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.computerUse.permissionsRequired')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.computerUse.permissionsDescription')}
                  </p>
                </div>
                <ul className="toolbar-settings-list">
                  <li className="toolbar-settings-list-item">
                    <span>{t('settings.computerUse.screenRecording')}</span>
                    <span data-testid="perm-screen-recording">
                      {permissions?.screenRecording === 'granted' ? t('settings.computerUse.granted') : t('settings.computerUse.required')}
                    </span>
                  </li>
                  <li className="toolbar-settings-list-item">
                    <span>{t('settings.computerUse.accessibility')}</span>
                    <span data-testid="perm-accessibility">
                      {permissions?.accessibility ? t('settings.computerUse.granted') : t('settings.computerUse.required')}
                    </span>
                  </li>
                </ul>
                <div className="toolbar-setting-item">
                  <button
                    type="button"
                    className="toolbar-settings-button"
                    data-testid="grant-permissions"
                    onClick={onGrantPermissions}
                  >
                    {t('settings.computerUse.openSystemSettings')}
                  </button>
                </div>
              </div>
            )}

            {/* ── Require Confirmation Toggle ── */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.computerUse.requireConfirmation')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.computerUse.requireConfirmationDescription')}
                  </p>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={requireConfirmation}
                    disabled={!controlsEnabled}
                    onChange={(e) => onToggleRequireConfirmation(e.target.checked)}
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
            </div>

            {/* ── Always-allowed Apps ── */}
            <div className="toolbar-settings-card">
              <div className="setting-label-container">
                <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.computerUse.alwaysAllowedApps')}</label>
                <p className="runtime-card-desc">
                  {t('settings.computerUse.alwaysAllowedDescription')}
                </p>
              </div>

              <div className="toolbar-setting-item" style={{ gap: 8 }}>
                <input
                  type="text"
                  className="toolbar-settings-input"
                  placeholder={t('settings.computerUse.appNamePlaceholder')}
                  aria-label={t('settings.computerUse.appNamePlaceholder')}
                  value={appInput}
                  disabled={!controlsEnabled}
                  onChange={(e) => setAppInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitApp()
                    }
                  }}
                />
                <button
                  type="button"
                  className="toolbar-settings-button"
                  disabled={!controlsEnabled || appInput.trim().length === 0}
                  onClick={submitApp}
                >
                  {t('settings.computerUse.add')}
                </button>
              </div>

              {alwaysAllowedApps.length === 0 ? (
                <p className="runtime-card-desc" data-testid="allowlist-empty">{t('settings.computerUse.noAlwaysAllowedApps')}</p>
              ) : (
                <ul className="toolbar-settings-list" data-testid="allowlist">
                  {alwaysAllowedApps.map((app) => (
                    <li key={app} className="toolbar-settings-list-item">
                      <span>{app}</span>
                      <button
                        type="button"
                        className="toolbar-settings-button"
                        aria-label={t('settings.computerUse.removeApp', { app })}
                        onClick={() => onRemoveApp(app)}
                      >
                        {t('settings.computerUse.remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ComputerUseSettingsContentView
