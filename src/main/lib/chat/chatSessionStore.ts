import { BrowserWindow } from 'electron';
import { chatSessionManager } from '../userDataADO/chatSessionManager';
import { ChatSessionFile } from '../userDataADO/chatSessionFileOps';
import {
  ChatSession,
  ChatSessionReadStatus,
} from '../userDataADO/types/profile';
import type { ChatUnreadSummary } from '../../../shared/types/chatSessionTypes';
import {
  extractMonthFromChatSessionId,
  isValidChatSessionId,
} from '../userDataADO/pathUtils';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeReadStatus(status?: ChatSessionReadStatus): ChatSessionReadStatus {
  return status === 'unread' ? 'unread' : 'read';
}

function buildMetadataSnapshot(metadata: ChatSession): ChatSession {
  return {
    ...cloneDeep(metadata),
    readStatus: normalizeReadStatus(metadata.readStatus),
  };
}

function buildFileSnapshot(file: ChatSessionFile, lastUpdated: string): ChatSessionFile {
  return {
    ...cloneDeep(file),
    last_updated: lastUpdated,
  };
}

const RECENT_SCHEDULED_UNREAD_DAYS = 5;
const RECENT_SCHEDULED_UNREAD_WINDOW_MS =
  RECENT_SCHEDULED_UNREAD_DAYS * 24 * 60 * 60 * 1000;

function isScheduledSession(session: Pick<ChatSession, 'schedulerJobId'>): boolean {
  return typeof session.schedulerJobId === 'string' && session.schedulerJobId.trim().length > 0;
}

function getScheduledSessionEventTime(session: Pick<ChatSession, 'schedulerCompletedAt' | 'schedulerStartedAt' | 'last_updated'>): number | null {
  const timestamp = session.schedulerCompletedAt || session.schedulerStartedAt || session.last_updated;
  const value = new Date(timestamp).getTime();
  return Number.isNaN(value) ? null : value;
}

function isWithinRecentScheduledUnreadWindow(timestampMs: number, nowMs: number): boolean {
  return timestampMs >= nowMs - RECENT_SCHEDULED_UNREAD_WINDOW_MS;
}

export interface ChatSessionRuntimeState {
  loaded: boolean;
  dirtyMetadata: boolean;
  dirtyFile: boolean;
  revision: number;
  persistedRevision: number;
  lastAccessedAt: number;
  isFlushing: boolean;
}

export interface ChatSessionAggregate {
  alias: string;
  chatId: string;
  month: string;
  metadata: ChatSession;
  file: ChatSessionFile;
  runtime: ChatSessionRuntimeState;
}

interface SessionMutationContext {
  aggregate: ChatSessionAggregate;
  previousMetadata: ChatSession;
  previousFile: ChatSessionFile;
}

export interface ChatSessionListProjection {
  alias: string;
  chatId: string;
  sessions: ChatSession[];
  timestamp: number;
}

export class ChatSessionStore {
  private static instance: ChatSessionStore;

  private readonly sessionsById: Map<string, ChatSessionAggregate> = new Map();
  private readonly chatToSessionIds: Map<string, Set<string>> = new Map();
  private readonly sessionMutationQueues: Map<string, Promise<void>> = new Map();
  private mainWindow: BrowserWindow | null = null;

  private constructor() {}

  static getInstance(): ChatSessionStore {
    if (!ChatSessionStore.instance) {
      ChatSessionStore.instance = new ChatSessionStore();
    }
    return ChatSessionStore.instance;
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  async ensureLoaded(alias: string, chatId: string, chatSessionId: string): Promise<ChatSessionAggregate | null> {
    const cached = this.sessionsById.get(chatSessionId);
    if (cached) {
      cached.runtime.lastAccessedAt = Date.now();
      return cached;
    }

    if (!isValidChatSessionId(chatSessionId)) {
      logger.warn('[ChatSessionStore] Invalid chatSessionId in ensureLoaded', 'ensureLoaded', {
        alias,
        chatId,
        chatSessionId,
      });
      return null;
    }

    const month = extractMonthFromChatSessionId(chatSessionId);
    if (!month) {
      return null;
    }

    const monthIndex = await chatSessionManager.readMonthIndex(alias, chatId, month);
    if (!monthIndex) {
      return null;
    }

    const metadata = monthIndex.sessions.find((session) => session.chatSession_id === chatSessionId);
    if (!metadata) {
      return null;
    }

    const file = await chatSessionManager.getChatSessionFile(alias, chatId, chatSessionId);
    if (!file) {
      return null;
    }

    const aggregate = this.buildAggregate(alias, chatId, month, metadata, file, true);
    this.cacheAggregate(aggregate);
    return aggregate;
  }

  async createSession(
    alias: string,
    chatId: string,
    metadata: ChatSession,
    file: ChatSessionFile,
    options?: { autoSelect?: boolean }
  ): Promise<ChatSessionAggregate> {
    const month = extractMonthFromChatSessionId(metadata.chatSession_id);
    if (!month) {
      throw new Error(`Invalid chatSessionId: ${metadata.chatSession_id}`);
    }

    const aggregate = this.buildAggregate(alias, chatId, month, metadata, file, false);
    aggregate.runtime.dirtyMetadata = true;
    aggregate.runtime.dirtyFile = true;
    aggregate.runtime.revision = 1;

    this.cacheAggregate(aggregate);
    await this.flushSession(metadata.chatSession_id, { isCreate: true, autoSelect: options?.autoSelect !== false });
    this.notifySessionCreated(aggregate);
    await this.notifyUnreadSummaryChanged(alias, chatId);
    return aggregate;
  }

  async saveSession(
    alias: string,
    chatId: string,
    metadata: ChatSession,
    file: ChatSessionFile,
    options?: { autoSelect?: boolean }
  ): Promise<ChatSessionAggregate | null> {
    const existing = await this.ensureLoaded(alias, chatId, metadata.chatSession_id);
    if (!existing) {
      return this.createSession(alias, chatId, metadata, file, options);
    }

    return this.enqueueMutation(alias, chatId, metadata.chatSession_id, async ({ aggregate }) => {
      const nextLastUpdated = metadata.last_updated || file.last_updated || new Date().toISOString();
      const nextFile = buildFileSnapshot(
        {
          ...aggregate.file,
          ...cloneDeep(file),
          chatSession_id: aggregate.file.chatSession_id,
          last_updated: nextLastUpdated,
        },
        nextLastUpdated
      );
      const nextMetadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        ...cloneDeep(metadata),
        chatSession_id: aggregate.metadata.chatSession_id,
        title: nextFile.title,
        last_updated: nextLastUpdated,
      });

      aggregate.file = nextFile;
      aggregate.metadata = nextMetadata;
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.dirtyFile = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(metadata.chatSession_id);
      this.notifyFilePatched(aggregate);
      this.notifyMetadataPatched(aggregate);
      await this.notifyUnreadSummaryChanged(aggregate.alias, aggregate.chatId);
      return aggregate;
    });
  }

  async patchMetadata(
    alias: string,
    chatId: string,
    chatSessionId: string,
    patch: Partial<ChatSession>
  ): Promise<ChatSessionAggregate | null> {
    return this.enqueueMutation(alias, chatId, chatSessionId, async ({ aggregate }) => {
      const nextLastUpdated = patch.last_updated ?? new Date().toISOString();
      aggregate.metadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        ...cloneDeep(patch),
        chatSession_id: aggregate.metadata.chatSession_id,
        last_updated: nextLastUpdated,
      });
      aggregate.file.last_updated = nextLastUpdated;
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(chatSessionId);
      this.notifyMetadataPatched(aggregate);
      await this.notifyUnreadSummaryChanged(aggregate.alias, aggregate.chatId);
      return aggregate;
    });
  }

  async patchFile(
    alias: string,
    chatId: string,
    chatSessionId: string,
    patch: Partial<ChatSessionFile>
  ): Promise<ChatSessionAggregate | null> {
    return this.enqueueMutation(alias, chatId, chatSessionId, async ({ aggregate }) => {
      const nextLastUpdated = patch.last_updated ?? new Date().toISOString();
      aggregate.file = buildFileSnapshot(
        {
          ...aggregate.file,
          ...cloneDeep(patch),
          chatSession_id: aggregate.file.chatSession_id,
          last_updated: nextLastUpdated,
        },
        nextLastUpdated
      );
      aggregate.metadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        title: aggregate.file.title,
        last_updated: nextLastUpdated,
      });
      aggregate.runtime.dirtyFile = true;
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(chatSessionId);
      this.notifyFilePatched(aggregate);
      this.notifyMetadataPatched(aggregate);
      await this.notifyUnreadSummaryChanged(aggregate.alias, aggregate.chatId);
      return aggregate;
    });
  }

  async setReadStatus(
    alias: string,
    chatId: string,
    chatSessionId: string,
    readStatus: ChatSessionReadStatus
  ): Promise<ChatSessionAggregate | null> {
    return this.enqueueMutation(alias, chatId, chatSessionId, async ({ aggregate }) => {
      const normalized = normalizeReadStatus(readStatus);
      if (normalizeReadStatus(aggregate.metadata.readStatus) === normalized) {
        aggregate.runtime.lastAccessedAt = Date.now();
        return aggregate;
      }

      aggregate.metadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        readStatus: normalized,
      });
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(chatSessionId);
      this.notifyMetadataPatched(aggregate);
      await this.notifyUnreadSummaryChanged(aggregate.alias, aggregate.chatId);
      return aggregate;
    });
  }

  async setStarred(
    alias: string,
    chatId: string,
    chatSessionId: string,
    starred: boolean
  ): Promise<ChatSessionAggregate | null> {
    return this.enqueueMutation(alias, chatId, chatSessionId, async ({ aggregate }) => {
      const normalizedStarred = starred === true;
      const currentStarred = aggregate.metadata.starred === true;

      if (currentStarred === normalizedStarred) {
        aggregate.runtime.lastAccessedAt = Date.now();
        return aggregate;
      }

      aggregate.metadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        starred: normalizedStarred,
        starredAt: normalizedStarred ? new Date().toISOString() : undefined,
        // Starring should not affect conversational recency ordering.
        last_updated: aggregate.metadata.last_updated,
      });
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(chatSessionId);
      this.notifyMetadataPatched(aggregate);
      return aggregate;
    });
  }

  async patchSchedulerMetadata(
    alias: string,
    chatId: string,
    chatSessionId: string,
    patch: Pick<Partial<ChatSession>, 'schedulerJobId' | 'schedulerExecutionStatus' | 'schedulerStartedAt' | 'schedulerCompletedAt' | 'schedulerError'>
  ): Promise<ChatSessionAggregate | null> {
    return this.enqueueMutation(alias, chatId, chatSessionId, async ({ aggregate }) => {
      const nextMetadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        ...cloneDeep(patch),
      });

      const metadataChanged =
        nextMetadata.schedulerJobId !== aggregate.metadata.schedulerJobId ||
        nextMetadata.schedulerExecutionStatus !== aggregate.metadata.schedulerExecutionStatus ||
        nextMetadata.schedulerStartedAt !== aggregate.metadata.schedulerStartedAt ||
        nextMetadata.schedulerCompletedAt !== aggregate.metadata.schedulerCompletedAt ||
        nextMetadata.schedulerError !== aggregate.metadata.schedulerError;

      if (!metadataChanged) {
        aggregate.runtime.lastAccessedAt = Date.now();
        return aggregate;
      }

      aggregate.metadata = nextMetadata;
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(chatSessionId);
      this.notifyMetadataPatched(aggregate);
      return aggregate;
    });
  }

  async renameSession(
    alias: string,
    chatId: string,
    chatSessionId: string,
    title: string
  ): Promise<ChatSessionAggregate | null> {
    return this.enqueueMutation(alias, chatId, chatSessionId, async ({ aggregate }) => {
      const nextLastUpdated = new Date().toISOString();
      aggregate.file = buildFileSnapshot(
        {
          ...aggregate.file,
          title,
          last_updated: nextLastUpdated,
        },
        nextLastUpdated
      );
      aggregate.metadata = buildMetadataSnapshot({
        ...aggregate.metadata,
        title,
        last_updated: nextLastUpdated,
      });
      aggregate.runtime.dirtyFile = true;
      aggregate.runtime.dirtyMetadata = true;
      aggregate.runtime.revision += 1;
      aggregate.runtime.lastAccessedAt = Date.now();

      await this.flushSession(chatSessionId);
      this.notifyFilePatched(aggregate);
      this.notifyMetadataPatched(aggregate);
      await this.notifyUnreadSummaryChanged(aggregate.alias, aggregate.chatId);
      return aggregate;
    });
  }

  getSession(chatSessionId: string): ChatSessionAggregate | null {
    const aggregate = this.sessionsById.get(chatSessionId) || null;
    if (aggregate) {
      aggregate.runtime.lastAccessedAt = Date.now();
    }
    return aggregate;
  }

  getSessionFile(chatSessionId: string): ChatSessionFile | null {
    const aggregate = this.getSession(chatSessionId);
    return aggregate ? buildFileSnapshot(aggregate.file, aggregate.file.last_updated) : null;
  }

  getSessionMetadata(chatSessionId: string): ChatSession | null {
    const aggregate = this.getSession(chatSessionId);
    return aggregate ? buildMetadataSnapshot(aggregate.metadata) : null;
  }

  async deleteSession(alias: string, chatId: string, chatSessionId: string): Promise<boolean> {
    const aggregate = await this.ensureLoaded(alias, chatId, chatSessionId);
    if (!aggregate) {
      return await chatSessionManager.deleteChatSession(alias, chatId, chatSessionId);
    }

    const result = await this.enqueueOnSession(chatSessionId, async () => {
      const deleted = await chatSessionManager.deleteChatSession(alias, chatId, chatSessionId);
      if (!deleted) {
        return false;
      }
      this.sessionsById.delete(chatSessionId);
      const sessionIds = this.chatToSessionIds.get(chatId);
      sessionIds?.delete(chatSessionId);
      if (sessionIds && sessionIds.size === 0) {
        this.chatToSessionIds.delete(chatId);
      }
      this.notifySessionDeleted(alias, chatId, chatSessionId);
      await this.notifyUnreadSummaryChanged(alias, chatId);
      return true;
    });

    return result;
  }

  async getChatSessionsProjection(alias: string, chatId: string): Promise<ChatSessionListProjection> {
    const persisted = await chatSessionManager.getAllChatSessions(alias, chatId);
    const overlays = this.chatToSessionIds.get(chatId);
    const byId = new Map<string, ChatSession>(persisted.map((session) => [session.chatSession_id, buildMetadataSnapshot(session)]));

    if (overlays) {
      overlays.forEach((sessionId) => {
        const aggregate = this.sessionsById.get(sessionId);
        if (!aggregate || aggregate.alias !== alias || aggregate.chatId !== chatId) {
          return;
        }
        byId.set(sessionId, buildMetadataSnapshot(aggregate.metadata));
      });
    }

    const sessions = Array.from(byId.values()).sort(
      (a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
    );

    return {
      alias,
      chatId,
      sessions,
      timestamp: Date.now(),
    };
  }

  async getAllSessions(alias: string, chatId: string): Promise<ChatSession[]> {
    const projection = await this.getChatSessionsProjection(alias, chatId);
    return projection.sessions;
  }

  async getUnreadSummary(alias: string, chatId: string): Promise<ChatUnreadSummary> {
    const projection = await this.getChatSessionsProjection(alias, chatId);
    return this.buildUnreadSummary(chatId, projection.sessions);
  }

  async markAllSessionsAsRead(alias: string, chatId: string): Promise<number> {
    const sessions = await this.getAllSessions(alias, chatId);
    let updatedCount = 0;

    for (const session of sessions) {
      if (normalizeReadStatus(session.readStatus) === 'read') {
        continue;
      }

      const updated = await this.setReadStatus(alias, chatId, session.chatSession_id, 'read');
      if (updated) {
        updatedCount += 1;
      }
    }

    return updatedCount;
  }

  async copySession(
    alias: string,
    chatId: string,
    sourceChatSessionId: string,
    targetChatSessionId: string
  ): Promise<boolean> {
    const source = await this.ensureLoaded(alias, chatId, sourceChatSessionId);
    if (!source) {
      return false;
    }

    const now = new Date().toISOString();
    const title = source.metadata.title ? `${source.metadata.title} (Fork)` : 'New Chat (Fork)';

    await this.createSession(
      alias,
      chatId,
      {
        ...buildMetadataSnapshot(source.metadata),
        chatSession_id: targetChatSessionId,
        title,
        last_updated: now,
        readStatus: 'unread',
      },
      {
        ...buildFileSnapshot(source.file, now),
        chatSession_id: targetChatSessionId,
        title,
        last_updated: now,
      },
      { autoSelect: false }
    );

    return true;
  }

  private async enqueueMutation(
    alias: string,
    chatId: string,
    chatSessionId: string,
    mutator: (context: SessionMutationContext) => Promise<ChatSessionAggregate | null>
  ): Promise<ChatSessionAggregate | null> {
    const aggregate = await this.ensureLoaded(alias, chatId, chatSessionId);
    if (!aggregate) {
      return null;
    }

    return this.enqueueOnSession(chatSessionId, async () => {
      const current = this.sessionsById.get(chatSessionId);
      if (!current) {
        return null;
      }

      return mutator({
        aggregate: current,
        previousMetadata: buildMetadataSnapshot(current.metadata),
        previousFile: buildFileSnapshot(current.file, current.file.last_updated),
      });
    });
  }

  private async enqueueOnSession<T>(chatSessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionMutationQueues.get(chatSessionId) || Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.sessionMutationQueues.set(
      chatSessionId,
      previous.then(() => current, () => current)
    );

    await previous;

    try {
      return await task();
    } finally {
      release();
      if (this.sessionMutationQueues.get(chatSessionId) === current) {
        this.sessionMutationQueues.delete(chatSessionId);
      }
    }
  }

  private buildAggregate(
    alias: string,
    chatId: string,
    month: string,
    metadata: ChatSession,
    file: ChatSessionFile,
    loaded: boolean
  ): ChatSessionAggregate {
    const normalizedMetadata = buildMetadataSnapshot({
      ...metadata,
      readStatus: normalizeReadStatus(metadata.readStatus),
    });
    const normalizedFile = buildFileSnapshot(file, normalizedMetadata.last_updated || file.last_updated);

    return {
      alias,
      chatId,
      month,
      metadata: normalizedMetadata,
      file: normalizedFile,
      runtime: {
        loaded,
        dirtyMetadata: false,
        dirtyFile: false,
        revision: 0,
        persistedRevision: 0,
        lastAccessedAt: Date.now(),
        isFlushing: false,
      },
    };
  }

  private cacheAggregate(aggregate: ChatSessionAggregate): void {
    this.sessionsById.set(aggregate.metadata.chatSession_id, aggregate);

    const existing = this.chatToSessionIds.get(aggregate.chatId) || new Set<string>();
    existing.add(aggregate.metadata.chatSession_id);
    this.chatToSessionIds.set(aggregate.chatId, existing);
  }

  private buildUnreadSummary(chatId: string, sessions: ChatSession[]): ChatUnreadSummary {
    const now = Date.now();
    let userUnreadCount = 0;
    let scheduledUnreadCount = 0;

    for (const session of sessions) {
      if (normalizeReadStatus(session.readStatus) !== 'unread') {
        continue;
      }

      if (isScheduledSession(session)) {
        const eventTime = getScheduledSessionEventTime(session);
        if (eventTime !== null && isWithinRecentScheduledUnreadWindow(eventTime, now)) {
          scheduledUnreadCount += 1;
        }
        continue;
      }

      userUnreadCount += 1;
    }

    return {
      chatId,
      userUnreadCount,
      scheduledUnreadCount,
      updatedAt: new Date(now).toISOString(),
    };
  }

  private async flushSession(
    chatSessionId: string,
    options?: { isCreate?: boolean; autoSelect?: boolean }
  ): Promise<void> {
    const aggregate = this.sessionsById.get(chatSessionId);
    if (!aggregate) {
      return;
    }

    const targetRevision = aggregate.runtime.revision;
    aggregate.runtime.isFlushing = true;

    const metadataSnapshot = buildMetadataSnapshot(aggregate.metadata);
    const fileSnapshot = buildFileSnapshot(aggregate.file, metadataSnapshot.last_updated);

    let success = false;
    if (options?.isCreate) {
      success = await chatSessionManager.persistNewChatSession(
        aggregate.alias,
        aggregate.chatId,
        metadataSnapshot,
        fileSnapshot
      );
    } else {
      success = await chatSessionManager.persistUpdatedChatSession(
        aggregate.alias,
        aggregate.chatId,
        chatSessionId,
        metadataSnapshot,
        fileSnapshot
      );
    }

    aggregate.runtime.isFlushing = false;

    if (!success) {
      throw new Error(`Failed to flush chat session ${chatSessionId}`);
    }

    if (aggregate.runtime.revision === targetRevision) {
      aggregate.runtime.persistedRevision = targetRevision;
      aggregate.runtime.dirtyMetadata = false;
      aggregate.runtime.dirtyFile = false;
    }

    if (options?.isCreate && options.autoSelect && !metadataSnapshot.schedulerJobId) {
      this.notifyAutoSelect(aggregate.alias, aggregate.chatId, chatSessionId);
    }
  }

  private getWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }

    const windows = BrowserWindow.getAllWindows();
    return windows.find((window) => !window.isDestroyed()) || null;
  }

  private notifySessionCreated(aggregate: ChatSessionAggregate): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('chatSessionStore:sessionCreated', {
      alias: aggregate.alias,
      chatId: aggregate.chatId,
      session: buildMetadataSnapshot(aggregate.metadata),
      timestamp: Date.now(),
    });
  }

  private notifyMetadataPatched(aggregate: ChatSessionAggregate): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('chatSessionStore:metadataPatched', {
      alias: aggregate.alias,
      chatId: aggregate.chatId,
      chatSessionId: aggregate.metadata.chatSession_id,
      metadata: buildMetadataSnapshot(aggregate.metadata),
      timestamp: Date.now(),
    });
  }

  private notifyFilePatched(aggregate: ChatSessionAggregate): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('chatSessionStore:filePatched', {
      alias: aggregate.alias,
      chatId: aggregate.chatId,
      chatSessionId: aggregate.metadata.chatSession_id,
      file: buildFileSnapshot(aggregate.file, aggregate.file.last_updated),
      timestamp: Date.now(),
    });
  }

  private notifySessionDeleted(alias: string, chatId: string, chatSessionId: string): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('chatSessionStore:sessionDeleted', {
      alias,
      chatId,
      chatSessionId,
      timestamp: Date.now(),
    });
  }

  private async notifyUnreadSummaryChanged(alias: string, chatId: string): Promise<void> {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    const summary = await this.getUnreadSummary(alias, chatId);
    window.webContents.send('chatSessionStore:unreadSummaryChanged', {
      alias,
      summary,
      timestamp: Date.now(),
    });
  }

  private notifyAutoSelect(alias: string, chatId: string, chatSessionId: string): void {
    const window = this.getWindow();
    if (!window?.webContents) {
      return;
    }

    window.webContents.send('chatSession:autoSelect', {
      alias,
      chatId,
      chatSessionId,
      timestamp: Date.now(),
    });
  }
}

export const chatSessionStore = ChatSessionStore.getInstance();
