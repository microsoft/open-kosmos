/**
 * FileTreeService usage examples
 * Demonstrates how to use the high-performance file tree service based on ripgrep --files
 */

import { getFileTreeService, FileTreeService, FileTreeQuery } from './FileTreeService';
import * as path from 'path';

/**
 * Example 1: Get the complete file tree
 */
async function example1_GetFullTree() {
  
  const service = getFileTreeService();
  const workspaceRoot = process.cwd(); // Or specify a specific path
  
  const query: FileTreeQuery = {
    folder: workspaceRoot,
    includeHidden: false,
    useGitignore: true
  };
  
  const result = await service.getFileTree(query);
  
  
  // Print direct children of the root directory
  result.root.children?.slice(0, 10).forEach(child => {
  });
}

/**
 * Example 2: Get TypeScript files only
 */
async function example2_GetTypeScriptFiles() {
  
  const service = getFileTreeService();
  
  const query: FileTreeQuery = {
    folder: process.cwd(),
    includePattern: '*.ts,*.tsx',  // Only include TS files
    excludePattern: '*.test.ts,*.spec.ts' // Exclude test files
  };
  
  const result = await service.getFileTree(query);
  
  result.flatList.slice(0, 10).forEach(file => {
  });
}

/**
 * Example 3: Limit scan depth
 */
async function example3_LimitDepth() {
  
  const service = getFileTreeService();
  
  const query: FileTreeQuery = {
    folder: process.cwd(),
    maxDepth: 2  // Only scan 2 levels deep
  };
  
  const result = await service.getFileTree(query);
  
}

/**
 * Example 4: Quickly get file list (without building tree)
 */
async function example4_GetFlatList() {
  
  const service = getFileTreeService();
  
  const query: FileTreeQuery = {
    folder: process.cwd(),
    includePattern: '*.md'  // Only Markdown files
  };
  
  const startTime = Date.now();
  const files = await service.getFileList(query);
  const duration = Date.now() - startTime;
  
  files.slice(0, 5).forEach(file => {
  });
}

/**
 * Example 5: Include file metadata
 */
async function example5_WithMetadata() {
  
  const service = getFileTreeService();
  
  const query: FileTreeQuery = {
    folder: process.cwd(),
    includePattern: 'package.json',
    includeMetadata: true  // Include size and modification time
  };
  
  const result = await service.getFileTree(query);
  
  // Traverse tree to find package.json
  function findPackageJson(node: any): any {
    if (node.name === 'package.json') {
      return node;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = findPackageJson(child);
        if (found) return found;
      }
    }
    return null;
  }
  
  const packageJson = findPackageJson(result.root);
  if (packageJson) {
  }
}

/**
 * Example 6: Event listeners
 */
async function example6_EventListeners() {
  
  const service = getFileTreeService();
  
  // Listen for tree build complete event
  service.on('treeBuilt', (stats) => {
  });
  
  // Listen for metadata load complete event
  service.on('metadataLoaded', () => {
  });
  
  const query: FileTreeQuery = {
    folder: process.cwd(),
    maxDepth: 1,
    includeMetadata: true
  };
  
  await service.getFileTree(query);
}

/**
 * Example 7: Cache mechanism demo
 */
async function example7_CachingDemo() {
  
  const service = getFileTreeService();
  
  const query: FileTreeQuery = {
    folder: process.cwd(),
    maxDepth: 2
  };
  
  // First call (cache miss)
  const result1 = await service.getFileTree(query);
  
  // Second call (cache hit)
  const result2 = await service.getFileTree(query);
  
  // Clear cache
  service.clearCache();
  
  // Third call (rebuild)
  const result3 = await service.getFileTree(query);
}

/**
 * Example 8: Multi-project scenario
 */
async function example8_MultiProject() {
  
  const service = getFileTreeService();
  
  const projects = [
    '/path/to/project1',
    '/path/to/project2',
    '/path/to/project3'
  ];
  
  
  const startTime = Date.now();
  const results = await Promise.all(
    projects.map(folder => 
      service.getFileTree({ folder, maxDepth: 3 })
    )
  );
  const duration = Date.now() - startTime;
  
  results.forEach((result, index) => {
  });
}

/**
 * Example 9: Performance comparison - FileTreeService vs traditional recursive scan
 */
async function example9_PerformanceComparison() {
  
  const service = getFileTreeService();
  const workspaceRoot = process.cwd();
  
  // Method 1: Using FileTreeService (based on ripgrep)
  const start1 = Date.now();
  const result1 = await service.getFileTree({ 
    folder: workspaceRoot,
    maxDepth: 5
  });
  const duration1 = Date.now() - start1;
  
  // Method 2: Traditional Node.js fs recursive scan (for comparison)
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await example1_GetFullTree();
    await example2_GetTypeScriptFiles();
    await example3_LimitDepth();
    await example4_GetFlatList();
    await example5_WithMetadata();
    await example6_EventListeners();
    await example7_CachingDemo();
    // await example8_MultiProject(); // Requires actual project paths
    await example9_PerformanceComparison();
    
  } catch (error) {
  }
}

// If this file is run directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}

export {
  example1_GetFullTree,
  example2_GetTypeScriptFiles,
  example3_LimitDepth,
  example4_GetFlatList,
  example5_WithMetadata,
  example6_EventListeners,
  example7_CachingDemo,
  example8_MultiProject,
  example9_PerformanceComparison
};