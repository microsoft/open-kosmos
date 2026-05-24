import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { wrapInSystemReminder } from '../chat/systemReminderUtils';
import type {
  ChatSkillSnapshot,
  ChatSkillSnapshotItem,
  SkillConfig,
} from '../userDataADO/types/profile';

const logger = createLogger();

function getElectronApp() {
  try {
    if ((global as any).electron?.app) {
      return (global as any).electron.app;
    }

    return app;
  } catch {
    return null;
  }
}

function normalizeSkillNames(skillNames?: string[]): string[] {
  if (!Array.isArray(skillNames)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawSkillName of skillNames) {
    if (typeof rawSkillName !== 'string') {
      continue;
    }

    const skillName = rawSkillName.trim();
    if (!skillName || seen.has(skillName)) {
      continue;
    }

    seen.add(skillName);
    normalized.push(skillName);
  }

  return normalized;
}

function resolveUserDataPath(explicitUserDataPath?: string): string {
  if (explicitUserDataPath) {
    return explicitUserDataPath;
  }

  const electronApp = getElectronApp();
  if (electronApp) {
    return electronApp.getPath('userData');
  }

  return '';
}

function buildSkillFilePath(userAlias: string, skillName: string, userDataPath?: string): string {
  const resolvedUserDataPath = resolveUserDataPath(userDataPath);
  if (!resolvedUserDataPath) {
    return path.join('profiles', userAlias, 'skills', skillName, 'SKILL.md');
  }

  return path.join(resolvedUserDataPath, 'profiles', userAlias, 'skills', skillName, 'SKILL.md');
}

function buildSkillsPrompt(snapshotSkills: ChatSkillSnapshotItem[]): string {
  const sections: string[] = [];

  sections.push('\n---\n**Skills Instructions:**\n');
  sections.push('\n**What are Skills?**');
  sections.push('Skills are specialized capabilities that extend your abilities for specific tasks. Each skill contains instructions, scripts, and resources to help you complete tasks in a consistent, repeatable way.\n');

  sections.push('\n**How to Use Skills:**');
  sections.push('1. **Progressive Disclosure:** Skills information is loaded dynamically - you receive skill metadata first, then full instructions when relevant');
  sections.push('2. **Skill Selection:** Review available skills and load the ones relevant to the current task');
  sections.push('3. **Follow Instructions:** Each skill provides specific workflows and best practices - follow them carefully');
  sections.push('4. **Combine Skills:** You can use multiple skills together to accomplish complex tasks');
  sections.push('5. **Executable Scripts:** Some skills include code that you can run directly without loading into context\n');

  sections.push('\n**Available Skills for This Agent:**\n');

  if (snapshotSkills.length === 0) {
    sections.push('No valid skills configured for this agent.');
  } else {
    snapshotSkills.forEach((skill, index) => {
      sections.push(`${index + 1}. **${skill.name}**`);
      sections.push(`   - Description: ${skill.description || 'No description available'}`);
      sections.push(`   - Version: ${skill.version || 'N/A'}`);
      sections.push(`   - File Path: \`${skill.file_path}\``);
      sections.push('');
    });
  }

  sections.push('\n**Best Practices:**');
  sections.push('- Load skills only when they\'re relevant to the current task');
  sections.push('- Follow the specific instructions and workflows in each skill');
  sections.push('- Use skill-provided scripts for deterministic operations');
  sections.push('- Combine multiple skills when needed for complex workflows');
  sections.push('- Always check skill metadata first before loading full content\n');
  sections.push('---');

  return wrapInSystemReminder(sections.join('\n'));
}

export interface BuildChatSkillSnapshotArgs {
  userAlias: string;
  skillNames?: string[];
  availableSkills: SkillConfig[];
  userDataPath?: string;
}

export function buildChatSkillSnapshot(args: BuildChatSkillSnapshotArgs): ChatSkillSnapshot {
  const normalizedSkillNames = normalizeSkillNames(args.skillNames);
  const availableSkills = Array.isArray(args.availableSkills) ? args.availableSkills : [];

  const resolvedSkills: ChatSkillSnapshotItem[] = [];
  const resolvedSkillConfigs: SkillConfig[] = [];
  const missingSkillNames: string[] = [];

  for (const skillName of normalizedSkillNames) {
    const skillConfig = availableSkills.find(skill => skill.name === skillName);
    if (!skillConfig) {
      missingSkillNames.push(skillName);
      continue;
    }

    resolvedSkillConfigs.push(skillConfig);
    resolvedSkills.push({
      name: skillConfig.name,
      description: skillConfig.description || 'No description available',
      version: skillConfig.version || 'N/A',
      file_path: buildSkillFilePath(args.userAlias, skillConfig.name, args.userDataPath),
    });
  }

  const bindingSignature = JSON.stringify(normalizedSkillNames);
  const registrySignature = JSON.stringify(
    resolvedSkillConfigs.map((skillConfig, index) => ({
      name: skillConfig.name,
      description: skillConfig.description || '',
      version: skillConfig.version || '',
      source: skillConfig.source || 'ON-DEVICE',
      file_path: resolvedSkills[index]?.file_path || '',
    })),
  );

  if (missingSkillNames.length > 0) {
    logger.info('[SkillSnapshotBuilder] Missing skills referenced by chat agent', 'buildChatSkillSnapshot', {
      userAlias: args.userAlias,
      missingSkillNames,
      totalRequested: normalizedSkillNames.length,
      resolvedCount: resolvedSkills.length,
    });
  }

  return {
    binding_signature: bindingSignature,
    registry_signature: registrySignature,
    generated_at: new Date().toISOString(),
    skills: resolvedSkills,
    ...(missingSkillNames.length > 0 ? { missing_skill_names: missingSkillNames } : {}),
    prompt: buildSkillsPrompt(resolvedSkills),
  };
}