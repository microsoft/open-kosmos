import React, { useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../ui/ToastProvider'
import { adjustAnchoredDropdownToViewport, AnchoredDropdownPosition } from '../../lib/utilities/dropdownPosition'

interface SubAgentDropdownMenuProps {
  subAgentMenuRef: React.RefObject<HTMLDivElement>
  subAgentName: string
  position: AnchoredDropdownPosition
  onClose: () => void
}

/**
 * SubAgentDropdownMenu - Sub-agent floating dropdown menu
 *
 * Design reference: SkillDropdownMenu — floating positioning + custom event dispatch
 * Rendered at the SettingsPage level, controlled by subAgentMenuState
 */
const SubAgentDropdownMenu: React.FC<SubAgentDropdownMenuProps> = ({
  subAgentMenuRef,
  subAgentName,
  position,
  onClose,
}) => {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  useLayoutEffect(() => {
    if (subAgentMenuRef.current) {
      adjustAnchoredDropdownToViewport(subAgentMenuRef.current, position)
    }
  }, [position, subAgentMenuRef])

  const handleEdit = () => {
    onClose()
    navigate(`/settings/sub-agents/edit/${encodeURIComponent(subAgentName)}`)
  }

  const handleDelete = () => {
    onClose()
    // Dispatch custom event → SettingsPage listens and handles confirmation dialog
    window.dispatchEvent(new CustomEvent('subAgent:delete', {
      detail: { subAgentName }
    }))
  }

  const handleApplyToAgents = () => {
    onClose()
    window.dispatchEvent(new CustomEvent('subAgents:applyToAgents', {
      detail: { subAgentName }
    }))
  }

  const handleExportAsClaudeCode = async () => {
    onClose()
    try {
      if (!window.electronAPI?.subAgent?.exportAsClaudeCode) {
        showError('Export API not available')
        return
      }
      const result = await window.electronAPI.subAgent.exportAsClaudeCode(subAgentName)
      if (!result.success || !result.data) {
        showError(result.error || 'Export failed')
        return
      }
      // Trigger a file download (Electron shows native Save As dialog)
      const blob = new Blob([result.data], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${subAgentName}.md`
      a.click()
      URL.revokeObjectURL(url)
      showSuccess(`Sub-agent "${subAgentName}" exported successfully`)
    } catch (error) {
      showError(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleOpenInExplorer = async () => {
    onClose()
    try {
      if (!window.electronAPI?.subAgent?.openInExplorer) {
        showError('Open in Explorer API not available')
        return
      }
      const result = await window.electronAPI.subAgent.openInExplorer(subAgentName)
      if (!result.success) {
        showError(result.error || 'Failed to open folder')
      }
    } catch (error) {
      showError(`Failed to open folder: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const menuButtonStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: '13px',
    color: '#374151',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    borderRadius: '4px',
  }

  return (
    <div
      ref={subAgentMenuRef}
      className="dropdown-menu"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 1000,
        minWidth: 'fit-content',
        width: 'max-content',
        maxWidth: 'calc(100vw - 20px)',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08)',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        padding: '4px',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={handleEdit}
        style={menuButtonStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
      >
        Edit
      </button>
      <button
        onClick={handleApplyToAgents}
        style={menuButtonStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
      >
        Apply to Agents...
      </button>
      <div style={{ height: '1px', backgroundColor: 'rgba(0, 0, 0, 0.08)', margin: '4px 0' }} />
      <button
        onClick={handleExportAsClaudeCode}
        style={menuButtonStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
      >
        Export as Claude Code Format
      </button>
      <button
        onClick={handleOpenInExplorer}
        style={menuButtonStyle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0, 0, 0, 0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
      >
        Open in File Explorer
      </button>
      <div style={{ height: '1px', backgroundColor: 'rgba(0, 0, 0, 0.08)', margin: '4px 0' }} />
      <button
        onClick={handleDelete}
        style={{
          ...menuButtonStyle,
          color: '#ef4444',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239, 68, 68, 0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
      >
        Delete
      </button>
    </div>
  )
}

export default SubAgentDropdownMenu
