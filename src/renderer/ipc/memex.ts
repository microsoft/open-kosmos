import { renderToMain } from '@shared/ipc/memex';
import type { MemexCardsChangedEvent } from '@shared/ipc/memex';
import type { MemexMemoryTarget } from '@shared/types/memexTypes';

const rawMemexApi = renderToMain.bindRender(window.electronAPI.memex?.invoke as any);

const currentAgentTarget = (chatId: string): MemexMemoryTarget => ({ scope: 'current-agent', chatId });
const profileMemoryTarget = (): MemexMemoryTarget => ({ scope: 'profile-memory' });

// Renderer → Main. Chat callers keep the existing chatId-shaped helpers; Settings
// uses the explicit profile-memory helpers.
export const memexApi = {
  listCards(chatId: string) {
    return rawMemexApi.listCards(currentAgentTarget(chatId));
  },
  readCard(chatId: string, slug: string) {
    return rawMemexApi.readCard(currentAgentTarget(chatId), slug);
  },
  getGraph(chatId: string) {
    return rawMemexApi.getGraph(currentAgentTarget(chatId));
  },
  searchCards(chatId: string, query: string) {
    return rawMemexApi.searchCards(currentAgentTarget(chatId), query);
  },
  listProfileCards() {
    return rawMemexApi.listCards(profileMemoryTarget());
  },
  readProfileCard(slug: string) {
    return rawMemexApi.readCard(profileMemoryTarget(), slug);
  },
  getProfileGraph() {
    return rawMemexApi.getGraph(profileMemoryTarget());
  },
  searchProfileCards(query: string) {
    return rawMemexApi.searchCards(profileMemoryTarget(), query);
  },
  archiveProfileCard(slug: string) {
    return rawMemexApi.archiveProfileCard(slug);
  },
  deleteProfileCard(slug: string) {
    return rawMemexApi.deleteProfileCard(slug);
  },
};

// Main → Renderer: channel-specific `cardsChanged` push for the memory sidepane.
export const memexEvents = {
  cardsChanged(
    listener: (payload: MemexCardsChangedEvent) => void,
  ): VoidFunction {
    return window.electronAPI.memex?.onCardsChanged(listener) ?? (() => {});
  },
};
