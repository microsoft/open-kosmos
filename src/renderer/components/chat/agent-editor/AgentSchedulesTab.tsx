import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { SchedulerJob } from '@shared/ipc/scheduler'
import { Plus } from 'lucide-react'

import '../../../styles/Agent.css'
import { TabComponentProps } from './types'
import SchedulesContentView, { ScheduleWakeNotice } from '../../settings/SchedulesContentView'
import { ScheduleCleanupSection } from '../../settings/ScheduleCleanupSection'
import AddScheduleOverlay, { type AddScheduleOverlayChatOption } from './AddScheduleOverlay'
import { schedulerApi } from '../../../ipc/scheduler'
import { profileDataManager } from '../../../lib/userData'
import { showScheduledRunStartedToast } from '../../../lib/scheduler/showScheduledRunStartedToast'
import { useToast } from '../../ui/ToastProvider'
import { useNavigate } from 'react-router-dom'
import { resolveChatAgent } from '@/lib/agent'
import { useI18n } from '../../../lib/i18n/useI18n'

const AgentSchedulesTab: React.FC<TabComponentProps> = ({
  chatId,
  agentData,
  readOnly = false,
}) => {
  const navigate = useNavigate()
  const { showToast, showSuccess, showError } = useToast()
  const { t } = useI18n()
  const tRef = useRef(t)
  const [jobs, setJobs] = useState<SchedulerJob[]>([])
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isOverlayOpen, setIsOverlayOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<SchedulerJob | null>(null)

  useEffect(() => {
    tRef.current = t
  }, [t])

  const loadJobs = useCallback(async () => {
    if (!chatId) {
      setJobs([])
      return
    }

    try {
      setError(null)
      const response = await schedulerApi.listJobs()
      if (response?.success && response.data) {
        setJobs(response.data.filter(job => job.chat_id === chatId))
      } else {
        setError(tRef.current('chat.schedule.loadFailed', {
          error: response?.error || tRef.current('common.unknownError'),
        }))
      }
    } catch (err) {
      setError(tRef.current('chat.schedule.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }, [chatId])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe(() => {
      loadJobs()
    })

    const handleCreated = (event: Event) => {
      const customEvent = event as CustomEvent<{ chatId?: string }>
      if (!customEvent.detail?.chatId || customEvent.detail.chatId === chatId) {
        loadJobs()
      }
    }

    const handleUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ chatId?: string }>
      if (!customEvent.detail?.chatId || customEvent.detail.chatId === chatId) {
        loadJobs()
      }
    }

    window.addEventListener('schedule:created', handleCreated as EventListener)
    window.addEventListener('schedule:updated', handleUpdated as EventListener)

    return () => {
      unsubscribe()
      window.removeEventListener('schedule:created', handleCreated as EventListener)
      window.removeEventListener('schedule:updated', handleUpdated as EventListener)
    }
  }, [chatId, loadJobs])

  useEffect(() => {
    const profile = profileDataManager.getProfile()
    const names: Record<string, string> = {}

    if (profile?.chats) {
      for (const chat of profile.chats) {
        const agent = resolveChatAgent(chat)
        if (chat.chat_id && agent?.name) {
          names[chat.chat_id] = agent.name
        }
      }
    }

    if (chatId && agentData?.name && !names[chatId]) {
      names[chatId] = agentData.name
    }

    setAgentNames(names)
  }, [chatId, agentData?.name])

  const handleToggle = useCallback(async (jobId: string, enabled: boolean) => {
    try {
      setError(null)
      const response = await schedulerApi.toggleJob(jobId, enabled)
      if (response?.success) {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, enabled } : j))
      } else {
        setError(t('chat.schedule.toggleFailed', { error: response?.error || t('common.unknownError') }))
      }
    } catch (err) {
      setError(t('chat.schedule.toggleFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }, [t])

  const handleDelete = useCallback(async (jobId: string) => {
    try {
      setError(null)
      const response = await schedulerApi.deleteJob(jobId)
      if (response?.success) {
        setJobs(prev => prev.filter(j => j.id !== jobId))
      } else {
        setError(t('chat.schedule.deleteFailed', { error: response?.error || t('common.unknownError') }))
      }
    } catch (err) {
      setError(t('chat.schedule.deleteFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }, [t])

  const handleUpdate = useCallback(async (jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description'>>) => {
    try {
      setError(null)
      const response = await schedulerApi.updateJob(jobId, updates)
      if (response?.success) {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...updates } : j))
      } else {
        setError(t('chat.schedule.updateFailed', { error: response?.error || t('common.unknownError') }))
      }
    } catch (err) {
      setError(t('chat.schedule.updateFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }, [t])

  const handleRunNow = useCallback(async (jobId: string) => {
    try {
      setError(null)
      const response = await schedulerApi.runJobNow(jobId)
      if (response?.success) {
        showScheduledRunStartedToast({
          result: response.data,
          chatId,
          navigate,
          showToast,
          showSuccess,
          t,
        })
        await loadJobs()
        return true
      }

      const message = t('chat.schedule.runFailed', { error: response?.error || t('common.unknownError') })
      setError(message)
      showError(message)
      return false
    } catch (err) {
      const message = t('chat.schedule.runFailed', { error: err instanceof Error ? err.message : String(err) })
      setError(message)
      showError(message)
      return false
    }
  }, [chatId, loadJobs, navigate, showError, showSuccess, showToast, t])

  const enabledCount = useMemo(() => jobs.filter(job => job.enabled).length, [jobs])
  const availableScheduleChats = useMemo<AddScheduleOverlayChatOption[]>(() => {
    const profile = profileDataManager.getProfile()
    return (profile?.chats || [])
      .map((chat) => ({ chat, agent: resolveChatAgent(chat) }))
      .filter(({ chat, agent }) => !!chat.chat_id && !!agent?.name)
      .map(({ chat, agent }) => ({
        id: chat.chat_id,
        name: agent?.name || chat.chat_id,
      }))
  }, [agentNames])

  const handleOpenAddSchedule = useCallback(() => {
    setEditingJob(null)
    setIsOverlayOpen(true)
  }, [])

  const handleEditSchedule = useCallback((job: SchedulerJob) => {
    setEditingJob(job)
    setIsOverlayOpen(true)
  }, [])

  const isScheduleReadOnly = readOnly
  const isEmptyState = !error && jobs.length === 0

  return (
    <div className="agent-tab">
      <div className="tab-header">
        <div className="header-summary">
          <span className="summary-text">
            {t('agent.schedules.enabledCount', { count: enabledCount })}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleOpenAddSchedule}
            title={t('agent.schedules.addNew')}
            disabled={isScheduleReadOnly}
          >
            <Plus size={14} />
            {t('agent.schedules.addNew')}
          </button>
        </div>
      </div>

      <div
        className="tab-body"
        style={{
          padding: 0,
        }}
      >
        {isEmptyState ? (
          <div
            style={{
              minHeight: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: '10px',
                maxWidth: '420px',
              }}
            >
              <p
                className="schedule-empty-title"
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 600,
                  color: 'var(--color-neutral-900)',
                }}
              >
                {t('agent.schedules.emptyTitle')}
              </p>
              <p
                className="schedule-empty-description"
                style={{
                  margin: 0,
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: 'var(--color-neutral-500)',
                }}
              >
                {t('agent.schedules.emptyDescription')}
              </p>
              <div style={{ width: '100%', marginTop: '2px' }}>
                <ScheduleWakeNotice compact />
              </div>
              <div style={{ width: '100%', marginTop: '8px' }}>
                <ScheduleCleanupSection chatId={chatId!} disabled={isScheduleReadOnly} />
              </div>
              <button
                className="manage-servers-btn"
                onClick={handleOpenAddSchedule}
                title={t('agent.schedules.addNew')}
                disabled={isScheduleReadOnly}
                style={{ marginTop: '6px' }}
              >
                {t('agent.schedules.addNew')}
              </button>
            </div>
          </div>
        ) : (
          <SchedulesContentView
            jobs={jobs}
            agentNames={agentNames}
            error={error}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onRunNow={handleRunNow}
            onEdit={handleEditSchedule}
            readOnly={isScheduleReadOnly}
            chatId={chatId!}
          />
        )}
      </div>

      <AddScheduleOverlay
        open={isOverlayOpen}
        onOpenChange={(open) => {
          setIsOverlayOpen(open)
          if (!open) {
            setEditingJob(null)
          }
        }}
        defaultChatId={chatId}
        lockChat
        chatOptions={availableScheduleChats}
        editingJob={editingJob}
        onCreated={(job) => {
          setJobs((prev) => [job, ...prev])
        }}
        onUpdated={(updatedJob) => {
          setJobs((prev) => prev.map((job) => job.id === updatedJob.id ? updatedJob : job))
        }}
      />
    </div>
  )
}

export default AgentSchedulesTab
