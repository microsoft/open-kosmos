import React, { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronRight, Pencil, Play, Trash2 } from 'lucide-react'
import type { SchedulerJob } from '@shared/ipc/scheduler'
import { describeCronExpression } from '../../lib/scheduler/cronDescriptions'
import { ScheduleSessionList } from './ScheduleSessionList'
import { useI18n } from '../../lib/i18n/useI18n'

const RUN_NOW_DEBOUNCE_MS = 1200

type ScheduleUpdates = Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description'>>

const InlineEditableMessage: React.FC<{
  value: string
  onSave: (newValue: string) => void
  disabled?: boolean
}> = ({ value, onSave, disabled = false }) => {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else {
      setDraft(value)
    }
    setEditing(false)
  }, [draft, value, onSave])

  const handleClick = () => {
    if (disabled) return
    setDraft(value)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  if (editing) {
    return (
      <input
        className="schedule-inline-message-input"
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={{
          width: '100%',
          minWidth: 0,
          padding: '6px 8px',
          fontSize: '13px',
          lineHeight: 1.5,
          fontFamily: 'inherit',
          color: 'var(--color-neutral-900)',
          border: '1px solid var(--color-neutral-300)',
          borderRadius: '6px',
          outline: 'none',
          backgroundColor: 'var(--color-white)',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)' }}
      />
    )
  }

  return (
    <div
      className="schedule-inline-message-display"
      onClick={handleClick}
      title={disabled ? undefined : t('settings.schedules.clickToEditMessage')}
      style={{
        cursor: disabled ? 'default' : 'text',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        borderRadius: '6px',
        padding: '6px 8px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: 'var(--color-neutral-900)',
        backgroundColor: 'var(--color-neutral-50)',
        border: '1px solid var(--color-neutral-200)',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = 'var(--color-neutral-100)'
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = 'var(--color-neutral-50)'
      }}
    >
      {value}
    </div>
  )
}

const formatDateTime = (iso?: string) => {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const describeSchedule = (job: SchedulerJob) => {
  if (job.scheduleType === 'once') {
    return job.runAt ? `One-time at ${formatDateTime(job.runAt)}` : 'One-time schedule'
  }

  return describeCronExpression(job.cronExpression)
}

const getScheduleValue = (job: SchedulerJob) => {
  return job.scheduleType === 'once' ? (job.runAt || '-') : (job.cronExpression || '-')
}

const DetailItem: React.FC<{
  label: string
  children: React.ReactNode
}> = ({ label, children }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  }}>
    <div style={{
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'var(--color-neutral-400)',
    }}>
      {label}
    </div>
    <div className="schedule-detail-value" style={{
      fontSize: '12px',
      color: 'var(--color-neutral-900)',
      lineHeight: 1.5,
      minWidth: 0,
      wordBreak: 'break-word',
    }}>
      {children}
    </div>
  </div>
)

export const ScheduleCard: React.FC<{
  job: SchedulerJob
  agentName: string
  onToggle: (jobId: string, enabled: boolean) => void
  onDelete: (jobId: string) => void
  onUpdate: (jobId: string, updates: ScheduleUpdates) => void
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit?: (job: SchedulerJob) => void
  readOnly?: boolean
}> = ({ job, agentName, onToggle, onDelete, onUpdate, onRunNow, onEdit, readOnly = false }) => {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const lastRunNowAtRef = useRef(0)
  const friendlyTime = useMemo(() => describeSchedule(job), [job])
  const scheduleValue = useMemo(() => getScheduleValue(job), [job])
  const scheduleTypeText = useMemo(() => (
    job.scheduleType === 'once' ? t('settings.schedules.typeOnce') : t('settings.schedules.typeRecurring')
  ), [job.scheduleType, t])
  const statusText = useMemo(() => {
    switch (job.status) {
      case 'completed':
        return t('settings.schedules.statusCompleted')
      case 'expired':
        return t('settings.schedules.statusExpired')
      case 'failed':
        return t('settings.schedules.statusFailed')
      default:
        return job.enabled ? t('settings.schedules.statusPending') : t('settings.schedules.statusDisabled')
    }
  }, [job.enabled, job.status, t])

  const handleRunNow = useCallback(async () => {
    const now = Date.now()

    if (readOnly || !job.enabled) {
      return
    }

    if (now - lastRunNowAtRef.current < RUN_NOW_DEBOUNCE_MS) {
      return
    }

    lastRunNowAtRef.current = now
    await onRunNow(job.id)
  }, [job.enabled, job.id, onRunNow, readOnly])

  return (
    <div
      className="toolbar-settings-card schedule-card"
      style={{
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: '20px minmax(0, 1fr) auto auto',
              alignItems: 'center',
              gap: '10px',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <ChevronRight
              size={16}
              style={{
                color: 'var(--color-neutral-500)',
                transition: 'transform 0.15s ease',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div className="schedule-card-title" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-neutral-900)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {job.name}
              </div>
            </div>
            <span className="schedule-card-chip" style={{
              justifySelf: 'end',
              minWidth: 0,
              maxWidth: '180px',
              fontSize: '11px',
              color: 'var(--color-neutral-600)',
              backgroundColor: 'var(--color-neutral-100)',
              border: '1px solid var(--color-neutral-200)',
              borderRadius: '999px',
              padding: '2px 8px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {agentName}
            </span>
            <span className="schedule-card-chip" style={{
              justifySelf: 'end',
              fontSize: '11px',
              color: 'var(--color-neutral-600)',
              backgroundColor: 'var(--color-neutral-100)',
              border: '1px solid var(--color-neutral-200)',
              borderRadius: '999px',
              padding: '2px 8px',
              textTransform: 'capitalize',
              whiteSpace: 'nowrap',
            }}>
              {scheduleTypeText}
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <button
              className="schedule-run-now-button"
              onClick={handleRunNow}
              disabled={readOnly || !job.enabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: '1px solid var(--color-neutral-300)',
                borderRadius: '999px',
                backgroundColor: readOnly || !job.enabled ? 'var(--color-neutral-50)' : 'var(--color-white)',
                color: readOnly || !job.enabled ? 'var(--color-neutral-400)' : 'var(--color-neutral-700)',
                cursor: readOnly || !job.enabled ? 'not-allowed' : 'pointer',
                padding: '5px 10px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: 1,
              }}
              title={
                !job.enabled
                  ? t('settings.schedules.enableBeforeRun')
                  : t('settings.schedules.runImmediately')
              }
              onMouseEnter={(e) => {
                if (!readOnly && job.enabled) {
                  e.currentTarget.style.backgroundColor = 'var(--color-neutral-50)'
                  e.currentTarget.style.borderColor = 'var(--color-neutral-400)'
                }
              }}
              onMouseLeave={(e) => {
                if (!readOnly && job.enabled) {
                  e.currentTarget.style.backgroundColor = 'var(--color-white)'
                  e.currentTarget.style.borderColor = 'var(--color-neutral-300)'
                }
              }}
            >
              <Play size={12} fill={readOnly || !job.enabled ? 'none' : 'currentColor'} />
              <span>{t('settings.schedules.runNow')}</span>
            </button>
            <label className="toolbar-toggle-wrapper" onClick={(e) => e.stopPropagation()} style={readOnly ? { cursor: 'not-allowed', opacity: 0.6 } : undefined}>
              <input
                type="checkbox"
                checked={job.enabled}
                onChange={(e) => onToggle(job.id, e.target.checked)}
                disabled={readOnly}
              />
              <div className="toolbar-toggle-track"></div>
            </label>
            {onEdit && (
              <button
                className="schedule-icon-button schedule-icon-button-edit"
                onClick={() => onEdit(job)}
                disabled={readOnly}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: readOnly ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  color: readOnly ? 'var(--color-neutral-300)' : 'var(--color-neutral-400)',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={t('settings.schedules.edit')}
                onMouseEnter={(e) => {
                  if (!readOnly) e.currentTarget.style.color = 'var(--color-neutral-600)'
                }}
                onMouseLeave={(e) => {
                  if (!readOnly) e.currentTarget.style.color = 'var(--color-neutral-400)'
                }}
              >
                <Pencil size={15} />
              </button>
            )}
            <button
              className="schedule-icon-button schedule-icon-button-delete"
              onClick={() => onDelete(job.id)}
              disabled={readOnly}
              style={{
                background: 'none',
                border: 'none',
                cursor: readOnly ? 'not-allowed' : 'pointer',
                padding: '4px',
                color: readOnly ? 'var(--color-neutral-300)' : 'var(--color-neutral-400)',
                display: 'flex',
                alignItems: 'center',
              }}
              title={t('settings.schedules.delete')}
              onMouseEnter={(e) => {
                if (!readOnly) e.currentTarget.style.color = 'var(--color-danger-500)'
              }}
              onMouseLeave={(e) => {
                if (!readOnly) e.currentTarget.style.color = 'var(--color-neutral-400)'
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="schedule-expanded-content" style={{
            borderTop: '1px solid var(--color-neutral-200)',
            paddingTop: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}>
              <DetailItem label={t('settings.schedules.agent')}>{agentName}</DetailItem>
              <DetailItem label={t('settings.schedules.scheduleType')}>{scheduleTypeText}</DetailItem>
              <DetailItem label={t('settings.schedules.friendlySchedule')}>{friendlyTime}</DetailItem>
              <DetailItem label={t('settings.schedules.rawSchedule')}>
                <code className="schedule-raw-code" style={{
                  display: 'inline-block',
                  backgroundColor: 'var(--color-neutral-50)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--color-neutral-600)',
                  border: '1px solid var(--color-neutral-200)',
                }}>
                  {scheduleValue}
                </code>
              </DetailItem>
              <DetailItem label={t('settings.schedules.status')}>{statusText}</DetailItem>
              {job.executedAt && <DetailItem label={t('settings.schedules.executedAt')}>{formatDateTime(job.executedAt)}</DetailItem>}
            </div>

            <div>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--color-neutral-400)',
                marginBottom: '6px',
              }}>
                {t('settings.schedules.message')}
              </div>
              <InlineEditableMessage
                value={job.message}
                onSave={(newMessage) => onUpdate(job.id, { message: newMessage })}
                disabled={readOnly}
              />
            </div>

            <ScheduleSessionList
              jobId={job.id}
              chatId={job.chat_id}
            />
          </div>
        )}
      </div>
    </div>
  )
}