/**
 * Shared coding-CLI types: assert the id list is the single source of truth in display order.
 */

import { CODING_CLI_IDS, CODING_CLI_DISPLAY_NAMES } from '../codingCli';
import type { CodingCliId, CodingCliAvailability } from '../codingCli';

describe('CODING_CLI_IDS', () => {
  it('lists all four supported CLIs in display order', () => {
    expect(CODING_CLI_IDS).toEqual(['claude', 'codex', 'gemini', 'copilot']);
  });

  it('is usable to type-narrow a CodingCliId', () => {
    const id: CodingCliId = CODING_CLI_IDS[0];
    expect(id).toBe('claude');
  });

  it('maps every id to a human-readable display name', () => {
    expect(CODING_CLI_DISPLAY_NAMES).toEqual({
      claude: 'Claude Code',
      codex: 'Codex CLI',
      gemini: 'Gemini CLI',
      copilot: 'GitHub Copilot CLI',
    });
    for (const id of CODING_CLI_IDS) {
      expect(typeof CODING_CLI_DISPLAY_NAMES[id]).toBe('string');
    }
  });

  it('describes a CodingCliAvailability shape', () => {
    const sample: CodingCliAvailability = {
      id: 'claude',
      displayName: 'Claude Code',
      binaryName: 'claude',
      installHint: 'npm i -g x',
      docsUrl: 'https://example.com',
      available: false,
      path: null,
    };
    expect(sample.available).toBe(false);
    expect(sample.path).toBeNull();
  });
});
