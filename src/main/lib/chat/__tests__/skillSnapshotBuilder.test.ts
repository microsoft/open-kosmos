vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { buildChatSkillSnapshot } from '../skillSnapshotBuilder';
import * as path from 'path';

describe('skillSnapshotBuilder', () => {
  it('builds a snapshot with valid skills and missing skill names', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: ['pptx', 'missing-skill'],
      availableSkills: [
        {
          name: 'pptx',
          description: 'Create PowerPoint decks',
          version: '1.2.3',
          source: 'ON-DEVICE',
        },
      ],
      userDataPath: '/tmp/openkosmos-user-data',
    });

    expect(snapshot.binding_signature).toBe(JSON.stringify(['pptx', 'missing-skill']));
    const expectedSkillPath = path.join('/tmp/openkosmos-user-data', 'profiles', 'alice', 'skills', 'pptx', 'SKILL.md');

    expect(snapshot.skills).toEqual([
      {
        name: 'pptx',
        description: 'Create PowerPoint decks',
        version: '1.2.3',
        file_path: expectedSkillPath,
      },
    ]);
    expect(snapshot.missing_skill_names).toEqual(['missing-skill']);
    expect(snapshot.prompt).toContain('**pptx**');
    expect(snapshot.prompt).toContain(expectedSkillPath);
  });

  it('dedupes and trims skill names while preserving first-seen order', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: ['  alpha  ', 'alpha', '', 'beta'],
      availableSkills: [
        {
          name: 'alpha',
          description: 'Alpha skill',
          version: '1.0.0',
          source: 'ON-DEVICE',
        },
        {
          name: 'beta',
          description: 'Beta skill',
          version: '2.0.0',
          source: 'ON-DEVICE',
        },
      ],
      userDataPath: '/tmp/openkosmos-user-data',
    });

    expect(snapshot.binding_signature).toBe(JSON.stringify(['alpha', 'beta']));
    expect(snapshot.skills.map(skill => skill.name)).toEqual(['alpha', 'beta']);
  });

  it('emits fallback prompt text when no valid skills are resolved', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: ['missing-skill'],
      availableSkills: [],
      userDataPath: '/tmp/openkosmos-user-data',
    });

    expect(snapshot.skills).toEqual([]);
    expect(snapshot.missing_skill_names).toEqual(['missing-skill']);
    expect(snapshot.prompt).toContain('No valid skills configured for this agent.');
  });

  it('handles undefined skillNames gracefully (no skills, no missing)', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: undefined,
      availableSkills: [{ name: 'pptx', description: 'desc', version: '1.0.0', source: 'ON-DEVICE' }],
      userDataPath: '/tmp/openkosmos-user-data',
    });

    expect(snapshot.skills).toEqual([]);
    expect(snapshot.missing_skill_names).toBeUndefined();
    expect(snapshot.binding_signature).toBe('[]');
  });

  it('handles non-array availableSkills gracefully', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: ['pptx'],
      availableSkills: null as any,
      userDataPath: '/tmp/openkosmos-user-data',
    });

    expect(snapshot.skills).toEqual([]);
    expect(snapshot.missing_skill_names).toEqual(['pptx']);
  });

  it('resolves skill file path without userDataPath using profiles/ relative path', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: ['pptx'],
      availableSkills: [{ name: 'pptx', description: 'desc', version: '1.0.0', source: 'ON-DEVICE' }],
      userDataPath: '',
    });

    expect(snapshot.skills[0].file_path).toMatch(/profiles[/\\]alice[/\\]skills[/\\]pptx[/\\]SKILL\.md/);
  });

  it('handles skills with missing description and version fields gracefully', () => {
    const snapshot = buildChatSkillSnapshot({
      userAlias: 'alice',
      skillNames: ['mcp-tool'],
      availableSkills: [{ name: 'mcp-tool', source: 'ON-DEVICE' } as any],
      userDataPath: '/tmp',
    });

    expect(snapshot.skills[0].description).toBe('No description available');
    expect(snapshot.skills[0].version).toBe('N/A');
    expect(snapshot.prompt).toContain('No description available');
    expect(snapshot.registry_signature).toContain('"description":""');
    expect(snapshot.registry_signature).toContain('"version":""');
  });
});
