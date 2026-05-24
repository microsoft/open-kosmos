import React from 'react'
import { useMCPServers, useSkills } from '../userData/userDataProvider'
import type { AgentMcpServer } from '../../lib/userData/types'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import SubAgentModelSelect from './SubAgentModelSelect'
import '../../styles/SubAgentsView.css'

/**
 * Sub-agent form data structure shared between Create and Edit views.
 */
export interface SubAgentFormData {
  name: string
  description: string
  system_prompt: string
  model: string
  mcp_servers: AgentMcpServer[]
  inherit_mcp_servers: boolean
  skills: string[]
  inherit_skills: boolean
}

export const DEFAULT_FORM_DATA: SubAgentFormData = {
  name: '',
  description: '',
  system_prompt: '',
  model: INHERIT_MODEL_VALUE,
  mcp_servers: [],
  inherit_mcp_servers: true,
  skills: [],
  inherit_skills: true,
}

interface SubAgentFormProps {
  formData: SubAgentFormData
  errors: Record<string, string>
  /** Whether the name field is editable (true for Create, false for Edit) */
  isNameEditable: boolean
  isSubmitting: boolean
  submitLabel: string
  submittingLabel: string
  onUpdateField: (field: string, value: string | number) => void
  onUpdateFormData: React.Dispatch<React.SetStateAction<SubAgentFormData>>
  onSubmit: () => void
  onCancel: () => void
}

const SubAgentForm: React.FC<SubAgentFormProps> = ({
  formData,
  errors,
  isNameEditable,
  isSubmitting,
  submitLabel,
  submittingLabel,
  onUpdateField,
  onUpdateFormData,
  onSubmit,
  onCancel,
}) => {
  const { servers: mcpServersList, isLoading: mcpLoading } = useMCPServers()
  const { skills: skillsList, isLoading: skillsLoading } = useSkills()

  const toggleMcpServer = (serverName: string) => {
    if (formData.inherit_mcp_servers) return
    onUpdateFormData(prev => {
      const exists = prev.mcp_servers.some(s => s.name === serverName)
      return {
        ...prev,
        mcp_servers: exists
          ? prev.mcp_servers.filter(s => s.name !== serverName)
          : [...prev.mcp_servers, { name: serverName, tools: [] }],
      }
    })
  }

  const toggleSkill = (skillName: string) => {
    if (formData.inherit_skills) return
    onUpdateFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skillName)
        ? prev.skills.filter(s => s !== skillName)
        : [...prev.skills, skillName],
    }))
  }

  return (
    <div className="sub-agent-form-inner">
      {/* Name */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          Name {isNameEditable && <span className="required">*</span>}
        </label>
        {isNameEditable ? (
          <input
            type="text"
            className={`sub-agent-form-input ${errors.name ? 'error' : ''}`}
            value={formData.name}
            onChange={(e) => onUpdateField('name', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            placeholder="e.g., web-researcher"
          />
        ) : (
          <input
            type="text"
            className="sub-agent-form-input"
            value={formData.name}
            disabled
          />
        )}
        {errors.name && <p className="sub-agent-form-error">{errors.name}</p>}
        <p className="sub-agent-form-hint">
          {isNameEditable
            ? 'Unique identifier. Lowercase letters, numbers, hyphens, and underscores only.'
            : 'Name cannot be changed after creation.'}
        </p>
      </div>

      {/* Description */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          Description <span className="required">*</span>
        </label>
        <textarea
          className={`sub-agent-form-textarea ${errors.description ? 'error' : ''}`}
          value={formData.description}
          onChange={(e) => onUpdateField('description', e.target.value)}
          placeholder="Describe what this sub-agent does..."
          rows={2}
        />
        {errors.description && <p className="sub-agent-form-error">{errors.description}</p>}
      </div>

      {/* System Prompt */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          System Prompt <span className="required">*</span>
        </label>
        <textarea
          className={`sub-agent-form-textarea monospace ${errors.system_prompt ? 'error' : ''}`}
          value={formData.system_prompt}
          onChange={(e) => onUpdateField('system_prompt', e.target.value)}
          placeholder="Provide the system prompt that defines this sub-agent's behavior..."
          rows={8}
        />
        {errors.system_prompt && <p className="sub-agent-form-error">{errors.system_prompt}</p>}
      </div>

      {/* Model */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">Model</label>
        <SubAgentModelSelect
          value={formData.model}
          onChange={(modelId) => onUpdateField('model', modelId)}
        />
        <p className="sub-agent-form-hint">
          Use the parent agent model by default, or choose a specific model for this sub-agent.
        </p>
      </div>

      {/* ═══ Capabilities Section ═══ */}
      <div className="sub-agent-capabilities-section">
        <h3 className="sub-agent-capabilities-title">Capabilities</h3>

        {/* MCP Servers */}
        <div className="sub-agent-capability-card">
          <div className="sub-agent-capability-header">
            <label className="sub-agent-capability-label">MCP Servers</label>
            <label className="sub-agent-inherit-toggle">
              <input
                type="checkbox"
                checked={formData.inherit_mcp_servers}
                onChange={(e) => onUpdateFormData(prev => ({ ...prev, inherit_mcp_servers: e.target.checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_mcp_servers && (
            <p className="sub-agent-inherit-hint">
              All MCP servers will be inherited from the parent agent and cannot be changed individually.
            </p>
          )}
          <div className="sub-agent-capability-list">
            {mcpLoading ? (
              <p className="sub-agent-capability-empty">Loading servers...</p>
            ) : mcpServersList.filter(s => !s.hidden).length === 0 ? (
              <p className="sub-agent-capability-empty">No MCP servers configured. Add servers in Settings → MCP.</p>
            ) : (
              mcpServersList.filter(server => !server.hidden).map(server => (
                <label key={server.name} className={`sub-agent-capability-item${formData.inherit_mcp_servers ? ' inherited' : ''}`}>
                  <input
                    type="checkbox"
                    checked={formData.inherit_mcp_servers || formData.mcp_servers.some(s => s.name === server.name)}
                    onChange={() => toggleMcpServer(server.name)}
                    disabled={formData.inherit_mcp_servers}
                  />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className={`sub-agent-mcp-status-dot ${server.status === 'connected' ? 'connected' : 'disconnected'}`} />
                    {server.name}
                  </span>
                  {server.tools && <span className="sub-agent-capability-tools-count">({server.tools.length} tools)</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Skills */}
        <div className="sub-agent-capability-card">
          <div className="sub-agent-capability-header">
            <label className="sub-agent-capability-label">Skills</label>
            <label className="sub-agent-inherit-toggle">
              <input
                type="checkbox"
                checked={formData.inherit_skills}
                onChange={(e) => onUpdateFormData(prev => ({ ...prev, inherit_skills: e.target.checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_skills && (
            <p className="sub-agent-inherit-hint">
              All skills will be inherited from the parent agent and cannot be changed individually.
            </p>
          )}
          <div className="sub-agent-capability-list">
            {skillsLoading ? (
              <p className="sub-agent-capability-empty">Loading skills...</p>
            ) : skillsList.length === 0 ? (
              <p className="sub-agent-capability-empty">No skills installed. Add skills in Settings → Skills.</p>
            ) : (
              skillsList.map(skill => (
                <label key={skill.name} className={`sub-agent-capability-item${formData.inherit_skills ? ' inherited' : ''}`}>
                  <input
                    type="checkbox"
                    checked={formData.inherit_skills || formData.skills.includes(skill.name)}
                    onChange={() => toggleSkill(skill.name)}
                    disabled={formData.inherit_skills}
                  />
                  {skill.name}
                  {skill.description && <span className="sub-agent-capability-description">— {skill.description}</span>}
                </label>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Action Buttons */}
      <div className="sub-agent-form-actions">
        <button
          className="btn-secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={onSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </div>
  )
}

export default SubAgentForm
