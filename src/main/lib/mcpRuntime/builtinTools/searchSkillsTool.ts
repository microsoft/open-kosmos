/**
 * Search Skills Tool
 *
 * Searches for skills across installed (on-device) skills only.
 */

import { BuiltinToolDefinition } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';

interface SearchSkillsArgs {
  query: string;
}

interface SkillSearchResultItem {
  source: 'installed';
  metadata: {
    name: string;
    description: string;
    version?: string;
    /** Whether it is already applied to the current chat's agent */
    applied_to_current_agent?: boolean;
  };
}

interface SearchSkillsResult {
  success: boolean;
  message: string;
  results: SkillSearchResultItem[];
  total_count: number;
  error?: string;
}

export class SearchSkillsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_skills',
      description:
        'Search for installed (on-device) skills. ' +
        'Each result has source="installed". ' +
        'Skills already applied to the current agent need no further action. ' +
        'Use apply_skill_to_agents to apply an installed skill to an agent.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against skill names and descriptions',
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

    const queryLower = args.query.trim().toLowerCase();
    const ctx = BuiltinToolsManager.getExecutionContext();

    if (!ctx?.userAlias) {
      return {
        success: true,
        message: 'No user session found.',
        results: [],
        total_count: 0,
      };
    }

    const profile = profileCacheManager.getCachedProfile(ctx.userAlias);
    if (!profile || !Array.isArray((profile as any).skills)) {
      return {
        success: true,
        message: `No skills found matching "${args.query.trim()}".`,
        results: [],
        total_count: 0,
      };
    }

    const installedSkills = (profile as any).skills as Array<{
      name: string;
      description: string;
      version: string;
    }>;

    const appliedSkillNames = new Set<string>();
    if (ctx.chatId) {
      const chatConfig = profileCacheManager.getChatConfig(ctx.userAlias, ctx.chatId);
      if (chatConfig?.agent?.skills) {
        for (const s of chatConfig.agent.skills) {
          appliedSkillNames.add(s);
        }
      }
    }

    const results: SkillSearchResultItem[] = installedSkills
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(queryLower) ||
          skill.description.toLowerCase().includes(queryLower),
      )
      .map((skill) => ({
        source: 'installed' as const,
        metadata: {
          name: skill.name,
          description: skill.description,
          version: skill.version,
          applied_to_current_agent: appliedSkillNames.has(skill.name),
        },
      }));

    if (results.length === 0) {
      return {
        success: true,
        message: `No skills found matching "${args.query.trim()}".`,
        results: [],
        total_count: 0,
      };
    }

    return {
      success: true,
      message: `Found ${results.length} skill(s) matching "${args.query.trim()}".`,
      results,
      total_count: results.length,
    };
  }
}
