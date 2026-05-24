'use client'

import React, { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { PluginInfo } from './PluginManagementView'
import '../../styles/PluginContentView.css'
import ListSearchBox from '../ui/ListSearchBox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog'

interface PluginContentViewProps {
  plugins: PluginInfo[]
  selectedPlugin: PluginInfo | null
  isLoading: boolean
  onSelectPlugin: (plugin: PluginInfo | null) => void
  onUninstall: (pluginId: string) => void
  onToggleEnabled: (pluginId: string, currentlyEnabled: boolean) => void
  onRestart: (pluginId: string) => void
}

const PluginContentView: React.FC<PluginContentViewProps> = ({
  plugins,
  selectedPlugin,
  isLoading,
  onSelectPlugin,
  onUninstall,
  onToggleEnabled,
  onRestart,
}) => {
  const [pluginSearchQuery, setPluginSearchQuery] = useState('')

  const filteredPlugins = plugins.filter(
    plugin => !pluginSearchQuery || plugin.manifest.name?.includes(pluginSearchQuery) || plugin.id?.includes(pluginSearchQuery)
  )

  // Auto-select first filtered item when current selection is not in filtered results
  useEffect(() => {
    if (!pluginSearchQuery) return
    if (filteredPlugins.length === 0) {
      onSelectPlugin(null)
    } else {
      const currentInFiltered = selectedPlugin && filteredPlugins.some(p => p.id === selectedPlugin.id)
      if (!currentInFiltered) {
        onSelectPlugin(filteredPlugins[0])
      }
    }
  }, [pluginSearchQuery, filteredPlugins.length])

  if (isLoading) {
    return (
      <div className="plugin-content-view">
        <div className="plugin-empty-state">
          <div className="plugin-empty-icon">⏳</div>
          <h3>Loading plugins...</h3>
        </div>
      </div>
    )
  }

  if (plugins.length === 0) {
    return (
      <div className="plugin-content-view">
        <div className="plugin-empty-state">
          <div className="plugin-empty-icon">🧩</div>
          <h3>No Plugins Installed</h3>
          <p>Click the + button to install a plugin from a local directory.</p>
          <p className="plugin-empty-hint">
            Supports Claude Code plugin format (<code>.claude-plugin/plugin.json</code>)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="plugin-content-view">
      {/* Left: Plugin list */}
      <div className="plugin-list-panel">
        <ListSearchBox
          value={pluginSearchQuery}
          onChange={setPluginSearchQuery}
          placeholder="Search plugins..."
        />
        <div className="plugin-list-container">
          {filteredPlugins.map(plugin => (
            <div
              key={plugin.id}
              className={`plugin-card-wrapper ${selectedPlugin?.id === plugin.id ? 'selected' : ''}`}
              onClick={() => onSelectPlugin(plugin)}
            >
              <PluginCard plugin={plugin} />
            </div>
          ))}
        </div>
      </div>

      {/* Right: Detail panel */}
      <div className="plugin-detail-panel">
        {selectedPlugin ? (
          <PluginDetailView
            plugin={selectedPlugin}
            onUninstall={onUninstall}
            onToggleEnabled={onToggleEnabled}
            onRestart={onRestart}
          />
        ) : (
          <div className="plugin-no-selection">
            <div className="plugin-empty-icon">🧩</div>
            <h3>Select a Plugin</h3>
            <p>Choose a plugin from the list to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Plugin Card (left list) ─────────────────────────────────────────────────

const PluginCard: React.FC<{ plugin: PluginInfo }> = ({ plugin }) => {
  const skillCount = typeof plugin.manifest.skills === 'string'
    ? 1
    : (plugin.manifest.skills?.length ?? 0)
  const mcpCount = plugin.manifest.mcpServers ? Object.keys(plugin.manifest.mcpServers).length : 0
  const commandCount = plugin.manifest.commands?.length ?? 0
  const agentCount = plugin.manifest.agents?.length ?? 0
  const totalExtensions = skillCount + mcpCount + commandCount + agentCount

  return (
    <div className="plugin-card">
      <div className="plugin-card-header">
        <div className="plugin-card-info">
          <div className="plugin-card-title-row">
            <h4 className="plugin-card-name">{plugin.manifest.name}</h4>
          </div>
          <div className="plugin-card-status-row">
            <span className={`plugin-status ${plugin.enabled ? 'enabled' : 'disabled'}`}>
              {plugin.enabled ? 'enabled' : 'disabled'}
            </span>
            {plugin.manifest.version && (
              <span className="plugin-version-badge">v{plugin.manifest.version}</span>
            )}
            {totalExtensions > 0 && (
              <span className="plugin-extensions-badge">
                {totalExtensions} extension{totalExtensions !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Plugin Detail (right panel) ─────────────────────────────────────────────

const PluginDetailView: React.FC<{
  plugin: PluginInfo
  onUninstall: (pluginId: string) => void
  onToggleEnabled: (pluginId: string, currentlyEnabled: boolean) => void
  onRestart: (pluginId: string) => void
}> = ({ plugin, onUninstall, onToggleEnabled, onRestart }) => {
  const [showUninstallDialog, setShowUninstallDialog] = useState(false)

  // Close dialog if the selected plugin changes while dialog is open
  useEffect(() => {
    setShowUninstallDialog(false)
  }, [plugin.id])

  const skillPaths = typeof plugin.manifest.skills === 'string'
    ? [plugin.manifest.skills]
    : plugin.manifest.skills ?? []
  const mcpServers = plugin.manifest.mcpServers ? Object.entries(plugin.manifest.mcpServers) : []
  const hookEvents = plugin.manifest.hooks
    ? Object.entries(plugin.manifest.hooks).filter(([, cmds]) => cmds && cmds.length > 0)
    : []
  const commands = plugin.manifest.commands ?? []
  const agents = plugin.manifest.agents ?? []

  return (
    <div className="plugin-detail-view">
      {/* Header */}
      <div className="plugin-detail-header">
        <div className="plugin-detail-header-info">
          <h2 className="plugin-detail-title">{plugin.manifest.name}</h2>
          <div className="plugin-detail-subtitle">
            {plugin.manifest.author?.name && `by ${plugin.manifest.author.name}`}
            {plugin.manifest.version && ` · v${plugin.manifest.version}`}
          </div>
        </div>
        <div className="plugin-detail-actions">
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
            Enable/disable per agent in Agent Settings → Plugins
          </span>
          {plugin.enabled && (
            <button
              className="plugin-action-btn restart"
              onClick={() => onRestart(plugin.id)}
              title="Restart plugin (reconnect MCP servers with fresh environment)"
            >
              Restart
            </button>
          )}
          <button
            className="plugin-action-btn uninstall"
            onClick={() => setShowUninstallDialog(true)}
          >
            Uninstall
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="plugin-detail-content">
        {/* Description */}
        {plugin.manifest.description && (
          <div className="detail-section">
            <h3 className="section-title">Description</h3>
            <div className="section-content">
              <p className="plugin-description-text">{plugin.manifest.description}</p>
            </div>
          </div>
        )}

        {/* Skills */}
        {skillPaths.length > 0 && (
          <CollapsibleSection
            title="Skills"
            badge={`${skillPaths.length}`}
            defaultOpen={true}
          >
            <div className="extension-list">
              {skillPaths.map((sp, i) => {
                const name = plugin.injectedSkills[i] || sp.split('/').pop() || sp
                return (
                  <div className="extension-item" key={sp}>
                    <span className="extension-icon">📘</span>
                    <div className="extension-info">
                      <span className="extension-name">{name}</span>
                      <span className="extension-path">{sp}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Commands */}
        {commands.length > 0 && (
          <CollapsibleSection title="Commands" badge={`${commands.length}`} defaultOpen={true}>
            <div className="extension-list">
              {commands.map(cmd => (
                <div className="extension-item" key={cmd.name}>
                  <span className="extension-icon">⚡</span>
                  <div className="extension-info">
                    <span className="extension-name">/{cmd.name}</span>
                    {cmd.description && <span className="extension-path">{cmd.description}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Agents */}
        {agents.length > 0 && (
          <CollapsibleSection title="Agents" badge={`${agents.length}`} defaultOpen={true}>
            <div className="extension-list">
              {agents.map(agent => (
                <div className="extension-item" key={agent.name}>
                  <span className="extension-icon">🤖</span>
                  <div className="extension-info">
                    <span className="extension-name">{agent.name}</span>
                    {agent.description && (
                      <span className="extension-path">
                        {agent.description.length > 80
                          ? agent.description.slice(0, 80) + '...'
                          : agent.description}
                      </span>
                    )}
                    {agent.model && <span className="extension-path">model: {agent.model}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* MCP Servers */}
        {mcpServers.length > 0 && (
          <CollapsibleSection title="MCP Servers" badge={`${mcpServers.length}`} defaultOpen={true}>
            <div className="extension-list">
              {mcpServers.map(([name, config]) => (
                <div className="extension-item" key={name}>
                  <span className="extension-icon">🔌</span>
                  <div className="extension-info">
                    <span className="extension-name">{name}</span>
                    <span className="extension-path">{(config as any).command} {(config as any).args?.join(' ') ?? ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Hooks */}
        {hookEvents.length > 0 && (
          <CollapsibleSection title="Hooks" badge={`${hookEvents.length} event(s)`} defaultOpen={false}>
            <div className="extension-list">
              {hookEvents.map(([event, cmds]) => (
                <div className="extension-item" key={event}>
                  <span className="extension-icon">🪝</span>
                  <div className="extension-info">
                    <span className="extension-name">{event}</span>
                    <span className="extension-path">{cmds.length} command(s)</span>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Install Location */}
        <div className="detail-section">
          <h3 className="section-title">Install Location</h3>
          <div className="section-content">
            <code className="plugin-path-text">{plugin.path}</code>
          </div>
        </div>
      </div>

      {/* Uninstall Confirmation Dialog */}
      <Dialog
        open={showUninstallDialog}
        onOpenChange={setShowUninstallDialog}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Uninstall Plugin</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to uninstall &quot;{plugin.manifest.name || plugin.id}&quot;?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-destructive">
              This removes all its skills, MCP servers, and hooks. This action cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() => setShowUninstallDialog(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary bg-destructive hover:bg-destructive/90"
              onClick={() => {
                setShowUninstallDialog(false)
                onUninstall(plugin.id)
              }}
            >
              Uninstall
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const CollapsibleSection: React.FC<{
  title: string
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}> = ({ title, badge, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="detail-section">
      <div className="section-header-collapsible" onClick={() => setIsOpen(!isOpen)}>
        <div className="section-header-left">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h3 className="section-title-inline">{title}</h3>
          {badge && <span className="section-badge">{badge}</span>}
        </div>
      </div>
      {isOpen && (
        <div className="section-content">
          {children}
        </div>
      )}
    </div>
  )
}

export default PluginContentView
