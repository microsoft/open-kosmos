'use client'

import React from 'react'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/RuntimeSettings.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface BrowserSettingsContentViewProps {
  enabled: boolean
  error: string | null
  onToggle: (enabled: boolean) => void
}

const BrowserSettingsContentView: React.FC<BrowserSettingsContentViewProps> = ({
  enabled,
  error,
  onToggle,
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
            {/* ── Browser Master Toggle ── */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.browser.enableBrowser')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.browser.description')}
                  </p>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => onToggle(e.target.checked)}
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrowserSettingsContentView
