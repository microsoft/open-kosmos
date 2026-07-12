'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import ComputerUseSettingsHeaderView from './ComputerUseSettingsHeaderView'
import ComputerUseSettingsContentView from './ComputerUseSettingsContentView'
import { useProfileData } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager'
import { useI18n } from '../../lib/i18n/useI18n'

/** OS permission snapshot surfaced from the main process for the Settings UI. */
interface ComputerUsePermissions {
  screenRecording: string
  accessibility: boolean
  platformSupported?: boolean
  unsupportedReason?: string
}

const ComputerUseSettingsView: React.FC = () => {
  const profileData = useProfileData()
  const currentAlias = profileData?.data.profile?.alias || null
  const computerUse = profileData?.data.profile?.computerUse
  const enabled = computerUse?.enabled === true
  const requireConfirmation = computerUse?.requireConfirmation !== false
  const alwaysAllowedApps = computerUse?.alwaysAllowedApps ?? []
  // Mirror the persisted allowlist in a ref so add/remove handlers build each edit on the latest
  // intended value (updated synchronously in the handlers) rather than the async profile-cache
  // snapshot, which only refreshes a render AFTER the IPC write resolves. Without this, two quick
  // edits start from the same stale base and the second overwrites the first (add Chrome then
  // Firefox would persist only Firefox). Re-sync the ref only when the persisted CONTENTS change:
  // `?? []` produces a fresh array every render, so a content-equal snapshot on an unrelated
  // re-render (e.g. setError during an in-flight persist) must NOT reset an edit in progress, while
  // a real change (async profile load, external edit, post-persist refresh) MUST update the ref.
  const allowlistRef = useRef<string[]>(alwaysAllowedApps)
  const lastAllowlistSignature = useRef<string>(alwaysAllowedApps.join('\u0000'))
  const allowlistQueueRef = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const signature = alwaysAllowedApps.join('\u0000')
    if (signature !== lastAllowlistSignature.current) {
      lastAllowlistSignature.current = signature
      allowlistRef.current = alwaysAllowedApps
    }
  }, [alwaysAllowedApps])
  const [error, setError] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null)
  const platformSupported = permissions?.platformSupported !== false
  const unsupportedReason = permissions?.unsupportedReason ?? null
  const { showSuccess, showError } = useToast()
  const { t } = useI18n()

  const persist = useCallback(
    async (settings: Record<string, unknown>, successMessage: string): Promise<boolean> => {
      setError(null)

      if (!currentAlias) {
        const errMsg = t('settings.browser.noSignedInUser')
        const message = t('settings.common.updateFailed', { error: errMsg })
        setError(message)
        showError(message)
        return false
      }

      try {
        const result = await window.electronAPI.profile.updateComputerUseSettings(
          currentAlias,
          settings,
        )

        if (result.success) {
          showSuccess(successMessage)
          return true
        }
        const errMsg = result.error || t('common.unknownError')
        const message = t('settings.common.updateFailed', { error: errMsg })
        setError(message)
        showError(message)
        return false
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const message = t('settings.common.updateFailed', { error: errMsg })
        setError(message)
        showError(message)
        return false
      }
    },
    [currentAlias, showSuccess, showError, t],
  )

  // Read the current OS permission status for the Settings surface. `prompt: true`
  // additionally triggers the macOS Accessibility system dialog and deep-links to the
  // Screen Recording pane (handled in the main process) so the user can grant access.
  const refreshPermissions = useCallback(async (prompt: boolean) => {
    try {
      const res = await window.electronAPI.profile.getComputerUseStatus(prompt)
      if (res?.success && res.status) {
        setPermissions(res.status)
      }
    } catch {
      // Best-effort: a status read failure must not break the Settings view.
    }
  }, [])

  useEffect(() => {
    void refreshPermissions(false)
  }, [refreshPermissions])

  const handleGrantPermissions = useCallback(() => {
    void refreshPermissions(true)
  }, [refreshPermissions])

  const handleToggle = useCallback(
    async (value: boolean) => {
      if (value && !platformSupported) {
        const errMsg = unsupportedReason || t('settings.computerUse.unavailablePlatform')
        const message = t('settings.common.updateFailed', { error: errMsg })
        setError(message)
        showError(message)
        return
      }
      const ok = await persist(
        { enabled: value },
        value ? t('settings.computerUse.enabledToast') : t('settings.computerUse.disabledToast'),
      )
      if (ok) {
        // Re-advertise/hide the computer_use builtin tool in the renderer's MCP cache so
        // the Agent tool list reflects the master switch without a chat switch (mirrors
        // the coding_agent / Hooks master switches).
        void mcpClientCacheManager.refresh()
      }
    },
    [persist, platformSupported, showError, unsupportedReason, t],
  )

  const handleToggleRequireConfirmation = useCallback(
    (value: boolean) =>
      persist(
        { requireConfirmation: value },
        value ? t('settings.computerUse.confirmationRequiredToast') : t('settings.computerUse.confirmationRelaxedToast'),
      ),
    [persist, t],
  )

  const handleAddApp = useCallback(
    (app: string) => {
      const trimmed = app.trim()
      if (trimmed.length === 0) return
      const run = allowlistQueueRef.current.then(async () => {
        // Dedupe using the same shape the confirmation gate normalizes to (trim, lowercase,
        // drop a trailing `.exe`) so "Chrome", "chrome", and "chrome.exe" can't all be added.
        const normalize = (value: string) => value.trim().toLowerCase().replace(/\.exe$/, '')
        const key = normalize(trimmed)
        const current = allowlistRef.current
        if (current.some((existing) => normalize(existing) === key)) return
        const next = [...current, trimmed]
        allowlistRef.current = next
        const ok = await persist({ alwaysAllowedApps: next }, t('settings.computerUse.addedAppToast', { app: trimmed }))
        if (!ok) {
          allowlistRef.current = current
        }
      })
      allowlistQueueRef.current = run
      return run
    },
    [persist, t],
  )

  const handleRemoveApp = useCallback(
    (app: string) => {
      const run = allowlistQueueRef.current.then(async () => {
        const current = allowlistRef.current
        const next = current.filter((a) => a !== app)
        allowlistRef.current = next
        const ok = await persist({ alwaysAllowedApps: next }, t('settings.computerUse.removedAppToast', { app }))
        if (!ok) {
          allowlistRef.current = current
        }
      })
      allowlistQueueRef.current = run
      return run
    },
    [persist, t],
  )

  return (
    <div className="runtime-settings-view">
      <ComputerUseSettingsHeaderView />
      <ComputerUseSettingsContentView
        enabled={platformSupported && enabled}
        requireConfirmation={requireConfirmation}
        alwaysAllowedApps={alwaysAllowedApps}
        permissions={permissions}
        error={error}
        platformSupported={platformSupported}
        unsupportedReason={unsupportedReason}
        onToggle={handleToggle}
        onToggleRequireConfirmation={handleToggleRequireConfirmation}
        onAddApp={handleAddApp}
        onRemoveApp={handleRemoveApp}
        onGrantPermissions={handleGrantPermissions}
      />
    </div>
  )
}

export default ComputerUseSettingsView
