'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from '../ui/ToastProvider'
import { memexApi } from '../../ipc/memex'
import '../../styles/BrowserControlView.css'
import '../../styles/RuntimeSettings.css'

const MemexIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="#272320" strokeWidth="1.5" fill="none"/>
    <path d="M12 6v6l4 2" stroke="#272320" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="12" cy="12" r="2" fill="#272320"/>
  </svg>
)

const MemexView: React.FC = () => {
  const { showSuccess, showError } = useToast()
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [phase, setPhase] = useState<string>('idle')

  const loadStatus = useCallback(async () => {
    try {
      const result = await memexApi.getStatus()
      if (result.success && result.data) {
        setIsEnabled(result.data.enabled)
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const cleanup = window.electronAPI?.memex?.onPhaseChange((newPhase: string) => {
      setPhase(newPhase)
      if (newPhase === 'completed') {
        setTimeout(() => setPhase('idle'), 800)
      }
      if (newPhase === 'error') {
        setPhase('idle')
      }
    })
    return () => { cleanup?.() }
  }, [])

  const handleToggle = useCallback(async () => {
    if (isBusy) return
    setIsBusy(true)
    try {
      const result = isEnabled
        ? await memexApi.disable()
        : await memexApi.enable()
      if (result.success) {
        setIsEnabled(!isEnabled)
        showSuccess(!isEnabled ? 'Memex Memory enabled' : 'Memex Memory disabled')
      } else {
        showError('error' in result ? result.error : 'Unknown error')
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to toggle Memex')
    } finally {
      setIsBusy(false)
    }
  }, [isBusy, isEnabled, showSuccess, showError])

  if (isLoading) {
    return (
      <div className="runtime-settings-view">
        <div className="runtime-settings-loading">Loading...</div>
      </div>
    )
  }

  return (
    <div className="runtime-settings-view">
      {/* Header */}
      <div className="unified-header">
        <div className="header-title">
          <MemexIcon />
          <span className="header-name">Memex Memory</span>
        </div>
      </div>

      {/* Content */}
      <div className="content-view-container">
        <div className="browser-control-content">
          <div className="browser-control-form">
            <div className="browser-control-form-inner">
              <div className="browser-control-card">
                <div className="browser-control-setting-item">
                  <div className="setting-label-container">
                    <span className="setting-label">Enable Memex Memory</span>
                    <span className="setting-sublabel">
                      Each agent gets its own persistent Zettelkasten memory via hidden MCP servers.
                      Requires <code>@touchskyer/memex</code> installed globally.
                    </span>
                  </div>
                  {isBusy && phase !== 'idle' ? (
                    <div className="browser-control-inline-progress">
                      <span className="browser-control-inline-progress-label">
                        {phase === 'installing' ? 'Installing memex…' : phase === 'configuring' ? 'Configuring…' : phase === 'completed' ? 'Done' : 'Working…'}
                      </span>
                      <div className="browser-control-inline-progress-bar-container">
                        <div className="browser-control-inline-progress-bar browser-control-inline-progress-bar-indeterminate" />
                      </div>
                    </div>
                  ) : (
                    <label className="browser-control-toggle-wrapper">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={handleToggle}
                        disabled={isBusy}
                      />
                      <div className="browser-control-toggle-track"></div>
                    </label>
                  )}
                </div>
              </div>


            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MemexView
