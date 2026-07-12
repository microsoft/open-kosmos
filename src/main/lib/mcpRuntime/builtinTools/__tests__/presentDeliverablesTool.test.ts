/**
 * Tests for PresentTool - present_deliverables builtin tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PresentTool } from '../presentDeliverablesTool';

// Mock the unified logger
vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('PresentTool', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'present-tool-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('execute', () => {
    it('returns empty object when all files exist', async () => {
      // Create test files
      const file1 = path.join(tempDir, 'report.md');
      const file2 = path.join(tempDir, 'data.json');
      await fs.writeFile(file1, '# Report');
      await fs.writeFile(file2, '{}');

      const result = await PresentTool.execute({
        description: 'Final deliverables',
        filePaths: [file1, file2],
      });

      expect(result).toEqual({});
    });

    it('returns missingFiles array when some files do not exist', async () => {
      // Create one file, leave another missing
      const existingFile = path.join(tempDir, 'exists.md');
      const missingFile = path.join(tempDir, 'missing.md');
      await fs.writeFile(existingFile, 'content');

      const result = await PresentTool.execute({
        description: 'Deliverables with missing file',
        filePaths: [existingFile, missingFile],
      });

      expect(result).toEqual({ missingFiles: [missingFile] });
    });

    it('returns all files as missing when none exist', async () => {
      const missing1 = path.join(tempDir, 'missing1.md');
      const missing2 = path.join(tempDir, 'missing2.md');

      const result = await PresentTool.execute({
        description: 'All missing',
        filePaths: [missing1, missing2],
      });

      expect(result).toEqual({ missingFiles: [missing1, missing2] });
    });

    it('returns empty object for empty filePaths array', async () => {
      const result = await PresentTool.execute({
        description: 'No files',
        filePaths: [],
      });

      expect(result).toEqual({});
    });

    it('handles paths with special characters', async () => {
      const fileWithSpaces = path.join(tempDir, 'file with spaces.md');
      await fs.writeFile(fileWithSpaces, 'content');

      const result = await PresentTool.execute({
        description: 'File with spaces',
        filePaths: [fileWithSpaces],
      });

      expect(result).toEqual({});
    });
  });

  describe('getDefinition', () => {
    it('returns valid tool definition', () => {
      const definition = PresentTool.getDefinition();

      expect(definition.name).toBe('present_deliverables');
      expect(definition.description).toContain('Present final deliverables');
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.required).toContain('description');
      expect(definition.inputSchema.required).toContain('filePaths');
    });

    it('has correct schema for filePaths', () => {
      const definition = PresentTool.getDefinition();
      const filePathsSchema = definition.inputSchema.properties.filePaths;

      expect(filePathsSchema.type).toBe('array');
      expect(filePathsSchema.items).toEqual({ type: 'string' });
    });
  });
});
