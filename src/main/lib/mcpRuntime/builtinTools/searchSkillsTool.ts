import { BuiltinToolDefinition } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { getChatPrimaryAgent } from '../../userDataADO/agentAccessor';
import { skillsConfigManager } from '../../userDataADO/skillsConfigManager';

interface SearchSkillsArgs {
  query: string;
}

interface InstalledSkillSearchResult {
  source: 'installed';
  metadata: {
    name: string;
    description: string;
    version?: string;
    applied_to_current_agent?: boolean;
  };
}

interface SearchSkillsResult {
  success: boolean;
  message: string;
  results: InstalledSkillSearchResult[];
  total_count: number;
  error?: string;
}

export class SearchSkillsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_skills',
      description:
        'Search skills already installed on this device by name or description.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against installed skill names and descriptions',
          },
        },
        required: ['query'],
      },
    };
  }

  static async execute(args: SearchSkillsArgs): Promise<SearchSkillsResult> {
    if (!args.query || typeof args.query !== 'string' || !args.query.trim()) {
      return {
        success: false,
        message: 'Invalid input: query is required and must be a non-empty string.',
        results: [],
        total_count: 0,
        error: 'INVALID_INPUT',
      };
    }

    const ctx = BuiltinToolsManager.getExecutionContext();
    if (!ctx?.userAlias) {
      return {
        success: false,
        message: 'No active user session.',
        results: [],
        total_count: 0,
        error: 'NO_USER',
      };
    }

    const query = args.query.trim().toLowerCase();
    const profile = profileCacheManager.getCachedProfile(ctx.userAlias);
    if (!profile) {
      return {
        success: false,
        message: 'No profile is loaded for the active user.',
        results: [],
        total_count: 0,
        error: 'NO_PROFILE',
      };
    }

    const appliedSkillNames = new Set<string>();
    if (ctx.chatId) {
      const chatConfig = profileCacheManager.getChatConfig(ctx.userAlias, ctx.chatId);
      const agent = getChatPrimaryAgent(chatConfig);
      for (const skillName of agent?.skills || []) {
        appliedSkillNames.add(skillName);
      }
    }

    const results = skillsConfigManager
      .getSkills(ctx.userAlias)
      .filter(
        skill =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query),
      )
      .map<InstalledSkillSearchResult>(skill => ({
        source: 'installed',
        metadata: {
          name: skill.name,
          description: skill.description,
          version: skill.version,
          applied_to_current_agent: appliedSkillNames.has(skill.name),
        },
      }));

    return {
      success: true,
      message: `Found ${results.length} installed skill(s) matching "${args.query.trim()}".`,
      results,
      total_count: results.length,
    };
  }
}
