'use client'

import React from 'react'
import '../../styles/ContentView.css'
import '../../styles/BrowserControlView.css'

// Progress type for download
interface DownloadProgress {
  percent: number
  transferred: string
  total: string
}

type BrowserType = 'chrome' | 'edge'

interface BrowserControlContentViewProps {
  isEnabled: boolean
  isInstalling: boolean
  isLoading: boolean
  onToggle: () => void
  onLaunchBrowser: () => void
  phase: string
  downloadProgress: DownloadProgress
  selectedBrowser: BrowserType
  onBrowserChange: (browser: BrowserType) => void
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
  isEnabled,
  isInstalling,
  isLoading,
  onToggle,
  onLaunchBrowser,
  phase,
  downloadProgress,
  selectedBrowser,
  onBrowserChange,
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
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrowserControlContentView
