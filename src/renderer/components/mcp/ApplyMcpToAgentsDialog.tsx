/**
 * ApplyMcpToAgentsDialog Component
 *
 * A unified dialog shown after MCP server(s) are added (from device, VS Code import, or library).
 * Displays all local agents and lets the user choose which agents to apply the MCP server(s) to.
 * Agents already using all of the MCP servers are pre-checked and disabled.
 *
 * Tool conflict detection:
 * When applying, checks if any tools from the new MCP server(s) conflict with tools
 * already used by the agent (from other MCP servers). Conflicting tools are excluded
 * from the new entry's tools list, and a summary is reported to the user.
 *
 * Supports both single and multiple MCP server names (for VS Code bulk import).
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
import { useMCPServers } from '../userData/userDataProvider'
import { useToast } from '../ui/ToastProvider'

interface ApplyMcpToAgentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Single MCP server name or array of names (for bulk import) */
  mcpServerNames: string[]
}

interface AgentItem {
  chatId: string
  agentName: string
  emoji: string
  avatar?: string
  /** True if agent already has ALL the given MCP servers */
  alreadyApplied: boolean
}

/** Per-agent conflict report */
interface AgentConflictReport {
  agentName: string
  /** tool name -> which existing server already has it */
  conflicts: { toolName: string; existingServer: string }[]
  addedToolCount: number
  totalNewToolCount: number
}

const ApplyMcpToAgentsDialog: React.FC<ApplyMcpToAgentsDialogProps> = ({
  open,
  onOpenChange,
  mcpServerNames,
}) => {
  const { chats, chatOps } = useProfileData()
  const { servers: mcpRuntimeServers } = useMCPServers()
  const { showSuccess, showError, showWarning } = useToast()
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)
  const [conflictReports, setConflictReports] = useState<AgentConflictReport[]>([])
  const [showConflictSummary, setShowConflictSummary] = useState(false)

  // Display label for the dialog description
  const displayLabel = useMemo(() => {
    if (mcpServerNames.length === 1) return `"${mcpServerNames[0]}"`
    return `${mcpServerNames.length} MCP servers`
  }, [mcpServerNames])

  // Build a map: serverName -> Set<toolName> from runtime info
  const serverToolsMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const server of mcpRuntimeServers) {
      const toolNames = new Set((server.tools || []).map(t => t.name))
      map.set(server.name, toolNames)
    }
    return map
  }, [mcpRuntimeServers])

  /**
   * Resolve the effective tool names an agent uses from a given MCP server entry.
   * - If entry.tools is non-empty: those specific tools
   * - If entry.tools is empty (all tools): look up runtime to get all tool names
   */
  const resolveAgentToolNames = useCallback((entry: { name: string; tools: string[] }): Set<string> => {
    if (entry.tools && entry.tools.length > 0) {
      return new Set(entry.tools)
    }
    // Empty tools = all tools from this server
    return serverToolsMap.get(entry.name) || new Set()
  }, [serverToolsMap])

  // Extract agents from chats
  const agentItems: AgentItem[] = useMemo(() => {
    const items: AgentItem[] = []
    for (const chat of chats) {
      if (chat.chat_type === 'single_agent' && chat.agent) {
          const existingNames = new Set((chat.agent.mcp_servers || []).map(s => s.name))
          const allApplied = mcpServerNames.every(name => existingNames.has(name))
          items.push({
            chatId: chat.chat_id,
            agentName: chat.agent.name,
            emoji: chat.agent.emoji,
            avatar: chat.agent.avatar,
            alreadyApplied: allApplied,
          })
      } else if (chat.chat_type === 'multi_agent' && chat.agents) {
        for (const agent of chat.agents) {
            const existingNames = new Set((agent.mcp_servers || []).map(s => s.name))
            const allApplied = mcpServerNames.every(name => existingNames.has(name))
            items.push({
              chatId: chat.chat_id,
              agentName: agent.name,
              emoji: agent.emoji,
              avatar: agent.avatar,
              alreadyApplied: allApplied,
            })
        }
      }
    }
    return items
  }, [chats, mcpServerNames])

  // Track previous open state to detect open transition
  const [prevOpen, setPrevOpen] = useState(false)

  // Initialize selectedAgents only when dialog opens (false -> true transition)
  useEffect(() => {
    if (open && !prevOpen) {
      const initialSelected = new Set<string>()
      for (const item of agentItems) {
        if (item.alreadyApplied) {
          initialSelected.add(item.chatId)
        }
      }
      setSelectedAgents(initialSelected)
      setConflictReports([])
      setShowConflictSummary(false)
    }
    setPrevOpen(open)
  }, [open])

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

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(
      item => !item.alreadyApplied && selectedAgents.has(item.chatId)
    )

    if (toApply.length === 0) {
      onOpenChange(false)
      return
    }

    setIsApplying(true)
    let successCount = 0
    let failCount = 0
    const reports: AgentConflictReport[] = []

    for (const item of toApply) {
      const chat = chats.find(c => c.chat_id === item.chatId)
      if (!chat) continue

      const agent = chat.chat_type === 'single_agent' ? chat.agent : chat.agents?.find(a => a.name === item.agentName)
      if (!agent) continue

      const currentMcpServers = agent.mcp_servers || []
      const existingNames = new Set(currentMcpServers.map(s => s.name))

      // Collect all tool names currently used by this agent (across all existing MCP servers)
      // Map: toolName -> serverName (which server provides it)
      const existingToolOwnership = new Map<string, string>()
      for (const entry of currentMcpServers) {
        const toolNames = resolveAgentToolNames(entry)
        for (const toolName of toolNames) {
          existingToolOwnership.set(toolName, entry.name)
        }
      }

      // Build new server entries with conflict filtering
      const newServers: { name: string; tools: string[] }[] = []
      const agentConflicts: { toolName: string; existingServer: string }[] = []
      let totalNewToolCount = 0

      for (const serverName of mcpServerNames) {
        if (existingNames.has(serverName)) continue

        const newServerTools = serverToolsMap.get(serverName)
        if (!newServerTools || newServerTools.size === 0) {
          // Server has no runtime tools info (maybe not connected yet), add with empty tools (all)
          newServers.push({ name: serverName, tools: [] })
          continue
        }

        totalNewToolCount += newServerTools.size
        const conflicting: string[] = []
        const nonConflicting: string[] = []

        for (const toolName of newServerTools) {
          const owner = existingToolOwnership.get(toolName)
          if (owner) {
            conflicting.push(toolName)
            agentConflicts.push({ toolName, existingServer: owner })
          } else {
            nonConflicting.push(toolName)
          }
        }

        if (conflicting.length > 0) {
          if (nonConflicting.length > 0) {
            // Has conflicts but also has non-conflicting tools: add only the non-conflicting ones
            newServers.push({ name: serverName, tools: nonConflicting })
          }
          // else: ALL tools conflict — skip this MCP server entirely for this agent
        } else {
          // No conflicts, add with empty tools (all)
          newServers.push({ name: serverName, tools: [] })
        }
      }

      if (newServers.length === 0) {
        // All MCP servers fully conflicted for this agent — report but don't update
        if (agentConflicts.length > 0) {
          reports.push({
            agentName: item.agentName,
            conflicts: agentConflicts,
            addedToolCount: 0,
            totalNewToolCount,
          })
        }
        continue
      }

      const updatedMcpServers = [...currentMcpServers, ...newServers]
      const result = await chatOps.updateChatAgent(item.chatId, { mcp_servers: updatedMcpServers })

      if (result.success) {
        successCount++
        if (agentConflicts.length > 0) {
          // Count actually added tools: explicit list length, or all tools from runtime for [] entries
          const addedToolCount = newServers.reduce((sum, s) => {
            if (s.tools.length > 0) return sum + s.tools.length
            // tools: [] means all tools from this server
            const runtimeTools = serverToolsMap.get(s.name)
            return sum + (runtimeTools ? runtimeTools.size : 0)
          }, 0)
          reports.push({
            agentName: item.agentName,
            conflicts: agentConflicts,
            addedToolCount,
            totalNewToolCount,
          })
        }
      } else {
        failCount++
      }
    }

    setIsApplying(false)

    if (successCount > 0) {
      const serverLabel = mcpServerNames.length === 1
        ? `MCP server "${mcpServerNames[0]}"`
        : `${mcpServerNames.length} MCP servers`

      if (reports.length > 0) {
        // Has conflicts - show warning with summary
        const totalConflicts = reports.reduce((sum, r) => sum + r.conflicts.length, 0)
        showWarning(
          `${serverLabel} applied to ${successCount} agent${successCount > 1 ? 's' : ''}. ` +
          `${totalConflicts} conflicting tool${totalConflicts > 1 ? 's were' : ' was'} excluded.`
        )
        setConflictReports(reports)
        setShowConflictSummary(true)
      } else {
        showSuccess(`${serverLabel} applied to ${successCount} agent${successCount > 1 ? 's' : ''}`)
        onOpenChange(false)
      }
    } else {
      if (failCount > 0) {
        showError(`Failed to apply MCP server(s) to ${failCount} agent${failCount > 1 ? 's' : ''}`)
      }
      onOpenChange(false)
    }
  }, [agentItems, selectedAgents, chats, chatOps, mcpServerNames, serverToolsMap, resolveAgentToolNames, onOpenChange, showSuccess, showWarning, showError])

  const handleSkip = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleCloseConflictSummary = useCallback(() => {
    setShowConflictSummary(false)
    setConflictReports([])
    onOpenChange(false)
  }, [onOpenChange])

  const newlySelectedCount = agentItems.filter(
    item => !item.alreadyApplied && selectedAgents.has(item.chatId)
  ).length

  // Conflict summary view
  if (showConflictSummary && conflictReports.length > 0) {
    return (
      <Dialog open={open} onOpenChange={handleCloseConflictSummary}>
        <DialogContent className="w-[480px] max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Tool Conflict Report</DialogTitle>
            <DialogDescription>
              Some tools were excluded because they conflict with tools from existing MCP servers.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 max-h-[360px] overflow-y-auto space-y-4">
            {conflictReports.map((report) => (
              <div key={report.agentName} className="border border-gray-200 rounded-md p-3">
                <div className="text-sm font-medium text-gray-900 mb-2">
                  {report.agentName}
                  <span className={`ml-2 text-xs font-normal ${
                    report.addedToolCount === 0
                      ? 'text-red-500'
                      : 'text-gray-500'
                  }`}>
                    {report.addedToolCount === 0
                      ? 'MCP server not added (all tools conflict)'
                      : `${report.addedToolCount}/${report.totalNewToolCount} tools added`
                    }
                  </span>
                </div>
                <div className="space-y-1">
                  {report.conflicts.map((conflict, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="text-amber-500 flex-shrink-0">excluded</span>
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                        {conflict.toolName}
                      </code>
                      <span className="text-gray-400 flex-shrink-0">
                        (exists in {conflict.existingServer})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <button
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              onClick={handleCloseConflictSummary}
            >
              OK
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Normal agent selection view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Apply to Agents</DialogTitle>
          <DialogDescription>
            Select which agents should use {displayLabel}.
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

export default ApplyMcpToAgentsDialog
