import React, { useCallback, useEffect, useRef, useState } from 'react';
import { memexApi, memexEvents } from '../../ipc/memex';
import type { CardDetail, CardSummary } from '@shared/types/memexTypes';
import FileContentRenderer from '../ui/FileContentRenderer';
import { useI18n } from '../../lib/i18n/useI18n';

const memexFileViewerBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  position: 'relative',
  background: 'var(--color-white)',
};

export const CardListItem: React.FC<{ card: CardSummary; onClick: () => void }> = ({ card, onClick }) => (
  <button
    onClick={onClick}
    className="chat-session-item sidepane-list-card memex-card-list-item"
    style={{
      width: '100%',
      border: 'none',
      borderRadius: '12px',
      padding: '12px',
      background: 'var(--color-white)',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '6px',
      boxSizing: 'border-box',
      textAlign: 'left',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-white)'; }}
  >
    <span
      style={{
        width: '100%',
        fontSize: '14px',
        fontWeight: 500,
        color: 'var(--color-neutral-700)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {card.title || card.slug}
    </span>
    {card.excerpt && (
      <span
        style={{
          width: '100%',
          fontSize: '12px',
          color: 'var(--color-neutral-500)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {card.excerpt}
      </span>
    )}
    {(card.category || card.modified) && (
      <span style={{ fontSize: '11px', color: 'var(--color-neutral-400)' }}>
        {[card.category, card.modified].filter(Boolean).join(' · ')}
      </span>
    )}
  </button>
);

export const MemexCardDetail: React.FC<{
  chatId: string;
  slug: string;
  onNavigate?: (slug: string) => void;
}> = ({ chatId, slug, onNavigate }) => {
  const { t } = useI18n();
  const tRef = useRef(t);
  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);
  const activeLoadCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const loadCard = useCallback(() => {
    let cancelled = false;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    setCard(null);
    memexApi
      .readCard(chatId, slug)
      .then((result) => {
        if (cancelled || seq !== loadSeqRef.current) return;
        if (result.success && result.data) {
          setCard(result.data);
        } else {
          setError(result.success ? tRef.current('profileMemory.cardNotFound') : result.error);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled && seq === loadSeqRef.current) setError(e instanceof Error ? e.message : tRef.current('profileMemory.failedToLoadCard'));
      })
      .finally(() => {
        if (!cancelled && seq === loadSeqRef.current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [chatId, slug]);

  const startLoadCard = useCallback(() => {
    activeLoadCleanupRef.current?.();
    const cleanup = loadCard();
    activeLoadCleanupRef.current = cleanup;
    return () => {
      if (activeLoadCleanupRef.current === cleanup) {
        activeLoadCleanupRef.current = null;
      }
      cleanup();
    };
  }, [loadCard]);

  useEffect(() => startLoadCard(), [startLoadCard]);

  useEffect(() => () => {
    activeLoadCleanupRef.current?.();
    activeLoadCleanupRef.current = null;
  }, []);

  useEffect(() => {
    const unsub = memexEvents.cardsChanged((data) => {
      if (data.chatId === chatId) startLoadCard();
    });
    return unsub;
  }, [chatId, startLoadCard]);

  if (loading) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, var(--color-warm-400))', textAlign: 'center' }}>
        {t('profileMemory.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--color-danger-700)', textAlign: 'center' }}>
        {error}
      </div>
    );
  }
  if (!card) return null;

  const markdownContent = card.rawContent ?? card.content;

  return (
    <div style={memexFileViewerBodyStyle}>
      {markdownContent ? (
        <FileContentRenderer
          name={`${card.slug}.md`}
          mimeType="text/markdown"
          content={markdownContent}
          markdownWikilinks={onNavigate ? {
            resolveTarget: (target) => card.resolvedWikilinks?.[target] ?? null,
            onNavigate,
          } : undefined}
        />
      ) : (
        <div className="skill-detail-no-content">
          <span>{t('profileMemory.noContentShort')}</span>
        </div>
      )}
    </div>
  );
};
