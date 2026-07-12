import * as fs from 'fs';
import * as path from 'path';

import { Message, MessageHelper } from '@shared/types/chatTypes';
import { extractMonthFromChatSessionId } from '../userDataADO/pathUtils';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getChatPrimaryAgent, getChatWorkspace } from '../userDataADO/agentAccessor';
import { mcpConfigManager } from '../userDataADO/mcpConfigManager';
import { skillsConfigManager } from '../userDataADO/skillsConfigManager';
import { chatSkillSnapshotStore } from '../userDataADO/chatSkillSnapshotStore';
import { getGlobalSystemPromptAsMessages } from './globalSystemPrompt';
import { skillManager } from '../skill/skillManager';
import { buildChatSkillSnapshot } from './skillSnapshotBuilder';
import { createLogger } from '../unifiedLogger';
import { wrapInSystemReminder } from './systemReminderUtils';
import type { AgentConfig } from './agentChat';
import type { AgentChatInteractionPolicy } from './agentChatInteractionPolicy';
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";
import { renderAgentSystemPrompt } from '@shared/types/agentSystemPrompt';
import { buildMemexMemoryPrompt } from '../memex/memexMemoryPrompt';

const logger = createLogger();

// Authoritative system-reminder injected when the agent has ZERO tools available
// for the current turn (its mcp_servers select no servers/tools). The static
// global system prompt unconditionally documents the full builtin tool suite
// (bing_web_search, read_file, execute_command, M365, ...), so without this
// override the model reads that manual and hallucinates tool use — claiming it
// can call tools and even emitting tool-call syntax as plain text with fabricated
// results — despite no tools being sent to the API. This reminder tells the model
// the truth so its stated capabilities match its actual (empty) tool surface.
const NO_TOOLS_AVAILABLE_REMINDER =
  'You currently have NO tools available for this session. Any tool descriptions ' +
  'elsewhere in this system prompt (file operations, web/Bing search, ' +
  'execute_command, Microsoft 365, etc.) DO NOT apply right now — the user has ' +
  'configured this agent with no MCP servers or tools. You MUST NOT claim you can ' +
  'use any tool, MUST NOT emit tool-call syntax, and MUST NOT fabricate tool ' +
  'results (e.g. pretend to search the web or read a file). Answer only from your ' +
  'own knowledge and the conversation. If a request genuinely requires a tool, ' +
  'tell the user plainly that no tools are currently enabled for this agent and ' +
  'that they can enable tools in the agent editor.';

// ============ Directory index injection limits (Phase 1.5) ============
// Bounded, relative-path listing of KB / deliverables directories injected
// into the agent-specific system prompt so the model can SEE what files exist
// (gives keyword association a correct anchor) without injecting file content.
const DIRECTORY_INDEX_LIMITS = {
  MAX_FILES: 100,   // max relative paths listed per directory
  MAX_DEPTH: 3,     // max directory levels walked (root children = depth 1)
  SCAN_LIMIT: 5000, // hard cap on entries visited to bound worst-case cost
} as const;

// Directories never traversed for the index. `.claude` is excluded because
// KB skills are already surfaced separately by the skills scan below.
const DIRECTORY_INDEX_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.claude',
]);

/**
 * Synchronously build a bounded, flat relative-path index of a directory.
 *
 * Reuses the same synchronous `fs.readdirSync` pattern as the skills scan so it
 * can run inside the synchronous `getAgentSpecificSystemPrompt()`. Never throws:
 * any fs error on a sub-directory is swallowed and that branch is skipped.
 *
 * @returns paths sorted ascending; `moreCount` is the number of files beyond
 *          MAX_FILES that were counted but not listed.
 */
function buildDirectoryIndex(rootPath: string): { paths: string[]; moreCount: number; scanLimitHit: boolean } {
  const collected: string[] = [];
  let totalFiles = 0;
  let scanned = 0;
  let scanLimitHit = false;

  const walk = (dir: string, depth: number): void => {
    if (scanLimitHit) return;

    let entries: import('fs').Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable sub-directory — skip this branch, never throw.
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (scanLimitHit) return;
      scanned += 1;
      if (scanned > DIRECTORY_INDEX_LIMITS.SCAN_LIMIT) {
        scanLimitHit = true;
        return;
      }

      if (entry.name === '.DS_Store') continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (DIRECTORY_INDEX_SKIP_DIRS.has(entry.name)) continue;
        if (depth + 1 <= DIRECTORY_INDEX_LIMITS.MAX_DEPTH) {
          walk(full, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      totalFiles += 1;
      if (collected.length < DIRECTORY_INDEX_LIMITS.MAX_FILES) {
        // POSIX-style separators for consistent, model-friendly output.
        const rel = path.relative(rootPath, full).split(path.sep).join('/');
        collected.push(rel);
      }
    }
  };

  walk(rootPath, 1);
  collected.sort();
  const moreCount = Math.max(0, totalFiles - collected.length);
  return { paths: collected, moreCount, scanLimitHit };
}

/**
 * Format a directory index as system-prompt bullet lines.
 * Returns [] when the directory has no listable files AND the walk completed
 * (no scan-limit truncation). If the walk hit SCAN_LIMIT before collecting any
 * file (e.g. thousands of directories/skipped entries sorted ahead of files),
 * still emit an honest "too large" note rather than silently reporting empty —
 * otherwise the model is told to search its own sources but given no signal the
 * directory was truncated.
 */
function formatDirectoryIndexLines(rootPath: string, header: string): string[] {
  const { paths, moreCount, scanLimitHit } = buildDirectoryIndex(rootPath);
  if (paths.length === 0) {
    if (scanLimitHit) {
      return [
        header,
        `  ... directory too large to list fully (use search_files / search_file_contents to explore the contents)`,
      ];
    }
    return [];
  }

  const lines: string[] = [header];
  for (const p of paths) {
    lines.push(`  - ${p}`);
  }
  if (scanLimitHit) {
    // The walk stopped early, so `moreCount` would understate the true total.
    // Emit an honest "too large" note instead of a misleading number.
    lines.push(`  ... directory too large to list fully (showing first ${paths.length}; use search_files / search_file_contents to explore the rest)`);
  } else if (moreCount > 0) {
    lines.push(`  ... and ${moreCount} more file(s) (use search_files / search_file_contents to explore)`);
  }
  return lines;
}

export interface AgentChatPromptServiceDeps {
  getCurrentUserAlias(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getAgentName(): string;
  getLatestAgentConfig(): AgentConfig | null;
  getInteractionPolicy(): AgentChatInteractionPolicy;
}

export class AgentChatPromptService {
  /** Additional context strings injected by SessionStart hooks. */
  private hookAdditionalContexts: string[] = [];
  /** System message fragments injected by Agent Hooks. */
  private hookSystemMessages: string[] = [];


  constructor(private readonly deps: AgentChatPromptServiceDeps) {}

  /**
   * Store additional context strings from Agent Hooks (e.g. SessionStart).
   * These are injected into the system prompt via getCombinedSystemPromptForContext().
   */
  setHookAdditionalContexts(contexts: string[]): void {
    this.hookAdditionalContexts = contexts;
    logger.info('[AgentChatPromptService] Stored hook additional contexts', 'setHookAdditionalContexts', {
      count: contexts.length,
      totalChars: contexts.reduce((s, c) => s + c.length, 0),
    });
  }

  setHookSystemMessages(messages: string[]): void {
    this.hookSystemMessages = messages;
    logger.info('[AgentChatPromptService] Stored hook system messages', 'setHookSystemMessages', {
      count: messages.length,
      totalChars: messages.reduce((s, c) => s + c.length, 0),
    });
  }


  async getCurrentAvailableTools(): Promise<any[]> {
    try {
      const latestConfig = this.deps.getLatestAgentConfig();
      if (!latestConfig) {
        logger.warn('[AgentChat] Cannot get tools: no agent config available');
        return [];
      }

      const allTools = await mcpClientManager.getAllTools();

      let globalMcpServers: Array<{ name: string; in_use: boolean }> = [];
      const currentUserAlias = this.deps.getCurrentUserAlias();
      if (currentUserAlias) {
        globalMcpServers = mcpConfigManager.getServers(currentUserAlias);
      }

      // Assemble the agent's tool surface strictly from its configured mcp_servers.
      // Data model (authoritative):
      //   - A server entry { name, tools: [] } exposes ALL of that server's tools.
      //   - A server entry { name, tools: [t1, t2] } exposes only those tools.
      //   - A server that is NOT present in mcp_servers is not used at all.
      //   - builtin-tools is a normal server governed by these same rules.
      // Therefore an empty mcp_servers array means NO servers -> NO tools. An empty
      // array must never fall back to "all tools": that inverts the model and leaks
      // every connected tool to an agent whose servers the user has explicitly
      // cleared (e.g. unselecting everything in the editor removes each entry).
      const configuredServers = latestConfig.mcp_servers ?? [];
      const filteredTools: any[] = [];

      for (const serverConfig of configuredServers) {
        const serverName = serverConfig.name;
        const selectedTools = serverConfig.tools || [];
        const globalServer = globalMcpServers.find((server) => server.name === serverName);
        if (globalServer && globalServer.in_use === false) {
          continue;
        }

        const serverTools = allTools.filter((tool) => tool.serverName === serverName);
        if (selectedTools.length === 0) {
          filteredTools.push(...serverTools);
        } else {
          filteredTools.push(...serverTools.filter((tool) => selectedTools.includes(tool.name)));
        }
      }

      return filteredTools;
    } catch (error) {
      logger.error(`[AgentChat] Failed to get current available tools: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  getLatestCustomSystemPrompt(): Message[] {
    const config = this.deps.getLatestAgentConfig();
    if (!config) {
      return [];
    }
    const systemPrompt = renderAgentSystemPrompt(config.system_prompt);
    if (!systemPrompt) {
      return [];
    }

    return [
      MessageHelper.createTextMessage(
        systemPrompt,
        'system',
        `system-${config.name}-${config.role}`,
      ),
    ];
  }

  getGlobalSystemPrompt(): Message[] {
    return getGlobalSystemPromptAsMessages();
  }

  getAgentSpecificSystemPrompt(): Message[] {
    let workspaceInfo = '';
    let skillsInfo = '';

    const agentName = this.deps.getAgentName();
    const currentUserAlias = this.deps.getCurrentUserAlias();
    const chatSessionId = this.deps.getChatSessionId();
    const chatId = this.deps.getChatId();

    const agentIdentityInfo = `\n---\n**Your Identity:**\n- You are **${agentName}**, an AI assistant.\n- When users ask about "${agentName}" or refer to "you", they are asking about you as ${agentName}.\n- Your configured context can include Knowledge Base and workspace files. When users ask questions related to "${agentName}", treat configured local knowledge as relevant context.\n---`;

    try {
      if (currentUserAlias) {
        const allChats = profileCacheManager.getAllChatConfigs(currentUserAlias);
        // Identify the current chat by its stable chat_id, never by agent name:
        // under 1 Chat : N Agents an agent name can be shared across chats, so a
        // name match could select a DIFFERENT chat and inject the wrong knowledge
        // base, workspace, and skill snapshot (cross-chat leakage). Fall back to a
        // name match only when no chat matches the id (e.g. a transient chat not
        // yet in the cache), preserving prior behavior for that edge case.
        const currentChat =
          allChats.find((chat) => chat.chat_id === chatId) ??
          allChats.find((chat) => getChatPrimaryAgent(chat)?.name === agentName);
        const currentAgent = getChatPrimaryAgent(currentChat);

        const knowledgeBasePath = currentAgent?.knowledge?.knowledgeBase ?? currentAgent?.knowledgeBase;
        const hasKnowledgeBase = knowledgeBasePath && typeof knowledgeBasePath === 'string' && knowledgeBasePath.trim().length > 0;

        const workspacePath = getChatWorkspace(currentChat);
        const hasWorkspace = workspacePath && typeof workspacePath === 'string' && workspacePath.trim().length > 0;
        let chatSessionFilesPath = '';

        if (hasWorkspace && chatSessionId) {
          const yearMonth = extractMonthFromChatSessionId(chatSessionId);
          if (yearMonth) {
            const sep = workspacePath.includes('\\') ? '\\' : '/';
            chatSessionFilesPath = `${workspacePath}${sep}${yearMonth}${sep}${chatSessionId}`;
          }
        }

        const hasChatSessionFiles = chatSessionFilesPath.length > 0;
        const sections: string[] = [];
        sections.push('\n---');
        sections.push('\n**Your Knowledge Sources:**');

        if (hasKnowledgeBase) {
          sections.push(`- Knowledge Base files are enabled at \`${knowledgeBasePath}\`.`);
          sections.push(`- Path schema: \`@knowledge-base:{relative_path}\` → \`${knowledgeBasePath}/{relative_path}\``);
          try {
            if (fs.existsSync(knowledgeBasePath)) {
              const indexLines = formatDirectoryIndexLines(
                knowledgeBasePath,
                '- Knowledge Base contents (relative paths under the path above):',
              );
              sections.push(...indexLines);
            }
          } catch (idxErr) {
            logger.warn('[AgentChat] 📂 Failed to build Knowledge Base directory index', 'getAgentSpecificSystemPrompt', idxErr);
          }
        } else {
          sections.push('- Knowledge Base files are not configured.');
        }

        if (hasChatSessionFiles) {
          sections.push(`\n**Your Current Chat Session Deliverables Directory:** \`${chatSessionFilesPath}\``);
          sections.push(`- Path schema: \`@chat-session:{relative_path}\` → \`${chatSessionFilesPath}/{relative_path}\``);
          try {
            if (fs.existsSync(chatSessionFilesPath)) {
              const deliverableLines = formatDirectoryIndexLines(
                chatSessionFilesPath,
                '- Current Chat Session Deliverables contents (relative paths under the path above):',
              );
              if (deliverableLines.length > 0) {
                sections.push(...deliverableLines);
              } else {
                sections.push('- No deliverables have been produced in this session yet.');
              }
            } else {
              sections.push('- No deliverables have been produced in this session yet.');
            }
          } catch (idxErr) {
            logger.warn('[AgentChat] 📂 Failed to build deliverables directory index', 'getAgentSpecificSystemPrompt', idxErr);
          }
        }

        const primaryCwd = hasChatSessionFiles ? chatSessionFilesPath : (hasKnowledgeBase ? knowledgeBasePath : '');
        sections.push('\n**Command Execution:**');
        sections.push(`- Your working directory is \`${primaryCwd}\`. Pass the correct 'cwd' parameter when using execute_command.`);
        sections.push('- To run commands outside this directory, prepend `cd {target_dir} &&` before the command.');
        sections.push('\n---');
        workspaceInfo = sections.join('\n');

        if (hasKnowledgeBase) {
          try {
            const claudeSkillsDir = path.join(knowledgeBasePath, '.claude', 'skills');
            if (fs.existsSync(claudeSkillsDir)) {
              const entries: any[] = fs.readdirSync(claudeSkillsDir, { withFileTypes: true });
              const skillDirs = entries.filter((entry: any) => entry.isDirectory());

              if (skillDirs.length > 0) {
                const fsSkillsSections: string[] = [];
                fsSkillsSections.push('\n---');
                fsSkillsSections.push(`\n**Knowledge Base Skills** (${skillDirs.length} skills found in \`${claudeSkillsDir}\`):`);
                fsSkillsSections.push('\nThese skills are pre-configured in your Knowledge Base directory. When a task is relevant to a skill, use `read_file` to load its `SKILL.md` for detailed instructions before proceeding.\n');

                for (let i = 0; i < skillDirs.length; i += 1) {
                  const skillDir = skillDirs[i];
                  const skillDirPath = path.join(claudeSkillsDir, skillDir.name);
                  const skillMdPath = path.join(skillDirPath, 'SKILL.md');
                  const hasSkillMd = fs.existsSync(skillMdPath);
                  let description = 'No description available';
                  let version = 'N/A';
                  if (hasSkillMd) {
                    const { metadata } = skillManager.getSkillMetadata(skillDirPath);
                    if (metadata) {
                      description = metadata.description || description;
                      version = metadata.version || version;
                    }
                  }

                  fsSkillsSections.push(`${i + 1}. **${skillDir.name}**`);
                  fsSkillsSections.push(`   - Description: ${description}`);
                  fsSkillsSections.push(`   - Version: ${version}`);
                  fsSkillsSections.push(`   - File Path: \`${hasSkillMd ? skillMdPath : skillDirPath}\``);
                  fsSkillsSections.push('');
                }

                fsSkillsSections.push('\n---');
                skillsInfo = wrapInSystemReminder(fsSkillsSections.join('\n')) + skillsInfo;
              }
            }
          } catch (fsErr) {
            logger.warn('[AgentChat] 📂 Failed to scan .claude/skills directory', 'getAgentSpecificSystemPrompt', fsErr);
          }
        }

        const snapshot = currentUserAlias && chatId
          ? chatSkillSnapshotStore.get(currentUserAlias, chatId)
          : undefined;
        if (snapshot?.prompt) {
          skillsInfo += snapshot.prompt;
        }
      }
    } catch (err) {
      logger.warn('[AgentChat] 📂 WORKSPACE CONTEXT - Failed to add workspace to agent-specific system prompt', 'getAgentSpecificSystemPrompt', err);
      workspaceInfo = '\n---\n**Current Workspace:** (ERROR)\n\n⚠️ **Operating Rules:**\n\n**1. Configuration Error:**\n- Failed to retrieve workspace configuration\n- Please inform the user about this error\n---';
    }

    const combinedInfo = agentIdentityInfo + workspaceInfo + skillsInfo;
    if (!combinedInfo) {
      return [];
    }

    return [
      MessageHelper.createTextMessage(
        combinedInfo,
        'system',
        `system-agent-specific-${agentName}`,
      ),
    ];
  }


  getCombinedSystemPromptForContext(availableToolCount?: number, options?: { hasMemexMemoryTool?: boolean }): Message[] {
    const customPrompts = this.getLatestCustomSystemPrompt();
    const agentSpecificPrompts = this.getAgentSpecificSystemPrompt();
    const globalPrompts = this.getGlobalSystemPrompt();
    const texts: string[] = [];

    if (customPrompts.length > 0) {
      texts.push(MessageHelper.getText(customPrompts[0]));
    }
    if (agentSpecificPrompts.length > 0) {
      texts.push(MessageHelper.getText(agentSpecificPrompts[0]));
    }
    if (globalPrompts.length > 0) {
      texts.push(MessageHelper.getText(globalPrompts[0]));
    }

    if (texts.length === 0 && this.hookAdditionalContexts.length === 0 && this.hookSystemMessages.length === 0) {
      return [];
    }

    // When the caller knows the agent has zero tools this turn, override the
    // static tool manual so the model does not hallucinate tool use. Only fires
    // for an explicit count of 0 — callers that pass no count (e.g. non-send
    // paths) keep the previous behavior.
    if (availableToolCount === 0) {
      texts.push(wrapInSystemReminder(NO_TOOLS_AVAILABLE_REMINDER));
    }

    if (options?.hasMemexMemoryTool === true) {
      texts.push(buildMemexMemoryPrompt());
    }

    if (this.deps.getInteractionPolicy() === 'forbid') {
      texts.push(wrapInSystemReminder('You are currently running as a background scheduled job. Interactive UI tools like `request_interactive_input` are unavailable, and you must not ask the user follow-up questions because no user is present. If critical information is missing, stop and explain which input is missing so the schedule or agent configuration can be fixed for unattended execution.'));
    }

    if (this.hookSystemMessages.length > 0) {
      logger.info('[AgentChat] Injecting system messages from Agent Hooks', 'getCombinedSystemPromptForContext', {
        messageCount: this.hookSystemMessages.length,
      });
      texts.push(...this.hookSystemMessages);
    }

    // Agent Hooks: inject additionalContext from SessionStart hooks
    if (this.hookAdditionalContexts.length > 0) {
      const hookContextBlock = this.hookAdditionalContexts.join('\n\n');
      logger.info('[AgentChat] Injecting additional context from SessionStart hooks', 'getCombinedSystemPromptForContext', {
        contextCount: this.hookAdditionalContexts.length,
      });
      texts.push(wrapInSystemReminder(hookContextBlock));
    }

    return [
      MessageHelper.createTextMessage(
        texts.join('\n\n---\n\n'),
        'system',
        `system-combined-${this.deps.getAgentName()}`,
      ),
    ];
  }

  async refreshSkillSnapshotIfNeeded(): Promise<void> {
    try {
      const currentUserAlias = this.deps.getCurrentUserAlias();
      const chatId = this.deps.getChatId();
      const currentChat = profileCacheManager.getChatConfig(currentUserAlias, chatId);
      const currentAgent = getChatPrimaryAgent(currentChat);
      if (!currentAgent) {
        chatSkillSnapshotStore.clear(currentUserAlias, chatId);
        return;
      }

      const agentSkillNames = Array.isArray(currentAgent.skills) ? currentAgent.skills : [];
      if (agentSkillNames.length === 0) {
        chatSkillSnapshotStore.clear(currentUserAlias, chatId);
        return;
      }

      const availableSkills = skillsConfigManager.getSkills(currentUserAlias);
      const nextSnapshot = buildChatSkillSnapshot({
        userAlias: currentUserAlias,
        skillNames: agentSkillNames,
        availableSkills,
      });

      const existingSnapshot = chatSkillSnapshotStore.get(currentUserAlias, chatId);
      if (
        existingSnapshot &&
        existingSnapshot.binding_signature === nextSnapshot.binding_signature &&
        existingSnapshot.registry_signature === nextSnapshot.registry_signature
      ) {
        return;
      }

      const refreshReason = !existingSnapshot
        ? 'missing_snapshot'
        : existingSnapshot.binding_signature !== nextSnapshot.binding_signature
          ? 'binding_changed'
          : 'registry_changed';

      chatSkillSnapshotStore.set(currentUserAlias, chatId, nextSnapshot);

      logger.info('[AgentChat] Refreshed chat skill snapshot', 'refreshSkillSnapshotIfNeeded', {
        userAlias: currentUserAlias,
        chatId,
        reason: refreshReason,
        skillCount: nextSnapshot.skills.length,
        missingSkillCount: nextSnapshot.missing_skill_names?.length || 0,
      });
    } catch (error) {
      logger.warn('[AgentChat] Failed to refresh skill snapshot', 'refreshSkillSnapshotIfNeeded', {
        userAlias: this.deps.getCurrentUserAlias(),
        chatId: this.deps.getChatId(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getCombinedSystemPromptForCurrentTurn(): Promise<Message[]> {
    await this.refreshSkillSnapshotIfNeeded();
    // Compute the agent's actual tool surface for this turn so the prompt can
    // tell the model the truth when it has no tools (preventing tool-use
    // hallucination against the static tool manual in the global prompt).
    const availableTools = await this.getCurrentAvailableTools();
    return this.getCombinedSystemPromptForContext(
      availableTools.length,
      { hasMemexMemoryTool: availableTools.some((tool) => tool.name === 'memex_memory') },
    );
  }
}