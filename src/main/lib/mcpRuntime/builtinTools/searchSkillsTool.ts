/**
 * Search Skills Tool
 *
 * Searches for skills across four sources **in parallel**, then merges
 * results in priority order:
 * 1. Globally installed skills — already on the device, may just need applying
 * 2. Skill Library (CDN) — matches by name and description
 * 3. ClawHub (clawhub.ai) — the official OpenClaw skill marketplace (semantic search)
 * 4. Curated GitHub repositories — downloaded as ZIP, extracted locally, then searched by folder name
 *
 * All four searches are launched concurrently via Promise.allSettled so that
 * a slow or failing source never blocks the others.
 */

import { BuiltinToolDefinition } from './types';
import { SkillLibraryFetcher } from '../../skill/skillLibraryFetcher';
import { searchGitHubSkills } from '../../skill/githubSkillSearcher';
import { searchClawHubSkills } from '../../skill/clawHubSkillSearcher';
import { BuiltinToolsManager } from './builtinToolsManager';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';

interface SearchSkillsArgs {
  query: string;
}

interface SkillSearchResultItem {
  source: 'installed' | 'library' | 'clawhub' | 'github';
  metadata: {
    name: string;
    description: string;
    version?: string;
    contact?: string;
    url?: string;
    repo?: string;
    local_folder?: string;
    /** How this skill was originally installed (only for source='installed') */
    install_source?: 'IN-LIBRARY' | 'ON-DEVICE';
    /** Whether it is already applied to the current chat's agent (only for source='installed') */
    applied_to_current_agent?: boolean;
    /** Semantic search relevance score (only for source='clawhub') */
    score?: number;
  };
}

interface SearchSkillsResult {
  success: boolean;
  message: string;
  results: SkillSearchResultItem[];
  total_count: number;
  error?: string;
  /** Non-fatal errors from individual search sources (e.g. GitHub clone failures) */
  warnings?: string[];
}

export class SearchSkillsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'search_skills',
      description:
        'Search for skills across four sources (in priority order): ' +
        '1) Installed skills (source="installed") — already on the device; ' +
        '2) Skill Library (source="library") — the official curated CDN library; ' +
        '3) ClawHub (source="clawhub") — clawhub.ai, the official OpenClaw skill marketplace with semantic search; ' +
        '4) GitHub (source="github") — curated GitHub repositories: anthropics/skills (Anthropic Official), sickn33/antigravity-awesome-skills (Antigravity Collection). ' +
        'Each result includes a "source" field indicating where it came from — always mention the source to the user. ' +
        'Installed skills already applied to the current agent need no action. ' +
        'For any result, use apply_skill_to_agents to install (if needed) and apply. ' +
        'Pass skill_name for installed/library results, or skill_name + path with source=device ' +
        'for GitHub/ClawHub results (use the returned local_folder path).',
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

  // -----------------------------------------------------------------------
  // Individual search source helpers
  // -----------------------------------------------------------------------

  private static searchInstalled(queryLower: string): SkillSearchResultItem[] {
    const results: SkillSearchResultItem[] = [];
    const ctx = BuiltinToolsManager.getExecutionContext();
    if (!ctx?.userAlias) return results;

    const profile = profileCacheManager.getCachedProfile(ctx.userAlias);
    if (!profile || !Array.isArray((profile as any).skills)) return results;

    const installedSkills = (profile as any).skills as Array<{
      name: string;
      description: string;
      version: string;
      source: 'IN-LIBRARY' | 'ON-DEVICE';
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

    const matches = installedSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower),
    );

    for (const skill of matches) {
      results.push({
        source: 'installed',
        metadata: {
          name: skill.name,
          description: skill.description,
          version: skill.version,
          install_source: skill.source,
          applied_to_current_agent: appliedSkillNames.has(skill.name),
        },
      });
    }
    return results;
  }

  private static async searchLibrary(queryLower: string): Promise<SkillSearchResultItem[]> {
    const results: SkillSearchResultItem[] = [];
    const fetcher = SkillLibraryFetcher.getInstance();
    const libraryResult = await fetcher.getLibraryData();

    if (libraryResult.success && libraryResult.data) {
      for (const skill of libraryResult.data.skills) {
        if (
          skill.name.toLowerCase().includes(queryLower) ||
          skill.description.toLowerCase().includes(queryLower)
        ) {
          results.push({
            source: 'library',
            metadata: {
              name: skill.name,
              description: skill.description,
              version: skill.version,
              contact: skill.contact,
            },
          });
        }
      }
    }
    return results;
  }

  private static async searchClawHub(query: string): Promise<SkillSearchResultItem[]> {
    const results: SkillSearchResultItem[] = [];
    const clawHubResults = await searchClawHubSkills(query, 5);

    for (const skill of clawHubResults) {
      results.push({
        source: 'clawhub',
        metadata: {
          name: skill.name,
          description: skill.description,
          version: skill.version || undefined,
          url: skill.url,
          local_folder: skill.local_folder || undefined,
          score: skill.score,
        },
      });
    }
    return results;
  }

  private static async searchGitHub(query: string): Promise<SkillSearchResultItem[]> {
    const results: SkillSearchResultItem[] = [];
    const githubResults = await searchGitHubSkills(query, 5);

    for (const skill of githubResults) {
      results.push({
        source: 'github',
        metadata: {
          name: skill.name,
          description: skill.description,
          url: skill.url,
          repo: skill.repo,
          local_folder: skill.local_folder,
        },
      });
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Main execution — parallel search + merge
  // -----------------------------------------------------------------------

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

    const query = args.query.trim();
    const queryLower = query.toLowerCase();
    const warnings: string[] = [];

    // Launch all four search sources in parallel
    const [installedOutcome, libraryOutcome, clawHubOutcome, githubOutcome] =
      await Promise.allSettled([
        Promise.resolve().then(() => SearchSkillsTool.searchInstalled(queryLower)),
        SearchSkillsTool.searchLibrary(queryLower),
        SearchSkillsTool.searchClawHub(query),
        SearchSkillsTool.searchGitHub(query),
      ]);

    // Collect results from each source, recording warnings for failures
    const installedResults =
      installedOutcome.status === 'fulfilled' ? installedOutcome.value : [];
    if (installedOutcome.status === 'rejected') {
      warnings.push(`Installed skills check failed: ${String(installedOutcome.reason)}`);
    }

    const libraryResults =
      libraryOutcome.status === 'fulfilled' ? libraryOutcome.value : [];
    if (libraryOutcome.status === 'rejected') {
      warnings.push(
        `Skill Library search failed: ${libraryOutcome.reason instanceof Error ? libraryOutcome.reason.message : String(libraryOutcome.reason)}`,
      );
    }

    const clawHubResults =
      clawHubOutcome.status === 'fulfilled' ? clawHubOutcome.value : [];
    if (clawHubOutcome.status === 'rejected') {
      warnings.push(
        `ClawHub search failed: ${clawHubOutcome.reason instanceof Error ? clawHubOutcome.reason.message : String(clawHubOutcome.reason)}`,
      );
    }

    const githubResults =
      githubOutcome.status === 'fulfilled' ? githubOutcome.value : [];
    if (githubOutcome.status === 'rejected') {
      warnings.push(
        `GitHub repo search failed: ${githubOutcome.reason instanceof Error ? githubOutcome.reason.message : String(githubOutcome.reason)}`,
      );
    }

    // Deduplicate: skip library/clawhub/github results whose name already
    // appears in a higher-priority source
    const seenNames = new Set<string>();

    const results: SkillSearchResultItem[] = [];

    for (const item of installedResults) {
      seenNames.add(item.metadata.name);
      results.push(item);
    }
    for (const item of libraryResults) {
      if (!seenNames.has(item.metadata.name)) {
        seenNames.add(item.metadata.name);
        results.push(item);
      }
    }
    for (const item of clawHubResults) {
      if (!seenNames.has(item.metadata.name)) {
        seenNames.add(item.metadata.name);
        results.push(item);
      }
    }
    for (const item of githubResults) {
      if (!seenNames.has(item.metadata.name)) {
        seenNames.add(item.metadata.name);
        results.push(item);
      }
    }

    if (results.length === 0) {
      const msg = warnings.length > 0
        ? `No skills found matching "${query}". Some sources failed: ${warnings.join('; ')}`
        : `No skills found matching "${query}".`;
      return {
        success: true,
        message: msg,
        results: [],
        total_count: 0,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    return {
      success: true,
      message: `Found ${results.length} skill(s) matching "${query}".`,
      results,
      total_count: results.length,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
