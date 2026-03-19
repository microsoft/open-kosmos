#!/usr/bin/env node

/**
 * GitHub Copilot Model Data Table Generator
 * 
 * Reads docs/chat/models.json and generates a readable table
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  INPUT_FILE: 'docs/chat/models.json',
  OUTPUT_FILE: 'docs/chat/models-table.md'
};

/**
 * Load model data
 */
function loadModelsData() {
  try {
    if (!fs.existsSync(CONFIG.INPUT_FILE)) {
      throw new Error(`Input file does not exist: ${CONFIG.INPUT_FILE}`);
    }
    
    const rawData = fs.readFileSync(CONFIG.INPUT_FILE, 'utf8');
    const data = JSON.parse(rawData);
    
    if (!data.models || !data.models.data) {
      throw new Error('Model data format is incorrect');
    }
    
    return data;
  } catch (error) {
    throw new Error(`Failed to read model data: ${error.message}`);
  }
}

/**
 * Format boolean value
 */
function formatBoolean(value) {
  if (value === true) return '✅';
  if (value === false) return '❌';
  return '➖';
}

/**
 * Format number
 */
function formatNumber(value) {
  if (value === null || value === undefined) return '➖';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

/**
 * Format cost multiplier
 */
function formatMultiplier(billing) {
  if (!billing) return '➖';
  if (billing.is_premium === false) return 'Free';
  if (billing.multiplier === 0) return 'Free';
  if (billing.multiplier) return `${billing.multiplier}x`;
  return 'Paid';
}

/**
 * Get supported features list
 */
function getSupportedFeatures(capabilities) {
  if (!capabilities || !capabilities.supports) return '➖';
  
  const features = [];
  const supports = capabilities.supports;
  
  if (supports.streaming) features.push('Streaming');
  if (supports.tool_calls) features.push('Tools');
  if (supports.parallel_tool_calls) features.push('Parallel Tools');
  if (supports.vision) features.push('Vision');
  if (supports.thinking) features.push('Thinking');
  if (supports.structured_outputs) features.push('Structured');
  
  return features.length > 0 ? features.join(', ') : '➖';
}

/**
 * Get limit information
 */
function getLimits(capabilities) {
  if (!capabilities || !capabilities.limits) return { input: '➖', output: '➖', context: '➖' };
  
  const limits = capabilities.limits;
  return {
    input: formatNumber(limits.max_prompt_tokens),
    output: formatNumber(limits.max_output_tokens),
    context: formatNumber(limits.max_context_window_tokens)
  };
}

/**
 * Generate Markdown table
 */
function generateMarkdownTable(modelsData) {
  const models = modelsData.models.data;
  const fetchTime = modelsData.metadata.fetchedAt;
  
  let markdown = `# GitHub Copilot Model List\n\n`;
  markdown += `> Data fetched at: ${new Date(fetchTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
  markdown += `> Total ${models.length} models\n\n`;
  
  // Main information table
  markdown += `## Model Overview\n\n`;
  markdown += `| Model ID | Name | Vendor | Type | Default | Visible | Preview | Cost |\n`;
  markdown += `|---------|------|------|------|------|------|------|------|\n`;
  
  models.forEach(model => {
    const id = model.id || '➖';
    const name = model.name || '➖';
    const vendor = model.vendor || '➖';
    const type = model.capabilities?.type || '➖';
    const isDefault = formatBoolean(model.is_chat_default);
    const pickerEnabled = formatBoolean(model.model_picker_enabled);
    const preview = formatBoolean(model.preview);
    const pricing = formatMultiplier(model.billing);
    
    markdown += `| \`${id}\` | ${name} | ${vendor} | ${type} | ${isDefault} | ${pickerEnabled} | ${preview} | ${pricing} |\n`;
  });
  
  // Feature support table
  markdown += `\n## Feature Support\n\n`;
  markdown += `| Model ID | Supported Features | Max Input | Max Output | Context Window |\n`;
  markdown += `|---------|----------|----------|----------|------------|\n`;
  
  models.forEach(model => {
    const id = model.id || '➖';
    const features = getSupportedFeatures(model.capabilities);
    const limits = getLimits(model.capabilities);
    
    markdown += `| \`${id}\` | ${features} | ${limits.input} | ${limits.output} | ${limits.context} |\n`;
  });
  
  // Vendor group statistics
  markdown += `\n## Vendor Statistics\n\n`;
  const vendorStats = {};
  models.forEach(model => {
    const vendor = model.vendor || 'Unknown';
    if (!vendorStats[vendor]) {
      vendorStats[vendor] = { total: 0, premium: 0, chat: 0, embedding: 0 };
    }
    vendorStats[vendor].total++;
    if (model.billing?.is_premium) vendorStats[vendor].premium++;
    if (model.capabilities?.type === 'chat') vendorStats[vendor].chat++;
    if (model.capabilities?.type === 'embeddings') vendorStats[vendor].embedding++;
  });
  
  markdown += `| Vendor | Total | Paid Models | Chat Models | Embedding Models |\n`;
  markdown += `|------|------|----------|----------|----------|\n`;
  
  Object.entries(vendorStats)
    .sort(([,a], [,b]) => b.total - a.total)
    .forEach(([vendor, stats]) => {
      markdown += `| ${vendor} | ${stats.total} | ${stats.premium} | ${stats.chat} | ${stats.embedding} |\n`;
    });
  
  // Model family grouping
  markdown += `\n## Model Family Grouping\n\n`;
  const familyStats = {};
  models.forEach(model => {
    const family = model.capabilities?.family || 'Unknown';
    if (!familyStats[family]) {
      familyStats[family] = [];
    }
    familyStats[family].push(model.id);
  });
  
  markdown += `| Model Family | Model Count | Model List |\n`;
  markdown += `|--------|----------|----------|\n`;
  
  Object.entries(familyStats)
    .sort(([,a], [,b]) => b.length - a.length)
    .forEach(([family, modelIds]) => {
      const modelList = modelIds.map(id => `\`${id}\``).join(', ');
      markdown += `| ${family} | ${modelIds.length} | ${modelList} |\n`;
    });
  
  // Special feature statistics
  markdown += `\n## Special Feature Statistics\n\n`;
  const featureStats = {
    vision: models.filter(m => m.capabilities?.supports?.vision).length,
    toolCalls: models.filter(m => m.capabilities?.supports?.tool_calls).length,
    parallelTools: models.filter(m => m.capabilities?.supports?.parallel_tool_calls).length,
    streaming: models.filter(m => m.capabilities?.supports?.streaming).length,
    structuredOutputs: models.filter(m => m.capabilities?.supports?.structured_outputs).length,
    thinking: models.filter(m => m.capabilities?.supports?.thinking).length
  };
  
  markdown += `| Feature | Supported Models | Percentage |\n`;
  markdown += `|------|------------|------|\n`;
  markdown += `| Vision | ${featureStats.vision} | ${(featureStats.vision / models.length * 100).toFixed(1)}% |\n`;
  markdown += `| Tool Calls | ${featureStats.toolCalls} | ${(featureStats.toolCalls / models.length * 100).toFixed(1)}% |\n`;
  markdown += `| Parallel Tools | ${featureStats.parallelTools} | ${(featureStats.parallelTools / models.length * 100).toFixed(1)}% |\n`;
  markdown += `| Streaming | ${featureStats.streaming} | ${(featureStats.streaming / models.length * 100).toFixed(1)}% |\n`;
  markdown += `| Structured Output | ${featureStats.structuredOutputs} | ${(featureStats.structuredOutputs / models.length * 100).toFixed(1)}% |\n`;
  markdown += `| Thinking | ${featureStats.thinking} | ${(featureStats.thinking / models.length * 100).toFixed(1)}% |\n`;
  
  return markdown;
}

/**
 * Save table to file
 */
function saveTableToFile(markdown) {
  try {
    // Ensure output directory exists
    const outputDir = path.dirname(CONFIG.OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG.OUTPUT_FILE, markdown, 'utf8');
    console.log(`✅ Table saved to: ${CONFIG.OUTPUT_FILE}`);
  } catch (error) {
    throw new Error(`Failed to save table: ${error.message}`);
  }
}

/**
 * Main function
 */
function main() {
  console.log('🚀 Generating GitHub Copilot Model Table');
  console.log('═'.repeat(50));
  
  try {
    // 1. Read model data
    console.log('📖 Reading model data...');
    const modelsData = loadModelsData();
    console.log(`✅ Successfully read ${modelsData.models.data.length} models`);
    
    // 2. Generate table
    console.log('📊 Generating Markdown table...');
    const markdown = generateMarkdownTable(modelsData);
    
    // 3. Save to file
    console.log('💾 Saving table to file...');
    saveTableToFile(markdown);
    
    console.log('\n📈 Statistics:');
    console.log(`  - Input file: ${CONFIG.INPUT_FILE}`);
    console.log(`  - Output file: ${CONFIG.OUTPUT_FILE}`);
    console.log(`  - Total models: ${modelsData.models.data.length}`);
    console.log(`  - Table rows: ${markdown.split('\n').length}`);
    
  } catch (error) {
    console.error('❌ Failed to generate table:', error.message);
    process.exit(1);
  }
  
  console.log('\n🎉 Table generation complete!');
}

// Run main function
if (require.main === module) {
  main();
}

module.exports = {
  loadModelsData,
  generateMarkdownTable,
  formatBoolean,
  formatNumber,
  formatMultiplier,
  getSupportedFeatures,
  getLimits
};