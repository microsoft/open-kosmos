'use client'

import React from 'react'
import { Globe } from 'lucide-react'
import '../../styles/Header.css'
import { useI18n } from '../../lib/i18n/useI18n'

const BrowserSettingsHeaderView: React.FC = () => {
  const { t } = useI18n()
  return (
    <div className="unified-header">
      <div className="header-title">
        <Globe size={20} />
        <span className="header-name">{t('settings.navigation.browser')}</span>
      </div>
    </div>
  )
}

export default BrowserSettingsHeaderView
