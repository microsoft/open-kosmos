/**
 * Tests for clawHubSkillSearcher.ts
 */

const { fsMock, httpsMock, zipMock } = vi.hoisted(() => {
  const fsMock = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
  const httpsMock = { get: vi.fn() };
  const zipMock = { files: {} as Record<string, any> };
  return { fsMock, httpsMock, zipMock };
});

vi.mock('fs', () => fsMock);
vi.mock('https', () => httpsMock);

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock-userdata') },
}));

vi.mock('jszip', () => ({
  default: {
    loadAsync: vi.fn().mockResolvedValue(zipMock),
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { searchClawHubSkills } from '../clawHubSkillSearcher';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Set up httpsMock.get to return a JSON body string for the search endpoint,
 * and a ZIP buffer for any subsequent download requests.
 */
function setupHttp({
  searchBody,
  downloadBuffer = Buffer.from('fake-zip'),
  searchStatus = 200,
}: {
  searchBody: object;
  downloadBuffer?: Buffer;
  searchStatus?: number;
}) {
  let callIndex = 0;

  httpsMock.get.mockImplementation((url: string, cb: Function) => {
    const isSearch = url.includes('/search');
    const statusCode = isSearch ? searchStatus : 200;
    const body = isSearch
      ? Buffer.from(JSON.stringify(searchBody))
      : downloadBuffer;

    const res = {
      statusCode,
      headers: {},
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
        return res;
      }),
    };
    cb(res);
    return { on: vi.fn() };
  });
}

function resetState() {
  vi.clearAllMocks();
  // Reset files to empty (no cached downloads)
  fsMock.existsSync.mockReturnValue(false);
  fsMock.readdirSync.mockReturnValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('searchClawHubSkills', () => {
  beforeEach(() => {
    resetState();
  });

  it('returns empty array when API returns no results', async () => {
    setupHttp({ searchBody: { results: [] } });
    const results = await searchClawHubSkills('anything');
    expect(results).toEqual([]);
  });

  it('returns empty array when API returns null results', async () => {
    setupHttp({ searchBody: {} });
    const results = await searchClawHubSkills('anything');
    expect(results).toEqual([]);
  });

  it('returns results with expected shape', async () => {
    setupHttp({
      searchBody: {
        results: [
          {
            score: 0.95,
            slug: 'pptx-maker',
            displayName: 'PPTX Maker',
            summary: 'Generates PowerPoint files',
            version: '1.0.0',
            updatedAt: Date.now(),
          },
        ],
      },
    });

    const results = await searchClawHubSkills('pptx');
    expect(results.length).toBe(1);

    const r = results[0];
    expect(r.slug).toBe('pptx-maker');
    expect(r.name).toBe('pptx-maker');
    expect(r.description).toBe('Generates PowerPoint files');
    expect(r.version).toBe('1.0.0');
    expect(r.score).toBe(0.95);
    expect(r.url).toBe('https://clawhub.ai/skills/pptx-maker');
  });

  it('falls back to displayName when summary is null', async () => {
    setupHttp({
      searchBody: {
        results: [
          {
            score: 0.8,
            slug: 'my-skill',
            displayName: 'My Skill Display',
            summary: null,
            version: null,
            updatedAt: Date.now(),
          },
        ],
      },
    });

    const results = await searchClawHubSkills('my-skill');
    expect(results[0].description).toBe('My Skill Display');
  });

  it('respects maxResults limit', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      score: 0.9 - i * 0.01,
      slug: `skill-${i}`,
      displayName: `Skill ${i}`,
      summary: `Summary ${i}`,
      version: '1.0.0',
      updatedAt: Date.now(),
    }));

    setupHttp({ searchBody: { results: items } });

    const results = await searchClawHubSkills('skill', 3);
    expect(results.length).toBe(3);
  });

  it('sets local_folder to null when download fails', async () => {
    // Search succeeds but download errors out
    let callCount = 0;
    httpsMock.get.mockImplementation((url: string, cb: Function) => {
      const isSearch = url.includes('/search');

      if (isSearch) {
        const body = Buffer.from(
          JSON.stringify({
            results: [
              {
                score: 0.9,
                slug: 'failing-skill',
                displayName: 'Failing Skill',
                summary: 'This skill will fail to download',
                version: null,
                updatedAt: Date.now(),
              },
            ],
          }),
        );
        const res = {
          statusCode: 200,
          headers: {},
          on: vi.fn().mockImplementation((event: string, handler: Function) => {
            if (event === 'data') handler(body);
            if (event === 'end') handler();
            return res;
          }),
        };
        cb(res);
        return { on: vi.fn() };
      } else {
        // Download returns HTTP 500
        const res = {
          statusCode: 500,
          headers: {},
          on: vi.fn(),
        };
        cb(res);
        return { on: vi.fn() };
      }
    });

    const results = await searchClawHubSkills('failing');
    expect(results.length).toBe(1);
    expect(results[0].local_folder).toBeNull();
  });

  it('uses cached download when timestamp is fresh', async () => {
    // Pre-seed: timestamp file exists and is within TTL
    fsMock.existsSync.mockImplementation((p: string) => {
      return p.endsWith('.clawhub-download-timestamp');
    });
    fsMock.readFileSync.mockReturnValue(String(Date.now()));

    setupHttp({
      searchBody: {
        results: [
          {
            score: 0.99,
            slug: 'cached-skill',
            displayName: 'Cached',
            summary: 'Already downloaded',
            version: '2.0',
            updatedAt: Date.now(),
          },
        ],
      },
    });

    const results = await searchClawHubSkills('cached');
    expect(results.length).toBe(1);
    expect(results[0].slug).toBe('cached-skill');
    // local_folder should be set from the cached directory
    expect(results[0].local_folder).toBeTruthy();
  });

  it('throws when the search HTTP request itself fails', async () => {
    httpsMock.get.mockImplementation((_url: string, _cb: Function) => {
      const req = {
        on: vi.fn().mockImplementation((event: string, handler: Function) => {
          if (event === 'error') handler(new Error('DNS lookup failed'));
          return req;
        }),
      };
      return req;
    });

    await expect(searchClawHubSkills('anything')).rejects.toThrow(
      /DNS lookup failed/,
    );
  });

  it('throws when search API returns HTTP error status', async () => {
    setupHttp({ searchBody: {}, searchStatus: 503 });
    await expect(searchClawHubSkills('anything')).rejects.toThrow(/503/);
  });
});
