'use client'

import React from 'react'
import { Badge } from '../ui/badge'
import '../../styles/Header.css'

interface PluginHeaderViewProps {
  totalPlugins: number
  enabledPlugins: number
  onAddClick: () => void
}

const PluginIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.5 2C13.5 2 14 3 14 4C14 5.10457 13.1046 6 12 6C10.8954 6 10 5.10457 10 4C10 3 10.5 2 10.5 2H7C5.89543 2 5 2.89543 5 4V8.5C5 8.5 6 8 7 8C8.10457 8 9 8.89543 9 10C9 11.1046 8.10457 12 7 12C6 12 5 11.5 5 11.5V16C5 17.1046 5.89543 18 7 18H11.5C11.5 18 11 19 11 20C11 21.1046 11.8954 22 13 22C14.1046 22 15 21.1046 15 20C15 19 14.5 18 14.5 18H18C19.1046 18 20 17.1046 20 16V11.5C20 11.5 19 12 18 12C16.8954 12 16 11.1046 16 10C16 8.89543 16.8954 8 18 8C19 8 20 8.5 20 8.5V4C20 2.89543 19.1046 2 18 2H13.5Z" stroke="#272320" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const PluginHeaderView: React.FC<PluginHeaderViewProps> = ({
  totalPlugins,
  enabledPlugins,
  onAddClick,
}) => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <PluginIcon />
        <span className="header-name">Plugins</span>
        <div className="mcp-status-badges">
          <Badge variant="normal" className="text-xs">
            {enabledPlugins} / {totalPlugins} enabled
          </Badge>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="btn-action"
          onClick={onAddClick}
          title="Install Plugin from Folder"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="#272320"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default PluginHeaderView
