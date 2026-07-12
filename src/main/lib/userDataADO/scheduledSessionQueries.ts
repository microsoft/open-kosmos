import type { ChatSession } from './types/profile';

export interface ScheduledSessionPageOptions {
  limit?: number;
  offset?: number;
}

export interface ScheduledSessionPage {
  sessions: ChatSession[];
  total: number;
  hasMore: boolean;
}

export type MonthIndexReader = (month: string) => Promise<{ sessions: ChatSession[] } | null>;

interface ScheduledSessionQueryParams {
  alias: string;
  chatId: string;
  options?: ScheduledSessionPageOptions;
  operation: string;
  logContext?: Record<string, string>;
  readChatIndex: () => Promise<{ months: string[] } | null>;
  readMonthIndex: MonthIndexReader;
  matchesSession: (session: ChatSession) => boolean;
  logger: {
    info: (message: string, source: string, data?: Record<string, unknown>) => void;
    error: (message: string, source: string, data?: Record<string, unknown>) => void;
  };
}

export async function collectScheduledSessionPage(
  months: string[],
  readMonthIndex: MonthIndexReader,
  matchesSession: (session: ChatSession) => boolean,
  options?: ScheduledSessionPageOptions,
): Promise<ScheduledSessionPage> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const allMatches: ChatSession[] = [];

  for (const month of months) {
    const monthData = await readMonthIndex(month);
    if (!monthData) {
      continue;
    }

    for (const session of monthData.sessions) {
      if (matchesSession(session)) {
        allMatches.push(session);
      }
    }
  }

  allMatches.sort((a, b) =>
    new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
  );

  return {
    sessions: allMatches.slice(offset, offset + limit),
    total: allMatches.length,
    hasMore: offset + limit < allMatches.length,
  };
}

export async function queryScheduledSessionPage({
  alias,
  chatId,
  options,
  operation,
  logContext = {},
  readChatIndex,
  readMonthIndex,
  matchesSession,
  logger,
}: ScheduledSessionQueryParams): Promise<ScheduledSessionPage> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  try {
    const chatIndex = await readChatIndex();
    if (!chatIndex || chatIndex.months.length === 0) {
      return { sessions: [], total: 0, hasMore: false };
    }

    const result = await collectScheduledSessionPage(chatIndex.months, readMonthIndex, matchesSession, options);
    logger.info(`[ChatSessionManager] ${operation} completed`, operation, {
      alias,
      chatId,
      ...logContext,
      limit,
      offset,
      totalMatches: result.total,
      returnedCount: result.sessions.length,
      hasMore: result.hasMore,
    });

    return result;
  } catch (error) {
    logger.error(`[ChatSessionManager] ${operation} failed`, operation, {
      alias,
      chatId,
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sessions: [], total: 0, hasMore: false };
  }
}
