'use client'

import React from 'react'
import { MonitorCog } from 'lucide-react'
import '../../styles/Header.css'
import { useI18n } from '../../lib/i18n/useI18n'

const ComputerUseSettingsHeaderView: React.FC = () => {
  const { t } = useI18n()
  return (
    <div className="unified-header">
      <div className="header-title">
        <MonitorCog size={20} />
        <span className="header-name">{t('settings.navigation.computerUse')}</span>
      </div>
    </div>
  )
}

export default ComputerUseSettingsHeaderView
