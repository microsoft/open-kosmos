'use client'

import React from 'react'
import { Wrench, Loader2, ChevronRight } from 'lucide-react'

import '../../styles/McpToolListView.css';
import { MCPTool } from '../../types/mcpTypes'

interface McpToolListViewProps {
  tools: MCPTool[]
  selectedTool: MCPTool | null
  onSelectTool: (tool: MCPTool) => void
  isLoading?: boolean
}

const McpToolListView: React.FC<McpToolListViewProps> = ({
  tools,
  selectedTool,
  onSelectTool,
  isLoading = false
}) => {
  return (
    <div className="mcp-tool-list-view">
      <div className="tool-list-content">
        {isLoading ? (
          <div className="loading-state">
            <Loader2 className="spinner" size={24} />
            <p>Loading tools...</p>
          </div>
        ) : tools.length === 0 ? (
          <div className="empty-state">
            <Wrench className="empty-icon" size={48} />
            <p>No tools available</p>
          </div>
        ) : (
          <div className="tools-list">
            {tools.map((tool, index) => (
              <div
                key={`${tool.serverId}-${tool.name}-${index}`}
                className={`tool-item ${selectedTool?.name === tool.name ? 'selected' : ''}`}
                onClick={() => onSelectTool(tool)}
              >
                <div className="tool-item-content">
                  <div className="tool-item-header">
                    <Wrench className="tool-item-icon" size={20} />
                    <div className="tool-item-name">{tool.name}</div>
                  </div>
                </div>
                <div className="tool-item-explore-icon">
                  <ChevronRight size={20} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      </div>
  )
}

export default McpToolListView