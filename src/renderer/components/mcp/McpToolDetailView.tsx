'use client'

import React from 'react'

import '../../styles/McpToolDetailView.css';
import { MCPTool } from '../../types/mcpTypes'

interface McpToolDetailViewProps {
  tool: MCPTool | null
  serverName?: string
  onBack?: () => void
}

const McpToolDetailView: React.FC<McpToolDetailViewProps> = ({ tool, serverName, onBack }) => {
  const formatInputSchema = (schema: any) => {
    if (!schema || typeof schema !== 'object') {
      return 'N/A'
    }

    try {
      return JSON.stringify(schema, null, 2)
    } catch {
      return String(schema)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
    }
  }

  const handleCopySchema = () => {
    if (tool) {
      const schemaText = formatInputSchema(tool.inputSchema)
      copyToClipboard(schemaText)
    }
  }

  const handleCopyToolInfo = () => {
    if (tool) {
      const toolInfo = `Tool: ${tool.name}\nDescription: ${tool.description}\n${serverName ? `Server: ${serverName}\n` : ''}\nInput Schema:\n${formatInputSchema(tool.inputSchema)}`
      copyToClipboard(toolInfo)
    }
  }

  if (!tool) {
    return (
      <div className="mcp-tool-detail-view">
        <div className="no-selection-state">
          <div className="no-selection-icon">🔧</div>
          <h3>Select a Tool</h3>
          <p>Choose a tool from the list to view detailed information</p>
        </div>

        </div>
    )
  }

  return (
    <div className="mcp-tool-detail-view">
      {/* Tool Header */}
      <div className="tool-detail-header">
        <div className="tool-header-info">
          {onBack && (
            <button
              onClick={onBack}
              className="back-btn"
              title="Back to tool list"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.3544 15.8529C12.1594 16.0485 11.8429 16.0491 11.6472 15.8542L6.16276 10.3892C5.94705 10.1743 5.94705 9.82495 6.16276 9.61L11.6472 4.14502C11.8429 3.95011 12.1594 3.95067 12.3544 4.14628C12.5493 4.34189 12.5487 4.65848 12.3531 4.85339L7.18851 9.99961L12.3531 15.1458C12.5487 15.3407 12.5493 15.6573 12.3544 15.8529Z" fill="#272320"/>
              </svg>
            </button>
          )}
          <div className="tool-header-text">
            <h2 className="tool-title">{tool.name}</h2>
          </div>
        </div>
      </div>

      {/* Tool Content */}
      <div className="tool-detail-content">
        {/* Description Section */}
        <div className="detail-section">
          <h3 className="section-title">Description</h3>
          <div className="section-content">
            <p className="tool-description-text">
              {tool.description || 'No description available'}
            </p>
          </div>
        </div>

        {/* Input Schema Section */}
        <div className="detail-section">
          <h3 className="section-title">Input Schema</h3>
          <div className="section-content">
            <pre className="schema-code">
              <code>{formatInputSchema(tool.inputSchema)}</code>
            </pre>
          </div>
        </div>

        {/* Tool Properties */}
        <div className="detail-section">
          <h3 className="section-title">Tool Properties</h3>
          <div className="section-content">
            <div className="property-grid">
              <div className="property-item">
                <span className="property-label">Tool Name:</span>
                <span className="property-value">{tool.name}</span>
              </div>
              <div className="property-item">
                <span className="property-label">Server ID:</span>
                <span className="property-value">{tool.serverId}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      </div>
  )
}

export default McpToolDetailView