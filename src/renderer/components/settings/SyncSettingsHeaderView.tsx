'use client'

import React from 'react'
import '../../styles/Header.css'
import { useI18n } from '../../lib/i18n/useI18n'

// Sync Icon - arrows up and down
const SyncIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 16L7 4M7 4L3 8M7 4L11 8" stroke="var(--color-warm-900)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M17 8L17 20M17 20L21 16M17 20L13 16" stroke="var(--color-warm-900)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const SyncSettingsHeaderView: React.FC = () => {
  const { t } = useI18n()
  return (
    <div className="unified-header">
      <div className="header-title">
        <SyncIcon />
        <span className="header-name">{t('settings.navigation.sync')}</span>
      </div>

    </div>
  )
}

export default SyncSettingsHeaderView
