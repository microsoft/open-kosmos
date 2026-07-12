'use client'

import React from 'react'
import { Camera } from 'lucide-react'
import '../../styles/Header.css'
import { useI18n } from '../../lib/i18n/useI18n'

const ScreenshotSettingsHeaderView: React.FC = () => {
  const { t } = useI18n()
  return (
    <div className="unified-header">
      <div className="header-title">
        <Camera size={20} />
        <span className="header-name">{t('settings.navigation.screenshot')}</span>
      </div>
    </div>
  )
}

export default ScreenshotSettingsHeaderView
