'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useToast } from '../ui/ToastProvider'
import { pluginApi } from '../../ipc/plugin'
import type { PluginInfo } from '../../../shared/ipc/plugin'
import PluginHeaderView from './PluginHeaderView'
import PluginContentView from './PluginContentView'
import ApplyPluginToAgentsDialog from './ApplyPluginToAgentsDialog'

export type { PluginInfo }

export type PluginCommandInfo = NonNullable<PluginInfo['manifest']['commands']>[number]
export type PluginAgentInfo = NonNullable<PluginInfo['manifest']['agents']>[number]

const PluginManagementView: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null)
  const { showSuccess, showError } = useToast()

  // Apply-to-agents dialog state
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applyDialogPlugin, setApplyDialogPlugin] = useState<PluginInfo | null>(null)
  const pluginIdsBeforeInstall = useRef<Set<string>>(new Set())

  const fetchPlugins = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await pluginApi.getPlugins()
      if (result.success && result.plugins) {
        setPlugins(result.plugins)
      }
    } catch (e) {
      console.error('Failed to fetch plugins:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPlugins()
  }, [fetchPlugins])

  // Listen for external "select this plugin" events (from AgentPluginsTab gear button)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.pluginId) {
        const target = plugins.find(p => p.id === detail.pluginId)
        if (target) setSelectedPlugin(target)
      }
    }
    window.addEventListener('plugins:selectPlugin', handler)
    return () => window.removeEventListener('plugins:selectPlugin', handler)
  }, [plugins])

  const handleInstall = useCallback(async () => {
    try {
      // Capture existing plugin IDs before install so we can detect the newly added one
      pluginIdsBeforeInstall.current = new Set(plugins.map(p => p.id))

      const result = await pluginApi.install()
      if (result.success && result.plugins) {
        setPlugins(result.plugins)

        // Find the newly installed plugin by diffing IDs
        const newPlugin = result.plugins.find(p => !pluginIdsBeforeInstall.current.has(p.id))
        if (newPlugin) {
          showSuccess(`Plugin "${newPlugin.manifest.name}" installed`)
          setApplyDialogPlugin(newPlugin)
          setApplyDialogOpen(true)
        } else {
          showSuccess('Plugin installed successfully')
        }
      } else if (result.error && result.error !== 'Cancelled') {
        showError(`Install failed: ${result.error}`)
      }
    } catch (e) {
      showError(`Install error: ${e}`)
    }
  }, [plugins, showSuccess, showError])

  const handleUninstall = useCallback(async (pluginId: string) => {
    try {
      const result = await pluginApi.uninstall(pluginId)
      if (result.success && result.plugins) {
        setPlugins(result.plugins)
        setSelectedPlugin(null)
        showSuccess(`Plugin "${pluginId}" uninstalled`)
      } else {
        showError(`Uninstall failed: ${result.error}`)
      }
    } catch (e) {
      showError(`Uninstall error: ${e}`)
    }
  }, [showSuccess, showError])

  const handleToggleEnabled = useCallback(async (pluginId: string, currentlyEnabled: boolean) => {
    try {
      const result = currentlyEnabled
        ? await pluginApi.disable(pluginId)
        : await pluginApi.enable(pluginId)

      if (result.success && result.plugins) {
        setPlugins(result.plugins)
        const updated = result.plugins.find((p: PluginInfo) => p.id === pluginId)
        if (updated) setSelectedPlugin(updated)
        showSuccess(`Plugin "${pluginId}" ${currentlyEnabled ? 'disabled' : 'enabled'}`)
      } else {
        showError(`Toggle failed: ${result.error}`)
      }
    } catch (e) {
      showError(`Toggle error: ${e}`)
    }
  }, [showSuccess, showError])

  const handleRestart = useCallback(async (pluginId: string) => {
    try {
      const result = await pluginApi.restart(pluginId)
      if (result.success && result.plugins) {
        setPlugins(result.plugins)
        const updated = result.plugins.find((p: PluginInfo) => p.id === pluginId)
        if (updated) setSelectedPlugin(updated)
        showSuccess(`Plugin "${pluginId}" restarted`)
      } else {
        showError(`Restart failed: ${result.error}`)
      }
    } catch (e) {
      showError(`Restart error: ${e}`)
    }
  }, [showSuccess, showError])

  const handleApplied = useCallback((updatedPlugins: PluginInfo[]) => {
    setPlugins(updatedPlugins)
  }, [])

  return (
    <div className="skills-view">
      <PluginHeaderView
        totalPlugins={plugins.length}
        enabledPlugins={plugins.filter(p => p.enabled).length}
        onAddClick={handleInstall}
      />
      <PluginContentView
        plugins={plugins}
        selectedPlugin={selectedPlugin}
        isLoading={isLoading}
        onSelectPlugin={setSelectedPlugin}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
        onRestart={handleRestart}
      />
      <ApplyPluginToAgentsDialog
        open={applyDialogOpen}
        onOpenChange={setApplyDialogOpen}
        plugin={applyDialogPlugin}
        onApplied={handleApplied}
      />
    </div>
  )
}

export default PluginManagementView
