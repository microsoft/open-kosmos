/**
 * subAgentPromptBuilder — System prompt construction for sub-agent conversations
 *
 * Extracted from subAgentChat.ts to keep prompt-building logic separate from the
 * conversation-loop machinery. All functions are pure with respect to the options
 * object — they only read, never mutate.
 */

import type { Message } from '@shared/types/chatTypes';
import { MessageHelper } from '@shared/types/chatTypes';
import type { SubAgentChatOptions } from './types';
import type { SubAgentConfig } from '../userDataADO/types/profile';
import { skillManager } from '../skill/skillManager';
import * as path from 'path';
import { app } from 'electron';

/**
 * Get the Electron app instance (supports test environment mocking)
 */
function getElectronApp(): any {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }
    return app;
  } catch {
    return null;
  }
}

/**
 * Build the sub-agent's own Workspace + Skills + Knowledge Base prompt info
 *
 * Design considerations:
 * - Parent Agent's getAgentSpecificSystemPrompt() injects workspace path and skills' SKILL.md content
 * - If sub-agent also has workspace/skills configured, similar injection logic is needed
 * - Reuses SkillManager.getSkillMetadata() to read skill info
 * - v1.1.0: Uses resolvedSkills/resolvedKnowledgeBase (values after inheritance merge)
 */
export function buildWorkspaceAndSkillsInfo(options: SubAgentChatOptions, config: SubAgentConfig): string {
  let info = '';
  const subAgent = options.subAgent;

  // Workspace path — no longer configured on sub-agent directly; derived from deliverablesPath

  // Skills info — uses resolvedSkills (includes inherited skills)
  const skillNames = subAgent.resolvedSkills.length > 0
    ? subAgent.resolvedSkills.map(s => s.name)
    : (config.skills || []);

  if (skillNames.length > 0) {
    try {
      const electronApp = getElectronApp();
      const skillSections: string[] = [];

      for (const skillName of skillNames) {
        try {
          if (electronApp) {
            const appPath = electronApp.getPath('userData');

            const skillDir = path.join(appPath, 'profiles', options.currentUserAlias, 'skills', skillName);
            const { metadata } = skillManager.getSkillMetadata(skillDir);
            if (metadata) {
              const skillMdPath = path.join(skillDir, 'skill.md');
              const inherited = subAgent.resolvedSkills.find(s => s.name === skillName)?.inherited;
              const tag = inherited ? ' (inherited from parent)' : '';
              skillSections.push(
                `### Skill: ${skillName}${tag}\n` +
                `- Description: ${metadata.description || 'No description'}\n` +
                `- File Path: \`${skillMdPath}\``
              );
            }
          }
        } catch {
          // Non-fatal: skill loading failure doesn't affect sub-agent operation
        }
      }

      if (skillSections.length > 0) {
        info += `---\n## Available Skills\n\n`;
        info += skillSections.join('\n\n');
        info += '\n\n';
      }
    } catch {
      // Non-fatal: skill system loading failure doesn't affect sub-agent operation
    }
  }

  // Knowledge Base path — uses resolvedKnowledgeBase (value after inheritance merge)
  const knowledgePath = subAgent.resolvedKnowledgeBase;
  if (knowledgePath) {
    info += `---\n## Knowledge Base\n\n`;
    info += `Your knowledge base directory: ${knowledgePath}\n`;
    info += `You can read files from this directory for context and reference information.\n\n`;
  }

  return info;
}

/**
 * Build the sub-agent's system prompt layers:
 *
 * Layer 1: Sub-agent identity and role + custom system_prompt
 * Layer 2: Task context
 * Layer 2.5: Workspace & Skills info (if configured)
 * Layer 3: Parent context (optional, controlled by context_access)
 * Layer 4: Behavioral constraints + deliverables path
 *
 * Design reference: Section 7.2 Sub-agent's own System Prompt
 */
export function buildSubAgentSystemPrompt(options: SubAgentChatOptions): Message[] {
  const { subAgent } = options;
  const config = subAgent.config;

  let prompt = '';

  // Layer 1: Sub-agent identity and role
  prompt += `# Sub-Agent: ${config.name}\n\n`;
  prompt += `${config.system_prompt}\n\n`;

  // Layer 2: Task context
  prompt += `---\n## Current Task\n\n`;
  prompt += `You are a sub-agent working on a specific task delegated by the parent agent.\n`;
  prompt += `Complete the task thoroughly and return a clear, structured result.\n\n`;

  // Layer 2.5: Sub-agent's own Workspace & Skills info
  prompt += buildWorkspaceAndSkillsInfo(options, config);

  // Layer 4: Behavioral constraints
  prompt += `---\n## Operating Rules\n\n`;
  prompt += `1. Focus exclusively on the assigned task\n`;
  prompt += `2. Use available tools as needed to complete the task\n`;
  prompt += `3. Return a clear, structured result when done\n`;
  prompt += `4. If the task cannot be completed, explain why clearly\n`;
  prompt += `5. Do NOT attempt to communicate with the user directly\n`;

  // 4.1 Deliverables path injection
  const deliverablesPath = options.deliverablesPath || null;
  if (deliverablesPath) {
    prompt += `6. When creating or saving files, use the deliverables directory: ${deliverablesPath}\n`;
    prompt += `7. After creating files, always mention the file paths and a brief description of each file in your final response, so the parent agent knows what was produced\n`;
  }

  // 4.2 Efficiency constraints — general efficiency guidance (specific turn progress injected dynamically per turn via buildTurnProgressHint)
  prompt += `\n## Efficiency Guidelines\n\n`;
  prompt += `- Plan your approach BEFORE executing. Batch related tool calls when possible.\n`;
  prompt += `- Do NOT fetch entire web pages if a search result snippet already contains the answer.\n`;
  prompt += `- When researching, gather the most important sources first, then synthesize results early.\n`;
  prompt += `- If you have enough information to produce a useful result, do so immediately rather than searching for more.\n`;
  prompt += `- Prefer concise, targeted tool calls over broad exploratory ones.\n`;

  return [MessageHelper.createTextMessage(
    prompt,
    'system',
    `system-sub-agent-${config.name}`
  )];
}
