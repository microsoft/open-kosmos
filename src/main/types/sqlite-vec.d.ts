/**
 * Type declarations for sqlite-vec
 * @see https://github.com/asg017/sqlite-vec
 */

declare module 'sqlite-vec' {
  import type { Database } from 'better-sqlite3';
  
  /**
   * Load the sqlite-vec extension into a better-sqlite3 database
   * @param db The better-sqlite3 database instance
   */
  export function load(db: Database): void;
}
