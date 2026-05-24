import * as fs from 'fs';
import * as path from 'path';

import { Message, MessageHelper } from '@shared/types/chatTypes';
import { extractMonthFromChatSessionId } from '../userDataADO/pathUtils';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getGlobalSystemPromptAsMessages } from './globalSystemPrompt';
import { skillManager } from '../skill/skillManager';
import { isFeatureEnabled } from '../featureFlags';
import { SubAgentFileManager } from '../subAgent/subAgentFileManager';
import { buildChatSkillSnapshot } from './skillSnapshotBuilder';
import { createLogger } from '../unifiedLogger';
import { wrapInSystemReminder } from './systemReminderUtils';
import type { AgentConfig } from './agentChat';
import type { AgentChatInteractionPolicy } from './agentChatInteractionPolicy';
import { mcpClientManager } from "../mcpRuntime/mcpClientManager";

const logger = createLogger();

export interface AgentChatPromptServiceDeps {
  getCurrentUserAlias(): string;
  getChatId(): string;
  getChatSessionId(): string;
  getAgentName(): string;
  getLatestAgentConfig(): AgentConfig | null;
  isRemoteSession(): boolean;
  getInteractionPolicy(): AgentChatInteractionPolicy;
}

export class AgentChatPromptService {
  /** Additional context strings injected by SessionStart hooks. */
  private hookAdditionalContexts: string[] = [];


  constructor(private readonly deps: AgentChatPromptServiceDeps) {}

  /**
   * Store additional context strings from plugin hooks (e.g. SessionStart).
   * These are injected into the system prompt via getCombinedSystemPromptForContext().
   */
  setHookAdditionalContexts(contexts: string[]): void {
    this.hookAdditionalContexts = contexts;
    logger.info('[AgentChatPromptService] Stored hook additional contexts', 'setHookAdditionalContexts', {
      count: contexts.length,
      totalChars: contexts.reduce((s, c) => s + c.length, 0),
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
        const profile = profileCacheManager.getCachedProfile(currentUserAlias);
        globalMcpServers = profile?.mcp_servers || [];
      }

      if (latestConfig.mcp_servers.length > 0) {
        const filteredTools: any[] = [];

        for (const serverConfig of latestConfig.mcp_servers) {
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
      }

      return allTools;
    } catch (error) {
      logger.error(`[AgentChat] Failed to get current available tools: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  getLatestCustomSystemPrompt(): Message[] {
    const config = this.deps.getLatestAgentConfig();
    if (!config || !config.system_prompt) {
      return [];
    }

    return [
      MessageHelper.createTextMessage(
        config.system_prompt,
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
    let subAgentsInfo = '';

    const agentName = this.deps.getAgentName();
    const currentUserAlias = this.deps.getCurrentUserAlias();
    const chatSessionId = this.deps.getChatSessionId();
    const chatId = this.deps.getChatId();

    const agentIdentityInfo = `\n---\n**Your Identity:**\n- You are **${agentName}**, an AI assistant.\n- When users ask about "${agentName}" or refer to "you", they are asking about you as ${agentName}.\n- Your configured knowledge can include Knowledge Base files. When users ask questions related to "${agentName}", treat all enabled knowledge sources as relevant context.\n---`;

    try {
      if (currentUserAlias) {
        const allChats = profileCacheManager.getAllChatConfigs(currentUserAlias);
        const currentChat = allChats.find((chat: any) => chat.agent?.name === agentName);

        const knowledgeBasePath = currentChat?.agent?.knowledge?.knowledgeBase ?? currentChat?.agent?.knowledgeBase;
        const hasKnowledgeBase = knowledgeBasePath && typeof knowledgeBasePath === 'string' && knowledgeBasePath.trim().length > 0;

        const workspacePath = currentChat?.agent?.workspace;
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
        } else {
          sections.push('- Knowledge Base files are not configured.');
        }

        if (hasChatSessionFiles) {
          sections.push(`\n**Your Current Chat Session Deliverables Directory:** \`${chatSessionFilesPath}\``);
          sections.push(`- Path schema: \`@chat-session:{relative_path}\` → \`${chatSessionFilesPath}/{relative_path}\``);
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

        if (currentChat?.skill_snapshot?.prompt) {
          skillsInfo += currentChat.skill_snapshot.prompt;
        }
      }
    } catch (err) {
      logger.warn('[AgentChat] 📂 WORKSPACE CONTEXT - Failed to add workspace to agent-specific system prompt', 'getAgentSpecificSystemPrompt', err);
      workspaceInfo = '\n---\n**Current Workspace:** (ERROR)\n\n⚠️ **Operating Rules:**\n\n**1. Configuration Error:**\n- Failed to retrieve workspace configuration\n- Please inform the user about this error\n---';
    }

    try {
      if (isFeatureEnabled('openkosmosFeatureSubAgent') && currentUserAlias && chatId) {
        const chatConfig = profileCacheManager.getChatConfig(currentUserAlias, chatId);
        const subAgentNames = chatConfig?.agent?.sub_agents || [];
        if (subAgentNames.length > 0) {
          subAgentsInfo = this.buildSubAgentsSystemPrompt(subAgentNames);
        }
      }
    } catch (err) {
      logger.warn('[AgentChat] Failed to build sub-agents system prompt', 'getAgentSpecificSystemPrompt', err);
    }

    const combinedInfo = agentIdentityInfo + workspaceInfo + skillsInfo + subAgentsInfo;
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

  buildSubAgentsSystemPrompt(subAgentNames: string[]): string {
    const fileManager = SubAgentFileManager.getInstance();
    const allSubAgents: import('../userDataADO/types/profile').SubAgentConfig[] = fileManager.getCachedConfigs();
    const enabledSubAgents = allSubAgents.filter((sa) => subAgentNames.includes(sa.name));

    if (enabledSubAgents.length === 0) {
      return '';
    }

    const subAgentDescriptions = enabledSubAgents.map((sa) => {
      const capabilities: string[] = [];
      if (sa.mcp_servers && sa.mcp_servers.length > 0) {
        capabilities.push(`MCP Servers: ${sa.mcp_servers.map((server) => server.name).join(', ')}`);
      }
      if (sa.skills && sa.skills.length > 0) {
        capabilities.push(`Skills: ${sa.skills.join(', ')}`);
      }

      return `### ${sa.name}\n**Description:** ${sa.description}\n**Capabilities:** ${capabilities.join(' | ')}`;
    }).join('\n\n');

    return `
---
## 🤖 Available Sub-Agents

You have access to the following sub-agents that can handle specialized tasks autonomously.

${subAgentDescriptions}

### How to Use Sub-Agents

**Use the \`sub_agent\` tool** to delegate tasks:
- Set \`subagent_type\` to the name of a pre-configured sub-agent (e.g., \`sub_agent({ prompt: "...", subagent_type: "researcher" })\`)
- Omit \`subagent_type\` to create an ad-hoc agent with optional \`system_prompt\` and \`tools\`
- For parallel execution, call \`sub_agent\` multiple times in the same turn — each runs concurrently

### Guidelines
1. **Delegate appropriately**: Use pre-defined sub-agents for tasks matching their specialization; use ad-hoc agents for one-off tasks
2. **Be specific**: Provide complete task descriptions with all necessary context
3. **Handle failures gracefully**: If a sub-agent fails, analyze the error and decide next steps
4. **Don't over-delegate**: For simple tasks, handle them directly

### Background Execution
Add \`run_in_background: true\` to run the sub-agent asynchronously without blocking your current turn.
- Results will be delivered as \`<task-notification>\` user messages at your next turn
- Use \`get_subagent_status\` to check on running background tasks
- Best for: long-running research, parallel independent tasks, non-urgent work
- **Auto-promotion**: Sync sub-agents that run longer than 120 seconds are automatically promoted to background

### Communicating with Background Agents
Use \`send_to_subagent({ task_id, message })\` to send follow-up instructions to running background agents.
- Only works for background agents (not sync agents)
- Use for: corrections, additional requirements, focus redirection
- The agent will incorporate your message at its next turn
---`;
  }

  getCombinedSystemPromptForContext(): Message[] {
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

    if (texts.length === 0) {
      return [];
    }

    if (this.deps.isRemoteSession() || this.deps.getInteractionPolicy() === 'plain-text-only') {
      texts.push(wrapInSystemReminder('You are currently serving a user through a remote channel. Interactive UI tools like `request_interactive_input` are unavailable in this environment. When you need user input, ask directly in plain text.'));
    }

    if (this.deps.getInteractionPolicy() === 'forbid') {
      texts.push(wrapInSystemReminder('You are currently running as a background scheduled job. Interactive UI tools like `request_interactive_input` are unavailable, and you must not ask the user follow-up questions because no user is present. If critical information is missing, stop and explain which input is missing so the schedule or agent configuration can be fixed for unattended execution.'));
    }

    // PM Studio interactive sessions: ask before creating tasks (scheduled jobs excluded via forbid check above)
    if (process.env.BRAND_NAME === 'pm-studio' && this.deps.getInteractionPolicy() !== 'forbid') {
      texts.push(wrapInSystemReminder('**Task Creation Confirmation:** When the user mentions action items, deadlines, or follow-ups, ask whether they would like you to create tasks for them before calling create_user_task. Do not create tasks automatically — wait for explicit confirmation.'));
    }

    // 🔌 Plugin hook: inject additionalContext from SessionStart hooks
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
      if (!currentChat?.agent) {
        if (currentChat?.skill_snapshot) {
          await profileCacheManager.updateChatSkillSnapshot(currentUserAlias, chatId, null);
        }
        return;
      }

      const agentSkillNames = Array.isArray(currentChat.agent.skills) ? currentChat.agent.skills : [];
      if (agentSkillNames.length === 0) {
        if (currentChat.skill_snapshot) {
          await profileCacheManager.updateChatSkillSnapshot(currentUserAlias, chatId, null);
        }
        return;
      }

      const profile = profileCacheManager.getCachedProfile(currentUserAlias);
      const availableSkills = Array.isArray((profile as any)?.skills) ? (profile as any).skills : [];
      const nextSnapshot = buildChatSkillSnapshot({
        userAlias: currentUserAlias,
        skillNames: agentSkillNames,
        availableSkills,
      });

      const existingSnapshot = currentChat.skill_snapshot;
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

      const success = await profileCacheManager.updateChatSkillSnapshot(
        currentUserAlias,
        chatId,
        nextSnapshot,
      );

      if (!success) {
        logger.warn('[AgentChat] Failed to persist refreshed skill snapshot', 'refreshSkillSnapshotIfNeeded', {
          userAlias: currentUserAlias,
          chatId,
          reason: refreshReason,
        });
        return;
      }

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
    return this.getCombinedSystemPromptForContext();
  }
}