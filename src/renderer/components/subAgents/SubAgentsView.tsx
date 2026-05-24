'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { useSubAgents, useProfileDataRefresh, useMCPServers, useSkills } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'
import { Badge } from '../ui/badge'
import SubAgentListItem from './SubAgentListItem'
import { AgentContextType } from '../../types/agentContextTypes'
import type { SubAgentConfig } from '../../lib/userData/types'
import { RefreshCw } from 'lucide-react'
import '../../styles/Header.css'
import '../../styles/SubAgentsView.css'
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[SubAgentsView]');

// Sub-Agents icon component - based on SkillsIcon
const SubAgentsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <mask id="mask_subagents" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="#242424"/>
    </mask>
    <g mask="url(#mask_subagents)">
      <rect width="24" height="24" fill="#272320"/>
    </g>
  </svg>
)

/**
 * SubAgentsView - Sub-agent management view in the Settings page
 *
 * Design reference: SkillsView.tsx
 * - Uses unified-header + sub-agents-content-view layout
 * - useOutletContext<AgentContextType>() to get SettingsPage handlers
 * - useSubAgents() to get global sub-agent data
 */
const SubAgentsView: React.FC = () => {
  const {
    onSubAgentsAddMenuToggle,
    onSubAgentMenuToggle,
  } = useOutletContext<AgentContextType>()

  const navigate = useNavigate()

  // Data fetching (via useSubAgents hook, not direct IPC)
  const { subAgents, stats, isLoading } = useSubAgents()
  const { servers: mcpServers } = useMCPServers()
  const { skills } = useSkills()
  const { refresh } = useProfileDataRefresh()
  const { showSuccess, showError } = useToast()

  // Global MCP/skills counts — used as inherited counts for sub-agents
  const globalMcpCount = mcpServers?.filter(s => !s.hidden)?.length || 0
  const globalSkillsCount = skills?.length || 0

  // Local UI state
  const [selectedSubAgent, setSelectedSubAgent] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  // Hidden file input for "Import from Claude Code"
  const importFileInputRef = useRef<HTMLInputElement>(null)

  // Auto-select the first item when subAgents changes
  useEffect(() => {
    if (subAgents.length > 0 && !selectedSubAgent) {
      setSelectedSubAgent(subAgents[0].name)
    } else if (subAgents.length === 0) {
      setSelectedSubAgent(null)
    }
  }, [subAgents, selectedSubAgent])

  // Listen for refresh events
  useEffect(() => {
    const handleRefresh = (event: CustomEvent<{ subAgentName?: string } | null>) => {
      refresh().catch(() => {})
      if (event.detail?.subAgentName) {
        setSelectedSubAgent(event.detail.subAgentName)
      }
    }

    window.addEventListener('subAgents:refreshList', handleRefresh as EventListener)
    return () => {
      window.removeEventListener('subAgents:refreshList', handleRefresh as EventListener)
    }
  }, [refresh])

  // Listen for "Import from Claude Code" event (from SubAgentsAddMenuDropdown)
  useEffect(() => {
    const handleImport = () => {
      importFileInputRef.current?.click()
    }
    window.addEventListener('subAgents:importFromClaudeCode', handleImport)
    return () => {
      window.removeEventListener('subAgents:importFromClaudeCode', handleImport)
    }
  }, [])

  // Handle import after file selection
  const handleImportFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so the same file can be re-selected if needed
    e.target.value = ''

    // Use Electron webUtils.getPathForFile() API to get file path (sandboxed renderer)
    let filePath: string | undefined
    if (window.electronAPI?.fs?.getPathForFile) {
      try {
        filePath = window.electronAPI.fs.getPathForFile(file)
      } catch (err) {
        logger.warn('[SubAgentsView] webUtils.getPathForFile failed:', err)
      }
    }
    // Fallback: try legacy file.path (non-sandboxed Electron)
    if (!filePath) {
      filePath = (file as File & { path?: string }).path
    }
    if (!filePath) {
      showError('Unable to get file path. Please try again.')
      return
    }

    try {
      if (!window.electronAPI?.subAgent?.importFromFile) {
        showError('Import API not available')
        return
      }
      const result = await window.electronAPI.subAgent.importFromFile(filePath)
      if (result.success && result.data) {
        showSuccess(`Sub-agent "${result.data.display_name || result.data.name}" imported successfully`)
        setTimeout(() => {
          refresh().catch(() => {})
          if (result.data?.name) {
            setSelectedSubAgent(result.data.name)
          }
        }, 300)
      } else {
        showError(result.error || 'Import failed')
      }
    } catch (error) {
      showError(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [refresh, showSuccess, showError])

  // Manually trigger Sync from Disk (filesystem scan → profile index sync)
  const handleSyncFromDisk = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      if (!window.electronAPI?.subAgent?.syncFromDisk) {
        showError('Sync API not available')
        return
      }
      const result = await window.electronAPI.subAgent.syncFromDisk()
      if (result.success) {
        showSuccess('Sub-agents synced from disk successfully')
        await refresh()
      } else {
        showError(result.error || 'Sync failed')
      }
    } catch (error) {
      showError(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing, refresh, showSuccess, showError])

  // Three-dot menu button callback (delegates to SettingsPage to manage floating menu)
  const handleMenuToggle = useCallback((subAgentName: string, buttonElement: HTMLElement) => {
    onSubAgentMenuToggle?.(subAgentName, buttonElement)
  }, [onSubAgentMenuToggle])

  // Handle add button click
  const handleAddClick = useCallback(
    (buttonElement: HTMLElement) => {
      if (onSubAgentsAddMenuToggle) {
        onSubAgentsAddMenuToggle(buttonElement)
      }
    },
    [onSubAgentsAddMenuToggle],
  )

  return (
    <div className="sub-agents-view">
      {/* Hidden file input for Import from Claude Code */}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".md"
        style={{ display: 'none' }}
        onChange={handleImportFileChange}
      />
      {/* Header - based on SkillsHeaderView using unified-header */}
      <div className="unified-header">
        <div className="header-title">
          <SubAgentsIcon />
          <span className="header-name">Sub-Agents</span>
          <div className="mcp-status-badges">
            <Badge variant="normal" className="text-xs">
              available sub-agents: {stats.total}
            </Badge>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn-action"
            onClick={handleSyncFromDisk}
            disabled={isSyncing}
            title="Sync from Disk"
          >
            <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
          </button>
          <button
            className="btn-action"
            onClick={(e) => handleAddClick(e.currentTarget)}
            title="Add Sub-Agent"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z" fill="#272320"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Content - based on SkillsContentView */}
      <div className="sub-agents-content-view">
        {isLoading ? (
          <div className="sub-agent-list-loading">
            <div className="loading-spinner" />
          </div>
        ) : subAgents.length === 0 ? (
          <div className="sub-agents-empty-state">
            <div className="sub-agents-empty-content">
              <p className="sub-agents-empty-text">No sub-agents configured yet.</p>
              <p className="sub-agents-empty-hint">
                Sub-agents allow your agents to delegate specialized tasks to other configured agents.
              </p>
              <div className="sub-agents-empty-actions">
                <button
                  className="sub-agents-empty-btn sub-agents-empty-btn-primary"
                  onClick={() => navigate('/settings/sub-agents/new')}
                >
                  Create Custom
                </button>
                <button
                  className="sub-agents-empty-btn sub-agents-empty-btn-secondary"
                  onClick={() => importFileInputRef.current?.click()}
                >
                  Import from AGENT.md (Claude Code)
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="sub-agent-cards">
            {subAgents.map(sa => (
              <SubAgentListItem
                key={sa.name}
                config={sa}
                isSelected={selectedSubAgent === sa.name}
                onClick={() => setSelectedSubAgent(sa.name)}
                onMenuToggle={(el: HTMLElement) => handleMenuToggle(sa.name, el)}
                parentMcpCount={globalMcpCount}
                parentSkillsCount={globalSkillsCount}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SubAgentsView
