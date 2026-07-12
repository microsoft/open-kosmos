import React, { useCallback, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { SchedulerSessionInfo } from '@shared/ipc/scheduler'
import { schedulerApi } from '../../ipc/scheduler'
import { useI18n } from '../../lib/i18n/useI18n'

const PAGE_SIZE = 20

const formatDate = (iso: string) => {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    /* v8 ignore next -- Date constructor never throws; this is a defensive catch */
    return iso
  }
}

export const ScheduleSessionList: React.FC<{
  jobId: string
  chatId: string
}> = ({ jobId, chatId }) => {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [sessions, setSessions] = useState<SchedulerSessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState(false)

  const fetchSessions = useCallback(async (offset: number = 0) => {
    const isInitial = offset === 0
    if (isInitial) {
      setLoading(true)
      setLoadError(false)
    } else {
      setLoadingMore(true)
    }

    try {
      const res = await schedulerApi.getJobSessions(jobId, { limit: PAGE_SIZE, offset })
      if (res?.success && res.data) {
        if (isInitial) {
          setSessions(res.data.sessions)
        } else {
          setSessions(prev => [...prev, ...res.data!.sessions])
        }
        setHasMore(res.data.hasMore)
        setTotal(res.data.total)
        if (isInitial) {
          setLoaded(true)
        }
      } else if (isInitial) {
        setLoadError(true)
      }
    } catch {
      if (isInitial) {
        setLoadError(true)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [jobId])

  const handleToggle = useCallback(async () => {
    const next = !expanded
    setExpanded(next)
    if (next && (!loaded || loadError)) {
      await fetchSessions(0)
    }
  }, [expanded, loaded, loadError, fetchSessions])

  const handleLoadMore = useCallback(async () => {
    /* v8 ignore next -- guard condition; button not rendered when !hasMore */
    if (loadingMore || !hasMore) return
    await fetchSessions(sessions.length)
  }, [loadingMore, hasMore, sessions.length, fetchSessions])

  return (
    <div className="schedule-session-list" style={{
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid var(--color-neutral-200)',
    }}>
      <button
        className="schedule-session-toggle"
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
          color: 'var(--color-neutral-600)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-neutral-600)' }}
      >
        <ChevronRight
          size={14}
          style={{
            transition: 'transform 0.15s ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
        <span>{t('settings.schedules.scheduledRuns')}</span>
        {loaded && (
          <span className="schedule-session-count" style={{
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--color-neutral-500)',
            backgroundColor: 'var(--color-neutral-100)',
            borderRadius: '999px',
            padding: '1px 6px',
          }}>
            {total}
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
            <span style={{ fontSize: '12px', color: 'var(--color-neutral-400)' }}>{t('common.loading')}</span>
          )}
          {!loading && sessions.length === 0 && (loaded || loadError) && (
            <span style={{ fontSize: '12px', color: 'var(--color-neutral-400)' }}>{t('settings.schedules.noRuns')}</span>
          )}
          {sessions.map((s) => (
            <button
              className="schedule-session-item"
              key={s.chatSession_id}
              onClick={() => navigate(`/agent/chat/${chatId}/${s.chatSession_id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                backgroundColor: 'var(--color-neutral-50)',
                border: '1px solid var(--color-neutral-200)',
                cursor: 'pointer',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--color-neutral-700)',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-neutral-100)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-neutral-50)' }}
              title={t('settings.schedules.openSession', { title: s.title })}
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
                color: 'var(--color-neutral-400)',
                flexShrink: 0,
              }}>
                {formatDate(s.last_updated)}
              </span>
            </button>
          ))}
          {hasMore && !loadingMore && (
            <button
              className="schedule-session-load-more"
              onClick={handleLoadMore}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                backgroundColor: 'transparent',
                border: '1px dashed var(--color-neutral-300)',
                cursor: 'pointer',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--color-neutral-500)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-neutral-400)'
                e.currentTarget.style.color = 'var(--color-neutral-600)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-neutral-300)'
                e.currentTarget.style.color = 'var(--color-neutral-500)'
              }}
            >
              {t('settings.schedules.showMore', { count: total - sessions.length })}
            </button>
          )}
          {loadingMore && (
            <span style={{ fontSize: '12px', color: 'var(--color-neutral-400)', textAlign: 'center' }}>{t('settings.schedules.loadingMore')}</span>
          )}
        </div>
      )}
    </div>
  )
}