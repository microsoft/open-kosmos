'use client'

import React from 'react'
import ShortcutRecorder from '../ui/ShortcutRecorder'
import type { ScreenshotSettings } from '@shared/ipc/screenshot'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface ScreenshotSettingsContentViewProps {
  settings: ScreenshotSettings
  error: string | null
  onSettingsChange: (settings: ScreenshotSettings) => void
  onShortcutChange: (shortcut: string) => void
  onSelectSavePath: () => void
  onResetSavePath: () => void
}

const ScreenshotSettingsContentView: React.FC<ScreenshotSettingsContentViewProps> = ({
  settings,
  error,
  onSettingsChange,
  onShortcutChange,
  onSelectSavePath,
  onResetSavePath,
}) => {
  const { t } = useI18n()
  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        {/* Error Message */}
        {error && (
          <div className="toolbar-settings-error glass-surface">
            <div className="message-header">
              <div className="message-indicator"></div>
              <span className="message-label">{t('common.error')}</span>
            </div>
            <p className="message-text">{error}</p>
          </div>
        )}

        {/* Settings Form */}
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            {/* Enable Screenshot */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">{t('settings.screenshot.enable')}</label>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) =>
                      onSettingsChange({
                        ...settings,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
            </div>

            {/* Shortcut Configuration */}
            <div className="toolbar-settings-card toolbar-shortcut-section">
              <div className="toolbar-setting-item" style={{ marginBottom: '8px' }}>
                <div className="setting-label-container">
                  <label className="setting-label">{t('settings.screenshot.enableShortcut')}</label>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={settings.shortcutEnabled}
                    onChange={(e) =>
                      onSettingsChange({
                        ...settings,
                        shortcutEnabled: e.target.checked,
                      })
                    }
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
              <label className="shortcut-label">{t('settings.screenshot.shortcut')}</label>
              <ShortcutRecorder
                value={settings.shortcut}
                onChange={onShortcutChange}
                requireModifier
                disabled={!settings.shortcutEnabled}
              />
            </div>

            {/* Save Path Configuration */}
            <div className="toolbar-settings-card">
              <div style={{ padding: '10px 4px' }}>
                <label className="setting-label" style={{ marginBottom: '8px', display: 'block' }}>{t('settings.screenshot.savePath')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    className="screenshot-save-path-value"
                    data-has-save-path={settings.savePath ? 'true' : 'false'}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      backgroundColor: 'var(--color-neutral-100)',
                      borderRadius: '8px',
                      border: '1px solid var(--color-neutral-200)',
                      fontSize: '14px',
                      color: settings.savePath ? 'var(--color-warm-900)' : 'var(--color-neutral-500)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {settings.savePath || t('settings.screenshot.defaultDownloads')}
                  </div>
                  <button
                    className="screenshot-save-path-browse"
                    onClick={onSelectSavePath}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: 'var(--color-warm-900)',
                      color: 'white',
                      borderRadius: '8px',
                      fontSize: '14px',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {t('settings.screenshot.browse')}
                  </button>
                </div>
                {settings.savePath && (
                  <button
                    className="screenshot-save-path-reset"
                    onClick={onResetSavePath}
                    style={{
                      marginTop: '8px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-neutral-500)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline'
                    }}
                  >
                    {t('settings.screenshot.resetDefault')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScreenshotSettingsContentView
