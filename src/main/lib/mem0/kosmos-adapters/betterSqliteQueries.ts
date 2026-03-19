/**
 * better-sqlite3 + sqlite-vec SQL query definitions
 * Used for Kosmos Memory vector storage
 */

export const BetterSqliteQueries = {
  /**
   * Table creation queries
   */
  createTables: {
    /**
     * Create memories main table (stores metadata)
     */
    memories: `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        memory TEXT NOT NULL,
        metadata TEXT,
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    
    /**
     * Create vec0 virtual table for vector storage and indexing
     * @param dimension Vector dimension (default 1536)
     */
    memoriesVec: (dimension: number = 1536) => `
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${dimension}]
      )
    `
  },

  /**
   * Index creation queries
   */
  createIndexes: {
    userId: 'CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)',
    createdAt: 'CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)'
    // Note: vec0 virtual table has built-in vector index, no need to create additional ones
  },

  /**
   * Memory operation queries
   */
  memory: {
    /**
     * Insert new memory into main table
     */
    insert: `
      INSERT OR REPLACE INTO memories (id, memory, metadata, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    
    /**
     * Insert vector into vec0 virtual table
     */
    insertVec: `
      INSERT OR REPLACE INTO memories_vec (id, embedding)
      VALUES (?, ?)
    `,
    
    /**
     * Get memory by ID
     */
    getById: 'SELECT * FROM memories WHERE id = ?',
    
    /**
     * Update memory
     */
    update: `
      UPDATE memories 
      SET memory = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `,
    
    /**
     * Update vector
     */
    updateVec: `
      UPDATE memories_vec SET embedding = ? WHERE id = ?
    `,
    
    /**
     * Delete memory
     */
    delete: 'DELETE FROM memories WHERE id = ?',
    
    /**
     * Delete vector
     */
    deleteVec: 'DELETE FROM memories_vec WHERE id = ?',
    
    /**
     * Count memories
     */
    count: (whereClause: string = '') => `
      SELECT COUNT(*) as total FROM memories ${whereClause}
    `,
    
    /**
     * List memories
     */
    list: (whereClause: string = '') => `
      SELECT * FROM memories 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ?
    `
  },

  /**
   * Vector search queries (using KNN search)
   */
  search: {
    /**
     * Vector similarity search (cosine distance)
     * sqlite-vec uses vec_distance_cosine to calculate distance (smaller = more similar)
     * Needs JOIN with main table to get complete data
     * 
     * Note: vec0 KNN search syntax is WHERE embedding MATCH ? AND k = ?
     * KNN search cannot add other AND conditions after k = ?
     * Filter conditions need to be applied in the outer SELECT
     * 
     * Important: vec_distance_cosine returns cosine distance (0~2), not cosine similarity:
     * - Distance 0 = identical (similarity 1.0)
     * - Distance 1 = orthogonal/unrelated (similarity 0.5)
     * - Distance 2 = completely opposite (similarity 0.0)
     * Formula: similarity = 1.0 - distance / 2.0, mapping result to 0~1 range
     */
    vectorSearchKNN: (whereClause: string = '') => `
      SELECT * FROM (
        SELECT 
          m.id,
          m.memory,
          m.metadata,
          m.user_id,
          m.created_at,
          m.updated_at,
          (1.0 - v.distance / 2.0) as similarity
        FROM memories_vec v
        INNER JOIN memories m ON v.id = m.id
        WHERE v.embedding MATCH ?
          AND k = ?
        ORDER BY v.distance ASC
      ) WHERE 1=1 ${whereClause}
    `,
    
    /**
     * Alternative: without KNN, directly calculate distance (slower but more flexible)
     * Note: vec_distance_cosine returns cosine distance (0~2), needs conversion to similarity (0~1)
     */
    vectorSearchDirect: (whereClause: string = '') => `
      SELECT 
        m.id,
        m.memory,
        m.metadata,
        m.user_id,
        m.created_at,
        m.updated_at,
        (1.0 - vec_distance_cosine(v.embedding, ?) / 2.0) as similarity
      FROM memories_vec v
      INNER JOIN memories m ON v.id = m.id
      WHERE 1=1 ${whereClause}
      ORDER BY similarity DESC
      LIMIT ?
    `
  },

  /**
   * Collection (table) operations
   */
  collection: {
    dropMemories: 'DROP TABLE IF EXISTS memories',
    dropMemoriesVec: 'DROP TABLE IF EXISTS memories_vec'
  }
} as const;
