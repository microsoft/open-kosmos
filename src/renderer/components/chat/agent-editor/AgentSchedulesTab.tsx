import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { SchedulerJob } from '@shared/ipc/scheduler'


import '../../../styles/Agent.css'
import { TabComponentProps } from './types'
import SchedulesContentView, { ScheduleWakeNotice } from '../../settings/SchedulesContentView'
import AddScheduleOverlay, { type AddScheduleOverlayAgentOption } from './AddScheduleOverlay'
import { schedulerApi } from '../../../ipc/scheduler'
import { profileDataManager } from '../../../lib/userData'
import { showScheduledRunStartedToast } from '../../../lib/scheduler/showScheduledRunStartedToast'
import { useToast } from '../../ui/ToastProvider'
import { useNavigate } from 'react-router-dom'

const AgentSchedulesTab: React.FC<TabComponentProps> = ({
  agentId,
  agentData,
  readOnly = false,
}) => {
  const navigate = useNavigate()
  const { showToast, showSuccess, showError } = useToast()
  const [jobs, setJobs] = useState<SchedulerJob[]>([])
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isOverlayOpen, setIsOverlayOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<SchedulerJob | null>(null)

  const loadJobs = useCallback(async () => {
    if (!agentId) {
      setJobs([])
      return
    }

    try {
      setError(null)
      const response = await schedulerApi.listJobs()
      if (response?.success && response.data) {
        setJobs(response.data.filter(job => job.agentId === agentId))
      } else {
        setError('Failed to load schedules: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to load schedules: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [agentId])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  useEffect(() => {
    const unsubscribe = profileDataManager.subscribe(() => {
      loadJobs()
    })

    const handleCreated = (event: Event) => {
      const customEvent = event as CustomEvent<{ agentId?: string }>
      if (!customEvent.detail?.agentId || customEvent.detail.agentId === agentId) {
        loadJobs()
      }
    }

    const handleUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ agentId?: string }>
      if (!customEvent.detail?.agentId || customEvent.detail.agentId === agentId) {
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
  }, [agentId, loadJobs])

  useEffect(() => {
    const profile = profileDataManager.getProfile()
    const names: Record<string, string> = {}

    if (profile?.chats) {
      for (const chat of profile.chats) {
        if (chat.chat_id && chat.agent?.name) {
          names[chat.chat_id] = chat.agent.name
        }
      }
    }

    if (agentId && agentData?.name && !names[agentId]) {
      names[agentId] = agentData.name
    }

    setAgentNames(names)
  }, [agentId, agentData?.name])

  const handleToggle = useCallback(async (jobId: string, enabled: boolean) => {
    try {
      setError(null)
      const response = await schedulerApi.toggleJob(jobId, enabled)
      if (response?.success) {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, enabled } : j))
      } else {
        setError('Failed to toggle schedule: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to toggle schedule: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  const handleDelete = useCallback(async (jobId: string) => {
    try {
      setError(null)
      const response = await schedulerApi.deleteJob(jobId)
      if (response?.success) {
        setJobs(prev => prev.filter(j => j.id !== jobId))
      } else {
        setError('Failed to delete schedule: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to delete schedule: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  const handleUpdate = useCallback(async (jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'notifyOnCompletion'>>) => {
    try {
      setError(null)
      const response = await schedulerApi.updateJob(jobId, updates)
      if (response?.success) {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...updates } : j))
      } else {
        setError('Failed to update schedule: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError('Failed to update schedule: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  const handleRunNow = useCallback(async (jobId: string) => {
    try {
      setError(null)
      const response = await schedulerApi.runJobNow(jobId)
      if (response?.success) {
        showScheduledRunStartedToast({
          result: response.data,
          agentId,
          navigate,
          showToast,
          showSuccess,
        })
        await loadJobs()
        return true
      }

      const message = 'Failed to run schedule: ' + (response?.error || 'Unknown error')
      setError(message)
      showError(message)
      return false
    } catch (err) {
      const message = 'Failed to run schedule: ' + (err instanceof Error ? err.message : String(err))
      setError(message)
      showError(message)
      return false
    }
  }, [agentId, loadJobs, navigate, showError, showSuccess, showToast])

  const enabledCount = useMemo(() => jobs.filter(job => job.enabled).length, [jobs])
  const availableScheduleAgents = useMemo<AddScheduleOverlayAgentOption[]>(() => {
    const profile = profileDataManager.getProfile()
    return (profile?.chats || [])
      .filter((chat) => !!chat.chat_id && !!chat.agent?.name)
      .map((chat) => ({
        id: chat.chat_id,
        name: chat.agent?.name || chat.chat_id,
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
            {enabledCount} enabled schedules
          </span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleOpenAddSchedule}
            title="Add new schedule"
            disabled={isScheduleReadOnly}
          >
            Add New Schedule
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
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Add one-time or recurring schedules for this agent.
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: '#6B7280',
                }}
              >
                Scheduled runs can automatically send prompts to this agent at the time you choose.
              </p>
              <div style={{ width: '100%', marginTop: '2px' }}>
                <ScheduleWakeNotice compact />
              </div>
              <button
                className="manage-servers-btn"
                onClick={handleOpenAddSchedule}
                title="Add new schedule"
                disabled={isScheduleReadOnly}
                style={{ marginTop: '6px' }}
              >
                Add New Schedule
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
        defaultAgentId={agentId}
        lockAgent
        agents={availableScheduleAgents}
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
