import React from 'react'
import '../../../styles/Agent.css'
import AgentChatEditingLayout from './AgentChatEditingLayout'
import { useAgentChatEditingViewModel } from './useAgentChatEditingViewModel'

/**
 * AgentChatEditingView - Agent editing view component.
 *
 * Routes:
 * - /agent/chat/:chatId/settings
 * - /agent/chat/:chatId/settings/basic
 * - /agent/chat/:chatId/settings/mcp_servers
 * - /agent/chat/:chatId/settings/skills
 * - /agent/chat/:chatId/settings/hooks
 * - /agent/chat/:chatId/settings/schedules
 * - /agent/chat/:chatId/settings/system_prompt
 */
const AgentChatEditingView: React.FC = () => {
  const viewModel = useAgentChatEditingViewModel()
  return <AgentChatEditingLayout {...viewModel} />
}

export default AgentChatEditingView
