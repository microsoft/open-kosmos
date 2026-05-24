/**
 * agentDuplicator.ts
 *
 * Orchestrates agent duplication: creates a new agent config,
 * copies knowledge files, and duplicates scheduled tasks.
 *
 * <!-- Last verified: 2026-05-12 -->
 */

import * as fs from 'fs';
import * as path from 'path';
import { createConsoleLogger } from '../unifiedLogger';
import {
  ChatConfig,
  ChatAgent,
  getAgentKnowledge,
} from './types/profile';
import { generateChatId } from './profileSanitizer';
import { schedulerManager } from '../scheduler/SchedulerManager';
import type { SchedulerJob } from '../scheduler/types';
import type { ProfileCacheManager } from './profileCacheManager';

const logger = createConsoleLogger();

const RUNTIME_FIELDS: (keyof SchedulerJob)[] = ['id', 'lastRunAt', 'lastFinishedAt', 'executedAt'];

function omitRuntimeFields(job: SchedulerJob): Omit<SchedulerJob, 'id' | 'lastRunAt' | 'lastFinishedAt' | 'executedAt'> {
  const copy = { ...job };
  for (const key of RUNTIME_FIELDS) {
    delete copy[key];
  }
  return copy;
}

export interface DuplicateChatConfigResult {
  success: boolean;
  newChatId?: string;
  knowledgeCopyFailed?: boolean;
  scheduleCopyFailed?: boolean;
  error?: string;
}

/**
 * Duplicate an agent with independent workspace, knowledge files, and scheduled tasks.
 */
export async function duplicateAgent(
  profileCacheManager: ProfileCacheManager,
  alias: string,
  sourceChatId: string,
  newAgentName: string,
): Promise<DuplicateChatConfigResult> {
  try {
    const sourceChat = profileCacheManager.getChatConfig(alias, sourceChatId);
    if (!sourceChat || !sourceChat.agent) {
      return { success: false, error: 'Source agent not found' };
    }

    const sourceKnowledgePath = getAgentKnowledge(sourceChat.agent).knowledgeBase;

    // Build new chat config with cleared workspace/knowledge so addChatConfig auto-generates fresh paths
    const newChatId = generateChatId();
    const duplicatedAgent: ChatAgent = {
      ...sourceChat.agent,
      name: newAgentName,
      source: 'ON-DEVICE',
      version: '1.0.0',
      workspace: '',
      knowledge: { knowledgeBase: '' },
    };

    const newChatConfig: ChatConfig = {
      chat_id: newChatId,
      chat_type: sourceChat.chat_type || 'single_agent',
      agent: duplicatedAgent,
    };

    const added = await profileCacheManager.addChatConfig(alias, newChatConfig);
    if (!added) {
      return { success: false, error: 'Failed to create duplicated agent' };
    }

    // Copy knowledge files
    const newChat = profileCacheManager.getChatConfig(alias, newChatId);
    const newKnowledgePath = newChat ? getAgentKnowledge(newChat.agent).knowledgeBase : '';
    let knowledgeCopyFailed = false;

    if (sourceKnowledgePath && newKnowledgePath && sourceKnowledgePath !== newKnowledgePath) {
      try {
        await copyDirectoryRecursiveAsync(sourceKnowledgePath, newKnowledgePath);
      } catch (err) {
        knowledgeCopyFailed = true;
        logger.warn('[AgentDuplicator] Failed to copy knowledge files', 'duplicateAgent', {
          sourceChatId, newChatId, error: String(err),
        });
      }
    }

    // Duplicate scheduled tasks via SchedulerManager (registers runtime cron/timeout + notifies renderer)
    let scheduleCopyFailed = false;
    try {
      const sourceJobs = (await schedulerManager.listJobs(sourceChatId)).filter(j => j.enabled);
      const results = await Promise.allSettled(sourceJobs.map(job =>
        schedulerManager.createJob({
          ...omitRuntimeFields(job),
          agentId: newChatId,
          status: 'pending',
        })
      ));
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        scheduleCopyFailed = true;
        logger.warn('[AgentDuplicator] Some scheduled tasks failed to duplicate', 'duplicateAgent', {
          sourceChatId, newChatId, failedCount: failures.length, totalCount: sourceJobs.length,
        });
      }
    } catch (err) {
      scheduleCopyFailed = true;
      logger.warn('[AgentDuplicator] Failed to duplicate scheduled tasks', 'duplicateAgent', {
        sourceChatId, newChatId, error: String(err),
      });
    }

    return { success: true, newChatId, knowledgeCopyFailed, scheduleCopyFailed };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Recursively copy directory contents (async).
 */
async function copyDirectoryRecursiveAsync(src: string, dest: string): Promise<void> {
  const fsp = fs.promises;
  const stat = await fsp.stat(src);
  if (!stat.isDirectory()) return;

  await fsp.mkdir(dest, { recursive: true });

  const entries = await fsp.readdir(src);
  await Promise.all(entries.map(async (entry) => {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const entryStat = await fsp.stat(srcPath);
    if (entryStat.isDirectory()) {
      await copyDirectoryRecursiveAsync(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }));
}
