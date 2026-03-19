'use client'

import React from 'react'
import { Camera } from 'lucide-react'
import '../../styles/Header.css'

const ScreenshotSettingsHeaderView: React.FC = () => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <Camera size={20} />
        <span className="header-name">Screenshot</span>
      </div>
    </div>
  )
}

export default ScreenshotSettingsHeaderView
