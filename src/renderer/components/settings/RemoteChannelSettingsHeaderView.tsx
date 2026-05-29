'use client'

import React from 'react'
import { Globe } from 'lucide-react'
import '../../styles/Header.css'

const RemoteChannelSettingsHeaderView: React.FC = () => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <Globe size={20} />
        <span className="header-name">Remote Channel</span>
      </div>
    </div>
  )
}

export default RemoteChannelSettingsHeaderView
