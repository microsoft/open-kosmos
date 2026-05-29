'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Link2, Unlink, Play, AlertTriangle, ChevronDown } from 'lucide-react'
import type { ChannelConfig, ChannelStatusInfo } from '@shared/ipc/remoteChannel'
import { APP_NAME } from '@shared/constants/branding'
import '../../styles/ContentView.css'
import '../../styles/SettingsShared.css'
import '../../styles/RuntimeSettings.css'
import '../../styles/RemoteChannelSettings.css'

interface ChatOption {
  chatId: string
  name: string
  emoji: string
}

interface RemoteChannelSettingsContentViewProps {
  config?: ChannelConfig
  statusInfo: ChannelStatusInfo | null
  bindingStatus: { bound: boolean; userId?: string }
  bindCode: string
  binding: boolean
  error: string | null
  bindError: string | null
  loading: boolean
  chatOptions: ChatOption[]
  onStartBinding: () => void
  onSave: (config: ChannelConfig) => Promise<boolean>
  onBindCodeChange: (code: string) => void
  onBind: () => void
  onDisconnect: () => void
}

function getTaskLabel(status: string, isBound: boolean): string {
  if (isBound) return status === 'running' ? 'Bound · Online' : 'Bound · Offline'
  if (status === 'running' || status === 'starting' || status === 'reconnecting') return 'Waiting for code'
  return 'Not bound'
}

const RemoteChannelSettingsContentView: React.FC<RemoteChannelSettingsContentViewProps> = ({
  config,
  statusInfo,
  bindingStatus,
  bindCode,
  binding,
  error,
  bindError,
  loading,
  chatOptions,
  onStartBinding,
  onSave,
  onBindCodeChange,
  onBind,
  onDisconnect,
}) => {
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [savingChatId, setSavingChatId] = useState<string | null>(null)
  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const teamsBotName = `${APP_NAME} Bot`
  const teamsBotInstallUrl = 'https://expert-adventure-7e7ow87.pages.github.io/download-teams-bot-openkosmos.html'

  const resolveValidChatId = (candidateId?: string): string => {
    if (candidateId && chatOptions.some(c => c.chatId === candidateId)) return candidateId
    return chatOptions.length > 0 ? chatOptions[0].chatId : ''
  }

  const [formChatId, setFormChatId] = useState(() => resolveValidChatId(config?.boundChatId))

  const configKey = `${config?.boundChatId}|${chatOptions.map(c => c.chatId).join(',')}`
  useEffect(() => {
    setFormChatId(resolveValidChatId(config?.boundChatId))
  }, [configKey])

  useEffect(() => {
    if (!showAgentDropdown) return
    const handleClickOutside = (event: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) {
        setShowAgentDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAgentDropdown])

  const handleSelectAgent = async (chatId: string) => {
    if (savingChatId || chatId === formChatId) {
      setShowAgentDropdown(false)
      return
    }

    const previousChatId = formChatId
    setFormChatId(chatId)
    setShowAgentDropdown(false)
    setSavingChatId(chatId)

    const success = await onSave({
      boundChatId: chatId || undefined,
    })

    if (!success) {
      setFormChatId(previousChatId)
    }

    setSavingChatId(null)
  }

  const status = statusInfo?.status || 'stopped'
  const isBound = bindingStatus.bound
  const isChannelActive = status === 'running' || status === 'starting' || status === 'reconnecting'
  const canStartBinding = !isBound && (status === 'stopped' || status === 'error')
  const hasCardBody = isBound || isChannelActive || (status === 'error' && statusInfo?.error)

  // Determine status badge style
  const badgeStatus = isBound && status === 'running' ? 'running'
    : isBound ? 'reconnecting'
    : isChannelActive ? 'starting'
    : status === 'error' ? 'error'
    : 'stopped'

  if (loading) {
    return (
      <div className="content-view-container">
        <div className="toolbar-settings-content">
          <div className="toolbar-loading-state">
            <div className="toolbar-loading-spinner" />
            <p className="loading-text">Loading settings...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            {error && (
              <div className="rc-inline-error">
                <AlertTriangle size={13} />
                <span>{error}</span>
              </div>
            )}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item rc-card-section-header">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>Agent for Teams Messages</label>
                  <p className="runtime-card-desc">
                    Messages from <code>{teamsBotName}</code> will be routed to the selected Agent on this device. In Teams, send <code>.agent</code> if you want to switch later.
                  </p>
                </div>
              </div>

              <div className="toolbar-setting-item rc-agent-setting-item">
                <div className="setting-label-container rc-agent-copy-block">
                  <label className="setting-label">Default Agent</label>
                </div>
                <div className="rc-agent-control-group">
                  <div className="rc-agent-selector" ref={agentDropdownRef}>
                    <button
                      type="button"
                      className="rc-agent-trigger"
                      disabled={savingChatId !== null}
                      onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                    >
                      {(() => {
                        const selected = chatOptions.find(c => c.chatId === formChatId)
                        return selected ? (
                          <>
                            {selected.emoji && <span className="rc-agent-trigger-emoji">{selected.emoji}</span>}
                            <span className="rc-agent-trigger-name">{selected.name}</span>
                          </>
                        ) : (
                          <span className="rc-agent-trigger-name rc-placeholder">Select an Agent</span>
                        )
                      })()}
                      <ChevronDown
                        size={14}
                        className={`rc-agent-trigger-arrow ${showAgentDropdown ? 'open' : ''}`}
                      />
                    </button>
                    {showAgentDropdown && chatOptions.length > 0 && (
                      <div className="rc-agent-dropdown">
                        <div className="rc-agent-list">
                          {chatOptions.map((chat) => (
                            <button
                              key={chat.chatId}
                              type="button"
                              className={`rc-agent-option ${formChatId === chat.chatId ? 'selected' : ''}`}
                              disabled={savingChatId !== null}
                              onClick={() => void handleSelectAgent(chat.chatId)}
                            >
                              {chat.emoji && <span className="rc-agent-option-emoji">{chat.emoji}</span>}
                              <span className="rc-agent-option-name">{chat.name}</span>
                              {formChatId === chat.chatId && (
                                <svg className="rc-agent-option-check" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="toolbar-settings-card">
              <div className={`toolbar-setting-item ${hasCardBody ? 'rc-card-section-header' : ''}`}>
                <div className="rc-card-header-topline">
                  <div className="setting-label-container rc-card-header-copy">
                    <div className="rc-card-title-row">
                      <label className="setting-label" style={{ fontWeight: 500 }}>Teams Binding</label>
                      <div className="rc-status-row">
                        <span className={`rc-status-badge rc-status-${badgeStatus}`}>
                          <span className="rc-status-dot" />
                          {getTaskLabel(status, isBound)}
                        </span>
                      </div>
                    </div>
                    <p className="runtime-card-desc">
                      Bind this {APP_NAME} device with <code>{teamsBotName}</code> to receive and reply to Teams messages remotely.
                      {' '}Haven't set up the Teams Bot yet? <a className="rc-inline-link" href={teamsBotInstallUrl} target="_blank" rel="noopener noreferrer">Download and set up Teams Bot</a>.
                    </p>
                  </div>
                  <div className="rc-card-header-actions">
                    {isBound ? (
                      <button
                        className="rc-btn rc-btn-icon rc-btn-danger"
                        onClick={onDisconnect}
                        disabled={binding}
                      >
                        {binding ? '...' : <><Unlink size={14} /> Unbind</>}
                      </button>
                    ) : canStartBinding ? (
                      <button
                        className="rc-btn rc-btn-icon runtime-action-btn"
                        onClick={onStartBinding}
                      >
                        <Play size={14} /> Start Binding
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Bound state */}
              {isBound && (
                <div className="rc-success-summary">
                  <div className="rc-success-summary-copy">
                    <label className="setting-label">Bound account</label>
                    <p className="runtime-card-desc">This device is bound and ready to receive Teams messages.</p>
                    {bindError && <div className="rc-bind-error">{bindError}</div>}
                  </div>
                  <div className="rc-binding-info">
                    <span className="rc-binding-badge rc-binding-bound">
                      <span className="rc-binding-dot" />
                      Bound
                      {bindingStatus.userId && (
                        <span className="rc-binding-user">{bindingStatus.userId}</span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Binding in progress — channel active, waiting for code */}
              {!isBound && isChannelActive && (
                <div className="rc-step-action-panel">
                  <div className="rc-step-action-copy">
                    <label className="setting-label">Paste binding code</label>
                    <p className="runtime-card-desc">
                      In Teams, send <code>.bind</code> to <code>{teamsBotName}</code> to get the binding code.
                    </p>
                    {bindError && <div className="rc-bind-error">{bindError}</div>}
                  </div>
                  <div className="rc-binding-entry-controls rc-step-action-controls">
                    <input
                      type="text"
                      className="rc-binding-code-input"
                      placeholder="ABC123"
                      value={bindCode}
                      onChange={(e) => onBindCodeChange(e.target.value.toUpperCase().slice(0, 10))}
                      maxLength={10}
                    />
                    <button
                      className="runtime-action-btn rc-btn rc-btn-icon"
                      onClick={onBind}
                      disabled={binding || !bindCode.trim()}
                    >
                      {binding ? '...' : <><Link2 size={14} /> Bind device</>}
                    </button>
                  </div>
                </div>
              )}

              {/* Error state */}
              {status === 'error' && statusInfo?.error && (
                <div className="rc-inline-error">
                  <AlertTriangle size={13} />
                  <span>{statusInfo.error}</span>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

export default RemoteChannelSettingsContentView
