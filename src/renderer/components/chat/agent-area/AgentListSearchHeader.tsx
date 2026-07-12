import React from 'react';
import { Search, X } from 'lucide-react';
import { AgentAvatar } from '../../common/AgentAvatar';
import type { SearchAgentOption } from './AgentList';
import { useI18n } from '../../../lib/i18n/useI18n';

interface AgentListSearchHeaderProps {
  isSearchMode: boolean;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
  handleSearchInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchFocus: () => void;
  handleSearchBlur: () => void;
  selectedAgentFilter: SearchAgentOption | null;
  clearSelectedAgentFilter: () => void;
  showAgentSearchHint: boolean;
  isMentionPickerOpen: boolean;
  mentionPickerRef: React.MutableRefObject<HTMLDivElement | null>;
  mentionSuggestions: SearchAgentOption[];
  activeMentionIndex: number;
  setActiveMentionIndex: React.Dispatch<React.SetStateAction<number>>;
  applyMentionSuggestion: (option: SearchAgentOption) => void;
  mentionOptionRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
}

/**
 * Sticky search header for the agent list: search input, clear control,
 * active agent-filter chip, the "type @" hint, and the agent mention picker.
 * Extracted from AgentList to keep that component within the file-length budget.
 */
export const AgentListSearchHeader: React.FC<AgentListSearchHeaderProps> = ({
  isSearchMode,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  handleSearchInputKeyDown,
  handleSearchFocus,
  handleSearchBlur,
  selectedAgentFilter,
  clearSelectedAgentFilter,
  showAgentSearchHint,
  isMentionPickerOpen,
  mentionPickerRef,
  mentionSuggestions,
  activeMentionIndex,
  setActiveMentionIndex,
  applyMentionSuggestion,
  mentionOptionRefs,
}) => {
  const { t } = useI18n();

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--agent-list-search-header-bg, var(--color-warm-50))', paddingBottom: '8px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderRadius: '14px',
          backgroundColor: 'var(--agent-list-search-field-bg, var(--color-warm-100))',
          border: isSearchMode ? '1px solid var(--agent-list-search-field-active-border, var(--color-warm-900))' : '1px solid transparent',
        }}
      >
        <Search size={16} color="var(--agent-list-search-icon-fg, var(--color-neutral-500))" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={handleSearchInputKeyDown}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          placeholder={t('agent.search.placeholder')}
          aria-label={t('agent.search.placeholder')}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            flex: 1,
            fontSize: '14px',
            color: 'var(--agent-list-search-input-fg, var(--color-warm-900))',
          }}
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label={t('agent.search.clearConversationSearch')}
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--agent-list-search-icon-fg, var(--color-neutral-500))',
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {selectedAgentFilter && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 4px',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              maxWidth: '100%',
              borderRadius: '999px',
              backgroundColor: 'var(--agent-list-search-chip-bg, var(--color-warm-accent))',
              color: 'var(--agent-list-search-chip-fg, var(--color-warm-900))',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            <AgentAvatar
              emoji={selectedAgentFilter.agentEmoji}
              avatar={selectedAgentFilter.agentAvatar}
              source={selectedAgentFilter.agentSource}
              name={selectedAgentFilter.agentName}
              size="sm"
              version={selectedAgentFilter.agentVersion}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedAgentFilter.agentName}
            </span>
            <button
              type="button"
              onClick={clearSelectedAgentFilter}
              aria-label={t('agent.search.clearAgentFilter')}
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--agent-list-search-icon-fg, var(--color-neutral-500))',
              }}
            >
              <X size={14} />
            </button>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--agent-list-search-muted-fg, var(--color-neutral-500))' }}>{t('agent.search.filteringByAgent')}</span>
        </div>
      )}

      {showAgentSearchHint && (
        <div
          style={{
            padding: '0 4px',
            fontSize: '12px',
            color: 'var(--agent-list-search-muted-fg, var(--color-neutral-500))',
          }}
        >
          {t('agent.search.hint')}
        </div>
      )}

      {isMentionPickerOpen && (
        <div
          ref={mentionPickerRef}
          style={{
            position: 'absolute',
            top: selectedAgentFilter ? '92px' : showAgentSearchHint ? '82px' : '58px',
            left: 0,
            right: 0,
            backgroundColor: 'var(--agent-list-search-menu-bg, var(--color-white))',
            border: '1px solid var(--agent-list-search-menu-border, var(--color-warm-200))',
            borderRadius: '16px',
            boxShadow: '0 12px 32px rgba(39, 35, 32, 0.12)',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            zIndex: 20,
            maxHeight: '280px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            scrollbarWidth: 'thin',
          }}
        >
          {mentionSuggestions.map((option, index) => {
            const isActiveOption = index === activeMentionIndex;
            return (
              <button
                key={`${option.chatId}-${option.agentName}`}
                ref={(element) => {
                  mentionOptionRefs.current[index] = element;
                }}
                type="button"
                className={`agent-list-search-option${isActiveOption ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveMentionIndex(index)}
                onClick={() => applyMentionSuggestion(option)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  border: 'none',
                  background: isActiveOption ? 'var(--color-warm-100)' : 'transparent',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <AgentAvatar
                  emoji={option.agentEmoji}
                  avatar={option.agentAvatar}
                  source={option.agentSource}
                  name={option.agentName}
                  size="sm"
                  version={option.agentVersion}
                />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--agent-list-search-option-fg, var(--color-warm-900))' }}>{option.agentName}</span>
                  <span style={{ fontSize: '12px', color: 'var(--agent-list-search-muted-fg, var(--color-neutral-500))' }}>{t('agent.search.filterForAgent')}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
