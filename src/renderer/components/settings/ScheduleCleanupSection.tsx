import React, { useCallback, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import type { SchedulerCleanupResult } from '@shared/ipc/scheduler'
import { schedulerApi } from '../../ipc/scheduler'
import { useI18n } from '../../lib/i18n/useI18n'

/** Cleanup old scheduled runs section */
export const ScheduleCleanupSection: React.FC<{
  disabled?: boolean
  chatId: string
}> = ({ disabled = false, chatId }) => {
  const { t } = useI18n()
  const [isCleaningUp, setIsCleaningUp] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<SchedulerCleanupResult | null>(null)
  const [cleanupError, setCleanupError] = useState<string | null>(null)

  const handleCleanup = useCallback(async () => {
    if (isCleaningUp || disabled) return

    setIsCleaningUp(true)
    setCleanupResult(null)
    setCleanupError(null)

    try {
      const res = await schedulerApi.cleanupAllSessionHistory({ includeOrphans: true, chatId: chatId })
      if (res?.data) {
        setCleanupResult(res.data)
        if (!res.success && res.error) {
          setCleanupError(res.error)
        }
      } else {
        setCleanupError(res?.error || t('settings.schedules.cleanupFailedFallback'))
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : t('settings.schedules.cleanupFailedFallback'))
    } finally {
      setIsCleaningUp(false)
    }
  }, [chatId, isCleaningUp, disabled, t])

  return (
    <div
      className="toolbar-settings-card schedule-cleanup-section"
      style={{ padding: '14px 16px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <p className="schedule-cleanup-title" style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--color-neutral-900)' }}>
              {t('settings.schedules.cleanupTitle')}
            </p>
            <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--color-neutral-500)' }}>
              {t('settings.schedules.cleanupDescription')}
            </p>
          </div>
          <button
            className="schedule-cleanup-button"
            onClick={handleCleanup}
            disabled={isCleaningUp || disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid var(--color-neutral-300)',
              borderRadius: '6px',
              backgroundColor: isCleaningUp || disabled ? 'var(--color-neutral-50)' : 'var(--color-white)',
              color: isCleaningUp || disabled ? 'var(--color-neutral-400)' : 'var(--color-neutral-700)',
              cursor: isCleaningUp || disabled ? 'not-allowed' : 'pointer',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 500,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isCleaningUp && !disabled) {
                e.currentTarget.style.backgroundColor = 'var(--color-neutral-50)'
                e.currentTarget.style.borderColor = 'var(--color-neutral-400)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isCleaningUp && !disabled) {
                e.currentTarget.style.backgroundColor = 'var(--color-white)'
                e.currentTarget.style.borderColor = 'var(--color-neutral-300)'
              }
            }}
          >
            {isCleaningUp ? (
              <>
                <Loader2 size={14} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                <span>{t('settings.schedules.cleaningUp')}</span>
              </>
            ) : (
              <>
                <Trash2 size={14} />
                <span>{t('settings.schedules.cleanup')}</span>
              </>
            )}
          </button>
        </div>

        {cleanupResult && (
          <div className={`schedule-cleanup-result ${cleanupResult.errors > 0 ? 'is-warning' : 'is-success'}`} style={{
            padding: '10px 12px',
            backgroundColor: cleanupResult.errors > 0 ? 'var(--color-warning-50)' : 'var(--color-success-50)',
            border: `1px solid ${cleanupResult.errors > 0 ? 'var(--color-warning-300)' : 'var(--color-success-300)'}`,
            borderRadius: '6px',
            fontSize: '12px',
            color: cleanupResult.errors > 0 ? 'var(--color-warning-800)' : 'var(--color-success-800)',
          }}>
            <p style={{ margin: 0, fontWeight: 500 }}>
              {cleanupResult.errors > 0 ? t('settings.schedules.cleanupCompletedWithErrors') : t('settings.schedules.cleanupCompleted')}
            </p>
            <p style={{ margin: '4px 0 0 0' }}>
              {t('settings.schedules.cleanupResult', {
                deleted: cleanupResult.totalDeleted,
                sessionLabel: cleanupResult.totalDeleted !== 1 ? t('settings.schedules.sessionPlural') : t('settings.schedules.sessionSingular'),
                orphans: cleanupResult.orphansDeleted > 0 ? t('settings.schedules.orphansDeleted', { count: cleanupResult.orphansDeleted }) : '',
                jobs: cleanupResult.jobsProcessed,
                scheduleLabel: cleanupResult.jobsProcessed !== 1 ? t('settings.schedules.schedulePlural') : t('settings.schedules.scheduleSingular'),
                errors: cleanupResult.errors > 0 ? t('settings.schedules.deletionsFailed', { count: cleanupResult.errors }) : '',
              })}
            </p>
          </div>
        )}

        {cleanupError && (
          <div className="schedule-cleanup-result is-error" style={{
            padding: '10px 12px',
            backgroundColor: 'var(--color-danger-50)',
            border: '1px solid var(--color-danger-200)',
            borderRadius: '6px',
            fontSize: '12px',
            color: 'var(--color-danger-800)',
          }}>
            <p style={{ margin: 0, fontWeight: 500 }}>{t('settings.schedules.cleanupFailed')}</p>
            <p style={{ margin: '4px 0 0 0' }}>{cleanupError}</p>
          </div>
        )}
      </div>
    </div>
  )
}
