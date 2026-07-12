import React, { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import './FindBar.css';
import { CONVERSATION_FIND_MAX_QUERY_LENGTH, useConversationFind } from './useConversationFind';
import { useI18n } from '../../lib/i18n/useI18n';

interface FindBarProps {
  rootRef: RefObject<HTMLElement>;
  scrollContainerRef: RefObject<HTMLElement>;
  sessionId?: string;
}

function getSelectedText(): string {
  return window.getSelection()?.toString().trim() ?? '';
}

const FindBar: React.FC<FindBarProps> = ({ rootRef, scrollContainerRef, sessionId }) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const {
    query,
    activeMatchOrdinal,
    totalMatches,
    isSupported,
    setQuery,
    clear,
    findNext,
    findPrevious,
  } = useConversationFind({ rootRef, scrollContainerRef, sessionId, isOpen });

  const focusInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const closeFindBar = useCallback((options?: { restoreFocus?: boolean }) => {
    setIsOpen(false);
    clear();

    if (options?.restoreFocus === false) return;

    window.requestAnimationFrame(() => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
        return;
      }

      scrollContainerRef.current?.focus({ preventScroll: true });
    });
  }, [clear, scrollContainerRef]);

  const openFindBar = useCallback((options?: { preferSelection?: boolean; initialQuery?: string }) => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !activeElement.closest('.find-bar')) {
      previousFocusRef.current = activeElement;
    }

    const selectedText = options?.initialQuery ?? (options?.preferSelection ? getSelectedText() : '');
    setIsOpen(true);

    if (!isOpen || selectedText) {
      setQuery(selectedText, { immediate: Boolean(selectedText) });
    }

    setFocusRequestId((current) => current + 1);
  }, [isOpen, setQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const isFindShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f';
      if (isFindShortcut) {
        event.preventDefault();
        openFindBar({ preferSelection: true });
        return;
      }

      if (event.key === 'F3') {
        event.preventDefault();
        if (!isOpen) {
          openFindBar({ initialQuery: '' });
        } else if (event.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
        return;
      }

      if (isOpen && event.key === 'Escape') {
        event.preventDefault();
        closeFindBar();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeFindBar, findNext, findPrevious, isOpen, openFindBar]);

  useEffect(() => {
    if (!isOpen) return;
    focusInput();
  }, [focusInput, focusRequestId, isOpen]);

  useEffect(() => {
    if (isOpen) {
      closeFindBar({ restoreFocus: false });
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.currentTarget.value, { skipSearch: composingRef.current });
  }, [setQuery]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((event: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    setQuery(event.currentTarget.value, { immediate: true });
  }, [setQuery]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFindBar();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    }
  }, [closeFindBar, findNext, findPrevious]);

  if (!isOpen) return null;

  const hasQuery = query.trim().length > 0;
  const counterText = !hasQuery ? '' : isSupported ? `${activeMatchOrdinal}/${totalMatches}` : t('chat.find.unavailable');
  const canNavigate = isSupported && totalMatches > 0;

  return (
    <div className="find-bar" role="search" aria-label={t('chat.find.aria')}>
      <Search className="find-bar-search-icon" size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        className="find-bar-input"
        type="text"
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        placeholder={t('chat.find.placeholder')}
        spellCheck={false}
        aria-label={t('chat.find.searchText')}
        maxLength={CONVERSATION_FIND_MAX_QUERY_LENGTH}
      />
      <span className="find-bar-count" aria-live="polite" role="status">
        {counterText}
      </span>
      <button
        type="button"
        className="find-bar-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={findPrevious}
        disabled={!canNavigate}
        title={t('chat.find.previousTitle')}
        aria-label={t('chat.find.previous')}
      >
        <ChevronUp size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="find-bar-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={findNext}
        disabled={!canNavigate}
        title={t('chat.find.nextTitle')}
        aria-label={t('chat.find.next')}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="find-bar-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => closeFindBar()}
        title={t('chat.find.closeTitle')}
        aria-label={t('chat.find.close')}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
};

export default FindBar;
