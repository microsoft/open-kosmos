/**
 * memex IPC contract — structured reads for Memex Memory surfaces. The chat
 * sidepane reads current-agent memory; Settings reads profile-memory and can
 * archive/delete cards.
 *
 * Agent-facing mutations still go through the `memex_memory` built-in tool. The
 * renderer mutation surface intentionally excludes create/edit.
 */

import { connectRenderToMain, connectMainToRender } from './base';
import type {
  CardSummary,
  CardDetail,
  MemexGraph,
  MemexMemoryScope,
  MemexMemoryTarget,
} from '../types/memexTypes';

export type {
  CardSummary,
  CardDetail,
  MemexGraph,
  MemexMemoryScope,
  MemexMemoryTarget,
} from '../types/memexTypes';

export type MemexResult<T = void> = { success: true; data?: T } | { success: false; error: string };

// ──────────────────────────────────────────────
// Renderer → Main (invoke/handle)
// ──────────────────────────────────────────────

type RenderToMain = {
  listCards: {
    call: [target: MemexMemoryTarget];
    return: MemexResult<CardSummary[]>;
  };
  readCard: {
    call: [target: MemexMemoryTarget, slug: string];
    return: MemexResult<CardDetail>;
  };
  getGraph: {
    call: [target: MemexMemoryTarget];
    return: MemexResult<MemexGraph>;
  };
  searchCards: {
    call: [target: MemexMemoryTarget, query: string];
    return: MemexResult<CardSummary[]>;
  };
  archiveProfileCard: {
    call: [slug: string];
    return: MemexResult<string>;
  };
  deleteProfileCard: {
    call: [slug: string];
    return: MemexResult<string>;
  };
};

// ──────────────────────────────────────────────
// Main → Renderer (send/on)
// ──────────────────────────────────────────────

export interface MemexCardsChangedEvent {
  /** Memory scope whose cards changed. */
  scope: MemexMemoryScope;
  /** Chat whose visible sidepane should refresh. */
  chatId?: string;
  /** Stable agent identity whose card set changed. */
  agentId?: string;
}

type MainToRender = {
  cardsChanged: MemexCardsChangedEvent;
};

export const renderToMain = connectRenderToMain<RenderToMain>('memex');
export const mainToRender = connectMainToRender<MainToRender>('memex');
