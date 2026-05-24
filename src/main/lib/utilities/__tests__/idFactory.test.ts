import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => { throw new Error('not available in tests'); }),
  },
}));

// We deliberately do NOT mock 'fs' or 'crypto' — we rely on the real filesystem
// with a temp directory injected via OpenKosmos_TEST_USER_DATA_PATH.

describe('idFactory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idFactory-test-'));
    process.env.OpenKosmos_TEST_USER_DATA_PATH = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OpenKosmos_TEST_USER_DATA_PATH;
    vi.resetModules();
  });

  it('getOrCreateInstallationDeviceId creates a new UUID on first call', async () => {
    const { getOrCreateInstallationDeviceId } = await import('../idFactory');
    const id = getOrCreateInstallationDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const idFilePath = path.join(tmpDir, 'analytics-device-id');
    expect(fs.existsSync(idFilePath)).toBe(true);
    expect(fs.readFileSync(idFilePath, 'utf8').trim()).toBe(id);
  });

  it('getOrCreateInstallationDeviceId returns the same UUID on subsequent calls', async () => {
    const { getOrCreateInstallationDeviceId } = await import('../idFactory');
    const id1 = getOrCreateInstallationDeviceId();
    const id2 = getOrCreateInstallationDeviceId();
    expect(id1).toBe(id2);
  });

  it('getOrCreateInstallationDeviceId reads an existing ID from disk', async () => {
    const idFilePath = path.join(tmpDir, 'analytics-device-id');
    const existingId = '00000000-0000-0000-0000-000000000001';
    fs.writeFileSync(idFilePath, existingId, 'utf8');

    const { getOrCreateInstallationDeviceId } = await import('../idFactory');
    const id = getOrCreateInstallationDeviceId();
    expect(id).toBe(existingId);
  });

  it('getOrCreateInstallationDeviceId uses os.tmpdir fallback when OpenKosmos_TEST_USER_DATA_PATH is not set', async () => {
    delete process.env.OpenKosmos_TEST_USER_DATA_PATH;
    // electron app.getPath is mocked to throw, so it will fall back to os.tmpdir()
    const { getOrCreateInstallationDeviceId } = await import('../idFactory');
    const id = getOrCreateInstallationDeviceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    // Restore for other tests
    process.env.OpenKosmos_TEST_USER_DATA_PATH = tmpDir;
  });

  it('getOrCreateInstallationDeviceId falls back to a random UUID if write fails', async () => {
    // Make the directory read-only so writing fails
    fs.chmodSync(tmpDir, 0o444);

    const { getOrCreateInstallationDeviceId } = await import('../idFactory');
    const id = getOrCreateInstallationDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Restore for cleanup
    fs.chmodSync(tmpDir, 0o755);
  });

  it('generateChatId returns a non-empty string', async () => {
    const { generateChatId } = await import('../idFactory');
    const id = generateChatId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generateChatSessionId returns a non-empty string', async () => {
    const { generateChatSessionId } = await import('../idFactory');
    const id = generateChatSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generateScheduleJobId returns a non-empty string', async () => {
    const { generateScheduleJobId } = await import('../idFactory');
    const id = generateScheduleJobId(new Date('2025-01-01T00:00:00Z'));
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generateScheduleJobId uses current date when no date provided', async () => {
    const { generateScheduleJobId } = await import('../idFactory');
    const id = generateScheduleJobId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generateEvalSessionId returns a non-empty string', async () => {
    const { generateEvalSessionId } = await import('../idFactory');
    const id = generateEvalSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
