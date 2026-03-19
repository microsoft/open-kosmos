/**
 * better-sqlite3 + sqlite-vec vector store adapter
 *
 * Features:
 * - Uses sqlite-vec extension for vector storage
 * - vec0 virtual table automatic indexing
 * - Cosine similarity search (vec_distance_cosine)
 * - Synchronous API wrapped as async interface for compatibility
 * - Windows ARM64 supports locally precompiled DLL
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { VectorStore } from '../mem0-core/vector_stores/base';
import { SearchFilters, VectorStoreResult } from '../mem0-core/types';
import { BetterSqliteQueries } from './betterSqliteQueries';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createLogger } from '../../unifiedLogger';

const logger = createLogger();

/**
 * Detect if running on Windows ARM64 environment
 */
function isWindowsArm64(): boolean {
  return process.platform === 'win32' && os.arch() === 'arm64';
}

/**
 * Get local sqlite-vec DLL path
 * Supports both development environment and packaged production environment
 *
 * Note: DLL filename must be vec.dll, because SQLite looks up entry point function based on filename
 * For vec.dll, SQLite will look for sqlite3_vec_init (which is the correct entry point for sqlite-vec)
 */
function getLocalSqliteVecDllPath(): string {
  // Use vec.dll filename to ensure SQLite can find the correct entry point sqlite3_vec_init
  const dllName = 'vec.dll';
  
  // Log environment info
  logger.info(`[BetterSqliteVectorStore] Environment info: cwd=${process.cwd()}, __dirname=${__dirname}, resourcesPath=${process.resourcesPath || 'undefined'}`, 'initialize');
  
  // Possible path list
  const possiblePaths = [
    // Production environment: from resources directory
    path.join(process.resourcesPath || '', 'dll', dllName),
    // Production environment: app.asar.unpacked
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'resources', 'dll', dllName),
    // Development environment: from project root directory
    path.join(process.cwd(), 'resources', 'dll', dllName),
    // Development environment: from __dirname relative path (may be needed after webpack bundling)
    path.join(__dirname, '..', '..', '..', '..', '..', 'resources', 'dll', dllName),
    // Development environment: directly from root directory
    path.resolve('resources', 'dll', dllName),
  ];
  
  logger.info(`[BetterSqliteVectorStore] Searching DLL in paths: ${possiblePaths.join(', ')}`, 'initialize');
  
  for (const dllPath of possiblePaths) {
    const normalizedPath = path.normalize(dllPath);
    logger.info(`[BetterSqliteVectorStore] Checking path: ${normalizedPath}, exists: ${fs.existsSync(normalizedPath)}`, 'initialize');
    if (fs.existsSync(normalizedPath)) {
      logger.info(`[BetterSqliteVectorStore] Found sqlite-vec DLL at: ${normalizedPath}`, 'initialize');
      return normalizedPath;
    }
  }
  
  throw new Error(`sqlite-vec DLL not found. Searched paths: ${possiblePaths.join(', ')}`);
}

/**
 * Load sqlite-vec extension
 * Windows ARM64 uses local DLL, other platforms use official precompiled binaries
 */
function loadSqliteVecExtension(db: DatabaseType): void {
  logger.info(`[BetterSqliteVectorStore] Loading sqlite-vec extension (platform=${process.platform}, arch=${os.arch()})`, 'initialize');
  
  if (isWindowsArm64()) {
    // Windows ARM64 still uses local DLL approach
    logger.info('[BetterSqliteVectorStore] Detected Windows ARM64, loading local DLL', 'initialize');
    const dllPath = getLocalSqliteVecDllPath();
    
    // Verify file actually exists and is readable
    try {
      const stats = fs.statSync(dllPath);
      logger.info(`[BetterSqliteVectorStore] DLL file size: ${stats.size} bytes`, 'initialize');
    } catch (statError) {
      logger.error(`[BetterSqliteVectorStore] Failed to stat DLL file: ${statError}`, 'initialize');
    }
    
    logger.info(`[BetterSqliteVectorStore] Attempting to load extension from: ${dllPath}`, 'initialize');
    
    // Try multiple path formats
    const pathsToTry = [
      dllPath,                              // Full path (with .dll)
      dllPath.replace(/\.dll$/i, ''),       // Without extension
      dllPath.replace(/\\/g, '/'),          // Using forward slashes
      dllPath.replace(/\.dll$/i, '').replace(/\\/g, '/'),  // Without extension + forward slashes
    ];
    
    let loadSuccess = false;
    let lastError: Error | null = null;
    
    for (const tryPath of pathsToTry) {
      if (loadSuccess) break;
      
      try {
        logger.info(`[BetterSqliteVectorStore] Trying to load: ${tryPath}`, 'initialize');
        db.loadExtension(tryPath);
        logger.info(`[BetterSqliteVectorStore] Successfully loaded from: ${tryPath}`, 'initialize');
        loadSuccess = true;
      } catch (loadError) {
        logger.warn(`[BetterSqliteVectorStore] Failed to load ${tryPath}: ${loadError}`, 'initialize');
        lastError = loadError as Error;
      }
    }
    
    if (!loadSuccess) {
      logger.error(`[BetterSqliteVectorStore] All load attempts failed. Last error: ${lastError?.message}`, 'initialize');
      throw lastError || new Error('Failed to load sqlite-vec extension');
    }
  } else {
    // All other platforms (including macOS) use the official sqlite-vec package
    try {
      // First try using official package loader
      logger.info('[BetterSqliteVectorStore] Using official sqlite-vec package loader', 'initialize');
      sqliteVec.load(db);
      logger.info('[BetterSqliteVectorStore] Successfully loaded sqlite-vec from npm package', 'initialize');
    } catch (officialLoadError) {
      logger.warn(`[BetterSqliteVectorStore] Official sqlite-vec loader failed: ${officialLoadError}`, 'initialize');
      
      // If official package loading fails, try using dynamic library file path directly
      try {
        const directPath = getSqliteVecDirectPath();
        logger.info(`[BetterSqliteVectorStore] Trying direct path: ${directPath}`, 'initialize');
        db.loadExtension(directPath);
        logger.info('[BetterSqliteVectorStore] Successfully loaded sqlite-vec via direct path', 'initialize');
      } catch (directLoadError) {
        logger.error(`[BetterSqliteVectorStore] Both official and direct loading failed. Official error: ${officialLoadError}, Direct error: ${directLoadError}`, 'initialize');
        throw new Error(`Failed to load sqlite-vec extension: ${officialLoadError instanceof Error ? officialLoadError.message : String(officialLoadError)}`);
      }
    }
  }
}

/**
 * Get direct path to sqlite-vec dynamic library (as fallback for official package loading)
 * Supports packaged production environment and development environment
 */
function getSqliteVecDirectPath(): string {
  const platform = process.platform;
  const arch = os.arch();
  
  // Build platform-specific package name
  const osName = platform === 'win32' ? 'windows' : platform;
  const packageName = `sqlite-vec-${osName}-${arch}`;
  
  // Dynamic library filename
  const dylibName = platform === 'win32' ? 'vec0.dll' :
                   platform === 'darwin' ? 'vec0.dylib' : 'vec0.so';
  
  // Possible path list
  const possiblePaths = [
    // Production environment: app.asar.unpacked
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', packageName, dylibName),
    // Development environment: directly from node_modules
    path.join(process.cwd(), 'node_modules', packageName, dylibName),
    // After Webpack bundling: from __dirname relative path
    path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', packageName, dylibName),
    // Other possible paths
    path.resolve('node_modules', packageName, dylibName),
  ];
  
  logger.info(`[BetterSqliteVectorStore] Searching for ${packageName}/${dylibName} in paths: ${possiblePaths.join(', ')}`, 'initialize');
  
  for (const dylibPath of possiblePaths) {
    const normalizedPath = path.normalize(dylibPath);
    logger.info(`[BetterSqliteVectorStore] Checking path: ${normalizedPath}, exists: ${fs.existsSync(normalizedPath)}`, 'initialize');
    if (fs.existsSync(normalizedPath)) {
      logger.info(`[BetterSqliteVectorStore] Found sqlite-vec dynamic library at: ${normalizedPath}`, 'initialize');
      return normalizedPath;
    }
  }
  
  throw new Error(`sqlite-vec dynamic library not found for ${platform}-${arch}. Searched paths: ${possiblePaths.join(', ')}`);
}

export class BetterSqliteVectorStore implements VectorStore {
  private db: DatabaseType | null = null;
  private dbPath: string;
  private collectionName: string;
  private dimension: number;
  private userId: string = 'default';
  private isInitialized: boolean = false;

  constructor(config: {
    collectionName?: string;
    dimension?: number;
    persistPath?: string;
    userAlias?: string;
  }) {
    this.collectionName = config.collectionName || 'kosmos_memories';
    this.dimension = config.dimension || 1536;
    this.dbPath = config.persistPath || './sqlite_db/user_memories.db';
  }

  /**
   * Initialize database and table structure
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Ensure database directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Create better-sqlite3 database instance
      this.db = new Database(this.dbPath);
      
      // Load sqlite-vec extension (Windows ARM64 uses local DLL)
      loadSqliteVecExtension(this.db);

      // Migration: clean up legacy vector index and table structure (if exists)
      this.migrateFromLegacySchema();

      // Create main table (stores metadata)
      this.db.exec(BetterSqliteQueries.createTables.memories);

      // Create vec0 virtual table (stores vectors)
      this.db.exec(BetterSqliteQueries.createTables.memoriesVec(this.dimension));

      // Create regular indexes
      this.db.exec(BetterSqliteQueries.createIndexes.userId);
      this.db.exec(BetterSqliteQueries.createIndexes.createdAt);

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize BetterSqliteVectorStore: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Migrate from legacy schema: clean up incompatible indexes and columns
   */
  private migrateFromLegacySchema(): void {
    try {
      // Delete old vector index
      this.db!.exec('DROP INDEX IF EXISTS idx_memories_vector');
      
      // Check if memories table has embedding column (legacy table structure)
      const tableInfo = this.db!.prepare("PRAGMA table_info(memories)").all() as any[];
      const hasEmbeddingColumn = tableInfo.some(col => col.name === 'embedding');
      
      if (hasEmbeddingColumn) {
        // Legacy table has embedding column, need to migrate to new dual-table structure
        // Create temporary table to save data
        this.db!.exec(`
          CREATE TABLE IF NOT EXISTS memories_backup AS 
          SELECT id, memory, metadata, user_id, created_at, updated_at 
          FROM memories
        `);
        
        // Drop old table
        this.db!.exec('DROP TABLE IF EXISTS memories');
        
        // Rename backup table
        this.db!.exec('ALTER TABLE memories_backup RENAME TO memories');
      }
    } catch (error) {
      // Migration failure should not block initialization, only log warning
      console.warn('[BetterSqliteVectorStore] Legacy schema migration warning:', error);
    }
  }

  /**
   * Ensure initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Convert vector array to Float32Array Buffer
   * sqlite-vec requires Float32Array buffer
   */
  private embeddingToBuffer(embedding: number[]): Buffer {
    const float32Array = new Float32Array(embedding);
    return Buffer.from(float32Array.buffer);
  }

  /**
   * Insert vectors
   */
  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[]
  ): Promise<void> {
    const insertStartTime = Date.now();

    await this.ensureInitialized();

    if (vectors.length !== ids.length || vectors.length !== payloads.length) {
      throw new Error('Vectors, ids, and payloads must have the same length');
    }

    try {
      // Use transaction to improve performance
      const insertMemory = this.db!.prepare(BetterSqliteQueries.memory.insert);
      const insertVec = this.db!.prepare(BetterSqliteQueries.memory.insertVec);

      const insertAll = this.db!.transaction((items: Array<{
        id: string;
        vector: number[];
        payload: Record<string, any>;
      }>) => {
        for (const item of items) {
          const memory = item.payload.data || item.payload.memory || item.payload.text || '';
          const metadata = JSON.stringify(item.payload);
          const userId = item.payload.userId || this.userId;
          const now = new Date().toISOString();

          // Insert into main table
          insertMemory.run(item.id, memory, metadata, userId, now, now);
          
          // Insert into vector table
          const vectorBuffer = this.embeddingToBuffer(item.vector);
          insertVec.run(item.id, vectorBuffer);
        }
      });

      const items = vectors.map((vector, i) => ({
        id: ids[i],
        vector,
        payload: payloads[i]
      }));

      insertAll(items);

      const insertDuration = Date.now() - insertStartTime;
      // console.log(`[BetterSqliteVectorStore] Insert completed in ${insertDuration}ms for ${vectors.length} items`);
    } catch (error) {
      const insertDuration = Date.now() - insertStartTime;
      // console.error(`[BetterSqliteVectorStore] Insert failed after ${insertDuration}ms:`, error);
      throw new Error(`Insert operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Vector similarity search
   */
  async search(
    query: number[],
    limit: number = 10,
    filters?: SearchFilters
  ): Promise<VectorStoreResult[]> {
    await this.ensureInitialized();
    logger.debug('[BetterSqliteVectorStore] 🔍 SEARCH START', 'search', {
      queryDimensions: query?.length,
      limit,
      filters
    });

    try {
      const queryBuffer = this.embeddingToBuffer(query);
      logger.debug('[BetterSqliteVectorStore] 🔍 Query buffer created', 'search', {
        bufferSize: queryBuffer?.length
      });
      
      // Build WHERE conditions (for outer SELECT filtering, without table alias)
      const conditions: string[] = [];

      if (filters) {
        if (filters.userId) {
          conditions.push(`AND user_id = '${filters.userId}'`);
        }
        if (filters.agentId) {
          conditions.push(`AND metadata LIKE '%"agentId":"${filters.agentId}"%'`);
        }
        if (filters.runId) {
          conditions.push(`AND metadata LIKE '%"runId":"${filters.runId}"%'`);
        }
      }

      const whereClause = conditions.join(' ');
      logger.debug('[BetterSqliteVectorStore] 🔍 WHERE clause built', 'search', { whereClause });
      
      // Use KNN search
      const sqlQuery = BetterSqliteQueries.search.vectorSearchKNN(whereClause);
      logger.debug('[BetterSqliteVectorStore] 🔍 SQL Query', 'search', { sqlQuery });
      
      const stmt = this.db!.prepare(sqlQuery);
      const rows = stmt.all(queryBuffer, limit) as any[];
      logger.debug('[BetterSqliteVectorStore] 🔍 Raw rows returned', 'search', {
        rowCount: rows?.length || 0,
        firstRowSample: rows && rows.length > 0 ? JSON.stringify(rows[0]).substring(0, 300) : null
      });

      // Convert result format
      const vectorResults: VectorStoreResult[] = rows.map((row) => ({
        id: row.id as string,
        payload: row.metadata ? JSON.parse(row.metadata as string) : {},
        score: row.similarity as number || 0
      }));
      
      logger.debug('[BetterSqliteVectorStore] 🔍 SEARCH DONE', 'search', {
        resultsCount: vectorResults.length
      });

      return vectorResults;
    } catch (error) {
      logger.error('[BetterSqliteVectorStore] ❌ SEARCH ERROR', 'search', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get vector by ID
   */
  async get(vectorId: string): Promise<VectorStoreResult | null> {
    await this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(BetterSqliteQueries.memory.getById);
      const row = stmt.get(vectorId) as any;

      if (!row) {
        return null;
      }

      return {
        id: row.id as string,
        payload: row.metadata ? JSON.parse(row.metadata as string) : {},
        score: 1.0
      };
    } catch (error) {
      throw new Error(`Get operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update vector
   */
  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>
  ): Promise<void> {
    await this.ensureInitialized();

    try {
      const memory = payload.memory || payload.text || '';
      const metadata = JSON.stringify(payload);
      const now = new Date().toISOString();

      // Use transaction to update
      const updateMemory = this.db!.prepare(BetterSqliteQueries.memory.update);
      const updateVec = this.db!.prepare(BetterSqliteQueries.memory.updateVec);

      const updateAll = this.db!.transaction(() => {
        updateMemory.run(memory, metadata, now, vectorId);
        const vectorBuffer = this.embeddingToBuffer(vector);
        updateVec.run(vectorBuffer, vectorId);
      });

      updateAll();
    } catch (error) {
      throw new Error(`Update operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete vector
   */
  async delete(vectorId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      const deleteMemory = this.db!.prepare(BetterSqliteQueries.memory.delete);
      const deleteVec = this.db!.prepare(BetterSqliteQueries.memory.deleteVec);

      const deleteAll = this.db!.transaction(() => {
        deleteMemory.run(vectorId);
        deleteVec.run(vectorId);
      });

      deleteAll();
    } catch (error) {
      throw new Error(`Delete operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete entire collection (table)
   */
  async deleteCol(): Promise<void> {
    await this.ensureInitialized();

    try {
      this.db!.exec(BetterSqliteQueries.collection.dropMemoriesVec);
      this.db!.exec(BetterSqliteQueries.collection.dropMemories);
      this.isInitialized = false;
    } catch (error) {
      throw new Error(`Delete collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List vectors
   */
  async list(
    filters?: SearchFilters,
    limit: number = 100
  ): Promise<[VectorStoreResult[], number]> {
    await this.ensureInitialized();

    try {
      // Build WHERE conditions
      const conditions: string[] = [];
      const params: any[] = [];

      if (filters) {
        if (filters.userId) {
          conditions.push('user_id = ?');
          params.push(filters.userId);
        }
        if (filters.agentId) {
          conditions.push('metadata LIKE ?');
          params.push(`%"agentId":"${filters.agentId}"%`);
        }
        if (filters.runId) {
          conditions.push('metadata LIKE ?');
          params.push(`%"runId":"${filters.runId}"%`);
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countStmt = this.db!.prepare(BetterSqliteQueries.memory.count(whereClause));
      const countResult = countStmt.get(...params) as any;
      const total = countResult.total as number;

      // Get data
      const listStmt = this.db!.prepare(BetterSqliteQueries.memory.list(whereClause));
      const rows = listStmt.all(...params, limit) as any[];

      const vectorResults: VectorStoreResult[] = rows.map((row) => ({
        id: row.id as string,
        payload: row.metadata ? JSON.parse(row.metadata as string) : {},
        score: 1.0
      }));

      return [vectorResults, total];
    } catch (error) {
      throw new Error(`List operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get user ID
   */
  async getUserId(): Promise<string> {
    return this.userId;
  }

  /**
   * Set user ID
   */
  async setUserId(userId: string): Promise<void> {
    this.userId = userId;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}
