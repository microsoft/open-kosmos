import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const CONVERSATION_FIND_MAX_QUERY_LENGTH = 500;
export const CONVERSATION_FIND_MATCH_HIGHLIGHT = 'openkosmos-conversation-find-match';
export const CONVERSATION_FIND_ACTIVE_HIGHLIGHT = 'openkosmos-conversation-find-active';
const CONVERSATION_FIND_MAX_WAIT_MS = 500;

interface HighlightLike {}

interface HighlightRegistryLike {
  set(name: string, highlight: HighlightLike): void;
  delete(name: string): void;
}

interface HighlightConstructorLike {
  new (...ranges: Range[]): HighlightLike;
}

interface HighlightGlobalLike {
  CSS?: {
    highlights?: HighlightRegistryLike;
  };
  Highlight?: HighlightConstructorLike;
}

interface HighlightApi {
  registry: HighlightRegistryLike;
  Highlight: HighlightConstructorLike;
}

export interface ConversationFindMatch {
  range: Range;
  textNode: Text;
  startOffset: number;
  endOffset: number;
}

interface UseConversationFindOptions {
  rootRef: RefObject<HTMLElement>;
  scrollContainerRef: RefObject<HTMLElement>;
  isOpen: boolean;
  sessionId?: string;
  debounceMs?: number;
}

interface SetQueryOptions {
  immediate?: boolean;
  skipSearch?: boolean;
}

interface PendingSearch {
  query: string;
  activeIndex: number;
  scroll: boolean;
}

function getHighlightApi(): HighlightApi | null {
  const candidate = globalThis as unknown as HighlightGlobalLike;
  const registry = candidate.CSS?.highlights;
  const Highlight = candidate.Highlight;

  if (!registry || typeof registry.set !== 'function' || typeof registry.delete !== 'function' || typeof Highlight !== 'function') {
    return null;
  }

  return { registry, Highlight };
}

function clearConversationHighlights(): void {
  const api = getHighlightApi();
  api?.registry.delete(CONVERSATION_FIND_MATCH_HIGHLIGHT);
  api?.registry.delete(CONVERSATION_FIND_ACTIVE_HIGHLIGHT);
}

function setHighlightRanges(name: string, ranges: Range[]): void {
  const api = getHighlightApi();
  if (!api) return;

  if (ranges.length === 0) {
    api.registry.delete(name);
    return;
  }

  api.registry.set(name, new api.Highlight(...ranges));
}

function applyHighlights(matches: ConversationFindMatch[], activeIndex: number): void {
  if (matches.length === 0 || activeIndex < 0) {
    clearConversationHighlights();
    return;
  }

  const matchRanges: Range[] = [];
  for (let index = 0; index < matches.length; index++) {
    if (index !== activeIndex) {
      matchRanges.push(matches[index].range);
    }
  }
  const activeRange = matches[activeIndex]?.range;

  setHighlightRanges(CONVERSATION_FIND_MATCH_HIGHLIGHT, matchRanges);
  setHighlightRanges(CONVERSATION_FIND_ACTIVE_HIGHLIGHT, activeRange ? [activeRange] : []);
}

function normalizeActiveIndex(index: number, total: number): number {
  if (total === 0) return -1;
  return ((index % total) + total) % total;
}

function isColumnReverseRoot(root: HTMLElement): boolean {
  return root.classList.contains('chat-message-flow-reverse');
}

function getRootChildForNode(root: HTMLElement, node: Node): Node | null {
  let current: Node | null = node;

  while (current && current.parentNode && current.parentNode !== root) {
    current = current.parentNode;
  }

  return current?.parentNode === root ? current : null;
}

function orderMatchesByVisualFlow(root: HTMLElement, matches: ConversationFindMatch[]): ConversationFindMatch[] {
  if (matches.length <= 1 || !isColumnReverseRoot(root)) {
    return matches;
  }

  const matchGroups: ConversationFindMatch[][] = [];
  let currentRootChild: Node | null = null;

  for (const match of matches) {
    const rootChild = getRootChildForNode(root, match.textNode);
    const currentGroup = matchGroups[matchGroups.length - 1];

    if (!currentGroup || rootChild !== currentRootChild) {
      matchGroups.push([match]);
      currentRootChild = rootChild;
      continue;
    }

    currentGroup.push(match);
  }

  return matchGroups.reverse().flat();
}

function isSearchableTextNode(node: Text, root: HTMLElement): boolean {
  if (!node.nodeValue) return false;

  let element = node.parentElement;
  while (element) {
    const tagName = element.tagName.toLowerCase();
    if (
      tagName === 'script' ||
      tagName === 'style' ||
      tagName === 'noscript' ||
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      tagName === 'option' ||
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }

    if (element === root) return true;
    element = element.parentElement;
  }

  return false;
}

export function collectConversationFindMatches(root: HTMLElement, rawQuery: string): ConversationFindMatch[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const ownerDocument = root.ownerDocument;
  const view = ownerDocument.defaultView;
  const nodeFilter = view?.NodeFilter;
  const showText = nodeFilter?.SHOW_TEXT ?? 4;
  const filterAccept = nodeFilter?.FILTER_ACCEPT ?? 1;
  const filterReject = nodeFilter?.FILTER_REJECT ?? 2;
  const textNodeType = view?.Node?.TEXT_NODE ?? 3;
  const walker = ownerDocument.createTreeWalker(
    root,
    showText,
    {
      acceptNode(node) {
        return node.nodeType === textNodeType && isSearchableTextNode(node as Text, root)
          ? filterAccept
          : filterReject;
      },
    },
  );
  const matches: ConversationFindMatch[] = [];
  const normalizedQuery = query.toLowerCase();

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const text = textNode.nodeValue ?? '';
    const normalizedText = text.toLowerCase();
    let startOffset = normalizedText.indexOf(normalizedQuery);

    while (startOffset !== -1) {
      const endOffset = startOffset + query.length;
      const range = ownerDocument.createRange();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);
      matches.push({ range, textNode, startOffset, endOffset });
      startOffset = normalizedText.indexOf(normalizedQuery, endOffset);
    }

    current = walker.nextNode();
  }

  return orderMatchesByVisualFlow(root, matches);
}

function scrollRangeIntoContainer(range: Range, container: HTMLElement): void {
  if (typeof range.getBoundingClientRect !== 'function') {
    range.startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
    return;
  }

  const rangeRect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  if (rangeRect.height === 0 && rangeRect.width === 0) {
    range.startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
    return;
  }

  const rangeCenter = rangeRect.top + rangeRect.height / 2;
  const containerCenter = containerRect.top + containerRect.height / 2;
  container.scrollTop += rangeCenter - containerCenter;
}

export function useConversationFind({
  rootRef,
  scrollContainerRef,
  isOpen,
  sessionId,
  debounceMs = 150,
}: UseConversationFindOptions) {
  const isSupported = useMemo(() => getHighlightApi() !== null, []);
  const [query, setQueryState] = useState('');
  const [totalMatches, setTotalMatches] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const matchesRef = useRef<ConversationFindMatch[]>([]);
  const activeIndexRef = useRef(-1);
  const searchTimerRef = useRef<number | null>(null);
  const searchMaxWaitTimerRef = useRef<number | null>(null);
  const pendingSearchRef = useRef<PendingSearch | null>(null);

  const clearSearchTimer = useCallback(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  const clearSearchMaxWaitTimer = useCallback(() => {
    if (searchMaxWaitTimerRef.current !== null) {
      window.clearTimeout(searchMaxWaitTimerRef.current);
      searchMaxWaitTimerRef.current = null;
    }
  }, []);

  const clearSearchTimers = useCallback(() => {
    clearSearchTimer();
    clearSearchMaxWaitTimer();
  }, [clearSearchMaxWaitTimer, clearSearchTimer]);

  const resetMatches = useCallback(() => {
    clearSearchTimers();
    pendingSearchRef.current = null;
    matchesRef.current = [];
    activeIndexRef.current = -1;
    setTotalMatches(0);
    setActiveIndex(-1);
    clearConversationHighlights();
  }, [clearSearchTimers]);

  const runSearch = useCallback((rawQuery: string, options?: { activeIndex?: number; scroll?: boolean }) => {
    const root = rootRef.current;
    const scrollContainer = scrollContainerRef.current;

    if (!isSupported || !root || !rawQuery.trim()) {
      resetMatches();
      return;
    }

    const matches = collectConversationFindMatches(root, rawQuery);
    const nextActiveIndex = normalizeActiveIndex(options?.activeIndex ?? 0, matches.length);
    matchesRef.current = matches;
    activeIndexRef.current = nextActiveIndex;
    setTotalMatches(matches.length);
    setActiveIndex(nextActiveIndex);
    applyHighlights(matches, nextActiveIndex);

    if (options?.scroll !== false && nextActiveIndex >= 0 && scrollContainer) {
      scrollRangeIntoContainer(matches[nextActiveIndex].range, scrollContainer);
    }
  }, [isSupported, resetMatches, rootRef, scrollContainerRef]);

  const runPendingSearch = useCallback(() => {
    const queuedSearch = pendingSearchRef.current;
    pendingSearchRef.current = null;
    clearSearchTimers();
    if (queuedSearch) {
      runSearch(queuedSearch.query, { activeIndex: queuedSearch.activeIndex, scroll: queuedSearch.scroll });
    }
  }, [clearSearchTimers, runSearch]);

  const scheduleSearch = useCallback((nextQuery: string, options?: { activeIndex?: number; immediate?: boolean; scroll?: boolean; useMaxWait?: boolean }) => {
    const pending: PendingSearch = {
      query: nextQuery,
      activeIndex: options?.activeIndex ?? 0,
      scroll: options?.scroll !== false,
    };

    clearSearchTimer();
    pendingSearchRef.current = pending;

    if (options?.immediate) {
      pendingSearchRef.current = null;
      clearSearchTimers();
      runSearch(pending.query, { activeIndex: pending.activeIndex, scroll: pending.scroll });
      return;
    }

    searchTimerRef.current = window.setTimeout(runPendingSearch, debounceMs);
    if (options?.useMaxWait === true && searchMaxWaitTimerRef.current === null) {
      searchMaxWaitTimerRef.current = window.setTimeout(runPendingSearch, CONVERSATION_FIND_MAX_WAIT_MS);
    }
  }, [clearSearchTimer, clearSearchTimers, debounceMs, runPendingSearch, runSearch]);

  const flushPendingSearch = useCallback((getActiveIndex: (pendingActiveIndex: number) => number) => {
    const pendingSearch = pendingSearchRef.current;
    if (!pendingSearch) return false;

    clearSearchTimers();
    pendingSearchRef.current = null;
    runSearch(pendingSearch.query, {
      activeIndex: getActiveIndex(pendingSearch.activeIndex),
      scroll: pendingSearch.scroll,
    });
    return true;
  }, [clearSearchTimers, runSearch]);

  const setActiveMatch = useCallback((nextIndex: number) => {
    const matches = matchesRef.current;
    const nextActiveIndex = normalizeActiveIndex(nextIndex, matches.length);
    activeIndexRef.current = nextActiveIndex;
    setActiveIndex(nextActiveIndex);
    applyHighlights(matches, nextActiveIndex);

    const scrollContainer = scrollContainerRef.current;
    if (nextActiveIndex >= 0 && scrollContainer) {
      scrollRangeIntoContainer(matches[nextActiveIndex].range, scrollContainer);
    }
  }, [scrollContainerRef]);

  const setQuery = useCallback((value: string, options?: SetQueryOptions) => {
    const nextQuery = value.slice(0, CONVERSATION_FIND_MAX_QUERY_LENGTH);
    setQueryState(nextQuery);

    if (options?.skipSearch) {
      clearSearchTimers();
      pendingSearchRef.current = null;
      return;
    }

    if (!nextQuery.trim()) {
      resetMatches();
      return;
    }

    scheduleSearch(nextQuery, { activeIndex: -1, immediate: options?.immediate, scroll: true });
  }, [clearSearchTimers, resetMatches, scheduleSearch]);

  const clear = useCallback(() => {
    setQueryState('');
    resetMatches();
  }, [resetMatches]);

  const findNext = useCallback(() => {
    if (flushPendingSearch((pendingActiveIndex) => pendingActiveIndex + 1)) return;
    if (matchesRef.current.length === 0) return;
    setActiveMatch(activeIndexRef.current + 1);
  }, [flushPendingSearch, setActiveMatch]);

  const findPrevious = useCallback(() => {
    if (flushPendingSearch((pendingActiveIndex) => pendingActiveIndex - 1)) return;
    if (matchesRef.current.length === 0) return;
    setActiveMatch(activeIndexRef.current - 1);
  }, [flushPendingSearch, setActiveMatch]);

  useEffect(() => {
    if (!isOpen) {
      clear();
    }
  }, [clear, isOpen]);

  useEffect(() => {
    if (!isOpen || !query.trim() || typeof MutationObserver === 'undefined') return;
    const root = rootRef.current;
    if (!root) return;

    const observer = new MutationObserver(() => {
      scheduleSearch(query, { activeIndex: activeIndexRef.current, scroll: false, useMaxWait: true });
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [isOpen, query, rootRef, scheduleSearch]);

  useEffect(() => {
    resetMatches();
  }, [resetMatches, sessionId]);

  useEffect(() => {
    return () => {
      clearSearchTimers();
      clearConversationHighlights();
    };
  }, [clearSearchTimers]);

  return {
    query,
    activeIndex,
    activeMatchOrdinal: totalMatches > 0 && activeIndex >= 0 ? activeIndex + 1 : 0,
    totalMatches,
    isSupported,
    setQuery,
    clear,
    findNext,
    findPrevious,
  };
}
