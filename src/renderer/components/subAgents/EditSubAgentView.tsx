import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../ui/ToastProvider'
import { useSubAgents, useProfileDataRefresh } from '../userData/userDataProvider'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import SubAgentForm, { DEFAULT_FORM_DATA } from './SubAgentForm'
import type { SubAgentFormData } from './SubAgentForm'
import '../../styles/Header.css'
import '../../styles/SubAgentsView.css'

/**
 * EditSubAgentView - Sub-agent edit form
 *
 * Design reference: SkillsView overall layout (unified-header + scrollable content)
 * Route parameter: /settings/sub-agents/edit/:subAgentName
 */
const EditSubAgentView: React.FC = () => {
  const navigate = useNavigate()
  const { subAgentName } = useParams<{ subAgentName: string }>()
  const { showSuccess, showError } = useToast()
  const { refresh } = useProfileDataRefresh()
  const { subAgents, isLoading } = useSubAgents()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<SubAgentFormData>({ ...DEFAULT_FORM_DATA })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isInitialized, setIsInitialized] = useState(false)

  // Load existing sub-agent data
  useEffect(() => {
    if (!subAgentName || isLoading || isInitialized) return

    const decodedName = decodeURIComponent(subAgentName)
    const existing = subAgents.find(sa => sa.name === decodedName)

    if (existing) {
      setFormData({
        name: existing.name,
        description: existing.description,
        system_prompt: existing.system_prompt,
        model: existing.model || INHERIT_MODEL_VALUE,
        mcp_servers: Array.isArray(existing.mcp_servers) ? existing.mcp_servers : [],
        inherit_mcp_servers: existing.inherit_mcp_servers ?? true,
        skills: Array.isArray(existing.skills) ? existing.skills : [],
        inherit_skills: existing.inherit_skills ?? true,
      })
      setIsInitialized(true)
    }
  }, [subAgentName, subAgents, isLoading, isInitialized])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required'
    }
    if (!formData.system_prompt.trim()) {
      newErrors.system_prompt = 'System prompt is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = useCallback(async () => {
    if (!validateForm() || !subAgentName) return
    setIsSubmitting(true)

    try {
      if (!window.electronAPI?.subAgent?.update) {
        showError('Sub-agent API not available')
        return
      }

      const decodedName = decodeURIComponent(subAgentName)
      const result = await window.electronAPI.subAgent.update(decodedName, {
        description: formData.description.trim(),
        model: formData.model.trim() || INHERIT_MODEL_VALUE,
        system_prompt: formData.system_prompt.trim(),
        mcp_servers: formData.mcp_servers,
        skills: formData.skills,
        inherit_mcp_servers: formData.inherit_mcp_servers,
        inherit_skills: formData.inherit_skills,
      })

      if (result.success) {
        showSuccess(`Sub-agent "${formData.name}" updated successfully`)

        setTimeout(() => {
          refresh().catch(() => {})
          window.dispatchEvent(new CustomEvent('subAgents:refreshList', {
            detail: { subAgentName: decodedName }
          }))
        }, 500)

        navigate('/settings/sub-agents')
      } else {
        showError(`Failed to update sub-agent: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to update sub-agent: ${errorMessage}`)
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, subAgentName, navigate, showSuccess, showError, refresh])

  const updateField = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  if (isLoading) {
    return (
      <div className="sub-agent-form-view">
        <div className="sub-agent-form-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="loading-spinner" />
        </div>
      </div>
    )
  }

  const decodedName = subAgentName ? decodeURIComponent(subAgentName) : ''
  const existing = subAgents.find(sa => sa.name === decodedName)

  if (!existing && isInitialized) {
    return (
      <div className="sub-agent-form-view">
        <div className="unified-header">
          <div className="header-title">
            <button className="btn-action" onClick={() => navigate('/settings/sub-agents')} title="Back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
              </svg>
            </button>
            <span className="header-name">Sub-Agent Not Found</span>
          </div>
          <div className="header-actions" />
        </div>
        <div className="sub-agent-form-content">
          <p>Sub-agent "{decodedName}" not found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="sub-agent-form-view">
      <div className="unified-header">
        <div className="header-title">
          <button className="btn-action" onClick={() => navigate('/settings/sub-agents')} title="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
            </svg>
          </button>
          <span className="header-name">Edit Sub-Agent: {existing?.name || decodedName}</span>
        </div>
        <div className="header-actions" />
      </div>

      {/* Scrollable Form Content */}
      <div className="sub-agent-form-content">
        <SubAgentForm
          formData={formData}
          errors={errors}
          isNameEditable={false}
          isSubmitting={isSubmitting}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          onUpdateField={updateField}
          onUpdateFormData={setFormData}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/settings/sub-agents')}
        />
      </div>
    </div>
  )
}

export default EditSubAgentView
