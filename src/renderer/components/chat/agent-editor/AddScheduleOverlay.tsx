import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog'
import { schedulerApi } from '../../../ipc/scheduler'
import type { SchedulerJob } from '@shared/ipc/scheduler'
import {
  buildDailyMultiTimesCronExpression,
  describeCronExpression,
  parseDailyMultiTimesCronExpression,
} from '../../../lib/scheduler/cronDescriptions'

export interface AddScheduleOverlayAgentOption {
  id: string
  name: string
}

interface AddScheduleOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultAgentId?: string
  lockAgent?: boolean
  agents: AddScheduleOverlayAgentOption[]
  editingJob?: SchedulerJob | null
  onCreated?: (job: SchedulerJob) => void
  onUpdated?: (job: SchedulerJob) => void
  /** Pre-fill values when creating a new schedule (not editing). */
  initialValues?: {
    name?: string
    description?: string
    message?: string
    mode?: OverlayScheduleMode
    recurringPreset?: RecurringPreset
    recurringTime?: string
  }
}

type OverlayScheduleMode = 'once' | 'recurring'
type RecurringPreset = 'daily' | 'daily_multi_times' | 'weekly' | 'monthly' | 'every_n_days' | 'every_n_weeks' | 'every_n_months'
const MULTI_DAILY_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/
const DEFAULT_MULTI_DAILY_TIMES = ['04:00', '08:00', '14:00', '18:00']

const pad = (value: number) => String(value).padStart(2, '0')

const formatLocalDate = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const formatLocalTime = (date: Date) => {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const buildLocalDateTimeValue = (date: Date) => `${formatLocalDate(date)}T${formatLocalTime(date)}`

const defaultRunAt = () => {
  const next = new Date(Date.now() + 60 * 60 * 1000)
  next.setSeconds(0, 0)
  return buildLocalDateTimeValue(next)
}

const toIsoString = (localDateTime: string) => {
  if (!localDateTime) return ''
  const date = new Date(localDateTime)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

const buildLocalDateTimeInputFromIso = (iso?: string) => {
  if (!iso) return defaultRunAt()
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? defaultRunAt() : buildLocalDateTimeValue(date)
}

const buildCronExpression = (
  preset: RecurringPreset,
  time: string,
  everyNValue: number,
  weeklyDay: number,
  monthlyDay: number,
) => {
  const [hourStr, minuteStr] = time.split(':')
  const minute = Number(minuteStr ?? '0')
  const hour = Number(hourStr ?? '9')
  const safeEvery = Math.max(1, everyNValue || 1)
  const safeWeeklyDay = Math.min(6, Math.max(0, weeklyDay || 1))
  const safeMonthlyDay = Math.min(28, Math.max(1, monthlyDay || 1))

  switch (preset) {
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${safeWeeklyDay}`
    case 'monthly':
      return `${minute} ${hour} ${safeMonthlyDay} * *`
    case 'every_n_days':
      return `${minute} ${hour} */${safeEvery} * *`
    case 'every_n_weeks':
      return `${minute} ${hour} * * ${safeWeeklyDay}/${safeEvery}`
    case 'every_n_months':
      return `${minute} ${hour} ${safeMonthlyDay} */${safeEvery} *`
    default:
      return `${minute} ${hour} * * *`
  }
}

const recurringPresetLabel: Record<RecurringPreset, string> = {
  daily: 'Daily',
  daily_multi_times: 'Daily Multi-Time',
  weekly: 'Weekly',
  monthly: 'Monthly',
  every_n_days: 'Every N Days',
  every_n_weeks: 'Every N Weeks',
  every_n_months: 'Every N Months',
}

type ParsedRecurringState = {
  preset: RecurringPreset
  time: string
  multiDailyTimes: string[]
  everyNValue: number
  weeklyDay: number
  monthlyDay: number
}

const normalizeMultiDailyTimes = (times: string[]) => {
  return Array.from(new Set(times.filter((time) => MULTI_DAILY_TIME_REGEX.test(time))))
    .sort((left, right) => left.localeCompare(right))
}

const parseCronExpression = (cronExpression?: string): ParsedRecurringState => {
  const fallback: ParsedRecurringState = {
    preset: 'daily',
    time: '09:00',
    multiDailyTimes: DEFAULT_MULTI_DAILY_TIMES,
    everyNValue: 2,
    weeklyDay: 1,
    monthlyDay: 1,
  }

  if (!cronExpression) return fallback

  const parsedDailyMultiTimes = parseDailyMultiTimesCronExpression(cronExpression)
  if (parsedDailyMultiTimes) {
    return {
      ...fallback,
      preset: 'daily_multi_times',
      time: parsedDailyMultiTimes[0],
      multiDailyTimes: parsedDailyMultiTimes,
    }
  }

  const parts = cronExpression.trim().split(/\s+/)
  const normalizedParts = parts.length === 6 ? parts.slice(1) : parts
  if (normalizedParts.length !== 5) return fallback

  const [minuteStr, hourStr, dayOfMonth, month, dayOfWeek] = normalizedParts
  const minute = Number(minuteStr)
  const hour = Number(hourStr)

  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return fallback
  }

  const time = `${pad(hour)}:${pad(minute)}`

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { ...fallback, preset: 'daily', time }
  }

  if (dayOfMonth === '*' && month === '*' && /^\d+$/.test(dayOfWeek)) {
    return { ...fallback, preset: 'weekly', time, weeklyDay: Number(dayOfWeek) }
  }

  if (/^\*\/\d+$/.test(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    return {
      ...fallback,
      preset: 'every_n_days',
      time,
      everyNValue: Number(dayOfMonth.slice(2)) || 1,
    }
  }

  if (dayOfMonth === '*' && month === '*' && /^\d+\/\d+$/.test(dayOfWeek)) {
    const [weeklyDayStr, everyNValueStr] = dayOfWeek.split('/')
    return {
      ...fallback,
      preset: 'every_n_weeks',
      time,
      weeklyDay: Number(weeklyDayStr) || 1,
      everyNValue: Number(everyNValueStr) || 1,
    }
  }

  if (/^\d+$/.test(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    return {
      ...fallback,
      preset: 'monthly',
      time,
      monthlyDay: Number(dayOfMonth) || 1,
    }
  }

  if (/^\d+$/.test(dayOfMonth) && /^\*\/\d+$/.test(month) && dayOfWeek === '*') {
    return {
      ...fallback,
      preset: 'every_n_months',
      time,
      monthlyDay: Number(dayOfMonth) || 1,
      everyNValue: Number(month.slice(2)) || 1,
    }
  }

  return { ...fallback, preset: 'daily', time }
}

const weekDayOptions = [
  { label: 'Sunday', value: 0 },
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
]

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '8px',
}

const radioCardStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  minWidth: 0,
  border: `1px solid ${active ? '#272320' : '#D1D5DB'}`,
  background: active ? '#F9FAFB' : '#FFFFFF',
  borderRadius: '10px',
  padding: '12px 14px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
})

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #D1D5DB',
  borderRadius: '8px',
  fontSize: '14px',
  lineHeight: '20px',
  color: '#111827',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...fieldStyle,
  minHeight: '96px',
  resize: 'vertical',
  fontFamily: 'inherit',
}

const disabledFieldStyle: React.CSSProperties = {
  background: '#F3F4F6',
  color: '#6B7280',
  borderColor: '#E5E7EB',
  cursor: 'not-allowed',
  opacity: 1,
}

const chipListStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginBottom: '10px',
}

const timeChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  borderRadius: '999px',
  border: '1px solid #D1D5DB',
  background: '#F9FAFB',
  color: '#111827',
  padding: '8px 10px',
  fontSize: '13px',
  fontWeight: 500,
}

const chipRemoveButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#6B7280',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  fontSize: '14px',
}

const addTimeButtonStyle: React.CSSProperties = {
  ...fieldStyle,
  width: 'auto',
  minWidth: '110px',
  cursor: 'pointer',
  fontWeight: 600,
}

const AddScheduleOverlay: React.FC<AddScheduleOverlayProps> = ({
  open,
  onOpenChange,
  defaultAgentId,
  lockAgent = false,
  agents,
  editingJob,
  onCreated,
  onUpdated,
  initialValues,
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [agentId, setAgentId] = useState(defaultAgentId || '')
  const [mode, setMode] = useState<OverlayScheduleMode>('once')

  const [runAt, setRunAt] = useState(defaultRunAt())
  const [recurringPreset, setRecurringPreset] = useState<RecurringPreset>('daily')
  const [recurringTime, setRecurringTime] = useState('09:00')
  const [multiDailyTimes, setMultiDailyTimes] = useState<string[]>(DEFAULT_MULTI_DAILY_TIMES)
  const [multiDailyTimeDraft, setMultiDailyTimeDraft] = useState('')
  const [multiDailyDraftMessage, setMultiDailyDraftMessage] = useState<string | null>(null)
  const [everyNValue, setEveryNValue] = useState(2)
  const [weeklyDay, setWeeklyDay] = useState(1)
  const [monthlyDay, setMonthlyDay] = useState(1)
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const agentDropdownRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    if (editingJob) {
      const parsedCron = parseCronExpression(editingJob.cronExpression)

      setName(editingJob.name || '')
      setDescription(editingJob.description || '')
      setMessage(editingJob.message || '')
      setAgentId(editingJob.agentId || defaultAgentId || agents[0]?.id || '')
      setMode(editingJob.scheduleType === 'cron' ? 'recurring' : 'once')
      setRunAt(buildLocalDateTimeInputFromIso(editingJob.runAt))
      setRecurringPreset(parsedCron.preset)
      setRecurringTime(parsedCron.time)
      setMultiDailyTimes(normalizeMultiDailyTimes(parsedCron.multiDailyTimes))
      setMultiDailyTimeDraft('')
      setEveryNValue(parsedCron.everyNValue)
      setWeeklyDay(parsedCron.weeklyDay)
      setMonthlyDay(parsedCron.monthlyDay)
      setNotifyOnCompletion(editingJob.notifyOnCompletion !== false)
    } else {
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setMessage(initialValues?.message || '')
      setAgentId(defaultAgentId || agents[0]?.id || '')
      setMode(initialValues?.mode || 'once')
      setRunAt(defaultRunAt())
      setRecurringPreset((initialValues?.recurringPreset as RecurringPreset) || 'daily')
      setRecurringTime(initialValues?.recurringTime || '09:00')
      setMultiDailyTimes(DEFAULT_MULTI_DAILY_TIMES)
      setMultiDailyTimeDraft('')
      setEveryNValue(2)
      setWeeklyDay(1)
      setMonthlyDay(1)
      setNotifyOnCompletion(true)
    }

    setSubmitting(false)
    setError(null)
    setShowAgentDropdown(false)
    setMultiDailyDraftMessage(null)
  }, [open, editingJob, defaultAgentId, agents, initialValues])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) {
        setShowAgentDropdown(false)
      }
    }

    if (showAgentDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAgentDropdown])

  const dailyMultiTimesResult = useMemo(() => {
    if (mode !== 'recurring' || recurringPreset !== 'daily_multi_times') {
      return null
    }

    return buildDailyMultiTimesCronExpression(multiDailyTimes.join(', '))
  }, [mode, recurringPreset, multiDailyTimes])

  const cronExpression = useMemo(() => {
    if (mode !== 'recurring') return undefined
    if (recurringPreset === 'daily_multi_times') {
      return dailyMultiTimesResult?.cronExpression
    }
    return buildCronExpression(recurringPreset, recurringTime, everyNValue, weeklyDay, monthlyDay)
  }, [mode, recurringPreset, recurringTime, everyNValue, weeklyDay, monthlyDay, dailyMultiTimesResult])

  const recurringValidationMessage = useMemo(() => {
    if (mode !== 'recurring' || recurringPreset !== 'daily_multi_times') {
      return null
    }

    return dailyMultiTimesResult?.error || null
  }, [mode, recurringPreset, dailyMultiTimesResult])

  const handleAddMultiDailyTime = useCallback(() => {
    if (!multiDailyTimeDraft) {
      setMultiDailyDraftMessage('Pick a time before adding it.')
      return
    }

    if (!MULTI_DAILY_TIME_REGEX.test(multiDailyTimeDraft)) {
      setMultiDailyDraftMessage('Select a valid time in HH:mm format.')
      return
    }

    if (multiDailyTimes.includes(multiDailyTimeDraft)) {
      setMultiDailyDraftMessage(`${multiDailyTimeDraft} is already in the list.`)
      return
    }

    setMultiDailyTimes((previous) => normalizeMultiDailyTimes([...previous, multiDailyTimeDraft]))
    setMultiDailyTimeDraft('')
    setMultiDailyDraftMessage(null)
  }, [multiDailyTimeDraft, multiDailyTimes])

  const handleRemoveMultiDailyTime = useCallback((timeToRemove: string) => {
    setMultiDailyTimes((previous) => previous.filter((time) => time !== timeToRemove))
    setMultiDailyDraftMessage(null)
  }, [])

  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
  }, [])

  const canSubmit = useMemo(() => {
    if (!name.trim() || !description.trim() || !message.trim() || !agentId) {
      return false
    }

    if (mode === 'once') {
      return !!toIsoString(runAt)
    }

    return !!cronExpression && !recurringValidationMessage
  }, [name, description, message, agentId, mode, runAt, cronExpression, recurringValidationMessage])

  const isEditMode = !!editingJob
  const isAgentSelectionLocked = lockAgent
  const dialogTitle = isEditMode ? 'Edit Schedule' : 'Add New Schedule'
  const dialogDescription = isEditMode
    ? 'Update this one-time or recurring schedule configuration.'
    : 'Create a one-time or recurring schedule for an agent. The current agent is selected by default.'
  const submitButtonTitle = isEditMode ? 'Update schedule' : 'Create schedule'
  const submitButtonLabel = submitting
    ? (isEditMode ? 'Updating...' : 'Creating...')
    : (isEditMode ? 'Update Schedule' : 'Add New Schedule')

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return

    try {
      setSubmitting(true)
      setError(null)

      const trimmedName = name.trim()
      const trimmedDescription = description.trim()
      const trimmedMessage = message.trim()
      const scheduleType: SchedulerJob['scheduleType'] = mode === 'once' ? 'once' : 'cron'
      const nextCronExpression = mode === 'recurring' ? cronExpression : undefined
      const nextRunAt = mode === 'once' ? toIsoString(runAt) : undefined

      if (editingJob) {
        const updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'agentId' | 'notifyOnCompletion'>> = {
          name: trimmedName,
          description: trimmedDescription,
          message: trimmedMessage,
          scheduleType,
          cronExpression: nextCronExpression,
          runAt: nextRunAt,
          agentId,
          notifyOnCompletion,
        }

        const response = await schedulerApi.updateJob(editingJob.id, updates)
        if (response?.success) {
          const updatedJob: SchedulerJob = {
            ...editingJob,
            ...updates,
          }
          window.dispatchEvent(new CustomEvent('schedule:updated', {
            detail: {
              agentId: updatedJob.agentId,
              job: updatedJob,
            },
          }))
          onUpdated?.(updatedJob)
          onOpenChange(false)
          return
        }

        setError(response?.error || 'Failed to update schedule')
        return
      }

      const job = {
        description: trimmedDescription,
        name: trimmedName,
        scheduleType,
        cronExpression: nextCronExpression,
        runAt: nextRunAt,
        enabled: true,
        agentId,
        message: trimmedMessage,
        status: 'pending' as const,
        notifyOnCompletion,
      }

      const response = await schedulerApi.createJob(job)
      if (response?.success) {
        window.dispatchEvent(new CustomEvent('schedule:created', {
          detail: {
            agentId,
          },
        }))
        onCreated?.({
          ...job,
          id: '',
          lastRunAt: undefined,
          executedAt: undefined,
        } as SchedulerJob)
        onOpenChange(false)
        return
      }

      setError(response?.error || 'Failed to create schedule')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [agentId, canSubmit, cronExpression, description, editingJob, message, mode, name, notifyOnCompletion, onCreated, onOpenChange, onUpdated, runAt, submitting])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="z-10000">
      <DialogContent className="w-[760px] max-w-[760px] max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginTop: '16px' }}>
          {error && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#B91C1C',
              fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          <div>
            <div style={sectionTitleStyle}>Schedule Type</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="button" style={radioCardStyle(mode === 'once')} onClick={() => setMode('once')}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>One-Time Schedule</span>
                <span style={{ fontSize: '12px', color: '#6B7280', textAlign: 'left' }}>Run once at a specific date and time.</span>
              </button>
              <button type="button" style={radioCardStyle(mode === 'recurring')} onClick={() => setMode('recurring')}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>Recurring Schedule</span>
                <span style={{ fontSize: '12px', color: '#6B7280', textAlign: 'left' }}>Repeat daily, weekly, monthly, or every N intervals.</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={sectionTitleStyle}>Schedule Name</div>
              <input style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily standup summary" />
            </div>
            <div>
              <div style={sectionTitleStyle}>Agent</div>
              <div className="model-selector" ref={agentDropdownRef}>
                <button
                  type="button"
                  className="model-button"
                  onClick={() => !isAgentSelectionLocked && setShowAgentDropdown(!showAgentDropdown)}
                  disabled={isAgentSelectionLocked}
                  title="Select Agent"
                  style={isAgentSelectionLocked
                    ? {
                        ...fieldStyle,
                        ...disabledFieldStyle,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: '42px',
                        margin: 0,
                        appearance: 'none',
                        WebkitAppearance: 'none',
                      }
                    : {
                        ...fieldStyle,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: '42px',
                        margin: 0,
                        appearance: 'none',
                        WebkitAppearance: 'none',
                      }}
                >
                  <span className="model-name">
                    {agents.find((agent) => agent.id === agentId)?.name || 'Select Agent'}
                  </span>
                  <svg
                    className={`dropdown-arrow ${showAgentDropdown ? 'rotated' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {showAgentDropdown && !isAgentSelectionLocked && (
                  <div className="model-dropdown">
                    <div className="model-list">
                      {agents.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          className={`model-option ${agentId === agent.id ? 'selected' : ''}`}
                          onClick={() => {
                            setAgentId(agent.id)
                            setShowAgentDropdown(false)
                          }}
                        >
                          <div className="model-info chat-input-vertical">
                            <span className="model-option-name">{agent.name}</span>
                          </div>
                          {agentId === agent.id && (
                            <svg className="check-icon" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {isAgentSelectionLocked && (
                <div style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  color: '#6B7280',
                }}>
                  {isEditMode
                    ? 'Agent is locked because this schedule is being edited from the current agent tab.'
                    : 'Agent is locked because this schedule is being created from the current agent tab.'}
                </div>
              )}
            </div>
          </div>

          <div>
            <div style={sectionTitleStyle}>Description</div>
            <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the latest project status every morning" />
          </div>

          <div>
            <div style={sectionTitleStyle}>Prompt Message</div>
            <textarea style={textareaStyle} value={message} onChange={handleMessageChange} placeholder="Write the exact prompt that the agent should receive when this schedule runs." />
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #E5E7EB',
            background: '#FFFFFF',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                Notify on completion
              </span>
              <span style={{ fontSize: '12px', color: '#6B7280' }}>
                Send a notification when this task finishes
              </span>
            </div>
            <label className="toolbar-toggle-wrapper">
              <input
                type="checkbox"
                checked={notifyOnCompletion}
                onChange={(e) => setNotifyOnCompletion(e.target.checked)}
              />
              <div className="toolbar-toggle-track"></div>
            </label>
          </div>

          {mode === 'once' ? (
            <div>
              <div style={sectionTitleStyle}>Run At</div>
              <input type="datetime-local" style={fieldStyle} value={runAt} onChange={(e) => setRunAt(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <div style={sectionTitleStyle}>Recurring Pattern</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
                  {(Object.keys(recurringPresetLabel) as RecurringPreset[]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      style={radioCardStyle(recurringPreset === preset)}
                      onClick={() => {
                        setRecurringPreset(preset)
                        if (preset === 'daily_multi_times' && multiDailyTimes.length === 0) {
                          setMultiDailyTimes(normalizeMultiDailyTimes([recurringTime]))
                        }
                        setMultiDailyDraftMessage(null)
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{recurringPresetLabel[preset]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {recurringPreset === 'daily_multi_times' ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={sectionTitleStyle}>Times of Day</div>
                    {multiDailyTimes.length > 0 ? (
                      <div style={chipListStyle}>
                        {multiDailyTimes.map((time) => (
                          <span key={time} style={timeChipStyle}>
                            <span>{time}</span>
                            <button
                              type="button"
                              style={chipRemoveButtonStyle}
                              onClick={() => handleRemoveMultiDailyTime(time)}
                              title={`Remove ${time}`}
                              aria-label={`Remove ${time}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ marginBottom: '10px', fontSize: '12px', color: '#6B7280' }}>
                        No times added yet.
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input
                        type="time"
                        style={fieldStyle}
                        value={multiDailyTimeDraft}
                        onChange={(e) => {
                          setMultiDailyTimeDraft(e.target.value)
                          setMultiDailyDraftMessage(null)
                        }}
                      />
                      <button
                        type="button"
                        style={addTimeButtonStyle}
                        onClick={handleAddMultiDailyTime}
                        disabled={!multiDailyTimeDraft}
                      >
                        Add Time
                      </button>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '12px', color: (multiDailyDraftMessage || recurringValidationMessage) ? '#B91C1C' : '#6B7280' }}>
                      {multiDailyDraftMessage || recurringValidationMessage || 'Add or remove time chips. A single schedule currently requires all times to share the same minute.'}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={sectionTitleStyle}>Time</div>
                    <input type="time" style={fieldStyle} value={recurringTime} onChange={(e) => setRecurringTime(e.target.value)} />
                  </div>
                )}

                {(recurringPreset === 'weekly' || recurringPreset === 'every_n_weeks') && (
                  <div>
                    <div style={sectionTitleStyle}>Day of Week</div>
                    <select style={fieldStyle} value={weeklyDay} onChange={(e) => setWeeklyDay(Number(e.target.value))}>
                      {weekDayOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(recurringPreset === 'monthly' || recurringPreset === 'every_n_months') && (
                  <div>
                    <div style={sectionTitleStyle}>Day of Month</div>
                    <input type="number" min={1} max={28} style={fieldStyle} value={monthlyDay} onChange={(e) => setMonthlyDay(Number(e.target.value) || 1)} />
                  </div>
                )}

                {(recurringPreset === 'every_n_days' || recurringPreset === 'every_n_weeks' || recurringPreset === 'every_n_months') && (
                  <div>
                    <div style={sectionTitleStyle}>Repeat Every</div>
                    <input type="number" min={1} style={fieldStyle} value={everyNValue} onChange={(e) => setEveryNValue(Number(e.target.value) || 1)} />
                  </div>
                )}
              </div>

              <div style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: '#F9FAFB',
                border: '1px solid #E5E7EB',
                fontSize: '13px',
                color: '#4B5563',
              }}>
                <div>Cron preview: <code>{cronExpression || 'Invalid recurring schedule'}</code></div>
                {cronExpression && (
                  <div style={{ marginTop: '4px' }}>Summary: {describeCronExpression(cronExpression)}</div>
                )}
              </div>
            </>
          )}
        </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-gray-200 px-6 py-4 flex flex-row justify-end gap-2 sm:flex-row sm:space-x-0">
          <button
            className="btn-secondary px-4 py-2 text-sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="manage-servers-btn"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            title={submitButtonTitle}
          >
            {submitButtonLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AddScheduleOverlay
