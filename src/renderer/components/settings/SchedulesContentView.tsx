'use client'

import React, { useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, ChevronRight, Pencil, Play } from 'lucide-react'
import type { SchedulerJob, SchedulerSessionInfo } from '@shared/ipc/scheduler'
import { schedulerApi } from '../../ipc/scheduler'
import { describeCronExpression } from '../../lib/scheduler/cronDescriptions'
import '../../styles/ContentView.css'
import '../../styles/SettingsComponents.css'
import '../../styles/ToolbarSettings.css'

const RUN_NOW_DEBOUNCE_MS = 1200

interface SchedulesContentViewProps {
  jobs: SchedulerJob[]
  agentNames: Record<string, string>
  error: string | null
  onToggle: (jobId: string, enabled: boolean) => void
  onDelete: (jobId: string) => void
  onUpdate: (jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'notifyOnCompletion'>>) => void
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit?: (job: SchedulerJob) => void
  readOnly?: boolean
}

export const ScheduleWakeNotice: React.FC<{
  compact?: boolean
}> = ({ compact = false }) => (
  <div
    className="toolbar-settings-card"
    style={{
      padding: compact ? '12px 14px' : '14px 16px',
      border: '1px solid #FCD34D',
      background: '#FFFBEB',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#92400E' }}>
        On-time runs require the app and machine to stay awake.
      </p>
      <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.6, color: '#92400E' }}>
        If the device sleeps through a recurring schedule, the app will attempt one catch-up run after resume when
        the missed run is still recent. One-time schedules are not replayed after their scheduled moment passes.
      </p>
    </div>
  </div>
)

/** Inline-editable message span: looks like plain text, becomes editable on click, saves on blur/Enter */
const InlineEditableMessage: React.FC<{
  value: string
  onSave: (newValue: string) => void
  disabled?: boolean
}> = ({ value, onSave, disabled = false }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else {
      setDraft(value) // revert
    }
    setEditing(false)
  }, [draft, value, onSave])

  const handleClick = () => {
    if (disabled) return
    setDraft(value)
    setEditing(true)
    // focus after next render
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  if (editing) {
    return (
      <input
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
          color: '#111827',
          border: '1px solid #D1D5DB',
          borderRadius: '6px',
          outline: 'none',
          backgroundColor: '#FFFFFF',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#3B82F6' }}
      />
    )
  }

  return (
    <div
      onClick={handleClick}
      title={disabled ? undefined : 'Click to edit message'}
      style={{
        cursor: disabled ? 'default' : 'text',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        borderRadius: '6px',
        padding: '6px 8px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: '#111827',
        backgroundColor: '#F9FAFB',
        border: '1px solid #E5E7EB',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = '#F3F4F6'
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.backgroundColor = '#F9FAFB'
      }}
    >
      {value}
    </div>
  )
}

const formatDateTime = (iso?: string) => {
  if (!iso) return '—'
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
  return job.scheduleType === 'once' ? (job.runAt || '—') : (job.cronExpression || '—')
}

const formatScheduleStatus = (job: SchedulerJob) => {
  switch (job.status) {
    case 'completed':
      return 'Completed'
    case 'expired':
      return 'Expired'
    case 'failed':
      return 'Failed'
    default:
      return job.enabled ? 'Pending' : 'Disabled'
  }
}

const formatScheduleType = (scheduleType: SchedulerJob['scheduleType']) => {
  return scheduleType === 'once' ? 'One-time' : 'Recurring'
}

/** Expandable session list for a schedule */
const ScheduleSessionList: React.FC<{
  jobId: string
  agentId: string
}> = ({ jobId, agentId }) => {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [sessions, setSessions] = useState<SchedulerSessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await schedulerApi.getJobSessions(jobId)
      if (res?.success && res.data) {
        setSessions(res.data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [jobId])

  const handleToggle = useCallback(async () => {
    const next = !expanded
    setExpanded(next)
    if (next) {
      await fetchSessions()
    }
  }, [expanded, fetchSessions])

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  return (
    <div style={{
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid #E5E7EB',
    }}>
      <button
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontSize: '12px',
          fontWeight: 600,
          color: '#4B5563',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#3B82F6' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#4B5563' }}
      >
        <ChevronRight
          size={14}
          style={{
            transition: 'transform 0.15s ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
        <span>Scheduled runs</span>
        {loaded && (
          <span style={{
            fontSize: '11px',
            fontWeight: 500,
            color: '#6B7280',
            backgroundColor: '#F3F4F6',
            borderRadius: '999px',
            padding: '1px 6px',
          }}>
            {sessions.length}
          </span>
        )}
      </button>

      {expanded && (
        <div style={{
          marginTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}>
          {loading && (
            <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Loading...</span>
          )}
          {!loading && sessions.length === 0 && loaded && (
            <span style={{ fontSize: '12px', color: '#9CA3AF' }}>No scheduled runs found</span>
          )}
          {sessions.map((s) => (
            <button
              key={s.chatSession_id}
              onClick={() => navigate(`/agent/chat/${agentId}/${s.chatSession_id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                backgroundColor: '#F9FAFB',
                border: '1px solid #E5E7EB',
                cursor: 'pointer',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#374151',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F3F4F6' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F9FAFB' }}
              title={`Open session: ${s.title}`}
            >
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
                fontWeight: 500,
              }}>
                {s.title}
              </span>
              <span style={{
                fontSize: '11px',
                color: '#9CA3AF',
                flexShrink: 0,
              }}>
                {formatDate(s.last_updated)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
      color: '#9CA3AF',
    }}>
      {label}
    </div>
    <div style={{
      fontSize: '12px',
      color: '#111827',
      lineHeight: 1.5,
      minWidth: 0,
      wordBreak: 'break-word',
    }}>
      {children}
    </div>
  </div>
)

const ScheduleCard: React.FC<{
  job: SchedulerJob
  agentName: string
  onToggle: (jobId: string, enabled: boolean) => void
  onDelete: (jobId: string) => void
  onUpdate: (jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'notifyOnCompletion'>>) => void
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit?: (job: SchedulerJob) => void
  readOnly?: boolean
}> = ({ job, agentName, onToggle, onDelete, onUpdate, onRunNow, onEdit, readOnly = false }) => {
  const [expanded, setExpanded] = useState(false)
  const lastRunNowAtRef = useRef(0)
  const friendlyTime = useMemo(() => describeSchedule(job), [job])
  const scheduleValue = useMemo(() => getScheduleValue(job), [job])
  const statusText = useMemo(() => formatScheduleStatus(job), [job])

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
      className="toolbar-settings-card"
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
                color: '#6B7280',
                transition: 'transform 0.15s ease',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {job.name}
              </div>
            </div>
            <span style={{
              justifySelf: 'end',
              minWidth: 0,
              maxWidth: '180px',
              fontSize: '11px',
              color: '#4B5563',
              backgroundColor: '#F3F4F6',
              border: '1px solid #E5E7EB',
              borderRadius: '999px',
              padding: '2px 8px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {agentName}
            </span>
            <span style={{
              justifySelf: 'end',
              fontSize: '11px',
              color: '#4B5563',
              backgroundColor: '#F3F4F6',
              border: '1px solid #E5E7EB',
              borderRadius: '999px',
              padding: '2px 8px',
              textTransform: 'capitalize',
              whiteSpace: 'nowrap',
            }}>
              {formatScheduleType(job.scheduleType)}
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <button
              onClick={handleRunNow}
              disabled={readOnly || !job.enabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: '1px solid #D1D5DB',
                borderRadius: '999px',
                backgroundColor: readOnly || !job.enabled ? '#F9FAFB' : '#FFFFFF',
                color: readOnly || !job.enabled ? '#9CA3AF' : '#374151',
                cursor: readOnly || !job.enabled ? 'not-allowed' : 'pointer',
                padding: '5px 10px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: 1,
              }}
              title={
                !job.enabled
                  ? 'Enable this schedule before running it now'
                  : 'Run this schedule immediately'
              }
              onMouseEnter={(e) => {
                if (!readOnly && job.enabled) {
                  e.currentTarget.style.backgroundColor = '#F9FAFB'
                  e.currentTarget.style.borderColor = '#9CA3AF'
                }
              }}
              onMouseLeave={(e) => {
                if (!readOnly && job.enabled) {
                  e.currentTarget.style.backgroundColor = '#FFFFFF'
                  e.currentTarget.style.borderColor = '#D1D5DB'
                }
              }}
            >
              <Play size={12} fill={readOnly || !job.enabled ? 'none' : 'currentColor'} />
              <span>Run now</span>
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
                onClick={() => onEdit(job)}
                disabled={readOnly}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: readOnly ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  color: readOnly ? '#D1D5DB' : '#9CA3AF',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Edit schedule"
                onMouseEnter={(e) => {
                  if (!readOnly) e.currentTarget.style.color = '#4B5563'
                }}
                onMouseLeave={(e) => {
                  if (!readOnly) e.currentTarget.style.color = '#9CA3AF'
                }}
              >
                <Pencil size={15} />
              </button>
            )}
            <button
              onClick={() => onDelete(job.id)}
              disabled={readOnly}
              style={{
                background: 'none',
                border: 'none',
                cursor: readOnly ? 'not-allowed' : 'pointer',
                padding: '4px',
                color: readOnly ? '#D1D5DB' : '#9CA3AF',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Delete schedule"
              onMouseEnter={(e) => {
                if (!readOnly) e.currentTarget.style.color = '#EF4444'
              }}
              onMouseLeave={(e) => {
                if (!readOnly) e.currentTarget.style.color = '#9CA3AF'
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {expanded && (
          <div style={{
            borderTop: '1px solid #E5E7EB',
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
              <DetailItem label="Agent">{agentName}</DetailItem>
              <DetailItem label="Schedule Type">{formatScheduleType(job.scheduleType)}</DetailItem>
              <DetailItem label="Friendly Schedule">{friendlyTime}</DetailItem>
              <DetailItem label="Raw Schedule">
                <code style={{
                  display: 'inline-block',
                  backgroundColor: '#F9FAFB',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#4B5563',
                  border: '1px solid #E5E7EB',
                }}>
                  {scheduleValue}
                </code>
              </DetailItem>
              <DetailItem label="Status">{statusText}</DetailItem>
              {job.executedAt && <DetailItem label="Executed At">{formatDateTime(job.executedAt)}</DetailItem>}
            </div>

            <div>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#9CA3AF',
                marginBottom: '6px',
              }}>
                Message
              </div>
              <InlineEditableMessage
                value={job.message}
                onSave={(newMessage) => onUpdate(job.id, { message: newMessage })}
                disabled={readOnly}
              />
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 0',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827' }}>
                  Notify on completion
                </span>
                <span style={{ fontSize: '12px', color: '#6B7280' }}>
                  Send a notification when this task finishes
                </span>
              </div>
              <label className="toolbar-toggle-wrapper" style={readOnly ? { cursor: 'not-allowed', opacity: 0.6 } : undefined}>
                <input
                  type="checkbox"
                  checked={job.notifyOnCompletion !== false}
                  onChange={(e) => onUpdate(job.id, { notifyOnCompletion: e.target.checked })}
                  disabled={readOnly}
                />
                <div className="toolbar-toggle-track"></div>
              </label>
            </div>

            <ScheduleSessionList
              jobId={job.id}
              agentId={job.agentId}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const SchedulesContentView: React.FC<SchedulesContentViewProps> = ({
  jobs,
  agentNames,
  error,
  onToggle,
  onDelete,
  onUpdate,
  onRunNow,
  onEdit,
  readOnly = false,
}) => {
  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <ScheduleWakeNotice />

            {/* Error Message */}
            {error && (
              <div className="toolbar-settings-error glass-surface">
                <div className="message-header">
                  <div className="message-indicator"></div>
                  <span className="message-label">Error:</span>
                </div>
                <p className="message-text">{error}</p>
              </div>
            )}

            {jobs.length === 0 ? (
              <div className="toolbar-settings-card">
                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                  <p style={{ color: '#6B7280', fontSize: '15px', margin: 0 }}>
                    No scheduled tasks. Use the <code style={{
                      backgroundColor: '#F3F4F6',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}>create_schedule</code> tool in a chat to create one.
                  </p>
                </div>
              </div>
            ) : (
              jobs.map((job) => (
                <ScheduleCard
                  key={job.id}
                  job={job}
                  agentName={agentNames[job.agentId] || job.agentId}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  onRunNow={onRunNow}
                  onEdit={onEdit}
                  readOnly={readOnly}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SchedulesContentView
