'use client'

import React from 'react'
import { AlertCircle, ExternalLink, GitBranch, ArrowDown, ArrowUp, GitMerge, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { SyncSettings } from '../../../main/lib/userDataADO/types/profile'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import { useI18n } from '../../lib/i18n/useI18n'
import type { TranslationKey } from '../../lib/i18n'

export interface SyncStatus {
  hasLocalChanges: boolean | null,
  hasRemoteChanges: boolean | null,
  isInitialized: boolean
  currentBranch: string | null
}

interface SyncSettingsContentViewProps {
  settings: SyncSettings
  status: SyncStatus | null
  gitInstalled: boolean
  gitEnabled: boolean
  syncEnabled: boolean
  userAlias: string
  isLoading: boolean
  isPulling: boolean
  isPushing: boolean
  isMerging: boolean
  isCheckingStatus: boolean
  isValidating: boolean
  repoUrlDraft: string
  autoSetupStatus: 'idle' | 'checking' | 'repo-not-found' | 'done'
  onToggleSync: (enabled: boolean) => void
  onRepoUrlChange: (url: string) => void
  onSaveRepo: () => void
  onPull: (force: boolean) => void
  onPush: (force: boolean) => void
  onMerge: () => void
  onInitializeRepo: () => void
  onCheckStatus: () => void
  onConfirmRepoCreated: () => void
}

/**
 * Validate the supported GitHub repository URL formats.
 */
type TFunction = (key: TranslationKey, params?: Record<string, string | number | boolean | null | undefined>) => string

function validateRepoUrl(url: string, t: TFunction): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: t('settings.sync.repoUrlRequired') }
  }

  // Match HTTPS and SSH GitHub repository URLs.
  const httpsPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/
  const sshPattern = /^git@github\.com:([^/]+)\/([^/]+)(\.git)?$/

  const httpsMatch = url.match(httpsPattern)
  const sshMatch = url.match(sshPattern)

  const match = httpsMatch || sshMatch
  if (!match) {
    return { valid: false, error: t('settings.sync.invalidRepoUrl') }
  }

  return { valid: true }
}

const SyncSettingsContentView: React.FC<SyncSettingsContentViewProps> = ({
  settings,
  status,
  gitInstalled,
  gitEnabled,
  syncEnabled,
  userAlias,
  isLoading,
  isPulling,
  isPushing,
  isMerging,
  isCheckingStatus,
  isValidating,
  repoUrlDraft,
  onToggleSync,
  onRepoUrlChange,
  onSaveRepo,
  onPull,
  onPush,
  onMerge,
  onInitializeRepo,
  onCheckStatus,
  autoSetupStatus,
  onConfirmRepoCreated,
}) => {
  const navigate = useNavigate()
  const { t } = useI18n()
  const repoValidation = validateRepoUrl(repoUrlDraft, t)
  const canEnableSync = gitInstalled && gitEnabled && syncEnabled
  const canSync = canEnableSync && settings.enabled
  const isOperating = isPulling || isPushing || isMerging

  // Check if repo URL has changed from saved value
  const repoUrlChanged = repoUrlDraft !== settings.repoUrl

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">

            {/* Loading indicator */}
            {isLoading && (
              <div className="toolbar-settings-card" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                padding: '24px',
              }}>
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--color-primary-600)' }} />
                <span style={{ color: 'var(--color-neutral-500)', fontSize: '14px' }}>{t('settings.sync.loadingSettings')}</span>
              </div>
            )}

            {/* Git Not Installed Warning */}
            {!gitInstalled && (
              <div className="toolbar-settings-card" style={{
                backgroundColor: 'rgba(251, 191, 36, 0.1)',
                border: '1px solid rgba(251, 191, 36, 0.3)'
              }}>
                <div className="toolbar-setting-item">
                  <div className="setting-label-container" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <AlertCircle size={20} style={{ color: 'var(--color-warning-500)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <label className="setting-label" style={{ color: 'var(--color-warning-800)' }}>{t('settings.sync.gitNotInstalled')}</label>
                      <p className="runtime-card-desc" style={{ color: 'var(--color-warning-800)' }}>
                        {t('settings.sync.gitRequired')}
                      </p>
                      <button
                        onClick={() => navigate('/settings/runtime')}
                        style={{
                          marginTop: '12px',
                          padding: '8px 16px',
                          backgroundColor: 'var(--color-warning-500)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {t('settings.sync.goToRuntimeSettings')}
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Feature Flags Warning */}
            {gitInstalled && (!gitEnabled || !syncEnabled) && (
              <div className="toolbar-settings-card" style={{
                backgroundColor: 'rgba(156, 163, 175, 0.1)',
                border: '1px solid rgba(156, 163, 175, 0.3)'
              }}>
                <div className="toolbar-setting-item">
                  <div className="setting-label-container" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <AlertCircle size={20} style={{ color: 'var(--color-neutral-500)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <label className="setting-label" style={{ color: 'var(--color-neutral-700)' }}>{t('settings.sync.featureNotAvailable')}</label>
                      <p className="runtime-card-desc" style={{ color: 'var(--color-neutral-500)' }}>
                        {!gitEnabled && t('settings.sync.gitIntegrationDisabled')}
                        {!syncEnabled && t('settings.sync.syncFeatureDisabled')}
                        {t('settings.sync.devOnly')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sync to GitHub Card */}
            <div className="toolbar-settings-card">
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">{t('settings.sync.syncToGitHub')}</label>
                  <span className="runtime-card-desc">
                    {t('settings.sync.syncDescription')}
                  </span>
                </div>
                <label className="toolbar-toggle-wrapper">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => onToggleSync(e.target.checked)}
                    disabled={!canEnableSync || isLoading}
                  />
                  <div className="toolbar-toggle-track"></div>
                </label>
              </div>
            </div>

            {/* Repository Configuration Card */}
            {settings.enabled && canSync && (
              <div className="toolbar-settings-card">
                <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label" style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <GitBranch size={18} />
                      {t('settings.sync.githubRepository')}
                    </label>
                    <p className="runtime-card-desc">
                      {t('settings.sync.githubRepositoryDescription')}
                    </p>
                  </div>
                </div>

                <div className="toolbar-setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label">{t('settings.sync.repositoryUrl')}</label>
                    <span className="runtime-card-desc">
                      {t('settings.sync.repositoryUrlDescription', { example: userAlias })}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={repoUrlDraft}
                      onChange={(e) => onRepoUrlChange(e.target.value)}
                      placeholder={`https://github.com/${userAlias}/openkosmos-sync`}
                      disabled={isLoading || isOperating || isValidating}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: repoUrlDraft && !repoValidation.valid
                          ? '1px solid var(--color-danger-500)'
                          : '1px solid rgba(0,0,0,0.1)',
                        fontSize: '14px',
                        backgroundColor: 'white',
                      }}
                    />
                    <button
                      className="btn-primary"
                      onClick={onSaveRepo}
                      disabled={!repoValidation.valid || !repoUrlChanged || isLoading || isOperating || isValidating}
                    >
                      {isValidating ? t('settings.sync.validating') : t('common.save')}
                    </button>
                  </div>

                  {repoUrlDraft && !repoValidation.valid && (
                    <p style={{ color: 'var(--color-danger-500)', fontSize: '13px', margin: 0 }}>
                      {repoValidation.error}
                    </p>
                  )}

                  {/* Auto-setup: checking repo existence */}
                  {autoSetupStatus === 'checking' && (
                    <div style={{
                      backgroundColor: 'rgb(var(--color-accent-rgb) / 0.05)',
                      padding: '16px',
                      borderRadius: '6px',
                      border: '1px solid rgb(var(--color-accent-rgb) / 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}>
                      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--color-primary-600)' }} />
                      <span style={{ color: 'var(--color-neutral-500)', fontSize: '14px' }}>{t('settings.sync.checkingRepoExists')}</span>
                    </div>
                  )}

                  {/* Auto-setup: repo not found — prompt to create */}
                  {autoSetupStatus === 'repo-not-found' && (
                    <div style={{
                      backgroundColor: 'rgba(251, 191, 36, 0.08)',
                      padding: '16px',
                      borderRadius: '6px',
                      border: '1px solid rgba(251, 191, 36, 0.3)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <AlertCircle size={18} style={{ color: 'var(--color-warning-500)', flexShrink: 0, marginTop: '2px' }} />
                        <div>
                          <p className="runtime-card-desc" style={{ margin: 0, color: 'var(--color-warning-800)' }}>
                            <strong>{t('settings.sync.repositoryNotFoundTitle')}</strong> {t('settings.sync.repositoryNotFoundDescription')}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
                            <a
                              href={`https://github.com/new?name=openkosmos-sync&description=OpenKosmos%20sync%20repository&visibility=private&owner=${userAlias}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                color: 'var(--color-primary-600)',
                                fontSize: '14px',
                                textDecoration: 'none',
                              }}
                            >
                              {t('settings.sync.createRepositoryOnGitHub')}
                              <ExternalLink size={14} />
                            </a>
                            <button
                              className="btn-primary"
                              onClick={onConfirmRepoCreated}
                            >
                              {t('settings.sync.repoCreatedContinue')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}


                </div>

                {/* Initialize Repository — only show after remote URL is validated */}
                {settings.repoUrl && status && !status.isInitialized && autoSetupStatus === 'done' && (
                  <div className="toolbar-setting-item" style={{ marginTop: '16px' }}>
                    <div className="setting-label-container">
                      <label className="setting-label">{t('settings.sync.initializeRepository')}</label>
                      <span className="runtime-card-desc">
                        {t('settings.sync.initializeRepositoryDescription')}
                      </span>
                    </div>
                    <button
                      className="btn-primary"
                      onClick={onInitializeRepo}
                      disabled={isLoading || isOperating}
                    >
                      {t('settings.sync.initialize')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Sync Actions Card */}
            {settings.enabled && canSync && settings.repoUrl && status?.isInitialized && autoSetupStatus === 'done' && (
              <div className="toolbar-settings-card">
                <div className="toolbar-setting-item" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '4px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.sync.syncActions')}</label>
                    <p className="runtime-card-desc">
                      {t('settings.sync.syncActionsDescription')}
                      {status?.currentBranch && (
                        <span style={{ display: 'block', marginTop: '4px' }}>
                          {t('settings.sync.currentBranchPrefix')} <span>{status.currentBranch}</span>
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Pull/Push buttons */}
                <div className="toolbar-setting-item" style={{ marginTop: '16px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label">{t('settings.sync.pullChanges')}</label>
                    <span className="runtime-card-desc">
                      {t('settings.sync.pullDescription')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-primary"
                      onClick={() => onPull(false)}
                      disabled={isLoading || isOperating}
                    >
                      <ArrowDown size={14} />
                      {isPulling ? t('settings.sync.pulling') : t('settings.sync.pull')}
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => onPull(true)}
                      disabled={isLoading || isOperating}
                      title={t('settings.sync.forcePullTitle')}
                    >
                      {t('settings.sync.forcePull')}
                    </button>
                  </div>
                </div>

                <div className="toolbar-setting-item" style={{ marginTop: '12px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label">{t('settings.sync.pushChanges')}</label>
                    <span className="runtime-card-desc">
                      {t('settings.sync.pushDescription')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-primary"
                      onClick={() => onPush(false)}
                      disabled={isLoading || isOperating}
                    >
                      <ArrowUp size={14} />
                      {isPushing ? t('settings.sync.pushing') : t('settings.sync.push')}
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => onPush(true)}
                      disabled={isLoading || isOperating}
                      title={t('settings.sync.forcePushTitle')}
                    >
                      {t('settings.sync.forcePush')}
                    </button>
                  </div>
                </div>

                <div className="toolbar-setting-item" style={{ marginTop: '12px' }}>
                  <div className="setting-label-container">
                    <label className="setting-label">{t('settings.sync.mergePush')}</label>
                    <span className="runtime-card-desc">
                      {t('settings.sync.mergeDescription')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-primary"
                      onClick={() => onMerge()}
                      disabled={isLoading || isOperating}
                      title={t('settings.sync.mergeTitle')}
                    >
                      <GitMerge size={14} />
                      {isMerging ? t('settings.sync.merging') : t('settings.sync.mergePush')}
                    </button>
                  </div>
                </div>

                {/* Last sync time */}
                {settings.lastSyncTime && (
                  <div className="toolbar-setting-item" style={{ marginTop: '16px', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px' }}>
                    <span className="runtime-card-desc">
                      {t('settings.sync.lastSynced', { time: new Date(settings.lastSyncTime).toLocaleString() })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Check Status Card */}
            {settings.enabled && canSync && settings.repoUrl && status?.isInitialized && autoSetupStatus === 'done' && (
              <div className="toolbar-settings-card">
                <div className="toolbar-setting-item">
                  <div className="setting-label-container">
                    <label className="setting-label" style={{ fontWeight: 500 }}>{t('settings.sync.checkStatus')}</label>
                    <p className="runtime-card-desc">
                      {t('settings.sync.checkStatusDescription')}
                    </p>
                  </div>
                  <button
                    className="btn-primary"
                    onClick={onCheckStatus}
                    disabled={isLoading || isOperating || isCheckingStatus}
                    style={{
                      minWidth: '130px',
                    }}
                  >
                    {isCheckingStatus && (
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    )}
                    {isCheckingStatus ? t('settings.sync.checking') : t('settings.sync.checkStatus')}
                  </button>
                </div>

                {/* Status result */}
                {(status.hasLocalChanges || status.hasRemoteChanges) && (
                  <div className="toolbar-setting-item" style={{ marginTop: '8px', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '16px', flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '16px',
                        backgroundColor: status.hasLocalChanges ? 'rgb(var(--color-accent-rgb) / 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        fontSize: '13px',
                        color: status.hasLocalChanges ? 'var(--color-primary-600)' : 'var(--color-success-500)',
                      }}>
                        <ArrowUp size={14} />
                        {status.hasLocalChanges ? t('settings.sync.localChangesPending') : t('settings.sync.noLocalChanges')}
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '16px',
                        backgroundColor: status.hasRemoteChanges ? 'rgba(249, 115, 22, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        fontSize: '13px',
                        color: status.hasRemoteChanges ? 'var(--color-orange-500)' : 'var(--color-success-500)',
                      }}>
                        <ArrowDown size={14} />
                        {status.hasRemoteChanges ? t('settings.sync.remoteChangesAvailable') : t('settings.sync.upToDate')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

export default SyncSettingsContentView
