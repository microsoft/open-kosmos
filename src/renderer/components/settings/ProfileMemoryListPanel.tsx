import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { CardSummary } from '@shared/types/memexTypes';
import ListSearchBox from '../ui/ListSearchBox';
import { useAutoHideScrollbar } from '../../lib/hooks/useAutoHideScrollbar';
import { useI18n } from '../../lib/i18n/useI18n';
import '../../styles/MemexMemory.css';

interface ProfileMemoryListPanelProps {
  cards: CardSummary[];
  loading: boolean;
  query: string;
  selectedSlug: string | null;
  onQueryChange: (query: string) => void;
  onSelect: (card: CardSummary) => void;
  onMenuToggle: (slug: string, buttonElement: HTMLElement) => void;
}

const ProfileMemoryListPanel: React.FC<ProfileMemoryListPanelProps> = ({
  cards,
  loading,
  query,
  selectedSlug,
  onQueryChange,
  onSelect,
  onMenuToggle,
}) => {
  const { t } = useI18n();
  const scrollRef = useAutoHideScrollbar<HTMLDivElement>();

  return (
    <>
      <ListSearchBox
        value={query}
        onChange={onQueryChange}
        placeholder={t('profileMemory.searchPlaceholder')}
      />
      <div className="profile-memory-list" ref={scrollRef}>
        {loading && cards.length === 0 ? (
          <p className="profile-memory-empty">{t('profileMemory.loadingList')}</p>
        ) : cards.length === 0 ? (
          <p className="profile-memory-empty">
            {query.trim() ? t('profileMemory.noSearchMatches') : t('profileMemory.emptyList')}
          </p>
        ) : (
          <ul className="profile-memory-cards">
            {cards.map(card => (
              <li
                key={card.slug}
                className={`profile-memory-card${card.slug === selectedSlug ? ' is-selected' : ''}`}
                data-testid="profile-memory-row"
              >
                <div className="profile-memory-card-header">
                  <button
                    type="button"
                    className="profile-memory-card-select"
                    onClick={() => onSelect(card)}
                    aria-label={t('profileMemory.selectCard', { name: card.title || card.slug })}
                  >
                    <div className="profile-memory-name-group">
                      <div className="profile-memory-title-row">
                        <span className="profile-memory-card-name">{card.title || card.slug}</span>
                      </div>
                      <div className="profile-memory-meta-group">
                        <span className="profile-memory-slug-badge">{card.slug}</span>
                        {card.category ? <span className="profile-memory-source-badge">{card.category}</span> : null}
                        {card.modified || card.created ? (
                          <span className="profile-memory-date-badge">{card.modified ?? card.created}</span>
                        ) : null}
                      </div>
                      {card.excerpt ? <p className="profile-memory-card-excerpt">{card.excerpt}</p> : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="profile-memory-card-menu"
                    data-profile-memory-menu-trigger="true"
                    aria-label={t('profileMemory.cardOptions', { name: card.title || card.slug })}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      onMenuToggle(card.slug, e.currentTarget);
                    }}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
};

export default ProfileMemoryListPanel;
