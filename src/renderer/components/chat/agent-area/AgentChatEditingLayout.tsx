import React from 'react'
import AgentBasicTab from '../agent-editor/AgentBasicTab'
import AgentKnowledgeBaseTab from '../agent-editor/AgentKnowledgeBaseTab'
import AgentMcpServersTab from '../agent-editor/AgentMcpServersTab'
import AgentSkillsTab from '../agent-editor/AgentSkillsTab'
import AgentHooksTab from '../agent-editor/AgentHooksTab'
import AgentSchedulesTab from '../agent-editor/AgentSchedulesTab'
import AgentSystemPromptTab from '../agent-editor/AgentSystemPromptTab'
import ErrorHandler from '../agent-editor/ErrorHandler'
import type { AgentChatEditingViewModel } from './useAgentChatEditingViewModel'
import { useI18n } from '../../../lib/i18n/useI18n'
import {
  AGENT_SYSTEM_PROMPT_AGENTS_FILE,
  AGENT_SYSTEM_PROMPT_BASE_FILE,
} from '@shared/types/agentSystemPrompt'

type Props = AgentChatEditingViewModel

const AgentChatEditingLayout: React.FC<Props> = ({
  chatId,
  agentData,
  error,
  isLoading,
  fieldErrors,
  tabResetKey,
  tabState,
  pendingChanges,
  tabChangesCache,
  isKnowledgeGroupExpanded,
  isPromptGroupExpanded,
  activePromptFile,
  readOnlyFlags,
  schedulerEnabled,
  showKnowledgeSourcesGroup,
  canSaveAll,
  handleTabSwitch,
  handleKnowledgeGroupToggle,
  handlePromptGroupToggle,
  handlePromptFileSwitch,
  handleClearError,
  handleSave,
  handleSaveAll,
  handleBackToChat,
  handleTabDataChange,
  navigateToChatList,
}) => {
  const { t } = useI18n()

  if (!chatId) {
    return (
      <div className="agent-editing-view-error">
        <p>{t('agent.settings.noAgentSelected')}</p>
        <button onClick={navigateToChatList}>{t('agent.settings.goToChat')}</button>
      </div>
    )
  }

  return (
    <div className="agent-editing-view">
      <header className="unified-header">
        <div className="header-title">
          <button
            className="btn-action"
            onClick={handleBackToChat}
            title={t('agent.settings.backToChat')}
            style={{ marginRight: '8px' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="header-name">
            {agentData ? t('agent.settings.title', { name: agentData.name }) : t('agent.settings.defaultTitle')}
          </span>
        </div>
        <div className="header-actions">
          <button
            className={`btn-save ${canSaveAll ? 'has-changes' : ''}`}
            onClick={handleSaveAll}
            disabled={isLoading || !canSaveAll}
            title={isLoading ? t('common.saving') : canSaveAll ? t('agent.settings.saveAllChanges') : t('agent.settings.noChangesToSave')}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '6px',
              border: 'none',
              cursor: canSaveAll && !isLoading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              backgroundColor: canSaveAll ? 'var(--color-danger-600)' : 'var(--button-disabled-bg)',
              color: canSaveAll ? 'white' : 'var(--button-disabled-fg)',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </header>

      <div className="agent-editing-view-content">
        {error && (
          <div className="agent-editing-view-error-banner">
            <ErrorHandler error={error} onDismiss={handleClearError} />
          </div>
        )}

        <div className="agent-editing-view-navigation">
          <div
            className={`nav-tab ${tabState.activeTab === 'basic' ? 'active' : ''} ${tabState.tabsEnabled.basic ? '' : 'disabled'}`}
            onClick={() => handleTabSwitch('basic')}
          >
            {t('agent.settings.basic')}
            {pendingChanges.basic && <span className="change-indicator">●</span>}
          </div>
          {showKnowledgeSourcesGroup ? (
            <div className="nav-group">
              <button
                type="button"
                className={`nav-tab nav-group-trigger ${tabState.activeTab === 'knowledge' ? 'active' : ''}`}
                onClick={handleKnowledgeGroupToggle}
              >
                <span className="nav-group-label">
                  <span>{t('agent.settings.knowledge')}</span>
                </span>
                {pendingChanges.knowledge && <span className="change-indicator">●</span>}
              </button>
              {isKnowledgeGroupExpanded && (
                <div className="nav-group-children">
                  <button
                    type="button"
                    className={`nav-tab nav-sub-tab ${tabState.activeTab === 'knowledge' ? 'active' : ''} ${tabState.tabsEnabled.knowledge ? '' : 'disabled'}`}
                    onClick={() => handleTabSwitch('knowledge')}
                  >
                    <span>{t('agent.settings.knowledgeFolder')}</span>
                    {pendingChanges.knowledge && <span className="change-indicator">●</span>}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`nav-tab ${tabState.activeTab === 'knowledge' ? 'active' : ''} ${tabState.tabsEnabled.knowledge ? '' : 'disabled'}`}
              onClick={() => handleTabSwitch('knowledge')}
            >
              {t('agent.settings.knowledge')}
              {pendingChanges.knowledge && <span className="change-indicator">●</span>}
            </div>
          )}
          <div className={`nav-tab ${tabState.activeTab === 'mcp' ? 'active' : ''} ${tabState.tabsEnabled.mcp ? '' : 'disabled'}`} onClick={() => handleTabSwitch('mcp')}>
            {t('agent.settings.mcpServers')}
            {pendingChanges.mcp && <span className="change-indicator">●</span>}
          </div>
          <div className={`nav-tab ${tabState.activeTab === 'skills' ? 'active' : ''} ${tabState.tabsEnabled.skills ? '' : 'disabled'}`} onClick={() => handleTabSwitch('skills')}>
            {t('agent.settings.skills')}
            {pendingChanges.skills && <span className="change-indicator">●</span>}
          </div>
          <div className={`nav-tab ${tabState.activeTab === 'hooks' ? 'active' : ''} ${tabState.tabsEnabled.hooks ? '' : 'disabled'}`} onClick={() => handleTabSwitch('hooks')}>
            {t('agent.settings.hooks')}
            {pendingChanges.hooks && <span className="change-indicator">●</span>}
          </div>
          {schedulerEnabled && (
            <div className={`nav-tab ${tabState.activeTab === 'schedules' ? 'active' : ''} ${tabState.tabsEnabled.schedules ? '' : 'disabled'}`} onClick={() => handleTabSwitch('schedules')}>
              {t('agent.settings.schedules')}
            </div>
          )}
          <div className="nav-group">
            <button
              type="button"
              className={`nav-tab nav-group-trigger ${tabState.activeTab === 'prompt' ? 'active' : ''} ${tabState.tabsEnabled.prompt ? '' : 'disabled'}`}
              onClick={handlePromptGroupToggle}
            >
              <span className="nav-group-label">
                <span>{t('agent.settings.systemPrompt')}</span>
              </span>
              {pendingChanges.prompt && <span className="change-indicator">●</span>}
            </button>
            {isPromptGroupExpanded && (
              <div className="nav-group-children">
                <button
                  type="button"
                  className={`nav-tab nav-sub-tab ${tabState.activeTab === 'prompt' && activePromptFile === AGENT_SYSTEM_PROMPT_BASE_FILE ? 'active' : ''} ${tabState.tabsEnabled.prompt ? '' : 'disabled'}`}
                  onClick={() => handlePromptFileSwitch(AGENT_SYSTEM_PROMPT_BASE_FILE)}
                >
                  <span>{t('agent.systemPrompt.agentIdentityTab')}</span>
                </button>
                <button
                  type="button"
                  className={`nav-tab nav-sub-tab ${tabState.activeTab === 'prompt' && activePromptFile === AGENT_SYSTEM_PROMPT_AGENTS_FILE ? 'active' : ''} ${tabState.tabsEnabled.prompt ? '' : 'disabled'}`}
                  onClick={() => handlePromptFileSwitch(AGENT_SYSTEM_PROMPT_AGENTS_FILE)}
                >
                  <span>{t('agent.systemPrompt.projectContextTab')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="agent-editing-view-main">
          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner">🔄</div>
              <span className="loading-text">{t('common.saving')}</span>
            </div>
          )}

          {tabState.activeTab === 'basic' && (
            <AgentBasicTab
              key={`basic-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.basic}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.basic}
            />
          )}
          {tabState.activeTab === 'knowledge' && tabState.tabsEnabled.knowledge && (
            <AgentKnowledgeBaseTab
              key={`knowledge-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.knowledge}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.knowledge}
            />
          )}
          {tabState.activeTab === 'mcp' && tabState.tabsEnabled.mcp && (
            <AgentMcpServersTab
              key={`mcp-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.mcp}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.mcp}
            />
          )}
          {tabState.activeTab === 'skills' && tabState.tabsEnabled.skills && (
            <AgentSkillsTab
              key={`skills-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.skills}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.skills}
            />
          )}
          {tabState.activeTab === 'hooks' && tabState.tabsEnabled.hooks && (
            <AgentHooksTab
              key={`hooks-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.hooks}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.hooks}
            />
          )}
          {schedulerEnabled && tabState.activeTab === 'schedules' && tabState.tabsEnabled.schedules && (
            <AgentSchedulesTab
              key={`schedules-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.schedules}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.schedules}
            />
          )}
          {tabState.activeTab === 'prompt' && tabState.tabsEnabled.prompt && (
            <AgentSystemPromptTab
              key={`prompt-${tabResetKey}`}
              mode="update"
              chatId={chatId}
              agentData={agentData}
              onSave={handleSave}
              onDataChange={handleTabDataChange}
              cachedData={tabChangesCache.prompt}
              fieldErrors={fieldErrors}
              readOnly={readOnlyFlags.prompt}
              promptFile={activePromptFile}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default AgentChatEditingLayout
