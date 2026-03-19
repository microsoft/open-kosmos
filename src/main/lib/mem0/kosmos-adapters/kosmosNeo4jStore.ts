import neo4j, { Driver } from "neo4j-driver";
import { GraphStore } from "../mem0-core/graph_stores/base";

export interface Neo4jConfig {
  url: string;
  username: string;
  password: string;
  database?: string;
}

/**
 * Kosmos Neo4j graph database adapter
 * Provides knowledge graph construction and query capabilities
 */
export class KosmosNeo4jStore extends GraphStore {
  private driver: Driver;
  private database: string;

  constructor(config: Neo4jConfig) {
    super();
    this.driver = neo4j.driver(
      config.url,
      neo4j.auth.basic(config.username, config.password),
    );
    this.database = config.database || "neo4j";

  }

  async add(data: any): Promise<string> {
    const session = this.driver.session({ database: this.database });
    
    try {
      const result = await session.run(
        `
        CREATE (n:KosmosNode {
          id: $id,
          data: $data,
          created_at: timestamp()
        })
        RETURN n.id AS id
        `,
        { 
          id: data.id || this.generateId(),
          data: JSON.stringify(data)
        }
      );
      
      return result.records[0]?.get('id') as string;
    } catch (error) {
      throw error;
    } finally {
      await session.close();
    }
  }

  async search(query: any, filters: Record<string, any> = {}): Promise<any[]> {
    const session = this.driver.session({ database: this.database });
    
    try {
      let cypher = `
        MATCH (n:KosmosNode)
      `;
      
      const params: Record<string, any> = {};
      
      // Add user filter if provided
      if (filters.userId) {
        cypher += ` WHERE n.userId = $userId`;
        params.userId = filters.userId;
      }
      
      cypher += ` RETURN n LIMIT $limit`;
      params.limit = neo4j.int(filters.limit || 100);

      const result = await session.run(cypher, params);
      
      return result.records.map(record => {
        const node = record.get('n');
        return {
          id: node.properties.id,
          data: JSON.parse(node.properties.data || '{}'),
          created_at: node.properties.created_at
        };
      });
    } catch (error) {
      throw error;
    } finally {
      await session.close();
    }
  }

  async delete(id: string): Promise<void> {
    const session = this.driver.session({ database: this.database });
    
    try {
      await session.run(
        `
        MATCH (n:KosmosNode {id: $id})
        DETACH DELETE n
        `,
        { id }
      );
      
    } catch (error) {
      throw error;
    } finally {
      await session.close();
    }
  }

  async deleteAll(filters: Record<string, any> = {}): Promise<void> {
    const session = this.driver.session({ database: this.database });
    
    try {
      let cypher = `MATCH (n:KosmosNode)`;
      const params: Record<string, any> = {};
      
      if (filters.userId) {
        cypher += ` WHERE n.userId = $userId`;
        params.userId = filters.userId;
      }
      
      cypher += ` DETACH DELETE n`;
      
      await session.run(cypher, params);
      
    } catch (error) {
      throw error;
    } finally {
      await session.close();
    }
  }

  async getAll(filters: Record<string, any> = {}): Promise<any[]> {
    return this.search({}, filters);
  }

  /**
   * Create relationships between entities
   */
  async createRelationship(
    sourceId: string, 
    targetId: string, 
    relationshipType: string, 
    properties: Record<string, any> = {}
  ): Promise<void> {
    const session = this.driver.session({ database: this.database });
    
    try {
      await session.run(
        `
        MATCH (a:KosmosNode {id: $sourceId})
        MATCH (b:KosmosNode {id: $targetId})
        CREATE (a)-[r:${relationshipType}]->(b)
        SET r += $properties
        SET r.created_at = timestamp()
        `,
        { sourceId, targetId, properties }
      );
      
    } catch (error) {
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Query related relationships of an entity
   */
  async getRelationships(nodeId: string, depth: number = 1): Promise<any[]> {
    const session = this.driver.session({ database: this.database });
    
    try {
      const result = await session.run(
        `
        MATCH path = (n:KosmosNode {id: $nodeId})-[*..${depth}]-(connected)
        RETURN path
        LIMIT 100
        `,
        { nodeId }
      );
      
      return result.records.map(record => {
        const path = record.get('path');
        return {
          start: path.start.properties,
          end: path.end.properties,
          relationships: path.segments.map((seg: any) => ({
            type: seg.relationship.type,
            properties: seg.relationship.properties
          }))
        };
      });
    } catch (error) {
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.driver.close();
  }

  private generateId(): string {
    return `kosmos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function to create Kosmos Neo4j graph store instance
 */
export function createKosmosNeo4jStore(config: Neo4jConfig): KosmosNeo4jStore {
  return new KosmosNeo4jStore(config);
}