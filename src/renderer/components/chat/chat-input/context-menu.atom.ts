import { atom } from '@/atom';
import { ContextOption, ContextMenuOptionType, ContextMenuTriggerType, filterSkillsByQuery, MentionSourceType, getDefaultMenuOptions } from '@/lib/chat/contextMentions';
import { searchWorkspaceFiles } from '@/lib/workspace/workspaceSearchService';
import { agentChatSessionCacheManager } from '@/lib/chat/agentChatSessionCacheManager';
import { profileDataManager } from '@/lib/userData';
import { resolveChatAgent } from '@/lib/agent';

/**
 * Resolve the chat session files folder from workspace path and session ID.
 * Returns null if inputs are missing or session ID format is unrecognized.
 * Uses forward slashes unconditionally — the main process normalizes to OS-native separators.
 */
export function resolveChatSessionFolder(workspacePath: string | undefined, chatSessionId: string | undefined | null): string | null {
  if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) return null;
  if (!chatSessionId) return null;
  const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
  if (!match) return null;
  const yearMonth = `${match[1]}${match[2]}`;
  return `${workspacePath}/${yearMonth}/${chatSessionId}`;
}


interface ContextMenuState {
  show: boolean;
  options: ContextOption[];
  selectedIndex: number;
  position: { top: number; left: number; width: number };
}


export const zeroContextMenuState: ContextMenuState = {
  show: false,
  options: [],
  selectedIndex: 0,
  position: { top: 0, left: 0, width: 0 },
};

export const ContextMenuAtom = atom(zeroContextMenuState, (get, set) => {
  function resetOptions(options: ContextOption[]) {
    set({ ...get(), selectedIndex: 0, options });
  }

  function closeMenu() {
    set(zeroContextMenuState);
  }

  async function selectMenu(option: ContextOption) {
    // 🆕 If a NoResults type option is selected, do nothing (it's just a hint)
    if (option.type === ContextMenuOptionType.NoResults) {
      // Close menu
      closeMenu();
      return;
    }

    // If it's a default option (no value), expand the file list for the corresponding source
    if (!option.value && !option.relativePath) {
      if (option.type === ContextMenuOptionType.KnowledgeBase) {
      // 🆕 Add Knowledge File: list all files under the Knowledge Base directory
        try {
          const currentChatConfig: any = profileDataManager.getCurrentChat?.();
          const agent = resolveChatAgent(currentChatConfig);
          const knowledgeBasePath = agent?.knowledge?.knowledgeBase ?? agent?.knowledgeBase;

          if (!knowledgeBasePath || typeof knowledgeBasePath !== 'string' || knowledgeBasePath.trim().length === 0) {
            resetOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'Knowledge Base path not set',
                fileNameKey: 'chat.context.knowledgeBasePathNotSet',
                description: 'Please configure Knowledge Base in Agent Settings first',
                descriptionKey: 'chat.context.configureKnowledgeBaseFirst',
              }]);
            return;
          }

          const searchResult = await searchWorkspaceFiles({
            folder: knowledgeBasePath,
            pattern: undefined,
            maxResults: 100,
            fuzzy: false,
            searchTarget: 'files',
          });
          const results = searchResult.results;

          if (results.length === 0) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No files found',
              fileNameKey: 'chat.context.noFilesFound',
              description: 'No files found in Knowledge Base',
              descriptionKey: 'chat.context.noKnowledgeBaseFiles',
            }]);
            return;
          }

          const fileOptions: ContextOption[] = results.map((r) => {
            const pathParts = r.path.split(/[\\/]/);
            const fileName = pathParts[pathParts.length - 1];
            return {
              type: ContextMenuOptionType.KnowledgeBase,
              relativePath: `@knowledge-base:/${r.path}`,
              fileName: fileName,
              description: `[Knowledge] ${r.path}`,
              value: `@knowledge-base:/${r.path}`,
            };
          });
          resetOptions(fileOptions);
        } catch (error) {
          resetOptions([{
            type: ContextMenuOptionType.NoResults,
            fileName: 'Failed to load Knowledge Base files',
            fileNameKey: 'chat.context.failedToLoadKnowledgeBaseFiles',
            description: 'An error occurred while loading files',
            descriptionKey: 'chat.context.errorLoadingFiles',
          }]);
        }
      } else if (option.type === ContextMenuOptionType.ChatSession) {
        // 🆕 Add Chat Session File: list all files under the current Chat Session directory
        try {
          const currentChatConfig: any = profileDataManager.getCurrentChat?.();
          const workspacePath = currentChatConfig?.workspace ?? resolveChatAgent(currentChatConfig)?.workspace;
          const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();
          const chatSessionFilesPath = resolveChatSessionFolder(workspacePath, chatSessionId);

          if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Workspace path not set',
              fileNameKey: 'chat.context.workspacePathNotSet',
              description: 'Please select a workspace in Workspace Explorer first',
              descriptionKey: 'chat.context.selectWorkspaceFirst',
            }]);
            return;
          }

          if (!chatSessionId) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No active chat session',
              fileNameKey: 'chat.context.noActiveChatSession',
              description: 'Please start a chat session first',
              descriptionKey: 'chat.context.startChatSessionFirst',
            }]);
            return;
          }

          if (!chatSessionFilesPath) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Invalid chat session ID',
              fileNameKey: 'chat.context.invalidChatSessionId',
              description: 'Unable to determine chat session files path',
              descriptionKey: 'chat.context.unableToDetermineSessionFilesPath',
            }]);
            return;
          }

          const searchResult = await searchWorkspaceFiles({
            folder: chatSessionFilesPath,
            pattern: undefined,
            maxResults: 100,
            fuzzy: false,
            searchTarget: 'files',
          });
          const results = searchResult.results;

          if (results.length === 0) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No files found',
              fileNameKey: 'chat.context.noFilesFound',
              description: 'No files found in current chat session',
              descriptionKey: 'chat.context.noCurrentChatSessionFiles',
            }]);
            return;
          }

          const fileOptions: ContextOption[] = results.map((r) => {
            const pathParts = r.path.split(/[\\/]/);
            const fileName = pathParts[pathParts.length - 1];
            return {
              type: ContextMenuOptionType.ChatSession,
              relativePath: `@chat-session:/${r.path}`,
              fileName: fileName,
              description: `[Session] ${r.path}`,
              value: `@chat-session:/${r.path}`,
            };
          });

          resetOptions(fileOptions);
        } catch (error) {
          resetOptions([{
            type: ContextMenuOptionType.NoResults,
            fileName: 'Failed to load Chat Session files',
            fileNameKey: 'chat.context.failedToLoadChatSessionFiles',
            description: 'An error occurred while loading files',
            descriptionKey: 'chat.context.errorLoadingFiles',
          }]);
        }
      }
    } else {
      // Options with actual values — dispatch corresponding event for ChatInput to handle insertion
      if (option.type === ContextMenuOptionType.Skill) {
        // 🆕 Skill option: dispatch skill mention event
        window.dispatchEvent(
          new CustomEvent('context:skillMentionSelect', {
            detail: { skillName: option.value },
          }),
        );
      } else {
        // KnowledgeBase/ChatSession/File/Folder options: dispatch mention event
        window.dispatchEvent(
          new CustomEvent('context:mentionSelect', {
            detail: { option },
          }),
        );
      }
      // Close menu
      closeMenu();
    }
  }

  function hoverMenu(index: number) {
    set((prev) => ({ ...prev, selectedIndex: index }));
  }

  let timer = 0;
  async function triggerMenu(query: string, inputRect: DOMRect, triggerType?: ContextMenuTriggerType) {
    set({
      ...get(),
      show: true,
      // Calculate menu position: align with ChatInput, 2px above it
      position: {
        top: inputRect.top - 2, // 2px above ChatInput
        left: inputRect.left,
        width: inputRect.width,
      },
    });

  // Debounced search
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        // 🆕 Determine search logic based on trigger type
        if (triggerType === ContextMenuTriggerType.Skill) {
          // # trigger: search Skills
          const skills = profileDataManager.getCurrentAgentSkills();
          let options: ContextOption[];

          if (skills.length === 0) {
            // No skills available
            options = [{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No skills available for this agent',
              fileNameKey: 'chat.context.noSkillsAvailableForAgent',
              description: 'Add skills in Agent Settings',
              descriptionKey: 'chat.context.addSkillsInAgentSettings',
            }];
          } else {
            // Filter skills by query
            options = filterSkillsByQuery(skills, query);

            if (options.length === 0 && query.trim().length > 0) {
              // 🆕 No matching results after filtering, show hint
              options = [{
                type: ContextMenuOptionType.NoResults,
                fileName: `No skills matching "${query}"`,
                fileNameKey: 'chat.context.noSkillsMatching',
                fileNameParams: { query },
                description: `${skills.length} skills available`,
                descriptionKey: 'chat.context.skillsAvailableCount',
                descriptionParams: { count: skills.length },
              }];
            } else if (options.length === 0) {
              // Show all skills when no search term
              options = skills.map((skill: { name: string; description?: string }) => ({
                type: ContextMenuOptionType.Skill,
                fileName: skill.name,
                description: skill.description || '',
                value: skill.name,
              }));
            }
          }

          resetOptions(options);
        } else {
          // @ trigger: search Knowledge Base and Chat Session Files
          const currentChatConfig: any = profileDataManager.getCurrentChat?.();
          const agent = resolveChatAgent(currentChatConfig);
          const knowledgeBasePath = agent?.knowledge?.knowledgeBase ?? agent?.knowledgeBase;
          const workspacePath = currentChatConfig?.workspace ?? agent?.workspace;
          const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();
          const chatSessionFilesPath = resolveChatSessionFolder(workspacePath, chatSessionId) ?? '';

          const hasKnowledgeBase = knowledgeBasePath && typeof knowledgeBasePath === 'string' && knowledgeBasePath.trim().length > 0;
          const hasChatSession = chatSessionFilesPath.length > 0;

          if (query.trim().length > 0) {
            // 🆕 Has search term: search both Knowledge Base and Chat Session Files
            const searchPromises: Promise<{ results: any[], source: MentionSourceType }>[] = [];

            if (hasKnowledgeBase) {
              searchPromises.push(
                searchWorkspaceFiles({
                  folder: knowledgeBasePath,
                  pattern: query,
                  maxResults: 10,
                  fuzzy: true,
                  searchTarget: 'files',
                }).then(res => ({ results: res.results, source: MentionSourceType.KnowledgeBase }))
              );
            }

            if (hasChatSession) {
              searchPromises.push(
                searchWorkspaceFiles({
                  folder: chatSessionFilesPath,
                  pattern: query,
                  maxResults: 10,
                  fuzzy: true,
                  searchTarget: 'files',
                }).then(res => ({ results: res.results, source: MentionSourceType.ChatSession }))
              );
            }

            let options: ContextOption[] = [];

            if (searchPromises.length > 0) {
              const searchResults = await Promise.all(searchPromises);

              for (const { results, source } of searchResults) {
                for (const r of results) {
                  const pathParts = r.path.split(/[\\/]/);
                  const fileName = pathParts[pathParts.length - 1];
                  const mentionPrefix = source === MentionSourceType.KnowledgeBase ? '@knowledge-base:' : '@chat-session:';
                  const optionType = source === MentionSourceType.KnowledgeBase
                    ? ContextMenuOptionType.KnowledgeBase
                    : ContextMenuOptionType.ChatSession;

                  options.push({
                    type: optionType,
                    relativePath: `${mentionPrefix}/${r.path}`,
                    fileName: fileName,
                    description: `${source === MentionSourceType.KnowledgeBase ? '[Knowledge] ' : '[Session] '}${r.path}`,
                    value: `${mentionPrefix}/${r.path}`,
                  });
                }
              }
            }

            if (options.length === 0) {
              options = [{
                type: ContextMenuOptionType.NoResults,
                fileName: `No files matching "${query}"`,
                fileNameKey: 'chat.context.noFilesMatching',
                fileNameParams: { query },
                description: 'Try a different search term',
                descriptionKey: 'chat.context.tryDifferentSearchTerm',
              }];
            }

            resetOptions(options);
          } else {
            // No search term (just typed @): show default options
            resetOptions(getDefaultMenuOptions());
          }
        }
      } catch (error) {
        if (triggerType === ContextMenuTriggerType.Skill) {
          resetOptions([{
            type: ContextMenuOptionType.NoResults,
            fileName: 'Failed to load skills',
            fileNameKey: 'chat.context.failedToLoadSkills',
            description: '',
          }]);
        } else {
          resetOptions(getDefaultMenuOptions());
        }
      }
    }, 200);
  }

  function navigateMenu(direction: 'up' | 'down') {
    const { options, selectedIndex: prev } = get();
    const len = options.length;
    if (len === 0) return;
    const next = direction === 'up' ? (prev - 1 + len) % len : (prev + 1) % len;
    set({ ...get(), selectedIndex: next });
  }

  return { closeMenu, selectMenu, hoverMenu, triggerMenu, navigateMenu }
});
