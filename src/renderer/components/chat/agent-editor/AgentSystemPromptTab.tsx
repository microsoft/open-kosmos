import React, { useState, useCallback, useEffect, useMemo } from 'react'

import '../../../styles/Agent.css';
import { TabComponentProps } from './types'
import MarkdownEditor from './MarkdownEditor'
import { useI18n } from '../../../lib/i18n/useI18n'
import {
  AGENT_SYSTEM_PROMPT_BASE_FILE,
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  type AgentSystemPrompt,
  type AgentSystemPromptFile,
  getAgentSystemPromptFile,
  normalizeAgentSystemPrompt,
  setAgentSystemPromptFile,
} from '@shared/types/agentSystemPrompt'

const DEFAULT_UPDATE_BASE_PROMPT = `You are a helpful AI assistant.

Please follow these guidelines:
- Be concise and clear
- Provide accurate information
- Ask clarifying questions when needed

## Specific Instructions
Add your specific instructions here...`

type AgentSystemPromptTabProps = TabComponentProps & {
  promptFile?: AgentSystemPromptFile
}

function areSystemPromptsEqual(left: AgentSystemPrompt, right: AgentSystemPrompt): boolean {
  return left[AGENT_SYSTEM_PROMPT_BASE_FILE] === right[AGENT_SYSTEM_PROMPT_BASE_FILE] &&
    left[AGENT_SYSTEM_PROMPT_AGENTS_FILE] === right[AGENT_SYSTEM_PROMPT_AGENTS_FILE]
}

type SystemPromptLabelKey =
  | 'agent.systemPrompt.agentIdentityTab'
  | 'agent.systemPrompt.projectContextTab'

function getPromptFileLabelKey(promptFile: AgentSystemPromptFile): SystemPromptLabelKey {
  return promptFile === AGENT_SYSTEM_PROMPT_BASE_FILE
    ? 'agent.systemPrompt.agentIdentityTab'
    : 'agent.systemPrompt.projectContextTab'
}

const AgentSystemPromptTab: React.FC<AgentSystemPromptTabProps> = ({
  mode,
  chatId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
  promptFile = AGENT_SYSTEM_PROMPT_BASE_FILE,
}) => {
  const { t } = useI18n()
  // Check if this is the Kobi Agent (system prompt modification is prohibited)
  const isKobiAgent = agentData?.name?.toLowerCase() === 'kobi'

  // Check if editing is disabled (read-only mode or Kobi Agent)
  const isEditDisabled = readOnly || isKobiAgent
  const promptLabel = t(getPromptFileLabelKey(promptFile))
  const promptGuidance = useMemo(() => {
    if (promptFile === AGENT_SYSTEM_PROMPT_BASE_FILE) {
      return {
        subtitle: t('agent.systemPrompt.agentIdentitySubtitle'),
        quickRule: t('agent.systemPrompt.quickRule'),
        tips: [
          t('agent.systemPrompt.agentIdentityTipRole'),
          t('agent.systemPrompt.agentIdentityTipAvoidContext'),
          t('agent.systemPrompt.sharedTipNoSecrets'),
        ],
        emptyTips: [
          t('agent.systemPrompt.agentIdentityEmptyTitle'),
          t('agent.systemPrompt.agentIdentityEmptyExample'),
          '',
          t('agent.systemPrompt.agentIdentityEmptyRole'),
          t('agent.systemPrompt.agentIdentityEmptyBehavior'),
          t('agent.systemPrompt.agentIdentityEmptySafety'),
        ],
      }
    }

    return {
      subtitle: t('agent.systemPrompt.projectContextSubtitle'),
      quickRule: t('agent.systemPrompt.quickRule'),
      tips: [
        t('agent.systemPrompt.projectContextTipScope'),
        t('agent.systemPrompt.projectContextTipFacts'),
        t('agent.systemPrompt.projectContextTipUpdate'),
        t('agent.systemPrompt.projectContextTipAvoidIdentity'),
        t('agent.systemPrompt.sharedTipNoSecrets'),
      ],
      emptyTips: [
        t('agent.systemPrompt.projectContextEmptyTitle'),
        t('agent.systemPrompt.projectContextEmptyExample'),
        '',
        t('agent.systemPrompt.projectContextEmptyScope'),
        t('agent.systemPrompt.projectContextEmptyRules'),
        t('agent.systemPrompt.projectContextEmptyConstraints'),
      ],
    }
  }, [promptFile, t])

  const [promptContent, setPromptContent] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationError, setOptimizationError] = useState<string | null>(null)
  const [optimizationWarnings, setOptimizationWarnings] = useState<string[]>([])

  const getOriginalPromptInput = useCallback(() => {
    if (agentData?.systemPrompt !== undefined) {
      return agentData.systemPrompt
    }
    if (mode === 'update') {
      return setAgentSystemPromptFile(undefined, AGENT_SYSTEM_PROMPT_BASE_FILE, DEFAULT_UPDATE_BASE_PROMPT)
    }
    return undefined
  }, [agentData?.systemPrompt, mode])

  const originalPrompt = useMemo(
    () => normalizeAgentSystemPrompt(getOriginalPromptInput()),
    [getOriginalPromptInput],
  )

  const workingPrompt = useMemo(
    () => normalizeAgentSystemPrompt(cachedData?.systemPrompt ?? originalPrompt),
    [cachedData?.systemPrompt, originalPrompt],
  )

  const updatePromptContent = useCallback((value: string) => {
    setPromptContent(value)
    if (!onDataChange) {
      return
    }

    const nextPrompt = setAgentSystemPromptFile(
      cachedData?.systemPrompt ?? originalPrompt,
      promptFile,
      value,
    )
    onDataChange(
      'prompt',
      { systemPrompt: nextPrompt },
      !areSystemPromptsEqual(nextPrompt, originalPrompt),
    )
  }, [cachedData?.systemPrompt, onDataChange, originalPrompt, promptFile])

  // Keep the visible editor bound to the selected prompt file. Switching files
  // must read the target file only; it must not emit a save-dirty update.
  useEffect(() => {
    setPromptContent(getAgentSystemPromptFile(workingPrompt, promptFile))
  }, [agentData?.id, promptFile, workingPrompt])

  // Toggle edit/preview mode
  const handleTogglePreview = useCallback(() => {
    setShowPreview(prev => !prev)
  }, [])

  // Handle content change
  const handleContentChange = useCallback((value: string) => {
    updatePromptContent(value)
    // When content changes, clear previous errors and warnings
    if (optimizationError) {
      setOptimizationError(null)
    }
    if (optimizationWarnings.length > 0) {
      setOptimizationWarnings([])
    }
  }, [optimizationError, optimizationWarnings.length, updatePromptContent])

  // AI optimization feature
  const handleAIOptimize = useCallback(async () => {
    // Clear previous errors and warnings
    setOptimizationError(null)
    setOptimizationWarnings([])

    // Validate that input is not empty
    const trimmedPrompt = promptContent.trim()
    if (!trimmedPrompt) {
      setOptimizationError(t('agent.systemPrompt.emptyError'))
      return
    }

    setIsOptimizing(true)
    try {

      // Call the main process systemPromptLlmWriter via IPC
      const ipcResult = await window.electronAPI?.llm?.improveSystemPrompt(trimmedPrompt, { promptFile })

      if (!ipcResult) {
        throw new Error(t('agent.systemPrompt.llmUnavailable'))
      }


      if (ipcResult.success && ipcResult.data) {
        const result = ipcResult.data

        if (result.success && result.improvedPrompt) {
          updatePromptContent(result.improvedPrompt)
          if (result.warnings && result.warnings.length > 0) {
            setOptimizationWarnings(result.warnings)
          }
        } else {
          const errorMessages = result.errors || [t('agent.systemPrompt.optimizationUnknownError')]
          setOptimizationError(errorMessages.join('; '))
        }
      } else {
        throw new Error(ipcResult.error || t('agent.systemPrompt.optimizationFailed'))
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('agent.systemPrompt.optimizationUnknownCatch')
      setOptimizationError(t('agent.systemPrompt.optimizationFailedWithError', { error: errorMessage }))
    } finally {
      setIsOptimizing(false)
    }
  }, [promptContent, t, updatePromptContent])

  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="tab-header">
        <div className="header-tabs">
          <div
            className={`header-tab ${!showPreview ? 'active' : ''}`}
            onClick={() => !showPreview || handleTogglePreview()}
          >
            {t('agent.systemPrompt.contents')}
          </div>
          <div
            className={`header-tab ${showPreview ? 'active' : ''}`}
            onClick={() => showPreview || handleTogglePreview()}
          >
            {t('agent.systemPrompt.preview')}
          </div>
        </div>
        <div className="header-actions">
          {!isEditDisabled && (
            <button
              className="system-btn"
              onClick={handleAIOptimize}
              disabled={isOptimizing || !promptContent.trim()}
              title={!promptContent.trim() ? t('agent.systemPrompt.enterPromptFirst') : t('agent.systemPrompt.polishPrompt')}
            >
              {isOptimizing ? t('agent.systemPrompt.polishing') : t('agent.systemPrompt.polishWithAi')}
            </button>
          )}
        </div>
      </div>

      {/* Tab Body */}
      <div className="tab-body">
        <div
          className="system-prompt-guidance"
          style={{
            marginBottom: '12px',
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid var(--color-border-default)',
            backgroundColor: 'var(--color-neutral-50)',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg-default)' }}>
            {promptLabel}
          </div>
          <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
            {promptGuidance.subtitle}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
            <strong>{t('agent.systemPrompt.quickRuleLabel')}</strong> {promptGuidance.quickRule}
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: '18px', color: 'var(--color-fg-muted)', fontSize: '12px', lineHeight: 1.5 }}>
            {promptGuidance.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
        <MarkdownEditor
          value={promptContent}
          onChange={handleContentChange}
          showPreview={showPreview}
          onTogglePreview={handleTogglePreview}
          readOnly={isEditDisabled}
          emptyTips={promptGuidance.emptyTips}
        />
        {isEditDisabled && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: 'var(--color-warning-100)',
            borderRadius: '8px',
            color: 'var(--color-warning-800)',
            fontSize: '14px'
          }}>
            ⚠️ {readOnly ? t('agent.systemPrompt.readOnly') : t('agent.systemPrompt.kobiReadOnly')}
          </div>
        )}
      </div>

    </div>
  )
}

export default AgentSystemPromptTab