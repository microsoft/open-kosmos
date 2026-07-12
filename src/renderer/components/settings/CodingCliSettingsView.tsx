'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../ui/ToastProvider'
import { codingCliApi } from '../../ipc/codingCli'
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager'
import type { CodingCliId, CodingCliAvailability } from '@shared/types/codingCli'
import CodingCliSettingsHeaderView from './CodingCliSettingsHeaderView'
import CodingCliSettingsContentView from './CodingCliSettingsContentView'
import '../../styles/RuntimeSettings.css'
import { createLogger } from '../../lib/utilities/logger'
import { useI18n } from '../../lib/i18n/useI18n'

const logger = createLogger('[CodingCliSettingsView]')

/**
 * Coding CLI Settings View (profile-level).
 *
 * Lets the user pick which coding CLI the `coding_agent` built-in tool drives. OpenKosmos only detects
 * availability and invokes the chosen CLI; it never installs or updates them. When a CLI is not
 * found on PATH, the install command is shown for the user to run themselves.
 */
const CodingCliSettingsView: React.FC = () => {
  const { showSuccess, showError } = useToast()
  const { t } = useI18n()
  const tRef = useRef(t)

  const [selectedCli, setSelectedCli] = useState<CodingCliId>('claude')
  const [enabled, setEnabled] = useState(false)
  const [availability, setAvailability] = useState<CodingCliAvailability[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDetecting, setIsDetecting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    tRef.current = t
  }, [t])

  const loadAvailability = useCallback(async () => {
    setIsDetecting(true)
    try {
      const response = await codingCliApi.detectAvailability()
      if (response?.success && response.data) {
        setAvailability(response.data.clis)
      } else {
        showError(tRef.current('settings.codingCli.detectFailed', {
          error: response?.success === false ? response.error : tRef.current('common.unknownError'),
        }))
      }
    } catch (err) {
      logger.error('detectAvailability failed', err)
      showError(tRef.current('settings.codingCli.detectFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsDetecting(false)
    }
  }, [showError])

  const loadSettings = useCallback(async () => {
    try {
      const response = await codingCliApi.getSettings()
      if (response?.success && response.data) {
        setSelectedCli(response.data.cli)
        setEnabled(response.data.enabled)
      }
    } catch (err) {
      logger.error('getSettings failed', err)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await Promise.all([loadSettings(), loadAvailability()])
      setIsLoading(false)
    })()
  }, [loadSettings, loadAvailability])

  const handleSelect = useCallback(async (cli: CodingCliId) => {
    if (cli === selectedCli || isSaving) return
    const previous = selectedCli
    setSelectedCli(cli)
    setIsSaving(true)
    try {
      const response = await codingCliApi.updateSettings({ cli })
      if (response?.success) {
        showSuccess(t('settings.codingCli.setTo', { cli }))
      } else {
        setSelectedCli(previous)
        showError(t('settings.common.saveFailed', { error: response?.success === false ? response.error : t('common.unknownError') }))
      }
    } catch (err) {
      setSelectedCli(previous)
      logger.error('updateSettings failed', err)
      showError(t('settings.common.saveFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsSaving(false)
    }
  }, [selectedCli, isSaving, showSuccess, showError, t])

  const handleToggle = useCallback(async (next: boolean) => {
    if (isSaving) return
    const previous = enabled
    setEnabled(next)
    setIsSaving(true)
    try {
      const response = await codingCliApi.updateSettings({ enabled: next })
      if (response?.success) {
        // Refresh the renderer MCP cache so the Agent tool list reflects the
        // coding_agent tool appearing/disappearing without a chat switch
        // (mirrors the profile-level Hooks master switch).
        void mcpClientCacheManager.refresh()
        showSuccess(next ? t('settings.codingCli.enabled') : t('settings.codingCli.disabled'))
      } else {
        setEnabled(previous)
        showError(t('settings.common.saveFailed', { error: response?.success === false ? response.error : t('common.unknownError') }))
      }
    } catch (err) {
      setEnabled(previous)
      logger.error('updateSettings(enabled) failed', err)
      showError(t('settings.common.saveFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsSaving(false)
    }
  }, [enabled, isSaving, showSuccess, showError, t])

  return (
    <div className="runtime-settings-view">
      <CodingCliSettingsHeaderView enabled={enabled} onRedetect={loadAvailability} isDetecting={isDetecting} />
      <CodingCliSettingsContentView
        enabled={enabled}
        clis={availability}
        selectedCli={selectedCli}
        isLoading={isLoading}
        isSaving={isSaving}
        onToggle={handleToggle}
        onSelect={handleSelect}
      />
    </div>
  )
}

export default CodingCliSettingsView
