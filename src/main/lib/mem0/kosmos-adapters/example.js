/**
 * Kosmos Memory Usage Example
 * Demonstrates how to use the adapted mem0 system
 * 
 * Note: This example needs to run in the Kosmos application environment and depends on GitHub Copilot authentication
 */

async function basicUsageExample() {
  
  try {
    // Import adapter - now imported directly from kosmos-adapters
    const { createKosmosMemory } = require('./index');
    
    // Create memory instance
    const memory = createKosmosMemory('development');
    
    // Add some test memories
    const memory1 = await memory.add("User prefers using dark theme", {
      userId: "test_user",
      category: "preference"
    });
    
    const memory2 = await memory.add("User frequently develops with TypeScript", {
      userId: "test_user", 
      category: "skill"
    });
    
    const memory3 = await memory.add("User prefers a clean code style", {
      userId: "test_user",
      category: "preference" 
    });
    
    // Search memories
    const searchResults = await memory.search("User's programming preferences", {
      userId: "test_user",
      limit: 3
    });
    
    
    // Get all memories
    const allMemories = await memory.getAll({
      userId: "test_user"
    });
    
    allMemories.forEach((mem, index) => {
    });
    
  } catch (error) {
  }
}

async function batchOperationExample() {
  
  try {
    const { createKosmosDevMemory } = require('./index');
    
    const memory = createKosmosDevMemory();
    
    // Batch add memories
    const memories = [
      "User is familiar with the React framework",
      "User likes using VS Code editor", 
      "User frequently uses Git for version control",
      "User prefers using npm as the package manager",
      "User likes writing unit tests"
    ];
    
    const addedMemories = [];
    for (let i = 0; i < memories.length; i++) {
      const memoryId = await memory.add(memories[i], {
        userId: "batch_user",
        category: "skill",
        batch: "development_skills"
      });
      addedMemories.push(memoryId);
    }
    
    // Search batch-added memories
    const skillResults = await memory.search("Development tools and skills", {
      userId: "batch_user",
      limit: 10
    });
    
    skillResults.results.forEach((result, index) => {
    });
    
  } catch (error) {
  }
}

async function customConfigExample() {
  
  try {
    const { createCustomKosmosMemory } = require('./index');
    
    const customMemory = createCustomKosmosMemory({
      vectorStore: {
        config: {
          collectionName: "custom_kosmos_memories",
          persistPath: "./custom_chroma_test"
        }
      },
      customPrompt: "You are a Kosmos assistant with memory capabilities."
    });
    
    // Test custom configuration
    const testMemory = await customMemory.add("This is a custom configuration test", {
      userId: "custom_user",
      test: true
    });
    
    
    const searchResult = await customMemory.search("Configuration test", {
      userId: "custom_user"
    });
    
    
  } catch (error) {
  }
}

async function memoryOnlyExample() {
  
  try {
    const { createKosmosMemoryOnly } = require('./index');
    
    const tempMemory = createKosmosMemoryOnly();
    
    // Add temporary memory in memory-only mode
    await tempMemory.add("This is a temporary memory that will not be persisted", {
      userId: "temp_user",
      temporary: true
    });
    
    const tempResults = await tempMemory.search("Temporary memory", {
      userId: "temp_user"
    });
    
    
  } catch (error) {
  }
}

// Main function
async function runAllExamples() {
  
  try {
    await basicUsageExample();
    await batchOperationExample();
    await customConfigExample();
    await memoryOnlyExample();
    
  } catch (error) {
  }
}

// If this file is run directly
if (require.main === module) {
  runAllExamples();
}

module.exports = {
  basicUsageExample,
  batchOperationExample,
  customConfigExample,
  memoryOnlyExample,
  runAllExamples
};