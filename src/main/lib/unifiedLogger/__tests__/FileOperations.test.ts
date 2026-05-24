import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CacheObject } from '../CacheObject';
import {
  cleanupOldLogFiles,
  getCurrentLogFileName,
  getDevLogFileName,
  getDevStartupLogFileName,
  getTodayLogFileName,
  resetDevStartupLogFileNameForTest,
  writeCacheObjectToDisk,
} from '../FileOperations';
import { selectMostRecentLogFile } from '../LogQueryFileSelection';
import { createLogEntry } from '../types';

describe('FileOperations log file selection', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalArgv = [...process.argv];
  let tempDirs: string[] = [];

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.argv.splice(0, process.argv.length, ...originalArgv.filter((arg) => arg !== '--dev'));
    resetDevStartupLogFileNameForTest();
  });

  afterEach(async () => {
    process.argv.splice(0, process.argv.length, ...originalArgv);
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-log-test-'));
    tempDirs.push(dir);
    return dir;
  }

  async function writeLogFile(dir: string, fileName: string): Promise<void> {
    await fs.writeFile(path.join(dir, fileName), 'test\n', 'utf8');
  }

  async function fileExists(dir: string, fileName: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, fileName));
      return true;
    } catch {
      return false;
    }
  }

  it('uses daily production log files outside dev mode', () => {
    process.env.NODE_ENV = 'production';

    expect(getCurrentLogFileName()).toBe(getTodayLogFileName());
  });

  it('uses one timestamped dev log file for a dev process', () => {
    const startupTime = new Date(2026, 3, 25, 13, 6, 7);
    const laterTime = new Date(2026, 3, 25, 13, 7, 8);
    const expected = 'openkosmos-dev-2026-04-25-13-06-07.log';

    expect(getDevLogFileName(startupTime)).toBe(expected);
    expect(getDevStartupLogFileName(startupTime)).toBe(expected);
    expect(getDevStartupLogFileName(laterTime)).toBe(expected);

    process.env.NODE_ENV = 'development';

    expect(getCurrentLogFileName()).toBe(expected);
  });

  it('writes cache objects to the per-launch dev log file', async () => {
    const logDirectory = await makeTempDir();
    const expectedFile = getDevStartupLogFileName(new Date(2026, 3, 25, 13, 6, 7));
    process.env.NODE_ENV = 'development';

    const cacheObject = new CacheObject(10);
    cacheObject.addLog(createLogEntry('INFO', 'dev log entry', 'test'));

    const result = await writeCacheObjectToDisk(cacheObject, logDirectory);

    expect(result.success).toBe(true);
    expect(path.basename(result.filePath ?? '')).toBe(expectedFile);
    expect(await fileExists(logDirectory, expectedFile)).toBe(true);
  });

  it('cleans only old dev logs during dev startup', async () => {
    const logDirectory = await makeTempDir();
    const currentDevFile = getDevStartupLogFileName(new Date(2026, 3, 25, 13, 6, 7));
    const oldDevFile = 'openkosmos-dev-2026-04-24-11-22-33.log';
    const productionFile = 'openkosmos-2026-04-24.log';
    const unrelatedFile = 'notes.log';

    await Promise.all([
      writeLogFile(logDirectory, currentDevFile),
      writeLogFile(logDirectory, oldDevFile),
      writeLogFile(logDirectory, productionFile),
      writeLogFile(logDirectory, unrelatedFile),
    ]);

    process.env.NODE_ENV = 'development';

    const result = await cleanupOldLogFiles(logDirectory);

    expect(result.success).toBe(true);
    expect(result.deletedFiles).toEqual([oldDevFile]);
    expect(await fileExists(logDirectory, currentDevFile)).toBe(true);
    expect(await fileExists(logDirectory, oldDevFile)).toBe(false);
    expect(await fileExists(logDirectory, productionFile)).toBe(true);
    expect(await fileExists(logDirectory, unrelatedFile)).toBe(true);
  });

  it('keeps dev logs when production cleanup removes old production logs', async () => {
    const logDirectory = await makeTempDir();
    const currentProductionFile = getTodayLogFileName();
    const oldProductionFile = 'openkosmos-1999-01-01.log';
    const devFile = 'openkosmos-dev-2026-04-25-13-06-07.log';

    await Promise.all([
      writeLogFile(logDirectory, currentProductionFile),
      writeLogFile(logDirectory, oldProductionFile),
      writeLogFile(logDirectory, devFile),
    ]);

    process.env.NODE_ENV = 'production';

    const result = await cleanupOldLogFiles(logDirectory);

    expect(result.success).toBe(true);
    expect(result.deletedFiles).toEqual([oldProductionFile]);
    expect(await fileExists(logDirectory, currentProductionFile)).toBe(true);
    expect(await fileExists(logDirectory, oldProductionFile)).toBe(false);
    expect(await fileExists(logDirectory, devFile)).toBe(true);
  });

  it('selects the newest today file by mtime for log query', async () => {
    const logDirectory = await makeTempDir();
    const today = new Date();
    const todayStr = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const devFile = `openkosmos-dev-${todayStr}-09-00-00.log`;
    const productionFile = `openkosmos-${todayStr}.log`;

    await Promise.all([
      writeLogFile(logDirectory, devFile),
      writeLogFile(logDirectory, productionFile),
    ]);
    const devFilePath = path.join(logDirectory, devFile);
    const productionFilePath = path.join(logDirectory, productionFile);
    await fs.utimes(devFilePath, new Date(1_000), new Date(1_000));
    await fs.utimes(productionFilePath, new Date(2_000), new Date(2_000));

    expect(selectMostRecentLogFile([devFilePath, productionFilePath])).toBe(productionFilePath);
  });
});
