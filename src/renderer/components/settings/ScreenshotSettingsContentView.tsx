'use client'

import React from 'react'
import ShortcutRecorder from '../ui/ShortcutRecorder'
import type { ScreenshotSettings } from '@shared/ipc/screenshot'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'

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
  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        {/* Error Message */}
        {error && (
          <div className="toolbar-settings-error glass-surface">
            <div className="message-header">
              <div className="message-indicator"></div>
              <span className="message-label">Error:</span>
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
                  <label className="setting-label">Enable Screenshot</label>
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
                  <label className="setting-label">Enable Shortcut</label>
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
              <label className="shortcut-label">Shortcut</label>
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
                <label className="setting-label" style={{ marginBottom: '8px', display: 'block' }}>Save Path</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      backgroundColor: '#F3F4F6',
                      borderRadius: '8px',
                      border: '1px solid #E5E7EB',
                      fontSize: '14px',
                      color: settings.savePath ? '#272320' : '#6B7280',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {settings.savePath || 'Downloads (Default)'}
                  </div>
                  <button
                    onClick={onSelectSavePath}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#272320',
                      color: 'white',
                      borderRadius: '8px',
                      fontSize: '14px',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Browse...
                  </button>
                </div>
                {settings.savePath && (
                  <button
                    onClick={onResetSavePath}
                    style={{
                      marginTop: '8px',
                      background: 'none',
                      border: 'none',
                      color: '#6B7280',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline'
                    }}
                  >
                    Reset to Default
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
