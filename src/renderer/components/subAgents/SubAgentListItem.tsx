import React, { useRef, useMemo } from 'react'
import type { SubAgentConfig } from '../../lib/userData/types'
import '../../styles/SubAgentsView.css'

interface SubAgentListItemProps {
  config: SubAgentConfig
  isSelected: boolean
  onClick: () => void
  onMenuToggle: (buttonElement: HTMLElement) => void
  /** Parent agent's MCP server count (for inherited display) */
  parentMcpCount?: number
  /** Parent agent's skills count (for inherited display) */
  parentSkillsCount?: number
}

const contextAccessLabels: Record<string, string> = {
  isolated: 'Isolated',
  parent_summary: 'Summary',
  full_history: 'Full History',
}

/**
 * SubAgentListItem - Sub-agent list card component
 *
 * Design reference: skill-card-wrapper style in SkillListPanel
 */
const SubAgentListItem: React.FC<SubAgentListItemProps> = ({
  config,
  isSelected,
  onClick,
  onMenuToggle,
  parentMcpCount = 0,
  parentSkillsCount = 0,
}) => {
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // Calculate effective MCP count (own + inherited from parent)
  const mcpDisplay = useMemo(() => {
    const ownCount = config.mcpServers?.length || config.mcp_servers?.length || 0
    const inheritEnabled = config.inherit_mcp_servers !== false // default true
    if (inheritEnabled && parentMcpCount > 0) {
      return `${ownCount + parentMcpCount} (${parentMcpCount} inherited)`
    }
    if (inheritEnabled && parentMcpCount === 0) {
      return `${ownCount} (+inherit)`
    }
    return `${ownCount}`
  }, [config, parentMcpCount])

  // Calculate effective Skills count (own + inherited from parent)
  const skillsDisplay = useMemo(() => {
    const ownCount = config.skills?.length || 0
    const inheritEnabled = config.inherit_skills !== false // default true
    if (inheritEnabled && parentSkillsCount > 0) {
      return `${ownCount + parentSkillsCount} (${parentSkillsCount} inherited)`
    }
    if (inheritEnabled && parentSkillsCount === 0) {
      return `${ownCount} (+inherit)`
    }
    return `${ownCount}`
  }, [config, parentSkillsCount])

  return (
    <div
      className={`sub-agent-card-wrapper ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {/* Header Row: emoji + name + version + menu button */}
      <div className="sub-agent-card-header">
        <span className="sub-agent-card-emoji">{config.emoji}</span>
        <span className="sub-agent-card-name">{config.display_name}</span>
        <span className="sub-agent-card-version">v{config.version}</span>
        <div className="sub-agent-menu-container">
          <button
            ref={menuButtonRef}
            className="sub-agent-menu-btn"
            onClick={(e) => {
              e.stopPropagation()
              onMenuToggle(menuButtonRef.current!)
            }}
          >
            ⋮
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="sub-agent-card-description">{config.description}</p>

      {/* Meta Row: MCP count, Skills count, Context access, Source badge */}
      <div className="sub-agent-card-meta">
        <span>MCP: {mcpDisplay}</span>
        <span className="sub-agent-card-meta-separator">·</span>
        <span>Skills: {skillsDisplay}</span>
        <span className="sub-agent-card-meta-separator">·</span>
        <span>Context: {contextAccessLabels[config.context_access || 'isolated'] || config.context_access || 'isolated'}</span>
      </div>
    </div>
  )
}

export default SubAgentListItem
