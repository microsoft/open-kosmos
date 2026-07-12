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
import { useI18n } from '../../../lib/i18n/useI18n'

export interface AddScheduleOverlayChatOption {
  id: string
  name: string
}

interface AddScheduleOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultChatId?: string
  lockChat?: boolean
  chatOptions: AddScheduleOverlayChatOption[]
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

const recurringPresetLabelKey: Record<RecurringPreset, 'agent.scheduleOverlay.preset.daily' | 'agent.scheduleOverlay.preset.dailyMultiTime' | 'agent.scheduleOverlay.preset.weekly' | 'agent.scheduleOverlay.preset.monthly' | 'agent.scheduleOverlay.preset.everyNDays' | 'agent.scheduleOverlay.preset.everyNWeeks' | 'agent.scheduleOverlay.preset.everyNMonths'> = {
  daily: 'agent.scheduleOverlay.preset.daily',
  daily_multi_times: 'agent.scheduleOverlay.preset.dailyMultiTime',
  weekly: 'agent.scheduleOverlay.preset.weekly',
  monthly: 'agent.scheduleOverlay.preset.monthly',
  every_n_days: 'agent.scheduleOverlay.preset.everyNDays',
  every_n_weeks: 'agent.scheduleOverlay.preset.everyNWeeks',
  every_n_months: 'agent.scheduleOverlay.preset.everyNMonths',
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
  { labelKey: 'agent.scheduleOverlay.weekday.sunday', value: 0 },
  { labelKey: 'agent.scheduleOverlay.weekday.monday', value: 1 },
  { labelKey: 'agent.scheduleOverlay.weekday.tuesday', value: 2 },
  { labelKey: 'agent.scheduleOverlay.weekday.wednesday', value: 3 },
  { labelKey: 'agent.scheduleOverlay.weekday.thursday', value: 4 },
  { labelKey: 'agent.scheduleOverlay.weekday.friday', value: 5 },
  { labelKey: 'agent.scheduleOverlay.weekday.saturday', value: 6 },
] as const

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-neutral-700)',
  marginBottom: '8px',
}

const radioCardStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  minWidth: 0,
  border: `1px solid ${active ? 'var(--color-warm-900)' : 'var(--color-neutral-300)'}`,
  background: active ? 'var(--color-neutral-50)' : 'var(--color-white)',
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
  border: '1px solid var(--color-neutral-300)',
  borderRadius: '8px',
  fontSize: '14px',
  lineHeight: '20px',
  color: 'var(--color-neutral-900)',
  background: 'var(--color-white)',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...fieldStyle,
  minHeight: '96px',
  resize: 'vertical',
  fontFamily: 'inherit',
}

const disabledFieldStyle: React.CSSProperties = {
  background: 'var(--color-neutral-100)',
  color: 'var(--color-neutral-500)',
  borderColor: 'var(--color-neutral-200)',
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
  border: '1px solid var(--color-neutral-300)',
  background: 'var(--color-neutral-50)',
  color: 'var(--color-neutral-900)',
  padding: '8px 10px',
  fontSize: '13px',
  fontWeight: 500,
}

const chipRemoveButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-neutral-500)',
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
  defaultChatId,
  lockChat = false,
  chatOptions,
  editingJob,
  onCreated,
  onUpdated,
  initialValues,
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [chatId, setChatId] = useState(defaultChatId || '')
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const agentDropdownRef = React.useRef<HTMLDivElement>(null)
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return

    if (editingJob) {
      const parsedCron = parseCronExpression(editingJob.cronExpression)

      setName(editingJob.name || '')
      setDescription(editingJob.description || '')
      setMessage(editingJob.message || '')
      setChatId(editingJob.chat_id || defaultChatId || chatOptions[0]?.id || '')
      setMode(editingJob.scheduleType === 'cron' ? 'recurring' : 'once')
      setRunAt(buildLocalDateTimeInputFromIso(editingJob.runAt))
      setRecurringPreset(parsedCron.preset)
      setRecurringTime(parsedCron.time)
      setMultiDailyTimes(normalizeMultiDailyTimes(parsedCron.multiDailyTimes))
      setMultiDailyTimeDraft('')
      setEveryNValue(parsedCron.everyNValue)
      setWeeklyDay(parsedCron.weeklyDay)
      setMonthlyDay(parsedCron.monthlyDay)
    } else {
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setMessage(initialValues?.message || '')
      setChatId(defaultChatId || chatOptions[0]?.id || '')
      setMode(initialValues?.mode || 'once')
      setRunAt(defaultRunAt())
      setRecurringPreset((initialValues?.recurringPreset as RecurringPreset) || 'daily')
      setRecurringTime(initialValues?.recurringTime || '09:00')
      setMultiDailyTimes(DEFAULT_MULTI_DAILY_TIMES)
      setMultiDailyTimeDraft('')
      setEveryNValue(2)
      setWeeklyDay(1)
      setMonthlyDay(1)
    }

    setSubmitting(false)
    setError(null)
    setShowAgentDropdown(false)
    setMultiDailyDraftMessage(null)
  }, [open, editingJob, defaultChatId, chatOptions, initialValues])

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
      setMultiDailyDraftMessage(t('agent.scheduleOverlay.pickTimeFirst'))
      return
    }

    if (!MULTI_DAILY_TIME_REGEX.test(multiDailyTimeDraft)) {
      setMultiDailyDraftMessage(t('agent.scheduleOverlay.invalidTime'))
      return
    }

    if (multiDailyTimes.includes(multiDailyTimeDraft)) {
      setMultiDailyDraftMessage(t('agent.scheduleOverlay.timeAlreadyAdded', { time: multiDailyTimeDraft }))
      return
    }

    setMultiDailyTimes((previous) => normalizeMultiDailyTimes([...previous, multiDailyTimeDraft]))
    setMultiDailyTimeDraft('')
    setMultiDailyDraftMessage(null)
  }, [multiDailyTimeDraft, multiDailyTimes, t])

  const handleRemoveMultiDailyTime = useCallback((timeToRemove: string) => {
    setMultiDailyTimes((previous) => previous.filter((time) => time !== timeToRemove))
    setMultiDailyDraftMessage(null)
  }, [])

  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
  }, [])

  const canSubmit = useMemo(() => {
    if (!name.trim() || !description.trim() || !message.trim() || !chatId) {
      return false
    }

    if (mode === 'once') {
      return !!toIsoString(runAt)
    }

    return !!cronExpression && !recurringValidationMessage
  }, [name, description, message, chatId, mode, runAt, cronExpression, recurringValidationMessage])

  const isEditMode = !!editingJob
  const isChatSelectionLocked = lockChat
  const dialogTitle = isEditMode ? t('agent.scheduleOverlay.editTitle') : t('agent.scheduleOverlay.addTitle')
  const dialogDescription = isEditMode
    ? t('agent.scheduleOverlay.editDescription')
    : t('agent.scheduleOverlay.addDescription')
  const submitButtonTitle = isEditMode ? t('agent.scheduleOverlay.updateTitle') : t('agent.scheduleOverlay.createTitle')
  const submitButtonLabel = submitting
    ? (isEditMode ? t('agent.scheduleOverlay.updating') : t('agent.scheduleOverlay.creating'))
    : (isEditMode ? t('agent.scheduleOverlay.update') : t('agent.scheduleOverlay.add'))

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
        const updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'chat_id'>> = {
          name: trimmedName,
          description: trimmedDescription,
          message: trimmedMessage,
          scheduleType,
          cronExpression: nextCronExpression,
          runAt: nextRunAt,
          chat_id: chatId,
        }

        const response = await schedulerApi.updateJob(editingJob.id, updates)
        if (response?.success) {
          const updatedJob: SchedulerJob = {
            ...editingJob,
            ...updates,
          }
          window.dispatchEvent(new CustomEvent('schedule:updated', {
            detail: {
              chatId: updatedJob.chat_id,
              job: updatedJob,
            },
          }))
          onUpdated?.(updatedJob)
          onOpenChange(false)
          return
        }

        setError(response?.error || t('agent.scheduleOverlay.failedUpdate'))
        return
      }

      const job = {
        description: trimmedDescription,
        name: trimmedName,
        scheduleType,
        cronExpression: nextCronExpression,
        runAt: nextRunAt,
        enabled: true,
        chat_id: chatId,
        message: trimmedMessage,
        status: 'pending' as const,
      }

      const response = await schedulerApi.createJob(job)
      if (response?.success) {
        window.dispatchEvent(new CustomEvent('schedule:created', {
          detail: {
            chatId,
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

      setError(response?.error || t('agent.scheduleOverlay.failedCreate'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [chatId, canSubmit, cronExpression, description, editingJob, message, mode, name, onCreated, onOpenChange, onUpdated, runAt, submitting, t])

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
              background: 'var(--color-danger-50)',
              border: '1px solid var(--color-danger-200)',
              color: 'var(--color-danger-700)',
              fontSize: '13px',
            }}>
              {error}
            </div>
          )}

          <div>
            <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.scheduleType')}</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="button" style={radioCardStyle(mode === 'once')} onClick={() => setMode('once')}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-neutral-900)' }}>{t('agent.scheduleOverlay.oneTime')}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-neutral-500)', textAlign: 'left' }}>{t('agent.scheduleOverlay.oneTimeDescription')}</span>
              </button>
              <button type="button" style={radioCardStyle(mode === 'recurring')} onClick={() => setMode('recurring')}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-neutral-900)' }}>{t('agent.scheduleOverlay.recurring')}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-neutral-500)', textAlign: 'left' }}>{t('agent.scheduleOverlay.recurringDescription')}</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.name')}</div>
              <input style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('agent.scheduleOverlay.namePlaceholder')} />
            </div>
            <div>
              <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.agent')}</div>
              <div className="model-selector" ref={agentDropdownRef}>
                <button
                  type="button"
                  className="model-button"
                  onClick={() => !isChatSelectionLocked && setShowAgentDropdown(!showAgentDropdown)}
                  disabled={isChatSelectionLocked}
                  title={t('agent.scheduleOverlay.selectAgent')}
                  style={isChatSelectionLocked
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
                    {chatOptions.find((agent) => agent.id === chatId)?.name || t('agent.scheduleOverlay.selectAgent')}
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

                {showAgentDropdown && !isChatSelectionLocked && (
                  <div className="model-dropdown">
                    <div className="model-list">
                      {chatOptions.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          className={`model-option ${chatId === agent.id ? 'selected' : ''}`}
                          onClick={() => {
                            setChatId(agent.id)
                            setShowAgentDropdown(false)
                          }}
                        >
                          <div className="model-info chat-input-vertical">
                            <span className="model-option-name">{agent.name}</span>
                          </div>
                          {chatId === agent.id && (
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
              {isChatSelectionLocked && (
                <div style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  color: 'var(--color-neutral-500)',
                }}>
                  {isEditMode
                    ? t('agent.scheduleOverlay.agentLockedEditing')
                    : t('agent.scheduleOverlay.agentLockedCreating')}
                </div>
              )}
            </div>
          </div>

          <div>
            <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.description')}</div>
            <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('agent.scheduleOverlay.descriptionPlaceholder')} />
          </div>

          <div>
            <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.promptMessage')}</div>
            <textarea style={textareaStyle} value={message} onChange={handleMessageChange} placeholder={t('agent.scheduleOverlay.promptPlaceholder')} />
          </div>

          {mode === 'once' ? (
            <div>
              <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.runAt')}</div>
              <input type="datetime-local" style={fieldStyle} value={runAt} onChange={(e) => setRunAt(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.recurringPattern')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
                  {(Object.keys(recurringPresetLabelKey) as RecurringPreset[]).map((preset) => (
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
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-neutral-900)' }}>{t(recurringPresetLabelKey[preset])}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {recurringPreset === 'daily_multi_times' ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.timesOfDay')}</div>
                    {multiDailyTimes.length > 0 ? (
                      <div style={chipListStyle}>
                        {multiDailyTimes.map((time) => (
                          <span key={time} style={timeChipStyle}>
                            <span>{time}</span>
                            <button
                              type="button"
                              style={chipRemoveButtonStyle}
                              onClick={() => handleRemoveMultiDailyTime(time)}
                              title={t('agent.scheduleOverlay.removeTime', { time })}
                              aria-label={t('agent.scheduleOverlay.removeTime', { time })}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ marginBottom: '10px', fontSize: '12px', color: 'var(--color-neutral-500)' }}>
                        {t('agent.scheduleOverlay.noTimes')}
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
                        {t('agent.scheduleOverlay.addTime')}
                      </button>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '12px', color: (multiDailyDraftMessage || recurringValidationMessage) ? 'var(--color-danger-700)' : 'var(--color-neutral-500)' }}>
                      {multiDailyDraftMessage || recurringValidationMessage || t('agent.scheduleOverlay.timeHint')}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.time')}</div>
                    <input type="time" style={fieldStyle} value={recurringTime} onChange={(e) => setRecurringTime(e.target.value)} />
                  </div>
                )}

                {(recurringPreset === 'weekly' || recurringPreset === 'every_n_weeks') && (
                  <div>
                    <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.dayOfWeek')}</div>
                    <select style={fieldStyle} value={weeklyDay} onChange={(e) => setWeeklyDay(Number(e.target.value))}>
                      {weekDayOptions.map((option) => (
                        <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(recurringPreset === 'monthly' || recurringPreset === 'every_n_months') && (
                  <div>
                    <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.dayOfMonth')}</div>
                    <input type="number" min={1} max={28} style={fieldStyle} value={monthlyDay} onChange={(e) => setMonthlyDay(Number(e.target.value) || 1)} />
                  </div>
                )}

                {(recurringPreset === 'every_n_days' || recurringPreset === 'every_n_weeks' || recurringPreset === 'every_n_months') && (
                  <div>
                    <div style={sectionTitleStyle}>{t('agent.scheduleOverlay.repeatEvery')}</div>
                    <input type="number" min={1} style={fieldStyle} value={everyNValue} onChange={(e) => setEveryNValue(Number(e.target.value) || 1)} />
                  </div>
                )}
              </div>

              <div style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'var(--color-neutral-50)',
                border: '1px solid var(--color-neutral-200)',
                fontSize: '13px',
                color: 'var(--color-neutral-600)',
              }}>
                <div>{t('agent.scheduleOverlay.cronPreview')} <code>{cronExpression || t('agent.scheduleOverlay.invalidRecurring')}</code></div>
                {cronExpression && (
                  <div style={{ marginTop: '4px' }}>{t('agent.scheduleOverlay.summary')} {describeCronExpression(cronExpression)}</div>
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
            {t('common.cancel')}
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
