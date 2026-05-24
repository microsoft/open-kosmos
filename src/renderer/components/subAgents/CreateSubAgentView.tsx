import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../ui/ToastProvider'
import { useProfileDataRefresh } from '../userData/userDataProvider'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import SubAgentForm, { DEFAULT_FORM_DATA } from './SubAgentForm'
import type { SubAgentFormData } from './SubAgentForm'
import '../../styles/Header.css'
import '../../styles/SubAgentsView.css'

/**
 * CreateSubAgentView - Sub-agent creation form
 *
 * Design reference: SkillsView overall layout (unified-header + scrollable content)
 * Uses IPC to call the main process subAgent:add handler
 */
const CreateSubAgentView: React.FC = () => {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const { refresh } = useProfileDataRefresh()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<SubAgentFormData>({ ...DEFAULT_FORM_DATA })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required'
    } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(formData.name)) {
      newErrors.name = 'Name must contain only lowercase letters, numbers, and hyphens (cannot start or end with a hyphen)'
    }

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
    if (!validateForm()) return
    setIsSubmitting(true)

    try {
      if (!window.electronAPI?.subAgent?.add) {
        showError('Sub-agent API not available')
        return
      }

      const result = await window.electronAPI.subAgent.add({
        name: formData.name.trim(),
        description: formData.description.trim(),
        version: '1.0.0',
        source: 'ON-DEVICE',
        model: formData.model.trim() || INHERIT_MODEL_VALUE,
        system_prompt: formData.system_prompt.trim(),
        mcp_servers: formData.mcp_servers,
        skills: formData.skills,
        builtin_tools: [],
        inherit_mcp_servers: formData.inherit_mcp_servers,
        inherit_skills: formData.inherit_skills,
      })

      if (result.success) {
        showSuccess(`Sub-agent "${formData.name}" created successfully`)

        // Trigger list refresh
        setTimeout(() => {
          refresh().catch(() => {})
          window.dispatchEvent(new CustomEvent('subAgents:refreshList', {
            detail: { subAgentName: formData.name }
          }))
        }, 500)

        // Trigger Apply to Agents dialog
        window.dispatchEvent(new CustomEvent('subAgents:applyToAgents', {
          detail: { subAgentName: formData.name }
        }))

        navigate('/settings/sub-agents')
      } else {
        showError(`Failed to create sub-agent: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to create sub-agent: ${errorMessage}`)
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, navigate, showSuccess, showError, refresh])

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

  return (
    <div className="sub-agent-form-view">
      <div className="unified-header">
        <div className="header-title">
          <button className="btn-action" onClick={() => navigate('/settings/sub-agents')} title="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
            </svg>
          </button>
          <span className="header-name">Create Sub-Agent</span>
        </div>
        <div className="header-actions" />
      </div>

      {/* Scrollable Form Content */}
      <div className="sub-agent-form-content">
        <SubAgentForm
          formData={formData}
          errors={errors}
          isNameEditable={true}
          isSubmitting={isSubmitting}
          submitLabel="Create Sub-Agent"
          submittingLabel="Creating..."
          onUpdateField={updateField}
          onUpdateFormData={setFormData}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/settings/sub-agents')}
        />
      </div>
    </div>
  )
}

export default CreateSubAgentView
