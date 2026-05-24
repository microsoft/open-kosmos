import { atom } from '@/atom';
import { ContextOption, ContextMenuOptionType, ContextMenuTriggerType, filterSkillsByQuery, MentionSourceType, getDefaultMenuOptions } from '@/lib/chat/contextMentions';
import { searchWorkspaceFiles } from '@/lib/workspace/workspaceSearchService';
import { agentChatSessionCacheManager } from '@/lib/chat/agentChatSessionCacheManager';
import { profileDataManager } from '@/lib/userData';


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
          const knowledgeBasePath = currentChatConfig?.agent?.knowledge?.knowledgeBase ?? currentChatConfig?.agent?.knowledgeBase;

          if (!knowledgeBasePath || typeof knowledgeBasePath !== 'string' || knowledgeBasePath.trim().length === 0) {
            resetOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'Knowledge Base path not set',
                description: 'Please configure Knowledge Base in Agent Settings first',
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
              description: 'No files found in Knowledge Base',
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
            description: 'An error occurred while loading files',
          }]);
        }
        // 🆕 Add Chat Session File: list all files under the current Chat Session directory
        try {
          const currentChatConfig: any = profileDataManager.getCurrentChat?.();
          const workspacePath = currentChatConfig?.agent?.workspace;

          if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Workspace path not set',
              description: 'Please select a workspace in Workspace Explorer first',
            }]);
            return;
          }

          // Compute chat session files path
          const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();
          if (!chatSessionId) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No active chat session',
              description: 'Please start a chat session first',
            }]);
            return;
          }

          const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
          if (!match) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Invalid chat session ID',
              description: 'Unable to determine chat session files path',
            }]);
            return;
          }

          const yearMonth = `${match[1]}${match[2]}`;
          const chatSessionFilesPath = `${workspacePath}/${yearMonth}/${chatSessionId}`;

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
              description: 'No files found in current chat session',
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
            description: 'An error occurred while loading files',
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
              description: 'Add skills in Agent Settings',
            }];
          } else {
            // Filter skills by query
            options = filterSkillsByQuery(skills, query);

            if (options.length === 0 && query.trim().length > 0) {
              // 🆕 No matching results after filtering, show hint
              options = [{
                type: ContextMenuOptionType.NoResults,
                fileName: `No skills matching "${query}"`,
                description: `${skills.length} skills available`,
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
          const knowledgeBasePath = currentChatConfig?.agent?.knowledge?.knowledgeBase ?? currentChatConfig?.agent?.knowledgeBase;
          const workspacePath = currentChatConfig?.agent?.workspace;

          // Compute chat session files path
          let chatSessionFilesPath = '';
          if (workspacePath && typeof workspacePath === 'string' && workspacePath.trim().length > 0) {
            const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();
            if (chatSessionId) {
              const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
              if (match) {
                const yearMonth = `${match[1]}${match[2]}`;
                chatSessionFilesPath = `${workspacePath}/${yearMonth}/${chatSessionId}`;
              }
            }
          }

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
                description: 'Try a different search term',
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
