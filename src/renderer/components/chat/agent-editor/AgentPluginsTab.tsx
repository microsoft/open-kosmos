import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Settings } from 'lucide-react'
import '../../../styles/Agent.css'
import { TabComponentProps } from './types'
import { useAuthContext } from '../../auth/AuthProvider'
import { useProfileDataRefresh } from '../../userData/userDataProvider'
import { pluginApi } from '../../../ipc/plugin'
import type { PluginInfo } from '../../../../shared/ipc/plugin'
import ListSearchBox from '../../ui/ListSearchBox'
import { createLogger } from '../../../lib/utilities/logger'

const logger = createLogger('[AgentPluginsTab]')

// Persist search query per agent across component remounts caused by parent refresh
const _persistedPluginSearchQueries = new Map<string, string>()

/**
 * AgentPluginsTab - Per-agent plugin enable/disable tab.
 *
 * Toggling a plugin ON for this agent automatically adds all of
 * the plugin's skills and MCP servers to the agent config.
 * Toggling OFF removes them.
 */
const AgentPluginsTab: React.FC<TabComponentProps> = ({
  agentId,
  agentData,
  readOnly = false,
}) => {
  const { authData } = useAuthContext()
  const { refresh } = useProfileDataRefresh()
  const navigate = useNavigate()
  const location = useLocation()
  const userAlias = authData?.ghcAuth?.alias ?? ''

  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  // 🆕 Search filter — initialize from per-agent module-level map to survive remounts
  const [agentPluginSearchQuery, setAgentPluginSearchQuery] = useState(
    agentId ? (_persistedPluginSearchQueries.get(agentId) ?? '') : ''
  )
  // Sync search state if agentId changes without remount
  useEffect(() => {
    setAgentPluginSearchQuery(agentId ? (_persistedPluginSearchQueries.get(agentId) ?? '') : '')
  }, [agentId])
  const handlePluginSearchChange = useCallback((value: string) => {
    if (agentId) {
      _persistedPluginSearchQueries.set(agentId, value)
    }
    setAgentPluginSearchQuery(value)
  }, [agentId])

  // Enabled plugin set for this agent
  const enabledPlugins = useMemo(
    () => new Set(agentData?.enabledPlugins ?? []),
    [agentData?.enabledPlugins],
  )

  // Load installed plugins list
  const loadPlugins = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await pluginApi.getPlugins()
      if (result.success && result.plugins) {
        setPlugins(result.plugins)
      }
    } catch (e) {
      logger.error('Failed to load plugins:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  const handleToggle = useCallback(
    async (pluginId: string) => {
      if (readOnly || !agentId || !userAlias) return
      if (toggling.has(pluginId)) return

      setToggling(prev => new Set(prev).add(pluginId))

      try {
        const isEnabled = enabledPlugins.has(pluginId)

        const result = isEnabled
          ? await pluginApi.disableForAgent(pluginId, userAlias, agentId)
          : await pluginApi.enableForAgent(pluginId, userAlias, agentId)

        if (!result.success) {
          logger.error(`Toggle plugin ${pluginId} failed:`, result.error)
        }

        // Reload plugins to refresh state
        if (result.plugins) setPlugins(result.plugins)

        // Refresh profile data so the parent view picks up the new agent.enabled_plugins / mcp_servers.
        // The parent (AgentChatEditingView) watches agentData.enabledPlugins and auto-resets tabs.
        await refresh()
      } catch (e) {
        logger.error(`Toggle plugin ${pluginId} error:`, e)
      } finally {
        setToggling(prev => {
          const next = new Set(prev)
          next.delete(pluginId)
          return next
        })
      }
    },
    [readOnly, agentId, userAlias, enabledPlugins, toggling],
  )

  // Navigate to global Settings → Plugins page (general)
  const handleManagePlugins = useCallback(() => {
    sessionStorage.setItem('previousPath', location.pathname)
    navigate('/settings/plugins')
  }, [navigate, location.pathname])

  // Navigate to global Settings → Plugins page and select a specific plugin
  const handleManagePlugin = useCallback(
    (pluginId: string) => {
      sessionStorage.setItem('previousPath', location.pathname)

      // Close the Agent Editor first
      window.dispatchEvent(new CustomEvent('agent:closeEditor'))

      setTimeout(() => {
        // Notify PluginManagementView to select this plugin
        window.dispatchEvent(
          new CustomEvent('plugins:selectPlugin', { detail: { pluginId } }),
        )
        navigate('/settings/plugins')
      }, 100)
    },
    [navigate, location.pathname],
  )

  const selectedCount = useMemo(() => {
    if (!plugins.length) return 0
    return plugins.filter(p => enabledPlugins.has(p.id)).length
  }, [plugins, enabledPlugins])

  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="tab-header">
        <div className="header-summary">
          <span className="summary-text">
            {selectedCount} selected from {plugins.length} installed plugin{plugins.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleManagePlugins}
            title="Manage installed plugins"
          >
            Manage Installed Plugins
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="tab-body">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner">🔄</div>
            <span>Loading Plugins...</span>
          </div>
        ) : plugins.length > 0 ? (
          <div className="skill-cards">
            <ListSearchBox
              value={agentPluginSearchQuery}
              onChange={handlePluginSearchChange}
              placeholder="Search plugins..."
            />
            {plugins
              .filter(plugin => !agentPluginSearchQuery || plugin.manifest.name?.includes(agentPluginSearchQuery) || plugin.id?.includes(agentPluginSearchQuery))
              .map(plugin => {
              const isEnabled = enabledPlugins.has(plugin.id)
              const isBusy = toggling.has(plugin.id)
              const skillCount = plugin.injectedSkills.length
              const mcpCount = plugin.injectedMcpServers.length
              const hookCount = plugin.manifest.hooks
                ? Object.values(plugin.manifest.hooks).filter(cmds => cmds && cmds.length > 0).length
                : 0

              return (
                <div
                  key={plugin.id}
                  className={`skill-card ${isEnabled ? 'selected' : ''} ${readOnly ? 'readonly' : ''}`}
                  onClick={() => !readOnly && handleToggle(plugin.id)}
                  style={readOnly ? { cursor: 'default', opacity: 0.75 } : undefined}
                >
                  <div className="skill-card-header">
                    <div className="skill-info">
                      <input
                        type="checkbox"
                        className="skill-checkbox"
                        checked={isEnabled}
                        disabled={readOnly || isBusy}
                        onChange={e => {
                          e.stopPropagation()
                          handleToggle(plugin.id)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                      <div className="skill-card-name-group">
                        <div className="server-title-row">
                          <span className="skill-card-name">{plugin.manifest.name}</span>
                          <span
                            className="builtin-badge"
                            style={{ background: 'var(--color-accent-secondary, #6b5ce7)' }}
                          >
                            Plugin
                          </span>
                          {isBusy && (
                            <span className="builtin-badge" style={{ background: '#888' }}>
                              ⏳
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'row',
                            gap: '6px',
                            alignItems: 'center',
                          }}
                        >
                          {plugin.manifest.version && (
                            <span className="skill-card-version">v{plugin.manifest.version}</span>
                          )}
                          {plugin.manifest.author?.name && (
                            <span className="skill-card-version">by {plugin.manifest.author.name}</span>
                          )}
                          {(skillCount > 0 || mcpCount > 0 || hookCount > 0) && (
                            <span className="skill-card-version">
                              {[
                                skillCount > 0 ? `${skillCount} skill${skillCount !== 1 ? 's' : ''}` : '',
                                mcpCount > 0 ? `${mcpCount} MCP` : '',
                                hookCount > 0 ? `${hookCount} hook${hookCount !== 1 ? 's' : ''}` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="skill-actions">
                      <button
                        className="manage-btn always-visible"
                        onClick={e => {
                          e.stopPropagation()
                          handleManagePlugin(plugin.id)
                        }}
                        title="Manage Plugin"
                      >
                        <Settings size={14} />
                      </button>
                    </div>
                  </div>
                  {plugin.manifest.description && (
                    <div
                      style={{
                        padding: '0 12px 8px 36px',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.4',
                      }}
                    >
                      {plugin.manifest.description}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">
            <h4>No plugins installed</h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Install plugins from Settings → Plugins to enable them for this agent.
            </p>
            <button className="manage-servers-btn" onClick={handleManagePlugins}>
              Go to Manage Plugins
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentPluginsTab
