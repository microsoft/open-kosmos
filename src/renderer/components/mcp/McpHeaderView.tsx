'use client'

import React from 'react'
import { Badge } from '../ui/badge'
import '../../styles/Header.css'

interface McpHeaderViewProps {
  totalServers: number
  connectedServers: number
  totalTools: number
  onAddMenuToggle: (buttonElement: HTMLElement) => void
}

const McpHeaderView: React.FC<McpHeaderViewProps> = ({
  totalServers,
  connectedServers,
  totalTools,
  onAddMenuToggle
}) => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <svg className="header-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19.4899 5.57084C20.2797 6.58684 20.75 7.8635 20.75 9.25001C20.75 11.5333 19.4746 13.5187 17.5974 14.5327C16.9482 14.8833 16.1672 14.6672 15.6455 14.1455L9.8545 8.35451C9.3328 7.8328 9.11672 7.05181 9.46735 6.40265C10.4813 4.52541 12.4667 3.25001 14.75 3.25001C16.1366 3.25001 17.4133 3.72034 18.4293 4.51016L20.7198 2.21967C21.0127 1.92678 21.4876 1.92678 21.7805 2.21967C22.0733 2.51256 22.0733 2.98744 21.7805 3.28033L19.4899 5.57084ZM17.4733 12.8331C18.5535 12.0106 19.25 10.7106 19.25 9.25001C19.25 6.76473 17.2353 4.75001 14.75 4.75001C13.2894 4.75001 11.9894 5.44648 11.1669 6.52671C10.901 6.87593 10.9813 7.35998 11.2917 7.67036L16.3297 12.7083C16.64 13.0187 17.1241 13.0991 17.4733 12.8331ZM3.28045 21.7803L5.57085 19.4899C6.58685 20.2797 7.86351 20.75 9.25001 20.75C11.5333 20.75 13.5187 19.4746 14.5327 17.5973C14.8833 16.9482 14.6672 16.1672 14.1455 15.6455L8.3545 9.85448C7.8328 9.33278 7.0518 9.1167 6.40265 9.46733C4.5254 10.4813 3.25001 12.4667 3.25001 14.75C3.25001 16.1366 3.72034 17.4133 4.51017 18.4293L2.21979 20.7197C1.9269 21.0126 1.9269 21.4874 2.21979 21.7803C2.51269 22.0732 2.98756 22.0732 3.28045 21.7803ZM7.67035 11.2917L12.7083 16.3296C13.0187 16.64 13.0991 17.1241 12.8331 17.4733C12.0106 18.5535 10.7106 19.25 9.25001 19.25C6.76473 19.25 4.75001 17.2353 4.75001 14.75C4.75001 13.2894 5.44648 11.9894 6.52671 11.1669C6.87593 10.9009 7.35997 10.9813 7.67035 11.2917Z" fill="#272320"/>
        </svg>
        <span className="header-name">MCP Connector</span>
        <div className="mcp-status-badges">
          <Badge
            variant="normal"
            className="text-xs"
          >
            total servers: {totalServers}
          </Badge>
          <Badge
            variant="normal"
            className="text-xs"
          >
            connected: {connectedServers}
          </Badge>
          <Badge
            variant="normal"
            className="text-xs"
          >
            available tools: {totalTools}
          </Badge>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="btn-action"
          onClick={(e) => onAddMenuToggle(e.currentTarget)}
          title="Add MCP Server"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="#272320"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default McpHeaderView