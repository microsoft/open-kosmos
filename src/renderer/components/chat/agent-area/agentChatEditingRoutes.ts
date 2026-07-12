import type { AgentEditorTabName } from '../agent-editor/types'

export const AGENT_EDITOR_TAB_ROUTE_MAP = {
  'basic': 'basic',
  'knowledge': 'knowledge',
  'mcp_servers': 'mcp',
  'skills': 'skills',
  'hooks': 'hooks',
  'schedules': 'schedules',
  'system_prompt': 'prompt',
} as const

export const AGENT_EDITOR_TAB_TO_ROUTE_MAP = {
  'basic': 'basic',
  'knowledge': 'knowledge',
  'mcp': 'mcp_servers',
  'skills': 'skills',
  'hooks': 'hooks',
  'schedules': 'schedules',
  'prompt': 'system_prompt',
} as const

export function getAgentEditorTabFromRoute(
  tabParam: string | undefined,
): AgentEditorTabName {
  if (!tabParam) return 'basic'

  const mappedTab = AGENT_EDITOR_TAB_ROUTE_MAP[tabParam as keyof typeof AGENT_EDITOR_TAB_ROUTE_MAP]
  return mappedTab || 'basic'
}

export function shouldRedirectAgentEditorRouteToBasic(
  tabParam: string | undefined,
): boolean {
  return !tabParam
}
