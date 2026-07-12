import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Brain, X, ArrowLeft, Search } from 'lucide-react';
import '../../styles/Sidepane.css';
import { MemexMemorySidepaneAtom } from './chat-side.atom';
import { useCurrentChatId } from '../../lib/chat/agentChatSessionCacheManager';
import { useMemexMemoryEnabled } from '../../lib/userData/useMemexMemoryEnabled';
import { memexApi, memexEvents } from '../../ipc/memex';
import { CardListItem, MemexCardDetail } from './MemexMemorySidepaneParts';
import type { CardSummary } from '@shared/types/memexTypes';
import { useI18n } from '../../lib/i18n/useI18n';

// ─── Sidepane ───

const MemexMemorySidepane: React.FC = () => {
  const enabled = useMemexMemoryEnabled();
  const [state, actions] = MemexMemorySidepaneAtom.use();
  const { t } = useI18n();
  const chatId = useCurrentChatId();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Monotonic generation guard: each loadCards() call claims a sequence number;
  // when its async result returns, we drop it if a newer load has since started.
  // Without this, a slow request for a previous chatId/query can resolve *after*
  // a faster newer one and overwrite the correct list (e.g. switching from an
  // agent with many cards to a brand-new empty agent leaves the old cards shown).
  const loadSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled && state.visible) {
      actions.hide();
    }
  }, [enabled, state.visible, actions]);

  const loadCards = useCallback(async () => {
    if (!chatId) {
      loadSeqRef.current += 1;
      setCards([]);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const trimmed = query.trim();
      const result = trimmed
        ? await memexApi.searchCards(chatId, trimmed)
        : await memexApi.listCards(chatId);
      if (seq !== loadSeqRef.current) return; // superseded by a newer load
      if (result.success) {
        setCards(result.data ?? []);
      } else {
        setError(result.error);
        setCards([]);
      }
    } catch (e: unknown) {
      if (seq !== loadSeqRef.current) return; // superseded by a newer load
      setError(e instanceof Error ? e.message : 'Failed to load memory');
      setCards([]);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [chatId, query]);

  // Load (and re-load on search) when the list view is active.
  useEffect(() => {
    if (state.visible && !state.selectedSlug) {
      loadCards();
    }
  }, [state.visible, state.selectedSlug, loadCards]);

  // Reset the list the instant the active agent (chatId) changes, so another
  // agent's cards are never shown while the new agent's cards load (R1 isolation).
  // Mirrors the detail view, which clears its card at the start of every load.
  // Also drop back to list mode: a stale `selectedSlug` from the previous agent
  // would otherwise read the old card's slug against the new chatId.
  useEffect(() => {
    setCards([]);
    setError(null);
    actions.backToList();
  }, [chatId]);

  // Refresh when the active chat's cards change underneath us.
  useEffect(() => {
    if (!state.visible || state.selectedSlug) return;
    if (!chatId) return;
    const unsub = memexEvents.cardsChanged((data) => {
      if (data.chatId === chatId) loadCards();
    });
    return unsub;
  }, [state.visible, state.selectedSlug, chatId, loadCards]);

  if (!enabled) return null;
  if (!state.visible) return null;

  // Detail view
  if (state.selectedSlug) {
    const selected = cards.find((c) => c.slug === state.selectedSlug);
    return (
      <div className="chat-sidepane" style={{ flex: 1 }}>
        <div className="file-explorer-section">
          <div className="sidepane-section-header" style={{ cursor: 'default' }}>
            <button
              onClick={actions.backToList}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-secondary, var(--color-warm-400))',
                padding: '2px 4px',
              }}
            >
              <ArrowLeft size={14} />
              {t('common.back')}
            </button>
            <div
              className="sidepane-section-header-title"
              style={{ flex: 1, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <span className="sidepane-section-title-text">{selected?.title || state.selectedSlug}</span>
            </div>
            <div className="sidepane-section-header-actions">
              <button
                className="sidepane-close-btn"
                onClick={actions.hide}
                title={t('common.close')}
                aria-label={t('common.close')}
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          <MemexCardDetail
            chatId={chatId!}
            slug={state.selectedSlug}
            onNavigate={actions.selectCard}
          />
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="chat-sidepane">
      <div className="file-explorer-section">
        <div className="sidepane-section-header" style={{ cursor: 'default' }}>
          <div className="sidepane-section-header-title">
            <Brain size={16} color="var(--color-neutral-700)" />
            <span className="sidepane-section-title-text">{t('sidepane.memory.title')}</span>
          </div>
          <div className="sidepane-section-header-actions">
            <button
              className="sidepane-close-btn"
              onClick={actions.hide}
              title={t('sidepane.memory.close')}
              aria-label={t('sidepane.memory.close')}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div className="memex-search-wrapper" style={{ padding: '8px 12px' }}>
          <div
            className="memex-search-box"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--color-neutral-200)',
              borderRadius: 8,
              padding: '4px 8px',
              background: 'var(--color-white)',
            }}
          >
            <Search size={14} color="var(--color-neutral-400)" />
            <input
              className="memex-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sidepane.memory.searchPlaceholder')}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: 'var(--color-neutral-700)',
                background: 'transparent',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-neutral-400)', padding: 0, display: 'flex' }}
                title={t('sidepane.memory.clearSearch')}
                aria-label={t('sidepane.memory.clearSearch')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="sidepane-body">
          {loading && cards.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, var(--color-warm-400))', textAlign: 'center' }}>
              {t('common.loading')}
            </div>
          )}
          {error && !loading && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--color-danger-700)', textAlign: 'center' }}>
              {error}
            </div>
          )}
          {!loading && !error && cards.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary, var(--color-warm-400))', textAlign: 'center' }}>
              {query.trim() ? t('sidepane.memory.noMatchingCards') : t('sidepane.memory.noMemoryCards')}
            </div>
          )}
          {cards.map((card) => (
            <CardListItem
              key={card.slug}
              card={card}
              onClick={() => actions.selectCard(card.slug)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default MemexMemorySidepane;

// ─── Header toggle ───
// Co-located with the pane it controls: both are memex-specific and share the
// same atom + app-level master switch. Rendered from ChatViewHeader's button row.
export function ToggleMemexMemory() {
  const enabled = useMemexMemoryEnabled();
  const [state, actions] = MemexMemorySidepaneAtom.use();
  const { t } = useI18n();
  if (!enabled) return null;
  const label = state.visible ? t('sidepane.memory.hideAgentMemory') : t('sidepane.memory.showAgentMemory');
  return (
    <button
      className={`btn-action ${state.visible ? 'active' : ''}`}
      onClick={actions.effectiveToggle}
      title={label}
      aria-label={label}
    >
      <Brain size={20} />
    </button>
  );
}
