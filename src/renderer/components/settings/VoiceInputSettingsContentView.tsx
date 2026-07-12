'use client'

import React, { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Trash2, AlertCircle } from 'lucide-react'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import '../../styles/RuntimeSettings.css'
import { useI18n } from '../../lib/i18n/useI18n'

import type {
  VoiceInputSettings,
  WhisperModelSize,
  WhisperModelStatus,
  WhisperModelInfo,
  DownloadProgress,
} from './VoiceInputSettingsView'

// Supported languages for Whisper
const SUPPORTED_LANGUAGES = [
  'auto',
  'en',
  'zh',
  'zh-Hant',
  'es',
  'fr',
  'de',
  'ja',
  'ko',
  'pt',
  'ru',
  'ar',
  'hi',
  'it',
  'nl',
  'pl',
  'tr',
  'vi',
  'th',
] as const

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
  const { t } = useI18n()

  const getLanguageLabel = (code: string): string => {
    switch (code) {
      case 'auto': return t('settings.voiceInput.language.auto')
      case 'en': return t('settings.voiceInput.language.en')
      case 'zh': return t('settings.voiceInput.language.zh')
      case 'zh-Hant': return t('settings.voiceInput.language.zhHant')
      case 'es': return t('settings.voiceInput.language.es')
      case 'fr': return t('settings.voiceInput.language.fr')
      case 'de': return t('settings.voiceInput.language.de')
      case 'ja': return t('settings.voiceInput.language.ja')
      case 'ko': return t('settings.voiceInput.language.ko')
      case 'pt': return t('settings.voiceInput.language.pt')
      case 'ru': return t('settings.voiceInput.language.ru')
      case 'ar': return t('settings.voiceInput.language.ar')
      case 'hi': return t('settings.voiceInput.language.hi')
      case 'it': return t('settings.voiceInput.language.it')
      case 'nl': return t('settings.voiceInput.language.nl')
      case 'pl': return t('settings.voiceInput.language.pl')
      case 'tr': return t('settings.voiceInput.language.tr')
      case 'vi': return t('settings.voiceInput.language.vi')
      case 'th': return t('settings.voiceInput.language.th')
      default: return code
    }
  }

  const getModelDescription = (size: WhisperModelSize, fallback: string): string => {
    switch (size) {
      case 'tiny':
        return t('settings.voiceInput.modelDescription.tiny')
      case 'base':
        return t('settings.voiceInput.modelDescription.base')
      case 'small':
        return t('settings.voiceInput.modelDescription.small')
      case 'medium':
        return t('settings.voiceInput.modelDescription.medium')
      case 'turbo':
        return t('settings.voiceInput.modelDescription.turbo')
      default:
        return fallback
    }
  }

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
              <div className="message-indicator" style={{ background: 'var(--color-danger-500)' }}></div>
              <span className="message-label">{t('common.error')}</span>
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
                  <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.voiceInput.enable')}</label>
                  <p className="runtime-card-desc">
                    {t('settings.voiceInput.enableDescription')}
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
                      >{t('common.cancel')}</button>
                    </div>
                    <span className="runtime-card-desc" style={{ opacity: 0.65 }}>
                      {setupStep === 'addon'
                        ? t('settings.voiceInput.setupAddon')
                        : setupStep === 'model'
                          ? t('settings.voiceInput.setupModel')
                          : t('settings.voiceInput.settingUp')}
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
                <p className="runtime-card-desc" style={{ color: 'var(--color-danger-500)', marginTop: '4px' }}>
                  {enablingError}
                </p>
              )}
              {/* Dev-only: addon install status + delete */}
              {process.env.NODE_ENV === 'development' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(0,0,0,0.08)' }}>
                  <span className="runtime-card-desc" style={{ opacity: 0.6 }}>{t('settings.voiceInput.engineAddon')}</span>
                  <span className={`runtime-python-badge ${
                    addonStatus === 'downloaded' ? 'runtime-python-badge--installed' :
                    'runtime-python-badge--available'
                  }`} style={addonStatus === 'error' ? { color: 'var(--color-danger-500)' } : undefined}>{addonStatus}</span>
                  {addonStatus === 'downloaded' && (
                    <button
                      className="runtime-icon-btn"
                      onClick={onDeleteAddon}
                      title={t('settings.voiceInput.deleteAddonCache')}
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
                      <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.voiceInput.whisperModel')}</label>
                      <p className="runtime-card-desc">
                        {t('settings.voiceInput.whisperModelDescription')}
                      </p>
                    </div>
                  </div>

                  {/* Warning if no model downloaded */}
                  {!hasAnyModelDownloaded && (
                    <div className="runtime-loading-bar" style={{ color: 'var(--color-warning-700)', background: 'var(--color-warning-100)', border: '1px solid var(--color-warning-200)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertCircle size={14} style={{ flexShrink: 0 }} />
                      {t('settings.voiceInput.downloadModelWarning')}
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
                          {isDownloaded ? t('settings.voiceInput.downloaded') : t('settings.voiceInput.available')}
                        </span>

                        {/* Col 2: Model info */}
                        <div className="settings-model-info">
                          <span className="setting-label" style={{ fontWeight: 500 }}>
                            {info.size.charAt(0).toUpperCase() + info.size.slice(1)}
                            <span className="runtime-component-tag">{info.fileSizeDisplay}</span>
                          </span>
                          <span className="runtime-card-desc">{getModelDescription(info.size, info.description)}</span>
                        </div>

                        {/* Col 3: Actions (always 168px) */}
                        <div className="settings-model-actions">
                          {isDownloading ? (
                            <>
                              <div className="settings-model-progress-bar">
                                <div className="settings-model-progress-fill" style={{ width: `${downloadProgress.percent}%` }} />
                              </div>
                              <span className="runtime-pin-text">{downloadProgress.percent}%</span>
                              <button className="runtime-text-btn" onClick={() => onCancelDownload(info.size)}>{t('common.cancel')}</button>
                            </>
                          ) : isDownloaded ? (
                            <>
                              <label className="runtime-pin-label" title={t('settings.voiceInput.useThisModel')}>
                                <input
                                  type="radio"
                                  name="whisperModel"
                                  value={info.size}
                                  checked={isSelected}
                                  onChange={() => onSettingsChange({ ...settings, whisperModel: info.size })}
                                  className="runtime-radio"
                                />
                                <span className="runtime-pin-text">{t('settings.voiceInput.use')}</span>
                              </label>
                              <button
                                className="runtime-icon-btn"
                                onClick={() => onDeleteModel(info.size)}
                                title={t('settings.voiceInput.deleteModel')}
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
                              {t('settings.voiceInput.download')}
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
                      <label className="setting-label">{t('settings.voiceInput.language')}</label>
                      <p className="runtime-card-desc">{t('settings.voiceInput.languageDescription')}</p>
                    </div>
                    <div className="toolbar-select-wrapper">
                      <select
                        className="toolbar-select"
                        value={settings.language}
                        onChange={(e) => onSettingsChange({ ...settings, language: e.target.value })}
                      >
                        {SUPPORTED_LANGUAGES.map((code) => (
                          <option key={code} value={code}>{getLanguageLabel(code)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Card 3: GPU Acceleration ── */}
                <div className="toolbar-settings-card">
                  <div className="toolbar-setting-item">
                    <div className="setting-label-container">
                      <label className="setting-label">{t('settings.voiceInput.gpu')}</label>
                      <p className="runtime-card-desc">{t('settings.voiceInput.gpuDescription')}</p>
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
                        <label className="setting-label">{t('settings.voiceInput.translateToEnglish')}</label>
                        <p className="runtime-card-desc">{t('settings.voiceInput.translateDescription')}</p>
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
