'use client'

import React from 'react'
import type { BrowserControlMode } from './BrowserControlView'
import '../../styles/ContentView.css'
import '../../styles/BrowserControlView.css'
import '../../styles/RuntimeSettings.css'

// Progress type for download
interface DownloadProgress {
  percent: number
  transferred: string
  total: string
}

type BrowserType = 'chrome' | 'edge'

interface BrowserControlContentViewProps {
  mode: BrowserControlMode
  onModeChange: (mode: BrowserControlMode) => void
  isEnabled: boolean
  isInstalling: boolean
  isLoading: boolean
  onToggle: () => void
  onLaunchBrowser: () => void
  phase: string
  downloadProgress: DownloadProgress
  selectedBrowser: BrowserType
  onBrowserChange: (browser: BrowserType) => void
  updateStatus: 'checking' | 'up-to-date' | 'available' | 'updating' | 'done'
  updateVersions: { local: string; remote: string | null }
  updatePhase: string
  updateProgress: DownloadProgress
  onUpdate: () => void
  isReinstalling: boolean
  reinstallDone: boolean
  onReinstallExtension: () => void
  // CDP props
  isCdpEnabled: boolean
  isCdpBusy: boolean
  cdpStatusMessage: string
  onCdpEnable: () => void
  onCdpDisable: () => void
}

// Get user-friendly phase label
const getPhaseLabel = (phase: string): string => {
  switch (phase) {
    case 'preparing':
      return 'Preparing...'
    case 'downloading':
      return 'Downloading...'
    case 'installing':
      return 'Installing browser...'
    case 'extracting':
      return 'Extracting...'
    case 'connecting':
      return 'Connecting...'
    case 'completed':
      return 'Done'
    case 'error':
      return 'Error'
    default:
      return ''
  }
}

const BrowserControlContentView: React.FC<BrowserControlContentViewProps> = ({
  mode,
  onModeChange,
  isEnabled,
  isInstalling,
  isLoading,
  onToggle,
  onLaunchBrowser,
  phase,
  downloadProgress,
  selectedBrowser,
  onBrowserChange,
  updateStatus,
  updateVersions,
  updatePhase,
  updateProgress,
  onUpdate,
  isReinstalling,
  reinstallDone,
  onReinstallExtension,
  isCdpEnabled,
  isCdpBusy,
  cdpStatusMessage,
  onCdpEnable,
  onCdpDisable,
}) => {
  const showProgress = isInstalling && phase !== 'idle'
  const phaseLabel = getPhaseLabel(phase)

  // Determine if we should show determinate progress (with percent)
  const showPercent = phase === 'downloading' || phase === 'extracting'

  // Determine what to render in the control area
  const renderControl = () => {
    // Still loading - render nothing
    if (isLoading) {
      return null
    }

    // Show progress bar
    if (showProgress) {
      return (
        <div className="browser-control-inline-progress">
          <span className="browser-control-inline-progress-label">
            {phaseLabel}
          </span>
          <div className="browser-control-inline-progress-bar-container">
            {showPercent ? (
              <div
                className="browser-control-inline-progress-bar"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            ) : (
              <div className="browser-control-inline-progress-bar browser-control-inline-progress-bar-indeterminate" />
            )}
          </div>
          {showPercent && (
            <span className="browser-control-inline-progress-percent">
              {Math.round(downloadProgress.percent)}%
            </span>
          )}
        </div>
      )
    }

    // Show toggle
    return (
      <label className="browser-control-toggle-wrapper">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={onToggle}
          disabled={isInstalling}
        />
        <div className="browser-control-toggle-track"></div>
      </label>
    )
  }

  return (
    <div className="content-view-container">
      <div className="browser-control-content">
        {/* Settings Form */}
        <div className="browser-control-form">
          <div className="browser-control-form-inner">

            {/* ── Mode Selector Card ── */}
            <div className="browser-control-card">
              {/* Card header */}
              <div className="browser-control-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>Control Mode</label>
                  <span className="setting-sublabel">
                    Select how to control the browser. Only one mode can be active at a time.
                  </span>
                </div>
              </div>

              {/* Extension mode option */}
              <label
                className={`runtime-mode-row browser-control-setting-item ${mode === 'extension' ? 'runtime-mode-row--active' : ''}`}
                onClick={() => onModeChange('extension')}
              >
                <div className="setting-label-container">
                  <span className="setting-label">Extension Mode</span>
                  <span className="setting-sublabel">Install a browser extension and native server for full browser automation. Requires admin privileges.</span>
                </div>
                <input
                  type="radio"
                  name="bcMode"
                  checked={mode === 'extension'}
                  onChange={() => onModeChange('extension')}
                  className="runtime-radio"
                />
              </label>

              {/* CDP mode option */}
              <label
                className={`runtime-mode-row browser-control-setting-item ${mode === 'cdp' ? 'runtime-mode-row--active' : ''}`}
                onClick={() => onModeChange('cdp')}
              >
                <div className="setting-label-container">
                  <span className="setting-label">CDP Mode</span>
                  <span className="setting-sublabel">Use Chrome DevTools Protocol via a DevTools MCP server. Requires manually enabling remote debugging in Chrome.</span>
                </div>
                <input
                  type="radio"
                  name="bcMode"
                  checked={mode === 'cdp'}
                  onChange={() => onModeChange('cdp')}
                  className="runtime-radio"
                />
              </label>
            </div>

            {/* ── Extension Mode Cards ── */}
            {mode === 'extension' && (<>
            {/* Enable Browser Control Card */}
            <div className="browser-control-card">
              <div className="browser-control-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">
                    Enable Browser Control
                  </label>
                  <span className="setting-sublabel">
                    Requires administrator privileges
                  </span>
                  <span className="setting-sublabel">
                    If the browser is currently open, please restart it manually after enabling
                  </span>
                </div>

                {/* Toggle or Progress Bar */}
                {renderControl()}
              </div>
            </div>

            {/* Native Server Update Card */}
            {(isEnabled || updateStatus === 'updating') && (
              <div className="browser-control-card">
                <div className="browser-control-setting-item">
                  <div className="setting-label-container">
                    <label className="setting-label">
                      Native Server
                    </label>
                    {updateStatus === 'checking' && (
                      <span className="setting-sublabel">Checking for updates...</span>
                    )}
                    {updateStatus === 'up-to-date' && (
                      <span className="setting-sublabel">Up to date (v{updateVersions.local})</span>
                    )}
                    {updateStatus === 'available' && (
                      <span className="setting-sublabel">
                        Update available: v{updateVersions.local} → v{updateVersions.remote}
                      </span>
                    )}
                    {updateStatus === 'updating' && (
                      <span className="setting-sublabel">Updating...</span>
                    )}
                  </div>

                  {updateStatus === 'updating' ? (
                    <div className="browser-control-inline-progress">
                      <span className="browser-control-inline-progress-label">
                        {getPhaseLabel(updatePhase)}
                      </span>
                      <div className="browser-control-inline-progress-bar-container">
                        {(updatePhase === 'downloading' || updatePhase === 'extracting') ? (
                          <div
                            className="browser-control-inline-progress-bar"
                            style={{ width: `${updateProgress.percent}%` }}
                          />
                        ) : (
                          <div className="browser-control-inline-progress-bar browser-control-inline-progress-bar-indeterminate" />
                        )}
                      </div>
                      {(updatePhase === 'downloading' || updatePhase === 'extracting') && (
                        <span className="browser-control-inline-progress-percent">
                          {Math.round(updateProgress.percent)}%
                        </span>
                      )}
                    </div>
                  ) : updateStatus === 'available' ? (
                    <button
                      className="browser-control-launch-btn"
                      onClick={onUpdate}
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Browser Extension Reinstall Card */}
            {(isEnabled || isReinstalling) && (
              <div className="browser-control-card">
                <div className="browser-control-setting-item">
                  <div className="setting-label-container">
                    <label className="setting-label">
                      Browser Extension
                    </label>
                    {isReinstalling ? (
                      <span className="setting-sublabel">Reinstalling...</span>
                    ) : reinstallDone ? (
                      <span className="setting-sublabel">Reinstall completed</span>
                    ) : (
                      <span className="setting-sublabel">
                        Reinstall the extension to apply updates
                      </span>
                    )}
                  </div>

                  {isReinstalling ? (
                    <div className="browser-control-inline-progress">
                      <div className="browser-control-inline-progress-bar-container">
                        <div className="browser-control-inline-progress-bar browser-control-inline-progress-bar-indeterminate" />
                      </div>
                    </div>
                  ) : (
                    <button
                      className="browser-control-launch-btn"
                      onClick={onReinstallExtension}
                      disabled={!isEnabled || isInstalling}
                    >
                      Reinstall
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Browser Selection Card */}
            <div className="browser-control-card">
              <div className="browser-control-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">
                    <input
                      type="radio"
                      name="browser"
                      value="edge"
                      checked={selectedBrowser === 'edge'}
                      onChange={() => onBrowserChange('edge')}
                      disabled={!isEnabled || isInstalling}
                      style={{ marginRight: '8px' }}
                    />
                    Microsoft Edge
                  </label>
                </div>
              </div>
              <div className="browser-control-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">
                    <input
                      type="radio"
                      name="browser"
                      value="chrome"
                      checked={selectedBrowser === 'chrome'}
                      onChange={() => onBrowserChange('chrome')}
                      disabled={!isEnabled || isInstalling}
                      style={{ marginRight: '8px' }}
                    />
                    Google Chrome
                  </label>
                </div>
              </div>
            </div>

            {/* Launch Browser Card */}
            <div className="browser-control-card">
              <div className="browser-control-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">
                    Launch Browser
                  </label>
                  <span className="setting-sublabel">
                    Open browser with snap layout
                  </span>
                </div>

                <button
                  className="browser-control-launch-btn"
                  onClick={onLaunchBrowser}
                  disabled={!isEnabled || isInstalling}
                >
                  Launch
                </button>
              </div>
            </div>
            </>)}

            {/* ── CDP Mode Card ── */}
            {mode === 'cdp' && (
            <div className="browser-control-card">
              <div className="browser-control-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">Enable CDP</label>
                  <span className="setting-sublabel">
                    {isCdpEnabled
                      ? 'MCP server is configured. Make sure remote debugging is enabled in Chrome.'
                      : 'Add a DevTools MCP server for browser control via Chrome DevTools Protocol.'}
                  </span>
                  {cdpStatusMessage && (
                    <span
                      className="setting-sublabel"
                      style={{ color: cdpStatusMessage.startsWith('Error') || cdpStatusMessage.startsWith('Failed') ? '#dc2626' : '#059669' }}
                    >
                      {cdpStatusMessage}
                    </span>
                  )}
                </div>
                <label className="browser-control-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={isCdpEnabled}
                    onChange={isCdpEnabled ? onCdpDisable : onCdpEnable}
                    disabled={isCdpBusy}
                  />
                  <div className="browser-control-toggle-track"></div>
                </label>
              </div>
            </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

export default BrowserControlContentView
