import { GraphStore } from "./base";
import neo4j, { Driver } from "neo4j-driver";

export interface Neo4jGraphStoreConfig {
  url: string;
  username: string;
  password: string;
  database?: string;
}

/**
 * Neo4j Graph Store implementation
 */
export class Neo4jGraphStore extends GraphStore {
  private driver: Driver;
  private database: string;

  constructor(config: Neo4jGraphStoreConfig) {
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
        CREATE (n:GraphNode {
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
    } finally {
      await session.close();
    }
  }

  async search(query: any, filters: Record<string, any> = {}): Promise<any[]> {
    const session = this.driver.session({ database: this.database });
    
    try {
      let cypher = `MATCH (n:GraphNode)`;
      const params: Record<string, any> = {};
      
      if (filters.userId) {
        cypher += ` WHERE n.userId = $userId`;
        params.userId = filters.userId;
      }
      
      cypher += ` RETURN n LIMIT $limit`;
      params.limit = neo4j.int(filters.limit || 100);

      const result = await session.run(cypher, params);
      
      return result.records.map((record: any) => {
        const node = record.get('n');
        return {
          id: node.properties.id,
          data: JSON.parse(node.properties.data || '{}'),
          created_at: node.properties.created_at
        };
      });
    } finally {
      await session.close();
    }
  }

  async delete(id: string): Promise<void> {
    const session = this.driver.session({ database: this.database });
    
    try {
      await session.run(
        `
        MATCH (n:GraphNode {id: $id})
        DETACH DELETE n
        `,
        { id }
      );
    } finally {
      await session.close();
    }
  }

  async deleteAll(filters: Record<string, any> = {}): Promise<void> {
    const session = this.driver.session({ database: this.database });
    
    try {
      let cypher = `MATCH (n:GraphNode)`;
      const params: Record<string, any> = {};
      
      if (filters.userId) {
        cypher += ` WHERE n.userId = $userId`;
        params.userId = filters.userId;
      }
      
      cypher += ` DETACH DELETE n`;
      
      await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async getAll(filters: Record<string, any> = {}): Promise<any[]> {
    return this.search({}, filters);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private generateId(): string {
    return `graph_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
