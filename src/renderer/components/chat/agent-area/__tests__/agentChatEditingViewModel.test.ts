import { describe, it, expect } from 'vitest'

import type { ChatAgent, ChatConfig } from '../../../../lib/userData/types'
import type { AgentConfig, AgentEditorTabName } from '../../agent-editor/types'
import {
  AGENT_EDITOR_TAB_NAMES,
  createEmptyPendingChanges,
  createEmptyTabChangesCache,
  getAgentKnowledge,
  buildAgentConfig,
  collectPendingChanges,
  validateAgentName,
  createAgentUpdateForTab,
  createAgentUpdateForAllChanges,
  mergeActiveTabIntoAgentConfig,
  buildUpdatedAgentConfig,
} from '../agentChatEditingViewModel'

const prompt = (base: string) => ({ 'Base.md': base, 'AGENTS.md': '' })

function makeAgent(overrides: Partial<ChatAgent> = {}): ChatAgent {
  return {
    name: 'Base Agent',
    emoji: '🤖',
    role: 'helper',
    model: 'model-a',
    mcp_servers: [],
    ...overrides,
  } as ChatAgent
}

describe('agentChatEditingViewModel', () => {
  describe('static factories', () => {
    it('exposes the full ordered tab name list', () => {
      expect(AGENT_EDITOR_TAB_NAMES).toContain('basic')
      expect(AGENT_EDITOR_TAB_NAMES).toContain('prompt')
    })

    it('creates empty pending-changes and cache maps for every tab', () => {
      const pending = createEmptyPendingChanges()
      const cache = createEmptyTabChangesCache()
      for (const tab of AGENT_EDITOR_TAB_NAMES) {
        expect(pending[tab]).toBe(false)
        expect(cache[tab]).toBeNull()
      }
    })
  })

  describe('getAgentKnowledge', () => {
    it('prefers nested knowledge.knowledgeBase', () => {
      expect(getAgentKnowledge(makeAgent({ knowledge: { knowledgeBase: 'kb-nested' } } as any))).toEqual({
        knowledgeBase: 'kb-nested',
      })
    })

    it('falls back to the flat knowledgeBase field', () => {
      expect(getAgentKnowledge(makeAgent({ knowledgeBase: 'kb-flat' } as any))).toEqual({
        knowledgeBase: 'kb-flat',
      })
    })

    it('returns undefined knowledgeBase when neither is present', () => {
      expect(getAgentKnowledge(null)).toEqual({ knowledgeBase: undefined })
    })
  })

  describe('buildAgentConfig', () => {
    it('maps a ChatAgent into an AgentConfig', () => {
      const config = buildAgentConfig('chat-1', makeAgent({ skills: ['s1'], system_prompt: prompt('sp') }))
      expect(config.id).toBe('chat-1')
      expect(config.name).toBe('Base Agent')
      expect(config.skills).toEqual(['s1'])
      expect(config.systemPrompt).toEqual(prompt('sp'))
      expect(config.createdAt).toBeInstanceOf(Date)
    })

    it('uses the chat workspace over legacy agent.workspace', () => {
      const config = buildAgentConfig('chat-1', makeAgent({ workspace: '/legacy-agent-workspace' } as any), '/chat-workspace')
      expect(config.workspace).toBe('/chat-workspace')
    })
  })

  describe('collectPendingChanges', () => {
    it('merges only tabs that are both dirty and cached', () => {
      const pending = createEmptyPendingChanges()
      const cache = createEmptyTabChangesCache()
      pending.basic = true
      cache.basic = { name: 'New Name' }
      pending.skills = true
      cache.skills = null
      pending.mcp = false
      cache.mcp = { mcpServers: [] }

      expect(collectPendingChanges(pending, cache)).toEqual({ name: 'New Name' })
    })
  })

  describe('validateAgentName', () => {
    const chats: ChatConfig[] = [
      { chat_id: 'a', agent: { name: 'Taken' } } as ChatConfig,
      { chat_id: 'b', agent: { name: 'Other' } } as ChatConfig,
    ]

    it('is valid for an empty/whitespace name', () => {
      expect(validateAgentName(chats, 'a', '   ')).toEqual({
        isValid: true,
        errorMessage: null,
        showError: false,
      })
    })

    it('flags a duplicate name owned by another chat', () => {
      const result = validateAgentName(chats, 'b', 'Taken')
      expect(result.isValid).toBe(false)
      expect(result.showError).toBe(true)
      expect(result.errorMessage).toContain('Taken')
    })

    it('allows the same name on the same chat', () => {
      expect(validateAgentName(chats, 'a', 'Taken')).toEqual({
        isValid: true,
        errorMessage: null,
        showError: false,
      })
    })
  })

  describe('createAgentUpdateForTab', () => {
    it('applies basic-tab fields', () => {
      const updated = createAgentUpdateForTab(makeAgent(), 'basic', {
        name: 'X',
        emoji: '😀',
        role: 'r',
        model: 'm',
      })
      expect(updated).toMatchObject({ name: 'X', emoji: '😀', role: 'r', model: 'm' })
    })

    it('applies knowledge/mcp/skills/hooks/prompt tabs', () => {
      expect(createAgentUpdateForTab(makeAgent(), 'knowledge', { knowledgeBase: 'kb' }).knowledge!.knowledgeBase).toBe('kb')
      expect(createAgentUpdateForTab(makeAgent(), 'mcp', { mcpServers: [{ name: 'm' }] as any }).mcp_servers).toEqual([{ name: 'm' }])
      expect(createAgentUpdateForTab(makeAgent(), 'skills', { skills: ['s'] }).skills).toEqual(['s'])
      expect(createAgentUpdateForTab(makeAgent(), 'hooks', { hooks: ['h'] }).hooks).toEqual(['h'])
      expect(createAgentUpdateForTab(makeAgent(), 'prompt', { systemPrompt: prompt('sp') }).system_prompt).toEqual(prompt('sp'))
    })

    it('does not include chat-owned workspace in agent update payloads', () => {
      const updated = createAgentUpdateForTab(makeAgent({ workspace: '/legacy-agent-workspace' } as any), 'knowledge', {
        workspace: '/new-chat-workspace',
        knowledgeBase: 'kb',
      })
      expect(updated.workspace).toBeUndefined()
      expect(updated.knowledge!.knowledgeBase).toBe('kb')
    })

    it('ignores undefined fields and unknown tabs', () => {
      const updated = createAgentUpdateForTab(makeAgent({ name: 'keep' }), 'basic', {})
      expect(updated.name).toBe('keep')
      const noop = createAgentUpdateForTab(makeAgent({ name: 'keep' }), 'unknown' as AgentEditorTabName, { skills: ['s'] })
      expect(noop.name).toBe('keep')
      expect(noop.skills).toBeUndefined()
    })
  })

  describe('createAgentUpdateForAllChanges', () => {
    it('applies every provided field', () => {
      const updated = createAgentUpdateForAllChanges(makeAgent({ knowledge: { knowledgeBase: 'old' } } as any), {
        name: 'N',
        emoji: 'E',
        role: 'R',
        model: 'M',
        knowledgeBase: 'KB',
        mcpServers: [{ name: 'mcp' }] as any,
        skills: ['s'],
        hooks: ['h'],
        systemPrompt: prompt('SP'),
      })
      expect(updated).toMatchObject({
        name: 'N',
        emoji: 'E',
        role: 'R',
        model: 'M',
        mcp_servers: [{ name: 'mcp' }],
        skills: ['s'],
        hooks: ['h'],
        system_prompt: prompt('SP'),
      })
      expect(updated.knowledge!.knowledgeBase).toBe('KB')
      expect(updated.workspace).toBeUndefined()
    })

    it('leaves fields untouched when nothing is provided', () => {
      const agent = makeAgent({ knowledgeBase: 'flat', name: 'keep' })
      const updated = createAgentUpdateForAllChanges(agent, {})
      expect(updated.name).toBe('keep')
      expect(updated.knowledge!.knowledgeBase).toBe('flat')
    })
  })

  describe('mergeActiveTabIntoAgentConfig', () => {
    const source = makeAgent({ skills: ['orig'] })

    it('builds from source when no current config exists', () => {
      const merged = mergeActiveTabIntoAgentConfig(undefined, 'chat-1', source, 'skills', { skills: ['new'] })
      expect(merged.id).toBe('chat-1')
      expect(merged.skills).toEqual(['new'])
      expect(merged.updatedAt).toBeInstanceOf(Date)
    })

    it('updates an existing config across tabs', () => {
      const current: AgentConfig = buildAgentConfig('chat-1', source)
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'mcp', { mcpServers: [{ name: 'm' }] as any }).mcpServers).toEqual([{ name: 'm' }])
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'hooks', { hooks: ['h'] }).hooks).toEqual(['h'])
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'prompt', { systemPrompt: prompt('sp') }).systemPrompt).toEqual(prompt('sp'))
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'knowledge', { knowledgeBase: 'kb' }).knowledgeBase).toBe('kb')
      const basic = mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'basic', { name: 'B', emoji: 'e', role: 'r', model: 'm' })
      expect(basic).toMatchObject({ name: 'B', emoji: 'e', role: 'r', model: 'm' })
    })

    it('keeps prior values when the active-tab data is undefined', () => {
      const current: AgentConfig = buildAgentConfig('chat-1', source)
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'skills', {}).skills).toEqual(['orig'])
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'hooks', {}).hooks).toEqual(current.hooks)
      expect(mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'prompt', {}).systemPrompt).toBe(current.systemPrompt)
      const knowledge = mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'knowledge', {})
      expect(knowledge.knowledgeBase).toBe(current.knowledgeBase)
      const basic = mergeActiveTabIntoAgentConfig(current, 'chat-1', source, 'basic', {})
      expect(basic).toMatchObject({
        name: current.name,
        emoji: current.emoji,
        role: current.role,
        model: current.model,
      })
    })
  })

  describe('buildUpdatedAgentConfig', () => {
    it('uses the provided createdAt when present', () => {
      const created = new Date('2020-01-01T00:00:00Z')
      const config = buildUpdatedAgentConfig('chat-1', makeAgent({ knowledge: { knowledgeBase: 'kb' } } as any), undefined, created)
      expect(config.createdAt).toBe(created)
      expect(config.knowledgeBase).toBe('kb')
    })

    it('defaults createdAt to now when omitted', () => {
      const config = buildUpdatedAgentConfig('chat-1', makeAgent())
      expect(config.createdAt).toBeInstanceOf(Date)
    })
  })
})
