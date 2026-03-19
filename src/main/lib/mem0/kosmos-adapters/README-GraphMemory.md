# Kosmos Graph Memory - Knowledge Graph Memory System

Kosmos Graph Memory is the graph database extension for the mem0 intelligent memory system, supporting knowledge graph construction and querying to understand complex relationships between entities.

## 🌟 Features

- **Knowledge Graph Construction**: Automatically extracts entities and relationships from text
- **Intelligent Relationship Reasoning**: Uses AI to understand semantic relationships
- **Neo4j Integration**: High-performance graph database support
- **Relationship Querying**: Supports complex graph traversal and search
- **Kosmos Integration**: Seamlessly integrates with the Kosmos ecosystem

## 🚀 Quick Start

### 1. Install Dependencies

The graph memory system requires Neo4j database support:

```bash
# Use Docker to quickly start Neo4j
docker run \
  --name neo4j-kosmos \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/kosmos123 \
  -v neo4j_data:/data \
  -d neo4j:latest
```

### 2. Environment Configuration

Add Neo4j configuration in the `.env.local` file:

```env
NEO4J_URL=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=kosmos123
```

### 3. Basic Usage

```typescript
import { createKosmosGraphMemory } from './src/main/lib/mem0/kosmos-adapters';

// Create graph memory instance
const graphMemory = createKosmosGraphMemory();

// Add knowledge
await graphMemory.add("Alice is a software engineer at Google", { userId: "user123" });
await graphMemory.add("Alice loves machine learning", { userId: "user123" });
await graphMemory.add("Bob works with Alice on AI projects", { userId: "user123" });

// Search related information
const results = await graphMemory.search("Alice career", { userId: "user123" });
console.log("Search results:", results);

// Get all relationships
const relationships = await graphMemory.getAll({ userId: "user123" });
console.log("All relationships:", relationships);
```

## 📊 API Reference

### createKosmosGraphMemory(config?)

Convenience function for creating a graph memory instance.

```typescript
const graphMemory = createKosmosGraphMemory({
  url: "bolt://localhost:7687",
  username: "neo4j", 
  password: "your_password"
});
```

### MemoryGraph Class

#### add(data, filters)

Add information to the knowledge graph.

```typescript
const result = await graphMemory.add(
  "The company was founded in 1995 by John Smith", 
  { userId: "user123" }
);
```

Return value contains:
- `deleted_entities`: Deleted/updated entities
- `added_entities`: Newly added entities
- `relations`: Established relationships

#### search(query, filters, limit?)

Search for related knowledge.

```typescript
const results = await graphMemory.search(
  "company founder", 
  { userId: "user123" },
  10
);
```

#### getAll(filters, limit?)

Get all relationships.

```typescript
const relationships = await graphMemory.getAll({ userId: "user123" }, 100);
```

#### deleteAll(filters)

Clear all data for a user.

```typescript
await graphMemory.deleteAll({ userId: "user123" });
```

## 🎯 Use Cases

### 1. Personal Knowledge Management

```typescript
// Add personal information and relationships
await graphMemory.add("I graduated from MIT with a CS degree", { userId: "john" });
await graphMemory.add("I work at Tesla as a senior engineer", { userId: "john" });
await graphMemory.add("Tesla is working on autonomous driving", { userId: "john" });

// Search personal information
const careerInfo = await graphMemory.search("my career education", { userId: "john" });
```

### 2. Project Relationship Management

```typescript
// Project team relationships
await graphMemory.add("Project Alpha is led by Sarah", { userId: "team" });
await graphMemory.add("Mike and Lisa are developers on Project Alpha", { userId: "team" });
await graphMemory.add("Project Alpha uses React and Node.js", { userId: "team" });

// Query project information
const projectInfo = await graphMemory.search("Project Alpha team", { userId: "team" });
```

### 3. Learning Notes Graph

```typescript
// Learning content relationships
await graphMemory.add("Machine Learning is a subset of Artificial Intelligence", { userId: "student" });
await graphMemory.add("Neural Networks are used in Deep Learning", { userId: "student" });
await graphMemory.add("Deep Learning is a type of Machine Learning", { userId: "student" });

// Search concept relationships
const concepts = await graphMemory.search("AI machine learning", { userId: "student" });
```

## 🔧 Advanced Configuration

### Custom Prompts

```typescript
const config = getKosmosMemoryConfig('graph');
config.graphStore.customPrompt = "Extract technical concepts and their relationships from software development context";
```

### Configuration Parameters

- **threshold**: Similarity threshold (default: 0.7)
- **customPrompt**: Custom entity extraction prompt
- **llm**: Specify the LLM provider to use

## 🎮 Running Examples

The project includes complete usage examples:

```typescript
import { runGraphMemoryExample } from './src/main/lib/mem0/kosmos-adapters/examples/graphMemoryExample';

// Run complete example
await runGraphMemoryExample();
```

## 🐛 Troubleshooting

### Common Issues

1. **Neo4j Connection Failed**
   - Check if the Neo4j service is running
   - Verify connection parameters are correct
   - Confirm port 7687 is open

2. **Dependency Errors**
   ```bash
   npm install neo4j-driver zod
   ```

3. **Out of Memory**
   - Adjust Neo4j memory configuration
   - Limit query result count

### Debug Logging

Enable verbose logging:

```typescript
// Set before creating instance
process.env.DEBUG = 'kosmos:graph-memory';
```

## 🤝 Contributing

Issues and Pull Requests are welcome to help improve Kosmos Graph Memory!

## 📄 License

This project is licensed under the MIT License.