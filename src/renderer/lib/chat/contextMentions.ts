/**
 * Context Mentions Utility Functions
 * For handling [@knowledge-base:path], [@chat-session:path] references and [#skill:skill-name] references
 * 🔧 Supports spaces in paths and names
 */

// Regex: matches [@workspace:relativePath] format (backward compatible)
export const workspaceMentionRegex = /\[@workspace:([^\]]+)\]/g;

// Regex: matches [@knowledge-base:relativePath] format (supports spaces in paths)
export const knowledgeBaseMentionRegex = /\[@knowledge-base:([^\]]+)\]/g;

// Regex: matches [@chat-session:relativePath] format (supports spaces in paths)
export const chatSessionMentionRegex = /\[@chat-session:([^\]]+)\]/g;

// Regex: matches [#skill:skill-name] format (supports spaces in names)
// 🔧 FIX: Match complete [...] bracket content, supports spaces in names
export const skillMentionRegex = /\[#skill:([^\]]+)\]/g;

// Context menu trigger type
export enum ContextMenuTriggerType {
  Workspace = '@',
  Skill = '#'
}

// Context menu option type
export enum ContextMenuOptionType {
  File = 'file',
  Folder = 'folder',
  Skill = 'skill',
  KnowledgeBase = 'knowledgeBase',   // 🆕 Knowledge Base file
  ChatSession = 'chatSession',       // 🆕 Chat Session file
  NoResults = 'no-results'
}

// 🆕 File source type (used to distinguish @ mention insertion format)
export enum MentionSourceType {
  KnowledgeBase = 'knowledgeBase',
  ChatSession = 'chatSession'
}

// Context option interface
export interface ContextOption {
  type: ContextMenuOptionType;
  relativePath?: string;   // Workspace relative path (optional, default options don't have one)
  fileName: string;        // File name (for display)
  description?: string;    // Additional description
  value?: string;          // Actual value (for matching Roo-Code interface)
}

/**
 * Get default menu options (when search results are empty)
 * 🆕 New design: display Add Knowledge File and Add Chat Session File
 */
export function getDefaultMenuOptions(): ContextOption[] {
  return [
    {
      type: ContextMenuOptionType.KnowledgeBase,
      fileName: 'Add Knowledge File',
      description: 'Browse and select knowledge base files',
      value: undefined // No value means a file picker needs to be opened
    },
    {
      type: ContextMenuOptionType.ChatSession,
      fileName: 'Add Chat Session File',
      description: 'Browse and select current chat session deliverables',
      value: undefined // No value means a file picker needs to be opened
    }
  ];
}

/**
 * Detect the trigger type of the current context menu
 * @param text Full text
 * @param cursorPos Cursor position
 * @returns Trigger type or null (if not triggered)
 */
export function getContextMenuTriggerType(text: string, cursorPos: number): ContextMenuTriggerType | null {
  const beforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf('@');
  const lastHashIndex = beforeCursor.lastIndexOf('#');
  
  // Determine which trigger character is closer to the cursor
  if (lastAtIndex === -1 && lastHashIndex === -1) return null;
  
  // Check # trigger (skill mention)
  if (lastHashIndex !== -1 && lastHashIndex > lastAtIndex) {
    const textAfterHash = beforeCursor.slice(lastHashIndex + 1);
    // If skill: already exists, don't trigger the menu
    if (textAfterHash.startsWith('skill:')) return null;
    // No spaces allowed after #
    if (!/\s/.test(textAfterHash)) {
      return ContextMenuTriggerType.Skill;
    }
  }
  
  // Check @ trigger (workspace mention)
  if (lastAtIndex !== -1) {
    const textAfterAt = beforeCursor.slice(lastAtIndex + 1);
    // If workspace:, knowledge-base:, or chat-session: already exists, don't trigger the menu
    if (textAfterAt.startsWith('workspace:') || textAfterAt.startsWith('knowledge-base:') || textAfterAt.startsWith('chat-session:')) return null;
    // No spaces allowed after @
    if (!/\s/.test(textAfterAt)) {
      return ContextMenuTriggerType.Workspace;
    }
  }
  
  return null;
}

/**
 * Determine whether the context menu should be shown (@ or #)
 * @param text Full text
 * @param cursorPos Cursor position
 * @returns Whether the menu should be shown
 */
export function shouldShowContextMenu(text: string, cursorPos: number): boolean {
  return getContextMenuTriggerType(text, cursorPos) !== null;
}

/**
 * Determine whether the Skill context menu should be shown
 * @param text Full text
 * @param cursorPos Cursor position
 * @returns Whether the Skill menu should be shown
 */
export function shouldShowSkillContextMenu(text: string, cursorPos: number): boolean {
  return getContextMenuTriggerType(text, cursorPos) === ContextMenuTriggerType.Skill;
}

/**
 * Get the current search query (@ trigger)
 * @param text Full text
 * @param cursorPos Cursor position
 * @returns Search query string
 */
export function getCurrentSearchQuery(text: string, cursorPos: number): string {
  const beforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf('@');
  
  if (lastAtIndex === -1) return '';
  
  return beforeCursor.slice(lastAtIndex + 1);
}

/**
 * Get the current Skill search query (# trigger)
 * @param text Full text
 * @param cursorPos Cursor position
 * @returns Skill search query string
 */
export function getCurrentSkillSearchQuery(text: string, cursorPos: number): string {
  const beforeCursor = text.slice(0, cursorPos);
  const lastHashIndex = beforeCursor.lastIndexOf('#');
  
  if (lastHashIndex === -1) return '';
  
  return beforeCursor.slice(lastHashIndex + 1);
}

/**
 * Insert mention (supports spaces in paths)
 * 🆕 Inserts different formats based on sourceType:
 *   - KnowledgeBase → [@knowledge-base:path]
 *   - ChatSession → [@chat-session:path]
 * @param text Original text
 * @param cursorPos Cursor position
 * @param mentionValue Mention value (format: @knowledge-base:/path, @chat-session:/path, or /path)
 * @param sourceType Source type
 * @returns New text and new cursor position
 */
export function insertMention(
  text: string,
  cursorPos: number,
  mentionValue: string,
  sourceType?: MentionSourceType
): { newText: string; newCursorPos: number } {
  // 🔧 FIX: Boundary check, ensure cursorPos does not exceed text length
  const safeCursorPos = Math.min(Math.max(0, cursorPos), text.length);
  const beforeCursor = text.slice(0, safeCursorPos);
  const afterCursor = text.slice(safeCursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf('@');
  
  if (lastAtIndex !== -1) {
    const beforeMention = text.slice(0, lastAtIndex);
    
    // 🆕 Determine format based on sourceType or mentionValue prefix
    let prefix: string;
    let path: string;
    
    if (mentionValue.startsWith('@knowledge-base:')) {
      prefix = '@knowledge-base:';
      path = mentionValue.substring('@knowledge-base:'.length);
    } else if (mentionValue.startsWith('@chat-session:')) {
      prefix = '@chat-session:';
      path = mentionValue.substring('@chat-session:'.length);
    } else if (mentionValue.startsWith('@workspace:')) {
      // Backward compatible with old format
      prefix = '@workspace:';
      path = mentionValue.substring('@workspace:'.length);
    } else {
      // Determine prefix based on sourceType
      if (sourceType === MentionSourceType.KnowledgeBase) {
        prefix = '@knowledge-base:';
      } else if (sourceType === MentionSourceType.ChatSession) {
        prefix = '@chat-session:';
      } else {
        prefix = '@workspace:';
      }
      path = mentionValue;
    }
    
    const mention = `[${prefix}${path}]`;
    const newText = `${beforeMention}${mention} ${afterCursor}`;
    const newCursorPos = lastAtIndex + mention.length + 1; // mention + space
    return { newText, newCursorPos };
  }
  
  return { newText: text, newCursorPos: safeCursorPos };
}

/**
 * Insert [#skill:skill-name] (supports spaces in names)
 * @param text Original text
 * @param cursorPos Cursor position
 * @param skillName Skill name
 * @returns New text and new cursor position
 */
export function insertSkillMention(
  text: string,
  cursorPos: number,
  skillName: string
): { newText: string; newCursorPos: number } {
  // 🔧 FIX: Boundary check, ensure cursorPos does not exceed text length
  const safeCursorPos = Math.min(Math.max(0, cursorPos), text.length);
  const beforeCursor = text.slice(0, safeCursorPos);
  const afterCursor = text.slice(safeCursorPos);
  const lastHashIndex = beforeCursor.lastIndexOf('#');
  
  if (lastHashIndex !== -1) {
    const beforeMention = text.slice(0, lastHashIndex);
    // 🔧 FIX: Wrap with square brackets, supports spaces in names
    const mention = `[#skill:${skillName}]`;
    const newText = `${beforeMention}${mention} ${afterCursor}`;
    const newCursorPos = lastHashIndex + mention.length + 1; // mention + space
    return { newText, newCursorPos };
  }
  
  return { newText: text, newCursorPos: safeCursorPos };
}

/**
 * Remove the current mention (supports bracket format)
 * 🆕 Supports @knowledge-base:, @chat-session:, and @workspace: formats
 * @param text Original text
 * @param cursorPos Cursor position
 * @returns New text and new cursor position
 */
export function removeMention(
  text: string,
  cursorPos: number
): { newText: string; newCursorPos: number } {
  const beforeCursor = text.slice(0, cursorPos);
  // 🔧 FIX: Match mention format with brackets (supports all types)
  const match = beforeCursor.match(/\[@(?:workspace|knowledge-base|chat-session):[^\]]+\]$/);
  
  if (match) {
    const mentionLength = match[0].length;
    const newText = text.slice(0, cursorPos - mentionLength) + text.slice(cursorPos);
    return { newText, newCursorPos: cursorPos - mentionLength };
  }
  
  return { newText: text, newCursorPos: cursorPos };
}

/**
 * Extract all [@workspace:...] mentions from the message (supports spaces in paths, backward compatible)
 * @param text Text content
 * @returns Array of relative paths
 */
export function extractWorkspaceMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = new RegExp(workspaceMentionRegex);
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]); // Capture group 1 is the relative path (without brackets)
  }
  
  return mentions;
}

/**
 * 🆕 Extract all [@knowledge-base:...] mentions from the message
 * @param text Text content
 * @returns Array of relative paths
 */
export function extractKnowledgeBaseMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = new RegExp(knowledgeBaseMentionRegex);
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  
  return mentions;
}

/**
 * 🆕 Extract all [@chat-session:...] mentions from the message
 * @param text Text content
 * @returns Array of relative paths
 */
export function extractChatSessionMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = new RegExp(chatSessionMentionRegex);
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  
  return mentions;
}

/**
 * Extract all [#skill:...] mentions from the message (supports spaces in names)
 * @param text Text content
 * @returns Array of skill names
 */
export function extractSkillMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = new RegExp(skillMentionRegex);
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]); // Capture group 1 is the skill name (without brackets)
  }
  
  return mentions;
}

/**
 * Filter skill list based on search query
 * @param skills Skill configuration array
 * @param query Search query string
 * @returns Filtered skill options array
 */
export function filterSkillsByQuery(
  skills: Array<{ name: string; description?: string; version?: string }>,
  query: string
): ContextOption[] {
  const lowerQuery = query.toLowerCase();
  
  return skills
    .filter(skill => skill.name.toLowerCase().includes(lowerQuery))
    .map(skill => ({
      type: ContextMenuOptionType.Skill,
      fileName: skill.name,
      description: skill.description || '',
      value: skill.name
    }));
}