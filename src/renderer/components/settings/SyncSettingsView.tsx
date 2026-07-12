'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useToast } from '../ui/ToastProvider'
import SyncSettingsHeaderView from './SyncSettingsHeaderView'
import SyncSettingsContentView, { SyncStatus } from './SyncSettingsContentView'
import { useFeatureFlag } from '../../lib/featureFlags'
import { profileDataManager } from '../../lib/userData/profileDataManager'
import type { SyncSettings } from '../../../main/lib/userDataADO/types/profile'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog'
import { AlertCircle } from 'lucide-react'
import '../../styles/RuntimeSettings.css'
import { logger } from '@renderer/lib/utilities/logger'
import { useI18n } from '../../lib/i18n/useI18n'

interface ExternalKnowledgeBase {
  chatId: string
  agentId: string
  agentName: string
  knowledgeBase: string
}

const SyncSettingsView: React.FC = () => {
  const { t } = useI18n()
  const [settings, setSettings] = useState<SyncSettings>({
    enabled: false,
    repoUrl: '',
    lastSyncTime: null,
  })
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [gitInstalled, setGitInstalled] = useState(false)
  const [userAlias, setUserAlias] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [repoUrlDraft, setRepoUrlDraft] = useState('')
  const [autoSetupStatus, setAutoSetupStatus] = useState<'idle' | 'checking' | 'repo-not-found' | 'done'>('idle')
  const [externalKBDialogOpen, setExternalKBDialogOpen] = useState(false)
  const [externalKBs, setExternalKBs] = useState<ExternalKnowledgeBase[]>([])
  const [pendingPushForce, setPendingPushForce] = useState(false)
  const [pendingPushNeedCommit, setPendingPushNeedCommit] = useState(true)
  const [isCopyingKB, setIsCopyingKB] = useState(false)

  const { showSuccess, showError } = useToast()

  const gitEnabled = useFeatureFlag('openkosmosUseGit')
  const syncEnabled = useFeatureFlag('openkosmosUseSync')

  // Load initial data and auto-setup sync
  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      // Check Git installation (even if feature disabled, we show the status)
      if (gitEnabled) {
        const gitSts = await window.electronAPI.runtime.checkGitVersion()
        setGitInstalled(gitSts.installed)
        if (!gitSts.installed) {
          return
        }
      } else {
        return
      }

      // Get user alias from profile
      const profile = profileDataManager.getProfile()
      let alias = ''
      if (profile?.alias) {
        alias = profile.alias
        setUserAlias(alias)
      }

      if (!window.electronAPI.sync || !alias) return

      // Load sync settings
      let syncSettings = await window.electronAPI.sync.getSettings()
      if (syncSettings) {
        setSettings(syncSettings)
        setRepoUrlDraft(syncSettings.repoUrl)
      } else {
        syncSettings = { enabled: false, repoUrl: '', lastSyncTime: null }
      }

      // Load basic status (isInitialized, currentBranch) without checking changes
      if (syncSettings.repoUrl) {
        const syncStatus = await window.electronAPI.sync.getStatus(false)
        if (syncStatus) {
          setStatus(syncStatus)
        }
      }

      // ---- Auto-setup: configure sync automatically ----
      if (!syncEnabled) return

      const expectedRepoUrl = `https://github.com/${alias}/openkosmos-sync`

      // Step 1: Auto-enable sync if not already enabled
      if (!syncSettings.enabled) {
        await window.electronAPI.sync.setEnabled(true)
        syncSettings = { ...syncSettings, enabled: true }
        setSettings(prev => ({ ...prev, enabled: true }))
      }

      // Step 2: Auto-fill repo URL if not set, then always validate
      const repoUrlToValidate = syncSettings.repoUrl || expectedRepoUrl
      if (!syncSettings.repoUrl) {
        setRepoUrlDraft(expectedRepoUrl)
      }

      // Always validate the repo URL exists on GitHub
      setAutoSetupStatus('checking')
      const validateResult = await window.electronAPI.sync.validateRepoUrl(repoUrlToValidate)

      if (!validateResult.success) {
        // Repo doesn't exist — prompt user to create it
        setRepoUrlDraft(expectedRepoUrl)
        setAutoSetupStatus('repo-not-found')
        return
      }

      // Repo exists — save URL if it wasn't saved yet
      if (!syncSettings.repoUrl) {
        const saveResult = await window.electronAPI.sync.setRepoUrl(expectedRepoUrl)
        if (saveResult.success) {
          syncSettings = { ...syncSettings, repoUrl: expectedRepoUrl }
          setSettings(prev => ({ ...prev, repoUrl: expectedRepoUrl }))
        }
      }

      // Step 3: Auto-initialize local repo if needed
      if (syncSettings.repoUrl) {
        const currentStatus = await window.electronAPI.sync.getStatus(false)
        if (currentStatus && !currentStatus.isInitialized) {
          const initResult = await window.electronAPI.sync.initialize()
          if (initResult.success) {
            const newStatus = await window.electronAPI.sync.getStatus(false)
            if (newStatus) setStatus(newStatus)
          }
        } else if (currentStatus) {
          setStatus(currentStatus)
        }
      }

      setAutoSetupStatus('done')
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to load sync settings:', e)
    } finally {
      setIsLoading(false)
    }
  }, [gitEnabled, syncEnabled])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleToggleSync = useCallback(async (enabled: boolean) => {
    try {
      if (window.electronAPI.sync) {
        await window.electronAPI.sync.setEnabled(enabled)
        setSettings(prev => ({ ...prev, enabled }))
        showSuccess(enabled ? t('settings.sync.enabledToast') : t('settings.sync.disabledToast'))
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to update sync setting:', e)
      showError(t('settings.sync.updateFailed'))
    }
  }, [showSuccess, showError, t])

  const handleSaveRepo = useCallback(async () => {
    setIsValidating(true)
    try {
      if (window.electronAPI.sync) {
        // Validate first
        const validateResult = await window.electronAPI.sync.validateRepoUrl(repoUrlDraft)
        if (!validateResult.success) {
          showError(validateResult.error || t('settings.sync.validationFailed'))
          return
        }

        // Then save
        const result = await window.electronAPI.sync.setRepoUrl(repoUrlDraft)
        if (result.success) {
          setSettings(prev => ({ ...prev, repoUrl: repoUrlDraft }))
          showSuccess(t('settings.sync.repoSaved'))
        } else {
          showError(result.error || t('settings.sync.repoSaveFailed'))
        }
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to save repository URL:', e)
      showError(t('settings.sync.repoSaveFailed'))
    } finally {
      setIsValidating(false)
    }
  }, [repoUrlDraft, showSuccess, showError, t])

  const handleInitializeRepo = useCallback(async () => {
    setIsLoading(true)
    try {
      if (window.electronAPI.sync) {
        const result = await window.electronAPI.sync.initialize()
        if (result.success) {
          showSuccess(t('settings.sync.repoInitialized'))
          // Reload status after init
          try {
            const syncStatus = await window.electronAPI.sync.getStatus(false)
            if (syncStatus) {
              setStatus(syncStatus)
            }
          } catch { /* ignore */ }
        } else {
          showError(result.error || t('settings.sync.repoInitializeFailed'))
        }
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to initialize repository:', e)
      showError(t('settings.sync.repoInitializeFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [showSuccess, showError, t])

  const handlePull = useCallback(async (force: boolean) => {
    setIsPulling(true)
    try {
      if (window.electronAPI.sync) {
        const result = await window.electronAPI.sync.pull(force)
        if (result.success) {
          showSuccess(force ? t('settings.sync.forcePullCompleted') : t('settings.sync.pullCompleted'))
          setSettings(prev => ({ ...prev, lastSyncTime: new Date().toISOString() }))
        } else {
          showError(result.error || t('settings.sync.pullFailed'))
        }
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to pull:', e)
      showError(t('settings.sync.pullFailed'))
    } finally {
      setIsPulling(false)
    }
  }, [showSuccess, showError, t])

  const executePush = useCallback(async (force: boolean, needCommit: boolean) => {
    setIsPushing(true)
    try {
      if (window.electronAPI.sync) {
        const result = await window.electronAPI.sync.push(force, needCommit)
        if (result.success) {
          showSuccess(force ? t('settings.sync.forcePushCompleted') : t('settings.sync.pushCompleted'))
          setSettings(prev => ({ ...prev, lastSyncTime: new Date().toISOString() }))
        } else {
          showError(result.error || t('settings.sync.pushFailed'))
        }
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to push:', e)
      showError(t('settings.sync.pushFailed'))
    } finally {
      setIsPushing(false)
    }
  }, [showSuccess, showError, t])

  const handlePush = useCallback(async (force: boolean, needCommit: boolean = true) => {
    if (!window.electronAPI.sync) return
    try {
      const checkResult = await window.electronAPI.sync.checkExternalKnowledgeBases()
      if (checkResult.success && checkResult.externalKnowledgeBases && checkResult.externalKnowledgeBases.length > 0) {
        setExternalKBs(checkResult.externalKnowledgeBases)
        setPendingPushForce(force)
        setPendingPushNeedCommit(needCommit)
        setExternalKBDialogOpen(true)
        return
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to check external knowledge bases:', e)
      // Continue with push even if check fails
    }
    await executePush(force, needCommit)
  }, [executePush])

  const handleMerge = useCallback(async () => {
    setIsMerging(true)
    try {
      if (window.electronAPI.sync) {
        const result = await window.electronAPI.sync.merge()
        if (result.success) {
          showSuccess(t('settings.sync.rebaseCompletedPushing'))
        } else {
          showError(result.error || t('settings.sync.mergeFailed'))
          return
        }
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to merge:', e)
      showError(t('settings.sync.mergeFailed'))
      return
    } finally {
      setIsMerging(false)
    }
    // After rebase, push with force (rebase rewrites history).
    // Skip commit since merge already committed the changes.
    await handlePush(true, false)
  }, [showSuccess, showError, handlePush, t])

  const handleKBCopyAndPush = useCallback(async () => {
    if (!window.electronAPI.sync) return
    setIsCopyingKB(true)
    try {
      const copyResult = await window.electronAPI.sync.copyKnowledgeBasesToProfile(
        externalKBs.map(kb => ({ chatId: kb.chatId, agentId: kb.agentId, knowledgeBase: kb.knowledgeBase }))
      )
      if (!copyResult.success) {
        showError(copyResult.error || t('settings.sync.copyKnowledgeFailed'))
        return
      }
      showSuccess(t('settings.sync.knowledgeCopied'))
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to copy knowledge bases:', e)
      showError(t('settings.sync.copyKnowledgeFailed'))
      return
    } finally {
      setIsCopyingKB(false)
    }
    setExternalKBDialogOpen(false)
    await executePush(pendingPushForce, pendingPushNeedCommit)
  }, [externalKBs, pendingPushForce, pendingPushNeedCommit, executePush, showSuccess, showError, t])

  const handleKBIgnoreAndPush = useCallback(async () => {
    setExternalKBDialogOpen(false)
    await executePush(pendingPushForce, pendingPushNeedCommit)
  }, [pendingPushForce, pendingPushNeedCommit, executePush])

  const handleCheckStatus = useCallback(async () => {
    setIsCheckingStatus(true)
    try {
      if (window.electronAPI.sync) {
        const syncStatus = await window.electronAPI.sync.getStatus()
        if (syncStatus) {
          setStatus(syncStatus)
          showSuccess(t('settings.sync.statusUpdated'))
        }
      }
    } catch (e) {
      logger.error('[SyncSettingsView] Failed to check status:', e)
      showError(t('settings.sync.checkStatusFailed'))
    } finally {
      setIsCheckingStatus(false)
    }
  }, [showSuccess, showError, t])

  const handleConfirmRepoCreated = useCallback(async () => {
    if (!window.electronAPI.sync) return

    setAutoSetupStatus('checking')

    // Re-validate that the repo now exists
    const validateResult = await window.electronAPI.sync.validateRepoUrl(repoUrlDraft)
    if (!validateResult.success) {
      showError(t('settings.sync.repositoryNotFound'))
      setAutoSetupStatus('repo-not-found')
      return
    }

    // Save repo URL
    const saveResult = await window.electronAPI.sync.setRepoUrl(repoUrlDraft)
    if (saveResult.success) {
      setSettings(prev => ({ ...prev, repoUrl: repoUrlDraft }))
    }

    // Auto-initialize local repo
    const initResult = await window.electronAPI.sync.initialize()
    if (initResult.success) {
      const syncStatus = await window.electronAPI.sync.getStatus(false)
      if (syncStatus) setStatus(syncStatus)
      showSuccess(t('settings.sync.repositoryConnected'))
    }

    setAutoSetupStatus('done')
  }, [repoUrlDraft, showSuccess, showError, t])

  return (
    <div className="runtime-settings-view">
      <SyncSettingsHeaderView />
      <SyncSettingsContentView
        settings={settings}
        status={status}
        gitInstalled={gitInstalled}
        gitEnabled={gitEnabled}
        syncEnabled={syncEnabled}
        userAlias={userAlias}
        isLoading={isLoading}
        isPulling={isPulling}
        isPushing={isPushing}
        isMerging={isMerging}
        isCheckingStatus={isCheckingStatus}
        isValidating={isValidating}
        repoUrlDraft={repoUrlDraft}
        onToggleSync={handleToggleSync}
        onRepoUrlChange={setRepoUrlDraft}
        onSaveRepo={handleSaveRepo}
        onPull={handlePull}
        onPush={handlePush}
        onMerge={handleMerge}
        onInitializeRepo={handleInitializeRepo}
        onCheckStatus={handleCheckStatus}
        autoSetupStatus={autoSetupStatus}
        onConfirmRepoCreated={handleConfirmRepoCreated}
      />

      {/* External Knowledge Base Dialog */}
      <Dialog open={externalKBDialogOpen} onOpenChange={setExternalKBDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={20} style={{ color: 'var(--color-warning-500)' }} />
              {t('settings.sync.externalKnowledgeDetected')}
            </DialogTitle>
            <DialogDescription>
              {t('settings.sync.externalKnowledgeDescription')}
            </DialogDescription>
          </DialogHeader>

          <div style={{ margin: '16px 0', maxHeight: '200px', overflowY: 'auto' }}>
            {externalKBs.map((kb, idx) => (
              <div key={idx} style={{
                padding: '8px 12px',
                marginBottom: '8px',
                backgroundColor: 'rgba(251, 191, 36, 0.08)',
                borderRadius: '6px',
                border: '1px solid rgba(251, 191, 36, 0.2)',
                fontSize: '13px',
              }}>
                <div style={{ fontWeight: 500, color: 'var(--color-neutral-700)' }}>{kb.agentName}</div>
                <div style={{ color: 'var(--color-neutral-500)', wordBreak: 'break-all', marginTop: '2px' }}>{kb.knowledgeBase}</div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={handleKBIgnoreAndPush}
              disabled={isCopyingKB}
            >
              {t('settings.sync.ignorePush')}
            </button>
            <button
              className="btn-primary"
              onClick={handleKBCopyAndPush}
              disabled={isCopyingKB}
            >
              {isCopyingKB ? t('settings.sync.copying') : t('settings.sync.copyToProfilePush')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SyncSettingsView
