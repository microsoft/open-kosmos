'use client'

import React from 'react'
import type { SchedulerJob } from '@shared/ipc/scheduler'
import { ScheduleCard } from './ScheduleCard'
import { ScheduleCleanupSection } from './ScheduleCleanupSection'
import '../../styles/ContentView.css'
import '../../styles/ToolbarSettingsView.css'
import { useI18n } from '../../lib/i18n/useI18n'

interface SchedulesContentViewProps {
  jobs: SchedulerJob[]
  agentNames: Record<string, string>
  error: string | null
  onToggle: (jobId: string, enabled: boolean) => void
  onDelete: (jobId: string) => void
  onUpdate: (jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description'>>) => void
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit?: (job: SchedulerJob) => void
  readOnly?: boolean
  chatId: string
}

export const ScheduleWakeNotice: React.FC<{
  compact?: boolean
}> = ({ compact = false }) => {
  const { t } = useI18n()
  return (
    <div
      className="toolbar-settings-card schedule-wake-notice"
      style={{
        padding: compact ? '12px 14px' : '14px 16px',
        border: '1px solid var(--color-warning-300)',
        background: 'var(--color-warning-50)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--color-warning-800)' }}>
          {t('settings.schedules.wakeNoticeTitle')}
        </p>
        <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--color-warning-800)' }}>
          {t('settings.schedules.wakeNoticeDescription')}
        </p>
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
  chatId,
}) => {
  const { t } = useI18n()
  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            <ScheduleWakeNotice />

            <ScheduleCleanupSection disabled={readOnly} chatId={chatId} />

            {/* Error Message */}
            {error && (
              <div className="toolbar-settings-error glass-surface">
                <div className="message-header">
                  <div className="message-indicator"></div>
                  <span className="message-label">{t('common.error')}</span>
                </div>
                <p className="message-text">{error}</p>
              </div>
            )}

            {jobs.length === 0 ? (
              <div className="toolbar-settings-card">
                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--color-neutral-500)', fontSize: '15px', margin: 0 }}>
                    {t('settings.schedules.noTasksPrefix')}<code className="schedule-empty-code" style={{
                      backgroundColor: 'var(--color-neutral-100)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}>create_schedule</code>{t('settings.schedules.noTasksSuffix')}
                  </p>
                </div>
              </div>
            ) : (
              jobs.map((job) => (
                <ScheduleCard
                  key={job.id}
                  job={job}
                  agentName={agentNames[job.chat_id] || job.chat_id}
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