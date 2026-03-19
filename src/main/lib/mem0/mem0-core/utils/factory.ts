import { OpenAIEmbedder } from "../embeddings/openai";
import { OpenAILLM } from "../llms/openai";
import { OpenAIStructuredLLM } from "../llms/openai_structured";
// MemoryVectorStore removed - depends on sqlite3
import {
  EmbeddingConfig,
  HistoryStoreConfig,
  LLMConfig,
  VectorStoreConfig,
} from "../types";
import { Embedder } from "../embeddings/base";
import { LLM } from "../llms/base";
import { VectorStore } from "../vector_stores/base";
import { DummyHistoryManager } from "../storage/DummyHistoryManager";
import { HistoryManager } from "../storage/base";

// Kosmos adapter imports
let BetterSqliteVectorStore: any = null;
let KosmosLLM: any = null;
let KosmosEmbedder: any = null;

// Lazy load Kosmos adapters
function loadKosmosAdapters() {
  if (!BetterSqliteVectorStore || !KosmosLLM || !KosmosEmbedder) {
    try {
      const adapters = require('../../kosmos-adapters');
      BetterSqliteVectorStore = adapters.BetterSqliteVectorStore;
      KosmosLLM = adapters.KosmosLLM;
      KosmosEmbedder = adapters.KosmosEmbedder;
    } catch (error) {
      throw new Error('Kosmos adapters not available');
    }
  }
}

export class EmbedderFactory {
  static create(provider: string, config: EmbeddingConfig): Embedder {
    switch (provider.toLowerCase()) {
      case "kosmos":
        loadKosmosAdapters();
        // KosmosEmbedder does not need config parameters, uses built-in main process modules and authentication
        return new KosmosEmbedder();
      case "openai":
        return new OpenAIEmbedder(config);
      default:
        throw new Error(`Unsupported embedder provider: ${provider}. Available providers: kosmos, openai`);
    }
  }
}

export class LLMFactory {
  static create(provider: string, config: LLMConfig): LLM {
    switch (provider.toLowerCase()) {
      case "kosmos":
        loadKosmosAdapters();
        // KosmosLLM does not need config parameters, uses built-in main process modules and authentication
        return new KosmosLLM();
      case "openai":
        return new OpenAILLM(config);
      case "openai_structured":
        return new OpenAIStructuredLLM(config);
      default:
        throw new Error(`Unsupported LLM provider: ${provider}. Available providers: kosmos, openai, openai_structured`);
    }
  }
}

export class VectorStoreFactory {
  static create(provider: string, config: VectorStoreConfig): VectorStore {
    switch (provider.toLowerCase()) {
      case "bettersqlite":
        loadKosmosAdapters();
        return new BetterSqliteVectorStore(config);
      default:
        throw new Error(`Unsupported vector store provider: ${provider}. Available providers: bettersqlite`);
    }
  }
}

export class HistoryManagerFactory {
  static create(provider: string, config: HistoryStoreConfig): HistoryManager {
    switch (provider.toLowerCase()) {
      case "dummy":
      default:
        // History feature is disabled, only return dummy implementation
        return new DummyHistoryManager();
    }
  }
}
