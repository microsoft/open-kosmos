/**
 * ApplySkillToAgentsDialog Component
 *
 * A unified dialog shown after a skill is added (from device or library).
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

interface ApplySkillToAgentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skillName: string
}

interface AgentItem {
  chatId: string
  agentName: string
  emoji: string
  avatar?: string
  alreadyApplied: boolean
}

const ApplySkillToAgentsDialog: React.FC<ApplySkillToAgentsDialogProps> = ({
  open,
  onOpenChange,
  skillName,
}) => {
  const { chats, chatOps } = useProfileData()
  const { showSuccess, showError } = useToast()
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)

  // Extract agents from chats
  // Skip expensive computation when dialog is closed to avoid unnecessary re-renders
  const agentItems: AgentItem[] = useMemo(() => {
    if (!open) return []
    const items: AgentItem[] = []
    for (const chat of chats) {
      if (chat.chat_type === 'single_agent' && chat.agent) {
          items.push({
            chatId: chat.chat_id,
            agentName: chat.agent.name,
            emoji: chat.agent.emoji,
            avatar: chat.agent.avatar,
            alreadyApplied: (chat.agent.skills || []).includes(skillName),
          })
      } else if (chat.chat_type === 'multi_agent' && chat.agents) {
        for (const agent of chat.agents) {
            items.push({
              chatId: chat.chat_id,
              agentName: agent.name,
              emoji: agent.emoji,
              avatar: agent.avatar,
              alreadyApplied: (agent.skills || []).includes(skillName),
            })
        }
      }
    }
    console.log('[ApplySkillToAgentsDialog] agentItems recalculated:', items.map(i => ({ chatId: i.chatId, name: i.agentName, alreadyApplied: i.alreadyApplied })))
    return items
  }, [chats, skillName, open])

  // Track previous open state to detect open transition
  const [prevOpen, setPrevOpen] = useState(false)

  // Initialize selectedAgents only when dialog opens (false -> true transition)
  useEffect(() => {
    console.log('[ApplySkillToAgentsDialog] open effect:', { open, prevOpen, agentItemsCount: agentItems.length })
    if (open && !prevOpen) {
      const initialSelected = new Set<string>()
      for (const item of agentItems) {
        if (item.alreadyApplied) {
          initialSelected.add(item.chatId)
        }
      }
      console.log('[ApplySkillToAgentsDialog] Initializing selectedAgents:', Array.from(initialSelected))
      setSelectedAgents(initialSelected)
    }
    setPrevOpen(open)
  }, [open])

  const handleToggle = useCallback((chatId: string, alreadyApplied: boolean) => {
    console.log('[ApplySkillToAgentsDialog] handleToggle called:', { chatId, alreadyApplied })
    if (alreadyApplied) {
      console.log('[ApplySkillToAgentsDialog] Toggle ignored - already applied')
      return
    }
    setSelectedAgents(prev => {
      const next = new Set(prev)
      const wasSelected = next.has(chatId)
      if (wasSelected) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      console.log('[ApplySkillToAgentsDialog] selectedAgents updated:', { chatId, wasSelected, nowSelected: !wasSelected, allSelected: Array.from(next) })
      return next
    })
  }, [])

  const handleApply = useCallback(async () => {
    // Find agents that are newly selected (not already applied)
    const toApply = agentItems.filter(
      item => !item.alreadyApplied && selectedAgents.has(item.chatId)
    )

    console.log('[ApplySkillToAgentsDialog] handleApply:', { toApplyCount: toApply.length, toApply: toApply.map(i => i.agentName) })

    if (toApply.length === 0) {
      onOpenChange(false)
      return
    }

    setIsApplying(true)
    let successCount = 0
    let failCount = 0

    for (const item of toApply) {
      // Find the chat to get current skills
      const chat = chats.find(c => c.chat_id === item.chatId)
      if (!chat) continue

      const agent = chat.chat_type === 'single_agent' ? chat.agent : chat.agents?.find(a => a.name === item.agentName)
      if (!agent) continue

      const currentSkills = agent.skills || []
      const updatedSkills = [...currentSkills, skillName]

      const result = await chatOps.updateChatAgent(item.chatId, { skills: updatedSkills })
      if (result.success) {
        successCount++
      } else {
        failCount++
      }
    }

    setIsApplying(false)

    if (successCount > 0) {
      showSuccess(`Skill "${skillName}" applied to ${successCount} agent${successCount > 1 ? 's' : ''}`)
    }
    if (failCount > 0) {
      showError(`Failed to apply skill to ${failCount} agent${failCount > 1 ? 's' : ''}`)
    }

    onOpenChange(false)
  }, [agentItems, selectedAgents, chats, chatOps, skillName, onOpenChange, showSuccess, showError])

  const handleSkip = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const newlySelectedCount = agentItems.filter(
    item => !item.alreadyApplied && selectedAgents.has(item.chatId)
  ).length

  // Skip rendering entirely when dialog is closed to avoid unnecessary DOM updates
  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="z-[10000]">
      <DialogContent className="w-[420px] max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Apply to Agents</DialogTitle>
          <DialogDescription>
            Select which agents should use the skill "{skillName}".
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 max-h-[320px] overflow-y-auto">
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
                  onClick={() => {
                    console.log('[ApplySkillToAgentsDialog] row clicked:', { chatId: item.chatId, agentName: item.agentName, alreadyApplied: item.alreadyApplied, currentChecked: selectedAgents.has(item.chatId) })
                    handleToggle(item.chatId, item.alreadyApplied)
                  }}
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

export default ApplySkillToAgentsDialog
