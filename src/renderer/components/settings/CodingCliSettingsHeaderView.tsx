'use client'

import React from 'react'
import { Code2 } from 'lucide-react'
import '../../styles/Header.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface CodingCliSettingsHeaderViewProps {
  enabled: boolean
  onRedetect: () => void
  isDetecting: boolean
}

/**
 * Header for the Coding CLI settings page. Mirrors the unified settings header
 * (RuntimeSettings, Screenshot, etc.): title on the left, a single icon action
 * button on the right that re-runs CLI availability detection. The re-detect
 * action is only shown while the feature is enabled (it acts on the CLI list,
 * which is hidden when the master switch is off).
 */
const CodingCliSettingsHeaderView: React.FC<CodingCliSettingsHeaderViewProps> = ({
  enabled,
  onRedetect,
  isDetecting,
}) => {
  const { t } = useI18n()
  return (
    <div className="unified-header">
      <div className="header-title">
        <Code2 size={24} />
        <span className="header-name">{t('settings.navigation.codingCli')}</span>
      </div>
      <div className="header-actions">
        {enabled && (
        <button
          className="btn-action"
          onClick={onRedetect}
          disabled={isDetecting}
          title={t('settings.codingCli.redetect')}
          aria-label={t('settings.codingCli.redetect')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={isDetecting ? 'animate-spin' : ''}>
            <path d="M12 4.5C7.85786 4.5 4.5 7.85786 4.5 12C4.5 16.1421 7.85786 19.5 12 19.5C16.1421 19.5 19.5 16.1421 19.5 12C19.5 11.6236 19.4723 11.2538 19.4188 10.8923C19.3515 10.4382 19.6839 10 20.1429 10C20.5138 10 20.839 10.2562 20.8953 10.6228C20.9642 11.0718 21 11.5317 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.3051 3 16.4077 3.86656 18 5.29168V4.25C18 3.83579 18.3358 3.5 18.75 3.5C19.1642 3.5 19.5 3.83579 19.5 4.25V7.25C19.5 7.66421 19.1642 8 18.75 8H15.75C15.3358 8 15 7.66421 15 7.25C15 6.83579 15.3358 6.5 15.75 6.5H17.0991C15.7609 5.25883 13.9691 4.5 12 4.5Z" fill="var(--color-warm-900)"/>
          </svg>
        </button>
        )}
      </div>
    </div>
  )
}

export default CodingCliSettingsHeaderView
