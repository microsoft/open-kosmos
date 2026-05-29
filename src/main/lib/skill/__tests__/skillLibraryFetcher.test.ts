import * as path from 'path';

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('fs', async () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

vi.mock('../../utils/urlUtils', async () => ({
  appendCacheBustingTimestamp: vi.fn((url: string) => url),
}));

vi.mock('../skillManager', async () => ({
  skillManager: {
    createTempDirectory: vi.fn(() => '/tmp/library-update'),
    extractZip: vi.fn(async () => 'pdf'),
    validateSkillPackage: vi.fn(() => ({ valid: true })),
    checkSkillExists: vi.fn(() => ({ name: 'pdf', version: '1.0.0' })),
    installSkill: vi.fn(async () => ({ success: true })),
    cleanupTempDirectory: vi.fn(),
  },
}));

import { SkillLibraryFetcher } from '../skillLibraryFetcher';
import { skillManager } from '../skillManager';

describe('SkillLibraryFetcher.updateSkill', () => {
  beforeEach(() => {
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
    vi.clearAllMocks();
  });

  it('validates the downloaded package against the requested skill name', async () => {
    const fetcher = SkillLibraryFetcher.getInstance() as any;

    vi.spyOn(fetcher, 'getLibraryData').mockResolvedValue({
      success: true,
      data: {
        skills: [
          {
            name: 'pdf',
            description: 'PDF skill',
            version: '2.0.0',
          },
        ],
      },
    });
    vi.spyOn(fetcher, 'downloadFile').mockResolvedValue(undefined);

    const result = await fetcher.updateSkill('pdf', 'tester');

    expect(result.success).toBe(true);
    expect(skillManager.validateSkillPackage).toHaveBeenCalledWith(path.join('/tmp/library-update', 'pdf'), 'pdf');
  });
});
