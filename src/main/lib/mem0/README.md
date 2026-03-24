# OpenKosmos Memory System

Kosmos application memory management system based on mem0. Fully integrated into the Kosmos project with no standalone package configuration.

## 🎯 Fully Integrated Status

✅ **Integration Complete**:
- Removed all standalone package.json, tsconfig.json, node_modules
- ChromaDB and related dependencies integrated into the main Kosmos package.json
- mem0 core code exists directly as a Kosmos component
- All import paths updated to relative paths
- Full mem0 core functionality preserved

## 🚀 Quick Start

```typescript
import { createKosmosMemory } from './src/main/lib/mem0/kosmos-adapters';

// Create memory instance (automatically uses Kosmos dependencies)
const memory = createKosmosMemory();

// Add memory
await memory.add("User prefers dark theme", {
  userId: "user123",
  agentId: "kosmos"
});

// Search memories  
const results = await memory.search("User interface preferences", {
  userId: "user123",
  limit: 5
});
```

## 📁 Project Structure After Integration

```
src/main/lib/mem0/
├── mem0-core/                  # mem0 core code (no standalone package config)
│   ├── config/                 # Configuration management
│   ├── embeddings/             # Embedding interfaces
│   ├── llms/                   # LLM interfaces
│   ├── memory/                 # Core memory management
│   ├── storage/                # Storage management
│   ├── types/                  # Type definitions
│   ├── utils/                  # Utility functions (factory classes updated)
│   ├── vector_stores/          # Vector stores
│   └── index.ts               # Core exports
└── kosmos-adapters/            # OpenKosmos adapter layer
    ├── chromaVectorStore.ts    # ChromaDB adapter
    ├── kosmosEmbedder.ts       # OpenKosmos embedding adapter
    ├── kosmosLLM.ts           # OpenKosmos LLM adapter
    ├── kosmosConfig.ts         # OpenKosmos configuration
    ├── index.ts                # Main export file
    ├── README.md               # Detailed documentation
    └── example.js              # Usage examples
```

## 🔧 Dependency Management

All dependencies are now managed centrally in the main Kosmos package.json:

```json
{
  "dependencies": {
    "better-sqlite3": "^11.10.0", // High-performance SQLite database
    "sqlite-vec": "^0.1.6",       // SQLite vector extension
    "openai": "^4.28.0",          // OpenAI SDK (backup)
    "uuid": "^11.1.0",            // UUID generation
    "zod": "^3.25.76"             // Type validation
  }
}
```

## 🎯 Core Features

- **Vector Storage**: better-sqlite3 + sqlite-vec local vector database
- **LLM Service**: GPT-4.1 via Kosmos GhcModelApi
- **Embedding Service**: text-embedding-3-small via Kosmos textLlmEmbedder
- **Memory Management**: Add, search, update, delete memories
- **Full Integration**: No standalone configuration, directly uses Kosmos's build system
- **Cross-Platform Support**: Supports Windows (x64/ARM64) and macOS (x64/ARM64)

## 📚 Usage Documentation

For detailed usage instructions, see:
- [kosmos-adapters/README.md](./kosmos-adapters/README.md) - Full API documentation
- [kosmos-adapters/example.js](./kosmos-adapters/example.js) - Usage examples

## 🧪 Running Examples

```bash
# Run in Kosmos application environment
cd src/main/lib/mem0/kosmos-adapters
node example.js
```

## ⚙️ Compilation and Build

mem0 is now part of Kosmos:
- Uses Kosmos's TypeScript configuration
- Compiled through Kosmos's webpack configuration
- Dependencies managed through Kosmos's package.json
- No standalone build process required

## 🔗 Integration Advantages

1. **Unified Dependency Management**: Avoids version conflicts, reduces package size
2. **Simplified Build**: No standalone compilation needed, follows the main project directly
3. **Type Consistency**: Uses unified TypeScript configuration
4. **Better Maintenance**: Fewer configuration files, centralized management

---

The following is original mem0 project information:
- **+26% Accuracy** over OpenAI Memory on the LOCOMO benchmark
- **91% Faster Responses** than full-context, ensuring low-latency at scale
- **90% Lower Token Usage** than full-context, cutting costs without compromise
- [Read the full paper](https://mem0.ai/research)

# Introduction

[Mem0](https://mem0.ai) ("mem-zero") enhances AI assistants and agents with an intelligent memory layer, enabling personalized AI interactions. It remembers user preferences, adapts to individual needs, and continuously learns over time—ideal for customer support chatbots, AI assistants, and autonomous systems.

### Key Features & Use Cases

**Core Capabilities:**
- **Multi-Level Memory**: Seamlessly retains User, Session, and Agent state with adaptive personalization
- **Developer-Friendly**: Intuitive API, cross-platform SDKs, and a fully managed service option

**Applications:**
- **AI Assistants**: Consistent, context-rich conversations
- **Customer Support**: Recall past tickets and user history for tailored help
- **Healthcare**: Track patient preferences and history for personalized care
- **Productivity & Gaming**: Adaptive workflows and environments based on user behavior

## 🚀 Quickstart Guide <a name="quickstart"></a>

Choose between our hosted platform or self-hosted package:

### Hosted Platform

Get up and running in minutes with automatic updates, analytics, and enterprise security.

1. Sign up on [Mem0 Platform](https://app.mem0.ai)
2. Embed the memory layer via SDK or API keys

### Self-Hosted (Open Source)

Install the sdk via pip:

```bash
pip install mem0ai
```

Install sdk via npm:
```bash
npm install mem0ai
```

### Basic Usage

Mem0 requires an LLM to function, with `gpt-4o-mini` from OpenAI as the default. However, it supports a variety of LLMs; for details, refer to our [Supported LLMs documentation](https://docs.mem0.ai/components/llms/overview).

First step is to instantiate the memory:

```python
from openai import OpenAI
from mem0 import Memory

openai_client = OpenAI()
memory = Memory()

def chat_with_memories(message: str, user_id: str = "default_user") -> str:
    # Retrieve relevant memories
    relevant_memories = memory.search(query=message, user_id=user_id, limit=3)
    memories_str = "\n".join(f"- {entry['memory']}" for entry in relevant_memories["results"])

    # Generate Assistant response
    system_prompt = f"You are a helpful AI. Answer the question based on query and memories.\nUser Memories:\n{memories_str}"
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": message}]
    response = openai_client.chat.completions.create(model="gpt-4o-mini", messages=messages)
    assistant_response = response.choices[0].message.content

    # Create new memories from the conversation
    messages.append({"role": "assistant", "content": assistant_response})
    memory.add(messages, user_id=user_id)

    return assistant_response

def main():
    print("Chat with AI (type 'exit' to quit)")
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() == 'exit':
            print("Goodbye!")
            break
        print(f"AI: {chat_with_memories(user_input)}")

if __name__ == "__main__":
    main()
```

For detailed integration steps, see the [Quickstart](https://docs.mem0.ai/quickstart) and [API Reference](https://docs.mem0.ai/api-reference).

## 🔗 Integrations & Demos

- **ChatGPT with Memory**: Personalized chat powered by Mem0 ([Live Demo](https://mem0.dev/demo))
- **Browser Extension**: Store memories across ChatGPT, Perplexity, and Claude ([Chrome Extension](https://chromewebstore.google.com/detail/onihkkbipkfeijkadecaafbgagkhglop?utm_source=item-share-cb))
- **Langgraph Support**: Build a customer bot with Langgraph + Mem0 ([Guide](https://docs.mem0.ai/integrations/langgraph))
- **CrewAI Integration**: Tailor CrewAI outputs with Mem0 ([Example](https://docs.mem0.ai/integrations/crewai))

## 📚 Documentation & Support

- Full docs: https://docs.mem0.ai
- Community: [Discord](https://mem0.dev/DiG) · [Twitter](https://x.com/mem0ai)
- Contact: founders@mem0.ai

## Citation

We now have a paper you can cite:

```bibtex
@article{mem0,
  title={Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory},
  author={Chhikara, Prateek and Khant, Dev and Aryan, Saket and Singh, Taranjeet and Yadav, Deshraj},
  journal={arXiv preprint arXiv:2504.19413},
  year={2025}
}
```

## ⚖️ License

Apache 2.0 — see the [LICENSE](LICENSE) file for details.