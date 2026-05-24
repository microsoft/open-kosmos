/**
 * ApplyPluginToAgentsDialog Component
 *
 * Shown after a plugin is installed. Displays all local agents and lets the
 * user choose which agents to apply the plugin to. Agents that already have
 * the plugin enabled are pre-checked and disabled.
 *
 * On confirm, calls pluginApi.enableForAgent() for each selected agent, which
 * automatically adds the plugin's skills and MCP servers to the agent config.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog'
import { useProfileData } from '../userData/userDataProvider'
import { useAuthContext } from '../auth/AuthProvider'
import { useToast } from '../ui/ToastProvider'
import { pluginApi } from '../../ipc/plugin'
import type { PluginInfo } from '../../../shared/ipc/plugin'
import { BRAND_NAME } from '../../../shared/constants/branding'
import { isBuiltinAgent } from '../../../main/lib/userDataADO/types/profile'

interface ApplyPluginToAgentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plugin: PluginInfo | null
  /** Called after applying completes (whether success or skip) with refreshed plugin list */
  onApplied?: (plugins: PluginInfo[]) => void
}

interface AgentItem {
  chatId: string
  agentName: string
  emoji: string
  avatar?: string
  alreadyApplied: boolean
}

const ApplyPluginToAgentsDialog: React.FC<ApplyPluginToAgentsDialogProps> = ({
  open,
  onOpenChange,
  plugin,
  onApplied,
}) => {
  const { chats } = useProfileData()
  const { authData } = useAuthContext()
  const { showSuccess, showError } = useToast()
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)

  const userAlias = authData?.ghcAuth?.alias ?? ''
  const pluginId = plugin?.id ?? ''

  const agentItems: AgentItem[] = useMemo(() => {
    if (!open || !pluginId) return []

    const items: AgentItem[] = []
    const shouldInclude = (agent: { name: string; source?: string }) => {
      if (isBuiltinAgent(agent.name, BRAND_NAME) && agent.name === 'Kobi') {
        return false
      }
      return true
    }

    for (const chat of chats) {
      if (chat.chat_type === 'single_agent' && chat.agent && shouldInclude(chat.agent)) {
        items.push({
          chatId: chat.chat_id,
          agentName: chat.agent.name,
          emoji: chat.agent.emoji,
          avatar: chat.agent.avatar,
          alreadyApplied: (chat.agent.enabled_plugins ?? []).includes(pluginId),
        })
      }

      if (chat.chat_type === 'multi_agent' && chat.agents) {
        for (const agent of chat.agents) {
          if (!shouldInclude(agent)) continue
          items.push({
            chatId: chat.chat_id,
            agentName: agent.name,
            emoji: agent.emoji,
            avatar: agent.avatar,
            alreadyApplied: (agent.enabled_plugins ?? []).includes(pluginId),
          })
        }
      }
    }

    return items
  }, [chats, pluginId, open])

  // Initialize selection on open transition
  useEffect(() => {
    if (open && !prevOpen) {
      const initialSelected = new Set<string>()
      for (const item of agentItems) {
        if (item.alreadyApplied) {
          initialSelected.add(item.chatId)
        }
      }
      setSelectedAgents(initialSelected)
    }
    setPrevOpen(open)
  }, [open, prevOpen, agentItems])

  const handleToggle = useCallback((chatId: string, alreadyApplied: boolean) => {
    if (alreadyApplied) return
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (next.has(chatId)) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      return next
    })
  }, [])

  const selectableAgents = useMemo(() => agentItems.filter(item => !item.alreadyApplied), [agentItems])
  const isAllSelected = selectableAgents.length > 0 && selectableAgents.every(item => selectedAgents.has(item.chatId))

  const handleSelectAll = useCallback(() => {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (isAllSelected) {
        for (const item of selectableAgents) next.delete(item.chatId)
      } else {
        for (const item of selectableAgents) next.add(item.chatId)
      }
      return next
    })
  }, [isAllSelected, selectableAgents])

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(item => !item.alreadyApplied && selectedAgents.has(item.chatId))
    if (toApply.length === 0) {
      onOpenChange(false)
      return
    }

    setIsApplying(true)
    let successCount = 0
    let failCount = 0
    let latestPlugins: PluginInfo[] | undefined

    for (const item of toApply) {
      const result = await pluginApi.enableForAgent(pluginId, userAlias, item.chatId)
      if (result.success) {
        successCount++
        if (result.plugins) latestPlugins = result.plugins
      } else {
        failCount++
      }
    }

    setIsApplying(false)

    if (successCount > 0) {
      showSuccess(`Plugin "${plugin?.manifest.name ?? pluginId}" applied to ${successCount} agent${successCount > 1 ? 's' : ''}`)
    }
    if (failCount > 0) {
      showError(`Failed to apply plugin to ${failCount} agent${failCount > 1 ? 's' : ''}`)
    }

    if (latestPlugins) onApplied?.(latestPlugins)
    onOpenChange(false)
  }, [agentItems, selectedAgents, pluginId, userAlias, plugin, onOpenChange, onApplied, showSuccess, showError])

  const handleSkip = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const newlySelectedCount = agentItems.filter(
    item => !item.alreadyApplied && selectedAgents.has(item.chatId),
  ).length

  if (!open || !plugin) return null

  // Summary of what the plugin provides
  const skillCount = plugin.injectedSkills.length
  const mcpCount = plugin.injectedMcpServers.length
  const resourceSummary = [
    skillCount > 0 ? `${skillCount} skill${skillCount > 1 ? 's' : ''}` : '',
    mcpCount > 0 ? `${mcpCount} MCP server${mcpCount > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' and ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="z-10000">
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Apply Plugin to Agents</DialogTitle>
          <DialogDescription>
            Plugin "{plugin.manifest.name}" has been installed
            {resourceSummary ? ` with ${resourceSummary}` : ''}.
            Select which agents should use it.
          </DialogDescription>
        </DialogHeader>

        {selectableAgents.length > 0 && (
          <div className="mt-3">
            <div
              className="flex items-center gap-3 px-3 py-1 rounded-md cursor-pointer select-none hover:bg-gray-100"
              onClick={handleSelectAll}
            >
              <input
                type="checkbox"
                checked={isAllSelected}
                readOnly
                tabIndex={-1}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
              />
              <span className="text-sm text-gray-700">{isAllSelected ? 'Deselect All' : 'Select All'}</span>
            </div>
          </div>
        )}

        <div className="py-3 min-h-[244px] max-h-[552px] overflow-y-auto">
          {agentItems.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-4">
              No agents found.
            </div>
          ) : (
            <div className="space-y-1">
              {agentItems.map((item) => (
                <div
                  key={item.chatId}
                  role="checkbox"
                  aria-checked={selectedAgents.has(item.chatId)}
                  tabIndex={0}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors select-none ${
                    item.alreadyApplied
                      ? 'opacity-60 cursor-default'
                      : 'hover:bg-gray-100'
                  }`}
                  onClick={() => handleToggle(item.chatId, item.alreadyApplied)}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(item.chatId)}
                    disabled={item.alreadyApplied}
                    readOnly
                    tabIndex={-1}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
                  />
                  {item.avatar ? (
                    <img src={item.avatar} alt={item.agentName} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <span className="w-6 h-6 flex items-center justify-center text-base leading-none">{item.emoji}</span>
                  )}
                  <span className="text-sm font-medium text-gray-900 flex-1">
                    {item.agentName}
                  </span>
                  {item.alreadyApplied && (
                    <span className="text-xs text-gray-400">
                      Applied
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            onClick={handleSkip}
            disabled={isApplying}
          >
            Skip
          </button>
          <button
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={handleApply}
            disabled={isApplying || newlySelectedCount === 0}
          >
            {isApplying ? 'Applying...' : `Apply${newlySelectedCount > 0 ? ` (${newlySelectedCount})` : ''}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ApplyPluginToAgentsDialog
