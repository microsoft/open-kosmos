/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import {
  getContextMenuTriggerType,
  shouldShowContextMenu,
  shouldShowSkillContextMenu,
  getCurrentSearchQuery,
  getCurrentSkillSearchQuery,
  insertMention,
  insertSkillMention,
  removeMention,
  extractWorkspaceMentions,
  extractKnowledgeBaseMentions,
  extractChatSessionMentions,
  extractSkillMentions,
  filterSkillsByQuery,
  getDefaultMenuOptions,
  ContextMenuTriggerType,
  ContextMenuOptionType,
  MentionSourceType,
} from '../contextMentions';

describe('getContextMenuTriggerType', () => {
  it('returns null when no trigger character present', () => {
    expect(getContextMenuTriggerType('hello world', 11)).toBeNull();
  });

  it('returns Workspace for @ trigger', () => {
    expect(getContextMenuTriggerType('hello @file', 11)).toBe(ContextMenuTriggerType.Workspace);
  });

  it('returns Skill for # trigger', () => {
    expect(getContextMenuTriggerType('hello #skill', 12)).toBe(ContextMenuTriggerType.Skill);
  });

  it('returns null when @ is followed by workspace: prefix', () => {
    const text = 'hello @workspace:foo';
    expect(getContextMenuTriggerType(text, text.length)).toBeNull();
  });

  it('returns null when @ is followed by knowledge-base: prefix', () => {
    const text = 'hello @knowledge-base:foo';
    expect(getContextMenuTriggerType(text, text.length)).toBeNull();
  });

  it('returns null when @ is followed by space', () => {
    const text = 'hello @ world';
    expect(getContextMenuTriggerType(text, text.length)).toBeNull();
  });

  it('returns null when # is followed by skill: prefix', () => {
    const text = 'hello #skill:foo';
    expect(getContextMenuTriggerType(text, text.length)).toBeNull();
  });

  it('returns null when # is followed by space', () => {
    const text = 'hello # world';
    expect(getContextMenuTriggerType(text, text.length)).toBeNull();
  });

  it('prefers # when it appears after @', () => {
    const text = 'hello @file #tag';
    expect(getContextMenuTriggerType(text, text.length)).toBe(ContextMenuTriggerType.Skill);
  });
});

describe('shouldShowContextMenu', () => {
  it('returns true when context menu should show', () => {
    expect(shouldShowContextMenu('hello @', 7)).toBe(true);
  });

  it('returns false when no trigger', () => {
    expect(shouldShowContextMenu('hello world', 11)).toBe(false);
  });
});

describe('shouldShowSkillContextMenu', () => {
  it('returns true for # trigger', () => {
    expect(shouldShowSkillContextMenu('hello #', 7)).toBe(true);
  });

  it('returns false for @ trigger', () => {
    expect(shouldShowSkillContextMenu('hello @', 7)).toBe(false);
  });
});

describe('getCurrentSearchQuery', () => {
  it('returns text after @', () => {
    expect(getCurrentSearchQuery('hello @file', 11)).toBe('file');
  });

  it('returns empty string when no @', () => {
    expect(getCurrentSearchQuery('hello world', 11)).toBe('');
  });

  it('respects cursor position', () => {
    // 'hello @fi' — cursor at position 9 (0-indexed), text after @ is 'fi'
    expect(getCurrentSearchQuery('hello @file', 9)).toBe('fi');
  });
});

describe('getCurrentSkillSearchQuery', () => {
  it('returns text after #', () => {
    expect(getCurrentSkillSearchQuery('hello #search', 13)).toBe('search');
  });

  it('returns empty string when no #', () => {
    expect(getCurrentSkillSearchQuery('hello world', 11)).toBe('');
  });
});

describe('insertMention', () => {
  it('inserts knowledge-base mention', () => {
    const result = insertMention('hello @', 7, 'path/to/file.md', MentionSourceType.KnowledgeBase);
    expect(result.newText).toBe('hello [@knowledge-base:path/to/file.md] ');
  });

  it('inserts chat-session mention', () => {
    const result = insertMention('hello @', 7, 'path/to/file.md', MentionSourceType.ChatSession);
    expect(result.newText).toBe('hello [@chat-session:path/to/file.md] ');
  });

  it('inserts workspace mention when no sourceType', () => {
    const result = insertMention('hello @', 7, 'path/to/file.md');
    expect(result.newText).toBe('hello [@workspace:path/to/file.md] ');
  });

  it('handles mention value with explicit @knowledge-base: prefix', () => {
    const result = insertMention('hello @', 7, '@knowledge-base:myfile.txt');
    expect(result.newText).toContain('[@knowledge-base:myfile.txt]');
  });

  it('handles mention value with explicit @chat-session: prefix', () => {
    const result = insertMention('hello @', 7, '@chat-session:myfile.txt');
    expect(result.newText).toContain('[@chat-session:myfile.txt]');
  });

  it('handles mention value with explicit @workspace: prefix', () => {
    const result = insertMention('hello @', 7, '@workspace:myfile.txt');
    expect(result.newText).toContain('[@workspace:myfile.txt]');
  });

  it('returns unchanged text when no @ found', () => {
    const result = insertMention('hello world', 11, 'file.md');
    expect(result.newText).toBe('hello world');
    expect(result.newCursorPos).toBe(11);
  });

  it('clamps cursor position to text length', () => {
    const result = insertMention('hello @', 999, 'file.md');
    expect(result.newText).toBeDefined();
  });

  it('updates cursor position correctly', () => {
    const text = 'hello @';
    const result = insertMention(text, text.length, 'file.md');
    expect(result.newCursorPos).toBe(result.newText.length - 0); // cursor after space
  });
});

describe('insertSkillMention', () => {
  it('inserts skill mention', () => {
    const result = insertSkillMention('hello #', 7, 'my skill');
    expect(result.newText).toBe('hello [#skill:my skill] ');
  });

  it('returns unchanged text when no # found', () => {
    const result = insertSkillMention('hello world', 11, 'skill');
    expect(result.newText).toBe('hello world');
    expect(result.newCursorPos).toBe(11);
  });

  it('positions cursor after inserted mention + space', () => {
    const text = '#';
    const result = insertSkillMention(text, 1, 'web-search');
    expect(result.newCursorPos).toBe('[#skill:web-search] '.length);
  });
});

describe('removeMention', () => {
  it('removes workspace mention before cursor', () => {
    const text = 'hello [@workspace:file.md]';
    const result = removeMention(text, text.length);
    expect(result.newText).toBe('hello ');
  });

  it('removes knowledge-base mention', () => {
    const text = 'hello [@knowledge-base:path/to/file.md]';
    const result = removeMention(text, text.length);
    expect(result.newText).toBe('hello ');
  });

  it('removes chat-session mention', () => {
    const text = 'hello [@chat-session:session.md]';
    const result = removeMention(text, text.length);
    expect(result.newText).toBe('hello ');
  });

  it('returns unchanged text when no mention before cursor', () => {
    const result = removeMention('hello world', 11);
    expect(result.newText).toBe('hello world');
    expect(result.newCursorPos).toBe(11);
  });
});

describe('extract mentions', () => {
  it('extracts workspace mentions', () => {
    const text = 'See [@workspace:a.md] and [@workspace:b/c.md]';
    expect(extractWorkspaceMentions(text)).toEqual(['a.md', 'b/c.md']);
  });

  it('returns empty array when no workspace mentions', () => {
    expect(extractWorkspaceMentions('no mentions here')).toEqual([]);
  });

  it('extracts knowledge-base mentions', () => {
    const text = 'See [@knowledge-base:note.md] here';
    expect(extractKnowledgeBaseMentions(text)).toEqual(['note.md']);
  });

  it('extracts chat-session mentions', () => {
    const text = 'Use [@chat-session:output.txt] for context';
    expect(extractChatSessionMentions(text)).toEqual(['output.txt']);
  });

  it('extracts skill mentions', () => {
    const text = 'Run [#skill:web search] and [#skill:file ops]';
    expect(extractSkillMentions(text)).toEqual(['web search', 'file ops']);
  });

  it('handles spaces in paths', () => {
    const text = '[@knowledge-base:my notes/file name.md]';
    expect(extractKnowledgeBaseMentions(text)).toEqual(['my notes/file name.md']);
  });
});

describe('filterSkillsByQuery', () => {
  const skills = [
    { name: 'web search', description: 'Search the web' },
    { name: 'file operations', description: 'Work with files' },
    { name: 'Web Browser', description: 'Browse the web' },
  ];

  it('filters skills by name (case-insensitive)', () => {
    const result = filterSkillsByQuery(skills, 'web');
    expect(result).toHaveLength(2);
    expect(result.map(s => s.fileName)).toContain('web search');
    expect(result.map(s => s.fileName)).toContain('Web Browser');
  });

  it('returns all skills for empty query', () => {
    expect(filterSkillsByQuery(skills, '')).toHaveLength(3);
  });

  it('returns empty array when no match', () => {
    expect(filterSkillsByQuery(skills, 'xyz')).toHaveLength(0);
  });

  it('returns correct ContextOption shape', () => {
    const result = filterSkillsByQuery(skills, 'web search');
    expect(result[0]).toMatchObject({
      type: ContextMenuOptionType.Skill,
      fileName: 'web search',
      description: 'Search the web',
      value: 'web search',
    });
  });
});

describe('getDefaultMenuOptions', () => {
  it('returns two default options', () => {
    const options = getDefaultMenuOptions();
    expect(options).toHaveLength(2);
  });

  it('includes KnowledgeBase and ChatSession types', () => {
    const options = getDefaultMenuOptions();
    const types = options.map(o => o.type);
    expect(types).toContain(ContextMenuOptionType.KnowledgeBase);
    expect(types).toContain(ContextMenuOptionType.ChatSession);
  });

  it('has undefined value for both options (triggers file picker)', () => {
    const options = getDefaultMenuOptions();
    expect(options.every(o => o.value === undefined)).toBe(true);
  });
});
