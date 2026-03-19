'use client'

import React, { useState, useEffect, useCallback } from 'react'
import ScreenshotSettingsHeaderView from './ScreenshotSettingsHeaderView'
import ScreenshotSettingsContentView from './ScreenshotSettingsContentView'
import { screenshotApi } from '../../ipc/screenshot-main'
import type { ScreenshotSettings } from '@shared/ipc/screenshot'
import '../../styles/ScreenshotSettingsView.css'

const ScreenshotSettingsView: React.FC = () => {
  const [settings, setSettings] = useState<ScreenshotSettings>({
    enabled: true,
    shortcut: 'CommandOrControl+Shift+S',
    shortcutEnabled: false,
    savePath: '',
    freRejected: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await screenshotApi.getSettings()
      if (response?.success && response.data) {
        setSettings(response.data)
      } else {
        setError('Failed to load screenshot settings: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to load screenshot settings: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const saveSettings = useCallback(async (newSettings: ScreenshotSettings) => {
    try {
      setError(null)
      const response = await screenshotApi.updateSettings(newSettings)
      if (!response?.success) {
        setError('Failed to save settings: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to save settings: ' + (err instanceof Error ? err.message : String(err)))
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
      setError('Failed to select save path: ' + (err instanceof Error ? err.message : String(err)))
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
