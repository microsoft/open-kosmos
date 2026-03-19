'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import VoiceInputSettingsHeaderView from './VoiceInputSettingsHeaderView'
import VoiceInputSettingsContentView from './VoiceInputSettingsContentView'
import { useFeatureFlag } from '../../lib/featureFlags'
import '../../styles/VoiceInputSettingsView.css'

// Type definitions
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'turbo';

export interface VoiceInputSettings {
  whisperModel: WhisperModelSize
  language: string
  useGPU?: boolean
  translate?: boolean
}

export interface WhisperModelStatus {
  size: WhisperModelSize
  downloaded: boolean
  path?: string
  actualSize?: number
}

export interface WhisperModelInfo {
  size: WhisperModelSize
  fileName: string
  fileSize: number
  fileSizeDisplay: string
  downloadUrl: string
  description: string
}

export interface DownloadProgress {
  model: WhisperModelSize
  downloaded: number
  total: number
  percent: number
}

// IPC events use the registry key ('whisper-addon'), not the npm package name
const WHISPER_ADDON_MODULE_KEY = 'whisper-addon'

const VoiceInputSettingsView: React.FC = () => {
  // Voice Input controlled by feature flag
  const featureFlagEnabled = useFeatureFlag('kosmosFeatureVoiceInput')

  // ── State ──────────────────────────────────────────────────────────────────

  // App-level voice input master switch (stored in AppConfig / app.json)
  const [voiceInputEnabled, setVoiceInputEnabled] = useState(false)
  // True while setting up (downloading addon / base model) during a toggle-on activation
  const [isEnabling, setIsEnabling] = useState(false)
  // ref: lets IPC listeners detect whether we are in the enabling flow (avoids stale closures)
  const isEnablingRef = useRef(false)
  // Sequential setup step + single progress bar
  const [setupStep, setSetupStep] = useState<'addon' | 'model' | null>(null)
  const [setupProgress, setSetupProgress] = useState(0)
  const [enablingError, setEnablingError] = useState<string | undefined>(undefined)

  // Addon download status: ref for synchronous flow checks, state for UI display
  const addonStatusRef = useRef<'not-downloaded' | 'downloading' | 'downloaded' | 'error'>('not-downloaded')
  const [addonStatus, setAddonStatus] = useState<'not-downloaded' | 'downloading' | 'downloaded' | 'error'>('not-downloaded')

  // Whisper model / language / GPU settings
  const [settings, setSettings] = useState<VoiceInputSettings>({
    whisperModel: 'base',
    language: 'auto',
    useGPU: false,
    translate: false,
  })

  const [modelStatuses, setModelStatuses] = useState<WhisperModelStatus[]>([])
  const [modelInfos, setModelInfos] = useState<WhisperModelInfo[]>([])
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // If feature flag is disabled, redirect to settings page
  if (!featureFlagEnabled) {
    return <Navigate to="/settings" replace />
  }

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadAppConfig()
    loadModelStatus()
    loadModelInfo()
  }, [])

  // ── IPC listeners: Whisper model download ──────────────────────────────────

  useEffect(() => {
    const whisperApi = window.electronAPI.whisper
    if (!whisperApi) return

    const unsubProgress = whisperApi.onDownloadProgress?.((progress) => {
      setDownloadProgress(progress as DownloadProgress)
      // Update single progress bar when in model step
      if (isEnablingRef.current) {
        setSetupProgress((progress as DownloadProgress).percent ?? 0)
      }
    })
    const unsubComplete = whisperApi.onDownloadComplete?.(() => {
      setDownloadProgress(null)
      loadModelStatus()
    })
    const unsubError = whisperApi.onDownloadError?.((data: { model: string; error: string }) => {
      setDownloadProgress(null)
      setError(`Download failed: ${data.error}`)
    })
    const unsubCancelled = whisperApi.onDownloadCancelled?.(() => {
      setDownloadProgress(null)
    })

    return () => {
      unsubProgress?.()
      unsubComplete?.()
      unsubError?.()
      unsubCancelled?.()
    }
  }, [])

  // ── IPC listeners: native addon download progress (during enabling flow) ──

  useEffect(() => {
    const nm = (window as any).electronAPI?.nativeModule
    if (!nm) return

    const unsubProgress = nm.onDownloadProgress?.((data: any) => {
      if (data.packageName !== WHISPER_ADDON_MODULE_KEY) return
      addonStatusRef.current = 'downloading'
      setAddonStatus('downloading')
      // Update single progress bar when in addon step
      if (isEnablingRef.current) setSetupProgress(data.percent ?? 0)
    })
    const unsubComplete = nm.onDownloadComplete?.((data: any) => {
      if (data.packageName !== WHISPER_ADDON_MODULE_KEY) return
      addonStatusRef.current = 'downloaded'
      setAddonStatus('downloaded')
    })
    const unsubCancelled = nm.onDownloadCancelled?.((data: any) => {
      if (data.packageName !== WHISPER_ADDON_MODULE_KEY) return
      addonStatusRef.current = 'not-downloaded'
      setAddonStatus('not-downloaded')
    })
    const unsubError = nm.onDownloadError?.((data: any) => {
      if (data.packageName !== WHISPER_ADDON_MODULE_KEY) return
      addonStatusRef.current = 'error'
      setAddonStatus('error')
    })

    return () => {
      unsubProgress?.()
      unsubComplete?.()
      unsubCancelled?.()
      unsubError?.()
    }
  }, [])

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadAppConfig = async () => {
    try {
      const res = await window.electronAPI.appConfig?.getAppConfig()
      if (res?.success && res.data?.voiceInput) {
        const vc = res.data.voiceInput
        setVoiceInputEnabled(vc.voiceInputEnabled ?? false)
        // Map to legacy VoiceInputSettings shape for model/language/gpu cards
        setSettings({
          whisperModel: (vc.whisperModelSelected || 'base') as WhisperModelSize,
          language: vc.recognitionLanguage || 'auto',
          useGPU: vc.gpuAcceleration ?? false,
          translate: false,
        })
      }
      // Check if addon is already downloaded
      const nm = (window as any).electronAPI?.nativeModule
      if (nm) {
        const statusRes = await nm.getStatus(WHISPER_ADDON_MODULE_KEY)
        if (statusRes?.success && statusRes.data?.status) {
          addonStatusRef.current = statusRes.data.status
          setAddonStatus(statusRes.data.status)
        }
      }
    } catch (err) {
      console.error('[VoiceInputSettings] Failed to load app config:', err)
    }
  }

  const loadModelStatus = async () => {
    try {
      setLoading(true)
      const response = await window.electronAPI.whisper?.getAllModelStatus()
      if (response?.success && response.data) {
        setModelStatuses(response.data as WhisperModelStatus[])
      }
    } catch (err) {
      console.error('Failed to load model status:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadModelInfo = async () => {
    try {
      const response = await window.electronAPI.whisper?.getAllModelInfo()
      if (response?.success && response.data) {
        setModelInfos(response.data as WhisperModelInfo[])
      }
    } catch (err) {
      console.error('Failed to load model info:', err)
    }
  }

  // ── Settings save (model / language / GPU → AppConfig) ────────────────────

  const handleSettingsChange = useCallback(async (newSettings: VoiceInputSettings) => {
    setSettings(newSettings)
    try {
      setError(null)
      await window.electronAPI.voiceInput?.updateSettings(newSettings)
    } catch (err) {
      setError('Failed to save settings: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  // ── Master toggle ──────────────────────────────────────────────────────────

  const handleToggleVoiceInput = useCallback(async (enabled: boolean) => {
    setEnablingError(undefined)

    if (!enabled) {
      // OFF: just update config — no cleanup
      try {
        await window.electronAPI.appConfig?.updateAppConfig({ voiceInput: { voiceInputEnabled: false } })
        setVoiceInputEnabled(false)
      } catch (err) {
        setError('Failed to disable voice input: ' + String(err))
      }
      return
    }

    // === Enabling flow: run two setup tasks in parallel ===
    const nm = (window as any).electronAPI?.nativeModule
    const whisperApi = window.electronAPI.whisper

    // Snapshot initial states
    const addonAlreadyDone = addonStatusRef.current === 'downloaded'
    const configRes = await window.electronAPI.appConfig?.getAppConfig()
    const modelAlreadySelected = !!configRes?.data?.voiceInput?.whisperModelSelected

    // Fast path: both already ready
    if (addonAlreadyDone && modelAlreadySelected) {
      try {
        await window.electronAPI.appConfig?.updateAppConfig({ voiceInput: { voiceInputEnabled: true } })
        setVoiceInputEnabled(true)
      } catch (err) {
        setError('Failed to enable voice input: ' + String(err))
      }
      return
    }

    // Show setup UI
    setIsEnabling(true)
    isEnablingRef.current = true
    setSetupStep(null)
    setSetupProgress(0)

    // Helper: wrap whisper base model download in a Promise
    const downloadBaseModel = (): Promise<void> => new Promise((resolve, reject) => {
      if (!whisperApi) { reject(new Error('Whisper API not available')); return }
      whisperApi.downloadModel?.('base')
      const cleanup = () => { unsubC?.(); unsubE?.(); unsubX?.() }
      const unsubC = whisperApi.onDownloadComplete?.((data: any) => {
        if (data?.model !== 'base') return
        cleanup()
        window.electronAPI.voiceInput?.updateSettings({ whisperModel: 'base', language: 'auto' })
        setSettings(prev => ({ ...prev, whisperModel: 'base' }))
        window.electronAPI.whisper?.getAllModelStatus().then(r => {
          if (r?.success && r.data) setModelStatuses(r.data as WhisperModelStatus[])
        }).catch(() => {})
        resolve()
      })
      const unsubE = whisperApi.onDownloadError?.((data: any) => {
        if (data?.model !== 'base') return
        cleanup()
        reject(new Error(data.error))
      })
      const unsubX = whisperApi.onDownloadCancelled?.(() => {
        cleanup()
        reject(new DOMException('Cancelled', 'AbortError'))
      })
    })

    try {
      // ── Step 1: Ensure whisper engine addon ──────────────────────────────
      if (!addonAlreadyDone) {
        setSetupStep('addon')
        setSetupProgress(0)
        if (!nm) throw new Error('Native module API not available')
        const res = await nm.ensureDownloaded(WHISPER_ADDON_MODULE_KEY)
        if (res?.success) {
          addonStatusRef.current = 'downloaded'
          setAddonStatus('downloaded')
          setSetupProgress(100)
        }
      }

      // ── Step 2: Ensure base model downloaded and selected ────────────────
      if (!modelAlreadySelected) {
        setSetupStep('model')
        setSetupProgress(0)

        // Check if base model file is already on disk.
        // downloadModel() returns early without emitting whisper:downloadComplete when the
        // file exists, so we must handle that case explicitly to avoid hanging forever.
        const modelStatusRes = await window.electronAPI.whisper?.getAllModelStatus()
        const baseAlreadyOnDisk = !!(modelStatusRes?.success &&
          (modelStatusRes.data as WhisperModelStatus[])?.find((s) => s.size === 'base')?.downloaded)

        if (baseAlreadyOnDisk) {
          // Model file present but config not set — just persist the selection.
          await window.electronAPI.voiceInput?.updateSettings({ whisperModel: 'base', language: 'auto' })
          setSettings(prev => ({ ...prev, whisperModel: 'base' }))
          const r = await window.electronAPI.whisper?.getAllModelStatus()
          if (r?.success && r.data) setModelStatuses(r.data as WhisperModelStatus[])
        } else {
          await downloadBaseModel()
        }
        setSetupProgress(100)
      }

      // All steps done — enable voice input
      await window.electronAPI.appConfig?.updateAppConfig({ voiceInput: { voiceInputEnabled: true } })
      setVoiceInputEnabled(true)
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setEnablingError('Setup failed: ' + (err instanceof Error ? err.message : String(err)))
      }
    } finally {
      setIsEnabling(false)
      isEnablingRef.current = false
      setSetupStep(null)
      setSetupProgress(0)
    }
  }, [])

  const handleDeleteAddon = useCallback(async () => {
    const nm = (window as any).electronAPI?.nativeModule
    if (!nm) return
    try {
      const res = await nm.deleteModule(WHISPER_ADDON_MODULE_KEY)
      if (res?.success) {
        addonStatusRef.current = 'not-downloaded'
        setAddonStatus('not-downloaded')
        // Addon gone — disable voice input so the user must re-enable via setup flow
        await window.electronAPI.appConfig?.updateAppConfig({ voiceInput: { voiceInputEnabled: false } })
        setVoiceInputEnabled(false)
      }
    } catch (err) {
      console.error('Failed to delete addon:', err)
    }
  }, [])

  const handleCancelEnabling = useCallback(async () => {
    const nm = (window as any).electronAPI?.nativeModule
    try {
      await Promise.allSettled([
        nm?.cancelDownload(WHISPER_ADDON_MODULE_KEY),
        window.electronAPI.whisper?.cancelDownload('base'),
      ])
    } catch (err) {
      console.error('Failed to cancel enabling:', err)
    }
  }, [])

  // ── Whisper model download handlers ───────────────────────────────────────

  const handleDownloadModel = useCallback(async (size: WhisperModelSize) => {
    try {
      setError(null)
      await window.electronAPI.whisper?.downloadModel(size)
    } catch (err) {
      setError('Failed to start download: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  const handleDeleteModel = useCallback(async (size: WhisperModelSize) => {
    try {
      setError(null)
      const response = await window.electronAPI.whisper?.deleteModel(size)
      if (response?.success) {
        // If the deleted model was the selected one, clear the selection
        if (settings.whisperModel === size) {
          setSettings(prev => ({ ...prev, whisperModel: '' as WhisperModelSize }))
          await window.electronAPI.appConfig?.updateAppConfig({ voiceInput: { whisperModelSelected: '' } })
        }
        await loadModelStatus()
      } else {
        setError('Failed to delete model: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to delete model: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [settings.whisperModel])

  const handleCancelDownload = useCallback(async (size: WhisperModelSize) => {
    try {
      await window.electronAPI.whisper?.cancelDownload(size)
    } catch (err) {
      console.error('Failed to cancel download:', err)
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="voice-input-settings-view">
      <VoiceInputSettingsHeaderView />

      <VoiceInputSettingsContentView
        settings={settings}
        modelStatuses={modelStatuses}
        modelInfos={modelInfos}
        downloadProgress={downloadProgress}
        loading={loading}
        error={error}
        onSettingsChange={handleSettingsChange}
        onDownloadModel={handleDownloadModel}
        onDeleteModel={handleDeleteModel}
        onCancelDownload={handleCancelDownload}
        voiceInputEnabled={voiceInputEnabled}
        isEnabling={isEnabling}
        setupStep={setupStep}
        setupProgress={setupProgress}
        enablingError={enablingError}
        onToggleVoiceInput={handleToggleVoiceInput}
        onCancelEnabling={handleCancelEnabling}
        addonStatus={addonStatus}
        onDeleteAddon={handleDeleteAddon}
      />
    </div>
  )
}

export default VoiceInputSettingsView
