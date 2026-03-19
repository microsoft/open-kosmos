/**
 * Base class for Graph Store implementations
 */
export abstract class GraphStore {
  /**
   * Add data to the graph store
   */
  abstract add(data: any): Promise<string>;

  /**
   * Search for data in the graph store
   */
  abstract search(query: any, filters?: Record<string, any>): Promise<any[]>;

  /**
   * Delete data from the graph store
   */
  abstract delete(id: string): Promise<void>;

  /**
   * Delete all data from the graph store
   */
  abstract deleteAll(filters?: Record<string, any>): Promise<void>;

  /**
   * Get all data from the graph store
   */
  abstract getAll(filters?: Record<string, any>): Promise<any[]>;
}
