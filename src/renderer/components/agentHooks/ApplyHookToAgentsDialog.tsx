/**
 * ApplyHookToAgentsDialog Component
 *
 * Shown after a Hook is created in Settings (mirrors the MCP/Skill "Apply to
 * Agents" flow). Lists local agents that run the Agent Hooks runtime and lets
 * the user choose which agents should run the new Hook. Agents already bound to
 * the Hook are pre-checked and disabled.
 *
 * Hooks bind from the Agent side: `ChatAgent.hooks` holds the selected Hook ids
 * (mirrors `skills`/`mcp_servers`). Applying a Hook adds its id to the agent's
 * `hooks` array via `chatOps.updateChatAgent`.
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
import { useToast } from '../ui/ToastProvider'
import { resolveChatAgent, resolveChatAgents } from '../../lib/agent'
import { useI18n } from '../../lib/i18n/useI18n'

interface ApplyHookToAgentsDialogProps {
  hookId: string
  hookName: string
  onClose: () => void
}

interface AgentItem {
  targetKey: string
  chatId: string
  chatType: 'single_agent' | 'multi_agent'
  agentIndex?: number
  agentName: string
  emoji: string
  avatar?: string
  /** Snapshot of the agent's current hook ids when the dialog opened. */
  hooks: string[]
  alreadyApplied: boolean
}

function canRunAgentHooks(agent: { source?: string }): boolean {
  return agent.source !== 'EXTERNAL'
}

const ApplyHookToAgentsDialog: React.FC<ApplyHookToAgentsDialogProps> = ({ hookId, hookName, onClose }) => {
  const { chats, chatOps } = useProfileData()
  const { showSuccess, showError } = useToast()
  const { t } = useI18n()
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)

  const agentItems: AgentItem[] = useMemo(() => {
    const items: AgentItem[] = []
    for (const chat of chats) {
      if (chat.chat_type === 'single_agent') {
        const singleAgent = resolveChatAgent(chat)
        if (!singleAgent || !canRunAgentHooks(singleAgent)) continue
        const hooks = singleAgent.hooks || []
        items.push({
          targetKey: `${chat.chat_id}:${singleAgent.name}`,
          chatId: chat.chat_id,
          chatType: 'single_agent',
          agentName: singleAgent.name,
          emoji: singleAgent.emoji,
          avatar: singleAgent.avatar,
          hooks,
          alreadyApplied: hooks.includes(hookId),
        })
      } else if (chat.chat_type === 'multi_agent') {
        const multiAgents = resolveChatAgents(chat)
        for (let agentIndex = 0; agentIndex < multiAgents.length; agentIndex++) {
          const agent = multiAgents[agentIndex]
          if (!canRunAgentHooks(agent)) continue
          const hooks = agent.hooks || []
          items.push({
            targetKey: `${chat.chat_id}:${agentIndex}:${agent.name}`,
            chatId: chat.chat_id,
            chatType: 'multi_agent',
            agentIndex,
            agentName: agent.name,
            emoji: agent.emoji,
            avatar: agent.avatar,
            hooks,
            alreadyApplied: hooks.includes(hookId),
          })
        }
      }
    }
    return items
  }, [chats, hookId])

  // Pre-check agents that already have the hook when the dialog mounts.
  useEffect(() => {
    const initialSelected = new Set<string>()
    for (const item of agentItems) {
      if (item.alreadyApplied) initialSelected.add(item.targetKey)
    }
    setSelectedAgents(initialSelected)
    // Run once on mount; agentItems is derived from the seeded hook id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleToggle = useCallback((targetKey: string, alreadyApplied: boolean) => {
    if (alreadyApplied) return
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (next.has(targetKey)) next.delete(targetKey)
      else next.add(targetKey)
      return next
    })
  }, [])

  const selectableAgents = useMemo(() => agentItems.filter(item => !item.alreadyApplied), [agentItems])
  const isAllSelected = selectableAgents.length > 0 && selectableAgents.every(item => selectedAgents.has(item.targetKey))

  const handleSelectAll = useCallback(() => {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (isAllSelected) {
        for (const item of selectableAgents) next.delete(item.targetKey)
      } else {
        for (const item of selectableAgents) next.add(item.targetKey)
      }
      return next
    })
  }, [isAllSelected, selectableAgents])

  const newlySelectedCount = agentItems.filter(
    item => !item.alreadyApplied && selectedAgents.has(item.targetKey),
  ).length

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(item => !item.alreadyApplied && selectedAgents.has(item.targetKey))
    const singleAgentItems = toApply.filter(item => item.chatType === 'single_agent')
    const multiAgentIndexesByChat = new Map<string, Set<number>>()
    for (const item of toApply) {
      if (item.chatType !== 'multi_agent') continue
      if (item.agentIndex === undefined) continue
      const indexes = multiAgentIndexesByChat.get(item.chatId) || new Set<number>()
      indexes.add(item.agentIndex)
      multiAgentIndexesByChat.set(item.chatId, indexes)
    }

    setIsApplying(true)
    let successCount = 0
    let failCount = 0
    for (const item of singleAgentItems) {
      const chat = chats.find(candidate => candidate.chat_id === item.chatId)
      if (!chat) {
        failCount++
        continue
      }

      let result
      const singleAgent = resolveChatAgent(chat)
      if (!singleAgent) {
        failCount++
        continue
      }
      result = await chatOps.updateChatAgent(item.chatId, {
        hooks: addHookId(singleAgent.hooks || item.hooks, hookId),
      })
      if (result.success) successCount++
      else failCount++
    }

    for (const [chatId, selectedIndexes] of multiAgentIndexesByChat) {
      const chat = chats.find(candidate => candidate.chat_id === chatId)
      const resolvedAgents = resolveChatAgents(chat)
      if (!chat || resolvedAgents.length === 0) {
        failCount += selectedIndexes.size
        continue
      }

      let updatedCount = 0
      const agents = resolvedAgents.map((agent, index) => {
        if (!selectedIndexes.has(index)) return agent
        updatedCount++
        return { ...agent, hooks: addHookId(agent.hooks || [], hookId) }
      })
      const missingCount = selectedIndexes.size - updatedCount
      if (missingCount > 0) failCount += missingCount
      if (updatedCount === 0) continue

      const result = await chatOps.updateChatConfig(chatId, { agents })
      if (result.success) successCount += updatedCount
      else failCount += updatedCount
    }
    setIsApplying(false)

    if (successCount > 0) {
      showSuccess(t(successCount === 1 ? 'agent.hooks.apply.appliedToast' : 'agent.hooks.apply.appliedToastPlural', { name: hookName, count: successCount }))
    }
    if (failCount > 0) {
      showError(t(failCount === 1 ? 'agent.hooks.apply.failedToast' : 'agent.hooks.apply.failedToastPlural', { count: failCount }))
    }
    onClose()
  }, [agentItems, selectedAgents, chats, chatOps, hookId, hookName, showSuccess, showError, onClose, t])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) onClose()
  }, [onClose])

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('agent.hooks.apply.title')}</DialogTitle>
          <DialogDescription>
            {t('agent.hooks.apply.description', { name: hookName })}
          </DialogDescription>
        </DialogHeader>

        {selectableAgents.length > 0 && (
          <div className="mt-3">
            <div
              className="flex items-center gap-3 px-3 py-1 rounded-md cursor-pointer select-none hover:bg-neutral-100"
              onClick={handleSelectAll}
            >
              <input
                type="checkbox"
                checked={isAllSelected}
                readOnly
                tabIndex={-1}
                className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 pointer-events-none"
              />
              <span className="text-sm text-neutral-700">{isAllSelected ? t('common.deselectAll') : t('common.selectAll')}</span>
            </div>
          </div>
        )}

        <div className="py-3 min-h-[244px] max-h-[552px] overflow-y-auto">
          {agentItems.length === 0 ? (
            <div className="text-sm text-neutral-500 text-center py-4">{t('agent.hooks.apply.noAgents')}</div>
          ) : (
            <div className="space-y-1">
              {agentItems.map((item) => (
                <div
                  key={item.targetKey}
                  role="checkbox"
                  aria-checked={selectedAgents.has(item.targetKey)}
                  tabIndex={0}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors select-none ${
                    item.alreadyApplied ? 'opacity-60 cursor-default' : 'hover:bg-neutral-100'
                  }`}
                  onClick={() => handleToggle(item.targetKey, item.alreadyApplied)}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(item.targetKey)}
                    disabled={item.alreadyApplied}
                    readOnly
                    tabIndex={-1}
                    className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 pointer-events-none"
                  />
                  {item.avatar ? (
                    <img src={item.avatar} alt={item.agentName} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <span className="w-6 h-6 flex items-center justify-center text-base leading-none">{item.emoji}</span>
                  )}
                  <span className="text-sm font-medium text-neutral-900 flex-1">{item.agentName}</span>
                  {item.alreadyApplied && <span className="text-xs text-neutral-400">{t('common.applied')}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
            onClick={onClose}
            disabled={isApplying}
          >
            {t('common.skip')}
          </button>
          <button
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={handleApply}
            disabled={isApplying || newlySelectedCount === 0}
          >
            {isApplying ? t('agent.hooks.apply.applying') : (newlySelectedCount > 0 ? t('agent.hooks.apply.applyCount', { count: newlySelectedCount }) : t('common.apply'))}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ApplyHookToAgentsDialog

function addHookId(hooks: string[], hookId: string): string[] {
  return hooks.includes(hookId) ? hooks : [...hooks, hookId]
}
