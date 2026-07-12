'use client'

import React from 'react'

import '../../styles/McpToolDetailView.css';
import { MCPTool } from '../../types/mcpTypes'
import { useI18n } from '../../lib/i18n/useI18n'

interface McpToolDetailViewProps {
  tool: MCPTool | null
  serverName?: string
  onBack?: () => void
}

const McpToolDetailView: React.FC<McpToolDetailViewProps> = ({ tool, serverName, onBack }) => {
  const { t } = useI18n()

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

  /* v8 ignore start -- legacy copy handlers are unreachable because this view renders no copy controls. */
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
  /* v8 ignore stop */

  if (!tool) {
    return (
      <div className="mcp-tool-detail-view">
        <div className="no-selection-state">
          <div className="no-selection-icon">🔧</div>
          <h3>{t('mcp.tool.selectTitle')}</h3>
          <p>{t('mcp.tool.selectDescription')}</p>
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
              title={t('mcp.tool.backToList')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.3544 15.8529C12.1594 16.0485 11.8429 16.0491 11.6472 15.8542L6.16276 10.3892C5.94705 10.1743 5.94705 9.82495 6.16276 9.61L11.6472 4.14502C11.8429 3.95011 12.1594 3.95067 12.3544 4.14628C12.5493 4.34189 12.5487 4.65848 12.3531 4.85339L7.18851 9.99961L12.3531 15.1458C12.5487 15.3407 12.5493 15.6573 12.3544 15.8529Z" fill="var(--color-warm-900)"/>
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
          <h3 className="section-title">{t('mcp.tool.description')}</h3>
          <div className="section-content">
            <p className="tool-description-text">
              {tool.description || t('mcp.tool.noDescription')}
            </p>
          </div>
        </div>

        {/* Input Schema Section */}
        <div className="detail-section">
          <h3 className="section-title">{t('mcp.tool.inputSchema')}</h3>
          <div className="section-content">
            <pre className="schema-code">
              <code>{formatInputSchema(tool.inputSchema)}</code>
            </pre>
          </div>
        </div>

        {/* Tool Properties */}
        <div className="detail-section">
          <h3 className="section-title">{t('mcp.tool.properties')}</h3>
          <div className="section-content">
            <div className="property-grid">
              <div className="property-item">
                <span className="property-label">{t('mcp.tool.toolName')}</span>
                <span className="property-value">{tool.name}</span>
              </div>
              <div className="property-item">
                <span className="property-label">{t('mcp.tool.serverId')}</span>
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