/**
 * ApplySkillToAgentsDialog Component
 *
 * A unified dialog shown after a skill is added from device.
 * Displays all local agents and lets the user choose which agents to apply the skill to.
 * Agents already using the skill are pre-checked and disabled.
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
import { atom } from '@/atom'

interface DialogState {
  open: boolean
  skillName: string
}

const zeroState: DialogState = { open: false, skillName: '' };
export const ApplySkillDialogAtom = atom(zeroState, (get, set) => {
  const cancel = () => set(zeroState);
  const setSkill = (skillName: string) => set({ open: true, skillName });
  const setOpen = (open: boolean) => set({ ...get(), open });
  return { cancel, setSkill, setOpen };
});

interface AgentItem {
  targetKey: string
  chatId: string
  agentName: string
  emoji: string
  avatar?: string
  alreadyApplied: boolean
}

const ApplySkillToAgentsDialog: React.FC = () => {
  const [{ open, skillName }, actions] = ApplySkillDialogAtom.use();
  const { chats } = useProfileData()
  const { showSuccess, showError } = useToast()
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)

  const agentItems: AgentItem[] = useMemo(() => {
    if (!open) return []

    const items: AgentItem[] = []

    for (const chat of chats) {
      if (chat.chat_type === 'single_agent' && chat.agent) {
        items.push({
          targetKey: `${chat.chat_id}:${chat.agent.name}`,
          chatId: chat.chat_id,
          agentName: chat.agent.name,
          emoji: chat.agent.emoji,
          avatar: chat.agent.avatar,
          alreadyApplied: (chat.agent.skills || []).includes(skillName),
        })
      }

      if (chat.chat_type === 'multi_agent' && chat.agents) {
        for (const agent of chat.agents) {
          items.push({
            targetKey: `${chat.chat_id}:${agent.name}`,
            chatId: chat.chat_id,
            agentName: agent.name,
            emoji: agent.emoji,
            avatar: agent.avatar,
            alreadyApplied: (agent.skills || []).includes(skillName),
          })
        }
      }
    }

    return items
  }, [chats, skillName, open])

  useEffect(() => {
    if (open && !prevOpen) {
      const initialSelected = new Set<string>()
      for (const item of agentItems) {
        if (item.alreadyApplied) {
          initialSelected.add(item.targetKey)
        }
      }
      setSelectedAgents(initialSelected)
    }

    setPrevOpen(open)
  }, [agentItems, open, prevOpen])

  const handleToggle = useCallback((targetKey: string, alreadyApplied: boolean) => {
    if (alreadyApplied) {
      return
    }

    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (next.has(targetKey)) {
        next.delete(targetKey)
      } else {
        next.add(targetKey)
      }
      return next
    })
  }, [])

  const selectableAgents = useMemo(() => agentItems.filter(item => !item.alreadyApplied), [agentItems])
  const isAllSelected = selectableAgents.length > 0 && selectableAgents.every(item => selectedAgents.has(item.targetKey))

  const handleSelectAll = useCallback(() => {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (isAllSelected) {
        for (const item of selectableAgents) {
          next.delete(item.targetKey)
        }
      } else {
        for (const item of selectableAgents) {
          next.add(item.targetKey)
        }
      }
      return next
    })
  }, [isAllSelected, selectableAgents])

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(item => !item.alreadyApplied && selectedAgents.has(item.targetKey))
    if (toApply.length === 0) {
      actions.setOpen(false)
      return
    }

    setIsApplying(true)
    const result = await window.electronAPI.skillLibrary.applySkillToAgents(
      skillName,
      toApply.map(item => ({ chatId: item.chatId, agentName: item.agentName })),
    )
    setIsApplying(false)

    if (!result.success && result.appliedCount === 0) {
      showError(result.message || result.error || `Failed to apply skill "${skillName}"`)
      return
    }

    if (result.appliedCount > 0) {
      showSuccess(`Skill "${skillName}" applied to ${result.appliedCount} agent${result.appliedCount > 1 ? 's' : ''}`)
    }

    if (result.failedCount > 0) {
      showError(`Failed to apply skill to ${result.failedCount} agent${result.failedCount > 1 ? 's' : ''}`)
    }

    actions.setOpen(false)
  }, [agentItems, selectedAgents, skillName, showSuccess, showError])

  const handleSkip = useCallback(() => {
    actions.setOpen(false)
  }, [])

  const newlySelectedCount = agentItems.filter(
    item => !item.alreadyApplied && selectedAgents.has(item.targetKey),
  ).length

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={actions.setOpen} className="z-10000">
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Apply to Agents</DialogTitle>
          <DialogDescription>
            Select which agents should use the skill "{skillName}".
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
                  key={item.targetKey}
                  role="checkbox"
                  aria-checked={selectedAgents.has(item.targetKey)}
                  tabIndex={0}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors select-none ${
                    item.alreadyApplied
                      ? 'opacity-60 cursor-default'
                      : 'hover:bg-gray-100'
                  }`}
                  onClick={() => handleToggle(item.targetKey, item.alreadyApplied)}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(item.targetKey)}
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

export default ApplySkillToAgentsDialog
