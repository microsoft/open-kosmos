// @ts-nocheck
/**
 * Tests for SkillLibraryFetcher private network methods:
 * fetchFromRemote, downloadFile, saveToLocal, loadFromLocal
 */

import { EventEmitter } from 'events';

// Mock modules before imports
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

// We use a real mock for fs to control behavior
const mockExistsSync = vi.fn(() => true);
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn(() => JSON.stringify({ skills: [{ name: 'pdf', version: '1.0.0' }] }));
const mockCreateWriteStream = vi.fn();

vi.mock('fs', async () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
  unlinkSync: vi.fn(),
}));

vi.mock('../../utils/urlUtils', async () => ({
  appendCacheBustingTimestamp: vi.fn((url: string) => url),
}));

vi.mock('../skillManager', async () => ({
  skillManager: {
    createTempDirectory: vi.fn(() => '/tmp/library-test'),
    extractZip: vi.fn(async () => 'pdf'),
    validateSkillPackage: vi.fn(() => ({ valid: true })),
    checkSkillExists: vi.fn(() => null),
    installSkill: vi.fn(async () => ({ success: true })),
    cleanupTempDirectory: vi.fn(),
  },
}));

// Create mock https/http modules
type MockRequest = EventEmitter & { setTimeout: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
type MockResponse = EventEmitter & { statusCode: number; statusMessage: string; pipe: ReturnType<typeof vi.fn> };

function createMockRequest(): MockRequest {
  const req = new EventEmitter() as MockRequest;
  req.setTimeout = vi.fn();
  req.destroy = vi.fn();
  return req;
}

function createMockResponse(statusCode = 200, body = '{"skills":[{"name":"pdf","version":"1.0.0","description":"PDF"}]}'): MockResponse {
  const res = new EventEmitter() as MockResponse;
  res.statusCode = statusCode;
  res.statusMessage = statusCode === 200 ? 'OK' : 'Error';
  res.pipe = vi.fn();
  // Simulate response data emission
  setImmediate(() => {
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return res;
}

const mockHttpsGet = vi.fn();
vi.mock('https', async () => ({
  default: {
    get: (...args: unknown[]) => mockHttpsGet(...args),
  },
  get: (...args: unknown[]) => mockHttpsGet(...args),
}));

vi.mock('http', async () => ({
  default: { get: vi.fn() },
  get: vi.fn(),
}));

import { SkillLibraryFetcher } from '../skillLibraryFetcher';

describe('SkillLibraryFetcher — network methods', () => {
  let fetcher: any;

  beforeEach(() => {
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    fetcher = SkillLibraryFetcher.getInstance();
  });

  // ─── fetchFromRemote ──────────────────────────────────────────────────────

  it('fetchFromRemote: resolves with data on successful 200 response', async () => {
    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ skills: [{ name: 'pdf', version: '1.0.0', description: 'PDF' }] }));
    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    const result = await (fetcher as any).fetchFromRemote();
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('pdf');
  });

  it('fetchFromRemote: rejects on non-200 status', async () => {
    const req = createMockRequest();
    const res = createMockResponse(404);
    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    await expect((fetcher as any).fetchFromRemote()).rejects.toThrow('HTTP 404');
  });

  it('fetchFromRemote: rejects when response has no skills array', async () => {
    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ data: [] }));
    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    await expect((fetcher as any).fetchFromRemote()).rejects.toThrow('Invalid data format');
  });

  it('fetchFromRemote: rejects on invalid JSON', async () => {
    const req = createMockRequest();
    const res = createMockResponse(200, 'not-json{{{');
    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    await expect((fetcher as any).fetchFromRemote()).rejects.toThrow('Failed to parse JSON');
  });

  it('fetchFromRemote: rejects on request error', async () => {
    const req = createMockRequest();
    mockHttpsGet.mockImplementation((_url: string, _cb: unknown) => {
      setImmediate(() => req.emit('error', new Error('Connection refused')));
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    await expect((fetcher as any).fetchFromRemote()).rejects.toThrow('Network error: Connection refused');
  });

  it('fetchFromRemote: rejects on timeout', async () => {
    const req = createMockRequest();
    mockHttpsGet.mockImplementation((_url: string, _cb: unknown) => {
      return req;
    });
    req.setTimeout.mockImplementation((_ms: number, cb: () => void) => {
      setImmediate(cb);
    });
    req.destroy.mockImplementation(() => {});

    await expect((fetcher as any).fetchFromRemote()).rejects.toThrow('Request timeout (10s)');
  });

  // ─── downloadFile ─────────────────────────────────────────────────────────

  it('downloadFile: downloads file successfully', async () => {
    const req = createMockRequest();
    const res = new EventEmitter() as MockResponse;
    res.statusCode = 200;
    res.statusMessage = 'OK';
    res.pipe = vi.fn();

    const fileStream = new EventEmitter() as any;
    fileStream.close = vi.fn();
    mockCreateWriteStream.mockReturnValue(fileStream);

    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    // Pipe triggers file finish
    res.pipe.mockImplementation(() => {
      setImmediate(() => fileStream.emit('finish'));
    });

    await expect((fetcher as any).downloadFile('https://example.com/pdf.zip', '/tmp/pdf.zip')).resolves.toBeUndefined();
  });

  it('downloadFile: rejects on non-200 status', async () => {
    const req = createMockRequest();
    const res = new EventEmitter() as MockResponse;
    res.statusCode = 403;
    res.statusMessage = 'Forbidden';
    res.pipe = vi.fn();

    const fileStream = new EventEmitter() as any;
    fileStream.close = vi.fn();
    mockCreateWriteStream.mockReturnValue(fileStream);

    const { unlinkSync } = await import('fs');

    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    await expect((fetcher as any).downloadFile('https://example.com/pdf.zip', '/tmp/pdf.zip')).rejects.toThrow('HTTP 403');
  });

  it('downloadFile: rejects on request error', async () => {
    const req = createMockRequest();
    const fileStream = new EventEmitter() as any;
    fileStream.close = vi.fn();
    mockCreateWriteStream.mockReturnValue(fileStream);

    mockHttpsGet.mockImplementation((_url: string, _cb: unknown) => {
      setImmediate(() => req.emit('error', new Error('Network down')));
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    await expect((fetcher as any).downloadFile('https://example.com/pdf.zip', '/tmp/pdf.zip')).rejects.toThrow('Network down');
  });

  it('downloadFile: rejects on file stream error', async () => {
    const req = createMockRequest();
    const res = new EventEmitter() as MockResponse;
    res.statusCode = 200;
    res.pipe = vi.fn();

    const fileStream = new EventEmitter() as any;
    fileStream.close = vi.fn();
    mockCreateWriteStream.mockReturnValue(fileStream);

    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    res.pipe.mockImplementation(() => {
      setImmediate(() => fileStream.emit('error', new Error('Disk full')));
    });

    await expect((fetcher as any).downloadFile('https://example.com/pdf.zip', '/tmp/pdf.zip')).rejects.toThrow('Disk full');
  });

  it('downloadFile: rejects on download timeout', async () => {
    const req = createMockRequest();
    const fileStream = new EventEmitter() as any;
    fileStream.close = vi.fn();
    mockCreateWriteStream.mockReturnValue(fileStream);

    mockHttpsGet.mockImplementation((_url: string, _cb: unknown) => {
      return req;
    });
    req.setTimeout.mockImplementation((_ms: number, cb: () => void) => {
      setImmediate(cb);
    });
    req.destroy.mockImplementation(() => {});

    await expect((fetcher as any).downloadFile('https://example.com/pdf.zip', '/tmp/pdf.zip')).rejects.toThrow('Download timeout (30s)');
  });

  // ─── saveToLocal ──────────────────────────────────────────────────────────

  it('saveToLocal: writes data to file', async () => {
    await (fetcher as any).saveToLocal({ skills: [] });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('saveToLocal: throws when writeFileSync fails', async () => {
    mockWriteFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    await expect((fetcher as any).saveToLocal({ skills: [] })).rejects.toThrow('ENOSPC');
  });

  // ─── loadFromLocal ────────────────────────────────────────────────────────

  it('loadFromLocal: returns null when file does not exist', async () => {
    // loadFromLocal checks fs.existsSync(this.libraryFilePath)
    // Override: return false for the next existsSync call
    mockExistsSync.mockReturnValue(false);
    const result = await (fetcher as any).loadFromLocal();
    expect(result).toBeNull();
    mockExistsSync.mockReturnValue(true); // restore
  });

  it('loadFromLocal: returns data from local file', async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ skills: [{ name: 'pdf', version: '1.0.0', description: 'PDF' }] }));
    const result = await (fetcher as any).loadFromLocal();
    expect(result?.skills[0].name).toBe('pdf');
  });

  it('loadFromLocal: returns null when local file has invalid format', async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ data: [] }));
    const result = await (fetcher as any).loadFromLocal();
    expect(result).toBeNull();
  });

  it('loadFromLocal: returns null when readFileSync throws', async () => {
    mockReadFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const result = await (fetcher as any).loadFromLocal();
    expect(result).toBeNull();
  });

  // ─── getLibraryData success path ──────────────────────────────────────────

  it('getLibraryData: fetches from remote and saves to local', async () => {
    const req = createMockRequest();
    const libraryData = { skills: [{ name: 'pdf', version: '1.0.0', description: 'PDF' }] };
    const res = createMockResponse(200, JSON.stringify(libraryData));
    mockHttpsGet.mockImplementation((_url: string, cb: (res: MockResponse) => void) => {
      cb(res);
      return req;
    });
    req.setTimeout.mockImplementation(() => {});

    const result = await fetcher.getLibraryData();
    expect(result.success).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  // ─── ensureDirectories ────────────────────────────────────────────────────

  it('ensureDirectories: creates directories when they do not exist', () => {
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
    // Return false so mkdirSync is called
    mockExistsSync.mockReturnValue(false);
    const newFetcher = SkillLibraryFetcher.getInstance();
    expect(mockMkdirSync).toHaveBeenCalled();
    mockExistsSync.mockReturnValue(true);
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
  });

  it('ensureDirectories: throws when mkdirSync fails', () => {
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementationOnce(() => { throw new Error('EPERM'); });
    expect(() => SkillLibraryFetcher.getInstance()).toThrow('EPERM');
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReset();
    (SkillLibraryFetcher as unknown as { instance?: SkillLibraryFetcher }).instance = undefined;
  });
});
