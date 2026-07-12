'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import ScreenshotSettingsHeaderView from './ScreenshotSettingsHeaderView'
import ScreenshotSettingsContentView from './ScreenshotSettingsContentView'
import { screenshotApi } from '../../ipc/screenshot-main'
import type { ScreenshotSettings } from '@shared/ipc/screenshot'
import { useI18n } from '../../lib/i18n/useI18n'
import '../../styles/ScreenshotSettingsView.css'

const ScreenshotSettingsView: React.FC = () => {
  const { t } = useI18n()
  const tRef = useRef(t)
  const [settings, setSettings] = useState<ScreenshotSettings>({
    enabled: true,
    shortcut: 'CommandOrControl+Shift+S',
    shortcutEnabled: false,
    savePath: '',
    freRejected: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    tRef.current = t
  }, [t])

  const loadSettings = useCallback(async () => {
    try {
      const response = await screenshotApi.getSettings()
      if (response?.success && response.data) {
        setSettings(response.data)
      } else {
        setError(tRef.current('settings.screenshot.loadFailed', {
          error: response?.error || tRef.current('common.unknownError'),
        }))
      }
    } catch (err) {
      setError(tRef.current('settings.screenshot.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const saveSettings = useCallback(async (newSettings: ScreenshotSettings) => {
    try {
      setError(null)
      const response = await screenshotApi.updateSettings(newSettings)
      if (!response?.success) {
        setError(tRef.current('settings.screenshot.saveFailed', {
          error: response?.error || tRef.current('common.unknownError'),
        }))
      }
    } catch (err) {
      setError(tRef.current('settings.screenshot.saveFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }, [])

  const handleSettingsChange = useCallback(async (newSettings: ScreenshotSettings) => {
    setSettings(newSettings)
    await saveSettings(newSettings)
  }, [saveSettings])

  const handleShortcutChange = async (newShortcut: string) => {
    if (!newShortcut.trim()) return
    const newSettings = { ...settings, shortcut: newShortcut }
    setSettings(newSettings)
    await saveSettings(newSettings)
  }

  const handleSelectSavePath = async () => {
    try {
      const response = await screenshotApi.selectSavePath()
      if (response?.success && response.data) {
        const newSettings = { ...settings, savePath: response.data }
        setSettings(newSettings)
        await saveSettings(newSettings)
      }
    } catch (err) {
      setError(t('settings.screenshot.selectSavePathFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  const handleResetSavePath = async () => {
    const newSettings = { ...settings, savePath: '' }
    setSettings(newSettings)
    await saveSettings(newSettings)
  }

  return (
    <div className="screenshot-settings-view">
      <ScreenshotSettingsHeaderView />
      <ScreenshotSettingsContentView
        settings={settings}
        error={error}
        onSettingsChange={handleSettingsChange}
        onShortcutChange={handleShortcutChange}
        onSelectSavePath={handleSelectSavePath}
        onResetSavePath={handleResetSavePath}
      />
    </div>
  )
}

export default ScreenshotSettingsView
