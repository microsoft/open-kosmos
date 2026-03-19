'use client'

import React from 'react'
import { ExperimentTag } from '../ui/ExperimentTag'
import '../../styles/Header.css'

const VoiceInputIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C10.3431 2 9 3.34315 9 5V12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12V5C15 3.34315 13.6569 2 12 2ZM7 12C7 14.7614 9.23858 17 12 17C14.7614 17 17 14.7614 17 12H19C19 15.6565 16.4003 18.7087 13 19.3V22H11V19.3C7.59968 18.7087 5 15.6565 5 12H7Z" fill="#272320"/>
  </svg>
)

const VoiceInputSettingsHeaderView: React.FC = () => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <VoiceInputIcon />
        <span className="header-name">Voice Input</span>
        <ExperimentTag size="normal" />
      </div>
    </div>
  )
}

export default VoiceInputSettingsHeaderView
