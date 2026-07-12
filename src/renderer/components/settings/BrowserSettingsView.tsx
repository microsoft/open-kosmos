'use client'

import React, { useState, useCallback } from 'react'
import BrowserSettingsHeaderView from './BrowserSettingsHeaderView'
import BrowserSettingsContentView from './BrowserSettingsContentView'
import { useProfileData } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { useI18n } from '../../lib/i18n/useI18n'

const BrowserSettingsView: React.FC = () => {
  const profileData = useProfileData()
  const currentAlias = profileData?.data.profile?.alias || null
  const enabled = profileData?.data.profile?.browser?.enabled === true
  const [error, setError] = useState<string | null>(null)
  const { showSuccess, showError } = useToast()
  const { t } = useI18n()

  const handleToggle = useCallback(async (value: boolean) => {
    setError(null)

    if (!currentAlias) {
      const errMsg = t('settings.browser.noSignedInUser')
      const message = t('settings.browser.updateFailed', { error: errMsg })
      setError(message)
      showError(message)
      return
    }

    try {
      const result = await window.electronAPI.profile.updateBrowserSettings(currentAlias, {
        enabled: value,
      })

      if (result.success) {
        showSuccess(
          value ? t('settings.browser.enabledToast') : t('settings.browser.disabledToast')
        )
      } else {
        const errMsg = result.error || 'Unknown error'
        const message = t('settings.browser.updateFailed', { error: errMsg })
        setError(message)
        showError(message)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const message = t('settings.browser.updateFailed', { error: errMsg })
      setError(message)
      showError(message)
    }
  }, [currentAlias, showSuccess, showError, t])

  return (
    <div className="runtime-settings-view">
      <BrowserSettingsHeaderView />
      <BrowserSettingsContentView
        enabled={enabled}
        error={error}
        onToggle={handleToggle}
      />
    </div>
  )
}

export default BrowserSettingsView
