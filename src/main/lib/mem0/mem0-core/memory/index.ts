import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import {
  MemoryConfig,
  MemoryConfigSchema,
  MemoryItem,
  Message,
  SearchFilters,
  SearchResult,
} from "../types";
import {
  EmbedderFactory,
  LLMFactory,
  VectorStoreFactory,
  HistoryManagerFactory,
} from "../utils/factory";
import {
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  parseMessages,
  removeCodeBlocks,
} from "../prompts";
import { DummyHistoryManager } from "../storage/DummyHistoryManager";
import { Embedder } from "../embeddings/base";
import { LLM } from "../llms/base";
import { VectorStore } from "../vector_stores/base";
import { ConfigManager } from "../config/manager";
// import { MemoryGraph } from "./graph_memory"; // Removed - no graph memory support
import {
  AddMemoryOptions,
  SearchMemoryOptions,
  DeleteAllMemoryOptions,
  GetAllMemoryOptions,
} from "./memory.types";
import { parse_vision_messages } from "../utils/memory";
import { HistoryManager } from "../storage/base";
import { createLogger } from "../../../unifiedLogger";

const logger = createLogger();

export class Memory {
  private config: MemoryConfig;
  private customPrompt: string | undefined;
  private embedder: Embedder;
  private vectorStore: VectorStore;
  private llm: LLM;
  private db: HistoryManager;
  private collectionName: string | undefined;
  private apiVersion: string;
  // private graphMemory?: MemoryGraph; // Removed - no graph memory support
  private enableGraph: boolean;
  host: string;

  constructor(config: Partial<MemoryConfig> = {}) {
    const constructorStartTime = Date.now();
    

    // Merge and validate config
    this.config = ConfigManager.mergeConfig(config);
    

    this.customPrompt = this.config.customPrompt;
    
    // Initialize embedder
    this.embedder = EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config,
    );
    
    // Initialize vector store
    this.vectorStore = VectorStoreFactory.create(
      this.config.vectorStore.provider,
      this.config.vectorStore.config,
    );
    
    // Initialize LLM
    this.llm = LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config,
    );
    
    // Initialize history store
    if (this.config.disableHistory) {
      this.db = new DummyHistoryManager();
    } else {
      const defaultConfig = {
        provider: "sqlite",
        config: {
          historyDbPath: this.config.historyDbPath || ":memory:",
        },
      };


      this.db =
        this.config.historyStore && !this.config.disableHistory
          ? HistoryManagerFactory.create(
              this.config.historyStore.provider,
              this.config.historyStore,
            )
          : HistoryManagerFactory.create("sqlite", defaultConfig);
    }

    this.collectionName = this.config.vectorStore.config.collectionName;
    this.apiVersion = this.config.version || "v1.0";
    this.enableGraph = this.config.enableGraph || false;
    this.host = "";


    // Initialize graph memory if configured
    // Graph memory support removed - GraphDB dependencies not available
    // if (this.enableGraph && this.config.graphStore) {
    //   this.graphMemory = new MemoryGraph(this.config);
    // }

    const constructorDuration = Date.now() - constructorStartTime;
  }

  static fromConfig(configDict: Record<string, any>): Memory {
    try {
      const config = MemoryConfigSchema.parse(configDict);
      return new Memory(config);
    } catch (e) {
      throw e;
    }
  }

  async add(
    messages: string | Message[],
    config: AddMemoryOptions,
  ): Promise<SearchResult> {
    const addStartTime = Date.now();
    

    
    const {
      userId,
      agentId,
      runId,
      metadata = {},
      filters = {},
      infer = true,
    } = config;

    // Build filters and metadata
    if (userId) filters.userId = metadata.userId = userId;
    if (agentId) filters.agentId = metadata.agentId = agentId;
    if (runId) filters.runId = metadata.runId = runId;


    if (!filters.userId && !filters.agentId && !filters.runId) {
      throw new Error(
        "One of the filters: userId, agentId or runId is required!",
      );
    }

    // Parse messages
    const parsedMessages = Array.isArray(messages)
      ? (messages as Message[])
      : [{ role: "user", content: messages }];


    const final_parsedMessages = await parse_vision_messages(parsedMessages);
    

    // Add to vector store

    const vectorStoreResult = await this.addToVectorStore(
      final_parsedMessages,
      metadata,
      filters,
      infer,
    );


    // Add to graph store if available - Graph support removed
    // let graphResult;
    // if (this.graphMemory) {
    //   try {
    //     graphResult = await this.graphMemory.add(
    //       final_parsedMessages.map((m) => m.content).join("\n"),
    //       filters,
    //     );
    //   } catch (error) {
    //   }
    // }

    const addDuration = Date.now() - addStartTime;
    const result = {
      results: vectorStoreResult,
      relations: undefined, // graphResult?.relations - Graph support removed
    };


    return result;
  }

  private async addToVectorStore(
    messages: Message[],
    metadata: Record<string, any>,
    filters: SearchFilters,
    infer: boolean,
  ): Promise<MemoryItem[]> {
    if (!infer) {
      const returnedMemories: MemoryItem[] = [];
      for (const message of messages) {
        if (message.content === "system") {
          continue;
        }
        const memoryId = await this.createMemory(
          message.content as string,
          {},
          metadata,
        );
        returnedMemories.push({
          id: memoryId,
          memory: message.content as string,
          metadata: { event: "ADD" },
        });
      }
      return returnedMemories;
    }
    const parsedMessages = messages.map((m) => m.content).join("\n");


    const [systemPrompt, userPrompt] = this.customPrompt
      ? [this.customPrompt, `Input:\n${parsedMessages}`]
      : getFactRetrievalMessages(parsedMessages);



    const response = await this.llm.generateResponse(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { type: "json_object" },
    );


    const cleanResponse = removeCodeBlocks(response as string);
    

    let facts: string[] = [];
    try {
      const parsed = JSON.parse(cleanResponse);
      facts = parsed.facts || [];
      
    } catch (e) {
      facts = [];
    }


    // Get embeddings for new facts
    const newMessageEmbeddings: Record<string, number[]> = {};
    const retrievedOldMemory: Array<{ id: string; text: string }> = [];


    // Create embeddings and search for similar memories
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      

      const embedding = await this.embedder.embed(fact);
      newMessageEmbeddings[fact] = embedding;



      const existingMemories = await this.vectorStore.search(
        embedding,
        5,
        filters,
      );
      

      for (const mem of existingMemories) {
        retrievedOldMemory.push({ id: mem.id, text: mem.payload.data });
      }
    }


    // Remove duplicates from old memories
    const uniqueOldMemories = retrievedOldMemory.filter(
      (mem, index) =>
        retrievedOldMemory.findIndex((m) => m.id === mem.id) === index,
    );


    // Create UUID mapping for handling UUID hallucinations
    const tempUuidMapping: Record<string, string> = {};
    uniqueOldMemories.forEach((item, idx) => {
      tempUuidMapping[String(idx)] = item.id;
      uniqueOldMemories[idx].id = String(idx);
    });


    // Get memory update decisions
    const updatePrompt = getUpdateMemoryMessages(uniqueOldMemories, facts);



    const updateResponse = await this.llm.generateResponse(
      [{ role: "user", content: updatePrompt }],
      { type: "json_object" },
    );


    const cleanUpdateResponse = removeCodeBlocks(updateResponse as string);
    

    let memoryActions: any[] = [];
    try {
      const parsed = JSON.parse(cleanUpdateResponse);
      memoryActions = parsed.memory || [];
      
    } catch (e) {
      memoryActions = [];
    }


    // Process memory actions
    const results: MemoryItem[] = [];
    

    for (let i = 0; i < memoryActions.length; i++) {
      const action = memoryActions[i];
      

      try {
        switch (action.event) {
          case "ADD": {

            const memoryId = await this.createMemory(
              action.text,
              newMessageEmbeddings,
              metadata,
            );
            
            const result = {
              id: memoryId,
              memory: action.text,
              metadata: { event: action.event },
            };
            results.push(result);
            
            break;
          }
          case "UPDATE": {
            const realMemoryId = tempUuidMapping[action.id];
            

            await this.updateMemory(
              realMemoryId,
              action.text,
              newMessageEmbeddings,
              metadata,
            );
            
            const result = {
              id: realMemoryId,
              memory: action.text,
              metadata: {
                event: action.event,
                previousMemory: action.old_memory,
              },
            };
            results.push(result);
            
            break;
          }
          case "DELETE": {
            const realMemoryId = tempUuidMapping[action.id];
            

            await this.deleteMemory(realMemoryId);
            
            const result = {
              id: realMemoryId,
              memory: action.text,
              metadata: { event: action.event },
            };
            results.push(result);
            
            break;
          }
          default: {
          }
        }
      } catch (error) {
      }
    }


    return results;
  }

  async get(memoryId: string): Promise<MemoryItem | null> {
    const memory = await this.vectorStore.get(memoryId);
    if (!memory) return null;

    const filters = {
      ...(memory.payload.userId && { userId: memory.payload.userId }),
      ...(memory.payload.agentId && { agentId: memory.payload.agentId }),
      ...(memory.payload.runId && { runId: memory.payload.runId }),
    };

    const memoryItem: MemoryItem = {
      id: memory.id,
      memory: memory.payload.data,
      hash: memory.payload.hash,
      createdAt: memory.payload.createdAt,
      updatedAt: memory.payload.updatedAt,
      metadata: {},
    };

    // Add additional metadata
    const excludedKeys = new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
    ]);
    for (const [key, value] of Object.entries(memory.payload)) {
      if (!excludedKeys.has(key)) {
        memoryItem.metadata![key] = value;
      }
    }

    return { ...memoryItem, ...filters };
  }

  async search(
    query: string,
    config: SearchMemoryOptions,
  ): Promise<SearchResult> {
    const searchStartTime = Date.now();
    logger.debug('[Memory] 🔍 SEARCH START', 'Memory.search', {
      queryPreview: query.substring(0, 100),
      queryLength: query.length,
      config
    });

    const { userId, agentId, runId, limit = 100, filters = {} } = config;

    if (userId) filters.userId = userId;
    if (agentId) filters.agentId = agentId;
    if (runId) filters.runId = runId;

    logger.debug('[Memory] 🔍 Filters applied', 'Memory.search', { filters });

    if (!filters.userId && !filters.agentId && !filters.runId) {
      throw new Error(
        "One of the filters: userId, agentId or runId is required!",
      );
    }

    // Search vector store
    logger.debug('[Memory] 🔍 Calling embedder.embed()', 'Memory.search');
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embedder.embed(query);
      logger.debug('[Memory] 🔍 Embedding completed', 'Memory.search', {
        dimensions: queryEmbedding?.length,
        first5Values: queryEmbedding?.slice(0, 5)
      });
    } catch (embedError) {
      logger.error('[Memory] ❌ Embedding failed', 'Memory.search', {
        error: embedError instanceof Error ? embedError.message : String(embedError)
      });
      throw embedError;
    }


    logger.debug('[Memory] 🔍 Calling vectorStore.search()', 'Memory.search', { limit });
    let memories: any[];
    try {
      memories = await this.vectorStore.search(
        queryEmbedding,
        limit,
        filters,
      );
      logger.debug('[Memory] 🔍 VectorStore.search() completed', 'Memory.search', {
        resultsCount: memories?.length || 0
      });
    } catch (searchError) {
      logger.error('[Memory] ❌ VectorStore search failed', 'Memory.search', {
        error: searchError instanceof Error ? searchError.message : String(searchError)
      });
      throw searchError;
    }


    // Search graph store if available - Graph support removed
    // let graphResults;
    // if (this.graphMemory) {
    //   try {
    //     graphResults = await this.graphMemory.search(query, filters);
    //   } catch (error) {
    //   }
    // }


    const excludedKeys = new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
    ]);
    const results = memories.map((mem) => ({
      id: mem.id,
      memory: mem.payload.data,
      hash: mem.payload.hash,
      createdAt: mem.payload.createdAt,
      updatedAt: mem.payload.updatedAt,
      score: mem.score,
      metadata: Object.entries(mem.payload)
        .filter(([key]) => !excludedKeys.has(key))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
      ...(mem.payload.userId && { userId: mem.payload.userId }),
      ...(mem.payload.agentId && { agentId: mem.payload.agentId }),
      ...(mem.payload.runId && { runId: mem.payload.runId }),
    }));

    const searchDuration = Date.now() - searchStartTime;
    const searchResult = {
      results,
      relations: undefined, // graphResults - Graph support removed
    };


    return searchResult;
  }

  async update(memoryId: string, data: string): Promise<{ message: string }> {
    const updateStartTime = Date.now();
    

    

    const embedding = await this.embedder.embed(data);
    


    await this.updateMemory(memoryId, data, { [data]: embedding });
    
    const updateDuration = Date.now() - updateStartTime;

    return { message: "Memory updated successfully!" };
  }

  async delete(memoryId: string): Promise<{ message: string }> {
    const deleteStartTime = Date.now();
    

    

    await this.deleteMemory(memoryId);
    
    const deleteDuration = Date.now() - deleteStartTime;

    return { message: "Memory deleted successfully!" };
  }

  async deleteAll(
    config: DeleteAllMemoryOptions,
  ): Promise<{ message: string }> {
    const deleteAllStartTime = Date.now();
    

    const { userId, agentId, runId } = config;

    const filters: SearchFilters = {};
    if (userId) filters.userId = userId;
    if (agentId) filters.agentId = agentId;
    if (runId) filters.runId = runId;


    if (!Object.keys(filters).length) {
      throw new Error(
        "At least one filter is required to delete all memories. If you want to delete all memories, use the `reset()` method.",
      );
    }


    const [memories] = await this.vectorStore.list(filters);
    


    let deletedCount = 0;
    for (const memory of memories) {
      
      try {
        await this.deleteMemory(memory.id);
        deletedCount++;
        
      } catch (error) {
        // Continue with next memory instead of failing entire operation
      }
    }

    const deleteAllDuration = Date.now() - deleteAllStartTime;

    return { message: "Memories deleted successfully!" };
  }

  async history(memoryId: string): Promise<any[]> {
    const historyStartTime = Date.now();
    

    const history = await this.db.getHistory(memoryId);
    
    const historyDuration = Date.now() - historyStartTime;

    return history;
  }

  async reset(): Promise<void> {
    const resetStartTime = Date.now();
    

    

    await this.db.reset();
    

    // Check provider before attempting deleteCol
    if (this.config.vectorStore.provider.toLowerCase() !== "langchain") {

      try {
        await this.vectorStore.deleteCol();
        
      } catch (e) {
        // Decide if you want to re-throw or just log
      }
    } else {
    }

    // Graph memory deleteAll removed - Graph support not available
    // if (this.graphMemory) {
    //   await this.graphMemory.deleteAll({ userId: "default" });
    // }


    // Re-initialize factories/clients based on the original config
    this.embedder = EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config,
    );
    

    // Re-create vector store instance - crucial for Langchain to reset wrapper state if needed
    this.vectorStore = VectorStoreFactory.create(
      this.config.vectorStore.provider,
      this.config.vectorStore.config, // This will pass the original client instance back
    );
    

    this.llm = LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config,
    );
    

    // Re-init DB if needed (though db.reset() likely handles its state)
    // Re-init Graph if needed


    
    const resetDuration = Date.now() - resetStartTime;
  }

  async getAll(config: GetAllMemoryOptions): Promise<SearchResult> {
    const getAllStartTime = Date.now();
    

    const { userId, agentId, runId, limit = 100 } = config;

    const filters: SearchFilters = {};
    if (userId) filters.userId = userId;
    if (agentId) filters.agentId = agentId;
    if (runId) filters.runId = runId;



    const [memories] = await this.vectorStore.list(filters, limit);
    


    const excludedKeys = new Set([
      "userId",
      "agentId",
      "runId",
      "hash",
      "data",
      "createdAt",
      "updatedAt",
    ]);
    const results = memories.map((mem) => ({
      id: mem.id,
      memory: mem.payload.data,
      hash: mem.payload.hash,
      createdAt: mem.payload.createdAt,
      updatedAt: mem.payload.updatedAt,
      metadata: Object.entries(mem.payload)
        .filter(([key]) => !excludedKeys.has(key))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
      ...(mem.payload.userId && { userId: mem.payload.userId }),
      ...(mem.payload.agentId && { agentId: mem.payload.agentId }),
      ...(mem.payload.runId && { runId: mem.payload.runId }),
    }));

    const getAllDuration = Date.now() - getAllStartTime;

    return { results };
  }

  private async createMemory(
    data: string,
    existingEmbeddings: Record<string, number[]>,
    metadata: Record<string, any>,
  ): Promise<string> {
    const createMemoryStartTime = Date.now();
    const memoryId = uuidv4();
    

    let embedding: number[];
    if (existingEmbeddings[data]) {
      embedding = existingEmbeddings[data];
    } else {
      embedding = await this.embedder.embed(data);
      
    }

    const hash = createHash("md5").update(data).digest("hex");
    const createdAt = new Date().toISOString();
    
    const memoryMetadata = {
      ...metadata,
      data,
      hash,
      createdAt,
    };



    await this.vectorStore.insert([embedding], [memoryId], [memoryMetadata]);
    


    await this.db.addHistory(
      memoryId,
      null,
      data,
      "ADD",
      memoryMetadata.createdAt,
    );
    

    const createMemoryDuration = Date.now() - createMemoryStartTime;

    return memoryId;
  }

  private async updateMemory(
    memoryId: string,
    data: string,
    existingEmbeddings: Record<string, number[]>,
    metadata: Record<string, any> = {},
  ): Promise<string> {
    const updateMemoryStartTime = Date.now();
    


    const existingMemory = await this.vectorStore.get(memoryId);
    if (!existingMemory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }

    const prevValue = existingMemory.payload.data;
    

    let embedding: number[];
    if (existingEmbeddings[data]) {
      embedding = existingEmbeddings[data];
    } else {
      embedding = await this.embedder.embed(data);
      
    }

    const hash = createHash("md5").update(data).digest("hex");
    const updatedAt = new Date().toISOString();
    
    const newMetadata = {
      ...metadata,
      data,
      hash,
      createdAt: existingMemory.payload.createdAt,
      updatedAt,
      ...(existingMemory.payload.userId && {
        userId: existingMemory.payload.userId,
      }),
      ...(existingMemory.payload.agentId && {
        agentId: existingMemory.payload.agentId,
      }),
      ...(existingMemory.payload.runId && {
        runId: existingMemory.payload.runId,
      }),
    };



    await this.vectorStore.update(memoryId, embedding, newMetadata);
    


    await this.db.addHistory(
      memoryId,
      prevValue,
      data,
      "UPDATE",
      newMetadata.createdAt,
      newMetadata.updatedAt,
    );
    

    const updateMemoryDuration = Date.now() - updateMemoryStartTime;

    return memoryId;
  }

  private async deleteMemory(memoryId: string): Promise<string> {
    const deleteMemoryStartTime = Date.now();
    


    const existingMemory = await this.vectorStore.get(memoryId);
    if (!existingMemory) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }

    const prevValue = existingMemory.payload.data;
    


    await this.vectorStore.delete(memoryId);
    


    await this.db.addHistory(
      memoryId,
      prevValue,
      null,
      "DELETE",
      undefined,
      undefined,
      1,
    );
    

    const deleteMemoryDuration = Date.now() - deleteMemoryStartTime;

    return memoryId;
  }
}

export { MemoryGraph } from "./graph_memory";
