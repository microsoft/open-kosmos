'use client'

import React from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/Header.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface AddNewMcpServerViewHeaderProps {
  onBack?: () => void
  editServerName?: string
}

const AddNewMcpServerViewHeader: React.FC<AddNewMcpServerViewHeaderProps> = ({
  onBack,
  editServerName
}) => {
  const navigate = useNavigate()
  const { t } = useI18n()

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      // Default behavior: navigate back to settings/mcp
      navigate('/settings/mcp')
    }
  }

  // Show different title based on whether in edit mode
  const isEditMode = !!editServerName
  const title = isEditMode ? t('mcp.form.editServerTitle') : t('mcp.form.addNewServerTitle')

  return (
    <div className="unified-header">
      <div className="header-title">
        <button
          className="btn-action"
          onClick={handleBack}
          title={t('common.back')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="var(--color-warm-900)"/>
          </svg>
        </button>
        <span className="header-name">{title}</span>
      </div>
      <div className="header-actions">
        {/* Additional action buttons can be added here on the right side */}
      </div>
    </div>
  )
}

export default AddNewMcpServerViewHeader