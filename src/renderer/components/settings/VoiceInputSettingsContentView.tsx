'use client'

import React, { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Trash2, AlertCircle } from 'lucide-react'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/RuntimeSettings.css'

import type {
  VoiceInputSettings,
  WhisperModelSize,
  WhisperModelStatus,
  WhisperModelInfo,
  DownloadProgress,
} from './VoiceInputSettingsView'

// Supported languages for Whisper
const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese (Simplified) 简体中文' },
  { code: 'zh-Hant', name: 'Chinese (Traditional) 繁體中文' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
]

interface VoiceInputSettingsContentViewProps {
  settings: VoiceInputSettings
  modelStatuses: WhisperModelStatus[]
  modelInfos: WhisperModelInfo[]
  downloadProgress: DownloadProgress | null
  loading: boolean
  error: string | null
  onSettingsChange: (settings: VoiceInputSettings) => void
  onDownloadModel: (size: WhisperModelSize) => void
  onDeleteModel: (size: WhisperModelSize) => void
  onCancelDownload: (size: WhisperModelSize) => void
  // Voice input master switch
  voiceInputEnabled: boolean
  isEnabling: boolean
  setupStep: 'addon' | 'model' | null
  setupProgress: number
  enablingError?: string
  onToggleVoiceInput: (enabled: boolean) => void
  onCancelEnabling: () => void
  // Dev-only addon info
  addonStatus: 'not-downloaded' | 'downloading' | 'downloaded' | 'error'
  onDeleteAddon: () => void
}

const VoiceInputSettingsContentView: React.FC<VoiceInputSettingsContentViewProps> = ({
  settings,
  modelStatuses,
  modelInfos,
  downloadProgress,
  loading,
  error,
  onSettingsChange,
  onDownloadModel,
  onDeleteModel,
  onCancelDownload,
  voiceInputEnabled,
  isEnabling,
  setupStep,
  setupProgress,
  enablingError,
  onToggleVoiceInput,
  onCancelEnabling,
  addonStatus,
  onDeleteAddon,
}) => {
  const [searchParams] = useSearchParams()
  const modelSectionRef = useRef<HTMLDivElement>(null)
  const hasAnyModelDownloaded = modelStatuses.some(s => s.downloaded)

  // Check if we should highlight the model section
  const shouldHighlightModel = searchParams.get('highlight') === 'model'

  // Scroll to and highlight model section when requested
  useEffect(() => {
    if (shouldHighlightModel && modelSectionRef.current) {
      // Scroll into view with smooth animation
      modelSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Add highlight class
      modelSectionRef.current.classList.add('highlight-pulse')

      // Remove highlight after animation
      const timer = setTimeout(() => {
        modelSectionRef.current?.classList.remove('highlight-pulse')
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [shouldHighlightModel])

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        {/* Error Message */}
        {error && (
          <div className="toolbar-settings-error glass-surface">
            <div className="message-header">
              <div className="message-indicator" style={{ background: '#ef4444' }}></div>
              <span className="message-label">Error:</span>
            </div>
            <p className="message-text">{error}</p>
          </div>
        )}

        {/* Settings Form */}
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            {/* ── Card 0: Voice Input Master Toggle ── */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label" style={{ fontWeight: 500 }}>Voice Input</label>
                  <p className="runtime-card-desc">
                    Enable voice input using Whisper speech recognition engine (~127 MB, downloaded once and cached locally).
                  </p>
                </div>
                {isEnabling ? (
                  /* Sequential setup: single progress bar + step label + cancel */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, minWidth: 240 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="settings-model-progress-bar" style={{ flex: 1 }}>
                        <div className="settings-model-progress-fill" style={{ width: `${setupProgress}%` }} />
                      </div>
                      <button
                        className="runtime-text-btn"
                        style={{ flexShrink: 0 }}
                        onClick={onCancelEnabling}
                      >Cancel</button>
                    </div>
                    <span className="runtime-card-desc" style={{ opacity: 0.65 }}>
                      {setupStep === 'addon'
                        ? '1/2 downloading engine'
                        : setupStep === 'model'
                          ? '2/2 downloading model'
                          : 'setting up...'}
                    </span>
                  </div>
                ) : (
                  <label className="toolbar-toggle-wrapper">
                    <input
                      type="checkbox"
                      checked={voiceInputEnabled}
                      onChange={(e) => onToggleVoiceInput(e.target.checked)}
                    />
                    <div className="toolbar-toggle-track"></div>
                  </label>
                )}
              </div>
              {enablingError && (
                <p className="runtime-card-desc" style={{ color: '#ef4444', marginTop: '4px' }}>
                  {enablingError}
                </p>
              )}
              {/* Dev-only: addon install status + delete */}
              {process.env.NODE_ENV === 'development' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(0,0,0,0.08)' }}>
                  <span className="runtime-card-desc" style={{ opacity: 0.6 }}>engine addon:</span>
                  <span className={`runtime-python-badge ${
                    addonStatus === 'downloaded' ? 'runtime-python-badge--installed' :
                    'runtime-python-badge--available'
                  }`} style={addonStatus === 'error' ? { color: '#ef4444' } : undefined}>{addonStatus}</span>
                  {addonStatus === 'downloaded' && (
                    <button
                      className="runtime-icon-btn"
                      onClick={onDeleteAddon}
                      title="Delete addon cache (dev)"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Cards 1-4: only shown when voice input is enabled ── */}
            {voiceInputEnabled && (
              <>
                {/* ── Card 1: Whisper Model ── */}
                <div
                  ref={modelSectionRef}
                  className={`toolbar-settings-card ${shouldHighlightModel ? 'highlight-section' : ''}`}
                >
                  {/* Card header */}
                  <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                    <div className="setting-label-container">
                      <label className="setting-label" style={{ fontWeight: 500 }}>Whisper Model</label>
                      <p className="runtime-card-desc">
                        Voice input uses OpenAI Whisper running locally for high accuracy offline speech recognition.
                        Please download a model to enable voice input.
                      </p>
                    </div>
                  </div>

                  {/* Warning if no model downloaded */}
                  {!hasAnyModelDownloaded && (
                    <div className="runtime-loading-bar" style={{ color: '#b45309', background: '#fef9c3', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertCircle size={14} style={{ flexShrink: 0 }} />
                      Please download at least one model to use voice input
                    </div>
                  )}

                  {/* Model rows */}
                  {modelInfos.map((info) => {
                    const status = modelStatuses.find(s => s.size === info.size)
                    const isDownloaded = status?.downloaded ?? false
                    const isSelected = settings.whisperModel === info.size
                    const isDownloading = downloadProgress?.model === info.size

                    return (
                      <div key={info.size} className="settings-model-row">
                        {/* Col 1: Status badge */}
                        <span className={`runtime-python-badge settings-model-badge ${isDownloaded ? 'runtime-python-badge--installed' : 'runtime-python-badge--available'}`}>
                          {isDownloaded ? 'downloaded' : 'available'}
                        </span>

                        {/* Col 2: Model info */}
                        <div className="settings-model-info">
                          <span className="setting-label" style={{ fontWeight: 500 }}>
                            {info.size.charAt(0).toUpperCase() + info.size.slice(1)}
                            <span className="runtime-component-tag">{info.fileSizeDisplay}</span>
                          </span>
                          <span className="runtime-card-desc">{info.description}</span>
                        </div>

                        {/* Col 3: Actions (always 168px) */}
                        <div className="settings-model-actions">
                          {isDownloading ? (
                            <>
                              <div className="settings-model-progress-bar">
                                <div className="settings-model-progress-fill" style={{ width: `${downloadProgress.percent}%` }} />
                              </div>
                              <span className="runtime-pin-text">{downloadProgress.percent}%</span>
                              <button className="runtime-text-btn" onClick={() => onCancelDownload(info.size)}>Cancel</button>
                            </>
                          ) : isDownloaded ? (
                            <>
                              <label className="runtime-pin-label" title="Use this model">
                                <input
                                  type="radio"
                                  name="whisperModel"
                                  value={info.size}
                                  checked={isSelected}
                                  onChange={() => onSettingsChange({ ...settings, whisperModel: info.size })}
                                  className="runtime-radio"
                                />
                                <span className="runtime-pin-text">Use</span>
                              </label>
                              <button
                                className="runtime-icon-btn"
                                onClick={() => onDeleteModel(info.size)}
                                title="Delete model"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="runtime-action-btn"
                              onClick={() => onDownloadModel(info.size)}
                              disabled={loading}
                            >
                              <Download size={13} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                              Download
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* ── Card 2: Language ── */}
                <div className="toolbar-settings-card">
                  <div className="toolbar-setting-item">
                    <div className="setting-label-container">
                      <label className="setting-label">Language</label>
                      <p className="runtime-card-desc">Select the language for speech recognition. Auto-detect works for most cases.</p>
                    </div>
                    <div className="toolbar-select-wrapper">
                      <select
                        className="toolbar-select"
                        value={settings.language}
                        onChange={(e) => onSettingsChange({ ...settings, language: e.target.value })}
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Card 3: GPU Acceleration ── */}
                <div className="toolbar-settings-card">
                  <div className="toolbar-setting-item">
                    <div className="setting-label-container">
                      <label className="setting-label">GPU Acceleration</label>
                      <p className="runtime-card-desc">Use GPU for faster transcription (Vulkan on Windows/Linux, Metal on macOS).</p>
                    </div>
                    <label className="toolbar-toggle-wrapper">
                      <input
                        type="checkbox"
                        checked={settings.useGPU ?? false}
                        onChange={(e) => onSettingsChange({ ...settings, useGPU: e.target.checked })}
                      />
                      <div className="toolbar-toggle-track"></div>
                    </label>
                  </div>
                </div>

                {/* ── Card 4: Translate to English (conditional) ── */}
                {(settings.whisperModel === 'small' || settings.whisperModel === 'medium' || settings.whisperModel === 'turbo') && (
                  <div className="toolbar-settings-card">
                    <div className="toolbar-setting-item">
                      <div className="setting-label-container">
                        <label className="setting-label">Translate to English</label>
                        <p className="runtime-card-desc">Automatically translate speech from other languages to English. Only available for Small, Medium, and Turbo models.</p>
                      </div>
                      <label className="toolbar-toggle-wrapper">
                        <input
                          type="checkbox"
                          checked={settings.translate ?? false}
                          onChange={(e) => onSettingsChange({ ...settings, translate: e.target.checked })}
                        />
                        <div className="toolbar-toggle-track"></div>
                      </label>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default VoiceInputSettingsContentView
