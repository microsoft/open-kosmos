#!/usr/bin/env node

/**
 * Sync GitHub Copilot model data to ghcModels.ts
 *
 * Reads scripts/github-copilot-models.json and updates src/main/lib/llm/ghcModels.ts
 *
 * Usage:
 *   1. First run test-github-copilot-models.js to get the latest model data
 *   2. Then run this script to sync to the TypeScript file
 *
 * Example:
 *   OPENKOSMOS_AUTH_FILE="..." node scripts/test-github-copilot-models.js
 *   node scripts/sync-ghc-models.js
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'github-copilot-models.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'main', 'lib', 'llm', 'ghcModels.ts');

function loadModelsJson() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Model data file not found: ${INPUT_FILE}\nPlease run test-github-copilot-models.js first to get the latest data`);
  }
  const raw = fs.readFileSync(INPUT_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Model data format error: missing data array');
  }
  return data.data;
}

/**
 * Convert JSON model object to TypeScript literal string
 */
function modelToTs(model, indent = 2) {
  const pad = ' '.repeat(indent);
  const pad2 = ' '.repeat(indent + 2);
  const pad3 = ' '.repeat(indent + 4);
  const pad4 = ' '.repeat(indent + 6);

  let lines = [];
  lines.push(`${pad}{`);

  // billing
  lines.push(`${pad2}billing: {`);
  lines.push(`${pad3}is_premium: ${model.billing.is_premium},`);
  lines.push(`${pad3}multiplier: ${model.billing.multiplier}${model.billing.restricted_to ? ',' : ''}`);
  if (model.billing.restricted_to) {
    lines.push(`${pad3}restricted_to: ${JSON.stringify(model.billing.restricted_to)}`);
  }
  lines.push(`${pad2}},`);

  // capabilities
  lines.push(`${pad2}capabilities: {`);
  lines.push(`${pad3}family: ${JSON.stringify(model.capabilities.family)},`);

  // limits
  if (model.capabilities.limits) {
    lines.push(`${pad3}limits: {`);
    const limits = model.capabilities.limits;
    const limitKeys = Object.keys(limits).filter(k => k !== 'vision');
    limitKeys.forEach((key, i) => {
      const comma = (i < limitKeys.length - 1 || limits.vision) ? ',' : '';
      lines.push(`${pad4}${key}: ${limits[key]}${comma}`);
    });
    if (limits.vision) {
      lines.push(`${pad4}vision: {`);
      lines.push(`${pad4}  max_prompt_image_size: ${limits.vision.max_prompt_image_size},`);
      lines.push(`${pad4}  max_prompt_images: ${limits.vision.max_prompt_images},`);
      lines.push(`${pad4}  supported_media_types: ${JSON.stringify(limits.vision.supported_media_types)}`);
      lines.push(`${pad4}}`);
    }
    lines.push(`${pad3}},`);
  }

  lines.push(`${pad3}object: "model_capabilities",`);

  // supports
  lines.push(`${pad3}supports: {`);
  const supports = model.capabilities.supports;
  const supportKeys = Object.keys(supports);
  supportKeys.forEach((key, i) => {
    const val = supports[key];
    const comma = i < supportKeys.length - 1 ? ',' : '';
    if (Array.isArray(val)) {
      lines.push(`${pad4}${key}: ${JSON.stringify(val)}${comma}`);
    } else {
      lines.push(`${pad4}${key}: ${val}${comma}`);
    }
  });
  lines.push(`${pad3}},`);

  lines.push(`${pad3}tokenizer: ${JSON.stringify(model.capabilities.tokenizer)},`);
  lines.push(`${pad3}type: ${JSON.stringify(model.capabilities.type)}`);
  lines.push(`${pad2}},`);

  // id
  lines.push(`${pad2}id: ${JSON.stringify(model.id)},`);
  lines.push(`${pad2}is_chat_default: ${model.is_chat_default},`);
  lines.push(`${pad2}is_chat_fallback: ${model.is_chat_fallback},`);

  // model_picker_category
  if (model.model_picker_category) {
    lines.push(`${pad2}model_picker_category: ${JSON.stringify(model.model_picker_category)},`);
  }
  lines.push(`${pad2}model_picker_enabled: ${model.model_picker_enabled},`);

  // name
  lines.push(`${pad2}name: ${JSON.stringify(model.name)},`);
  lines.push(`${pad2}object: "model",`);

  // policy
  if (model.policy) {
    lines.push(`${pad2}policy: {`);
    lines.push(`${pad3}state: ${JSON.stringify(model.policy.state)},`);
    lines.push(`${pad3}terms: ${JSON.stringify(model.policy.terms)}`);
    lines.push(`${pad2}},`);
  }

  lines.push(`${pad2}preview: ${model.preview},`);

  // supported_endpoints
  if (model.supported_endpoints) {
    lines.push(`${pad2}supported_endpoints: ${JSON.stringify(model.supported_endpoints)},`);
  }

  lines.push(`${pad2}vendor: ${JSON.stringify(model.vendor)},`);
  lines.push(`${pad2}version: ${JSON.stringify(model.version)}`);
  lines.push(`${pad}}`);

  return lines.join('\n');
}

function main() {
  console.log('📦 Starting model data sync...');

  const models = loadModelsJson();
  console.log(`📊 Read ${models.length} models from JSON`);

  // Read existing ghcModels.ts
  const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');

  // Generate new GITHUB_COPILOT_MODELS array
  const modelsTs = models.map(m => modelToTs(m)).join(',\n');

  // Replace GITHUB_COPILOT_MODELS array
  const startMarker = 'export const GITHUB_COPILOT_MODELS: GhcCopilotModel[] = [';
  const endMarker = '];';

  const startIdx = existingContent.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('Cannot find the start marker of GITHUB_COPILOT_MODELS array');
  }

  // Find the corresponding closing ];
  let bracketCount = 0;
  let endIdx = -1;
  for (let i = startIdx + startMarker.length; i < existingContent.length; i++) {
    if (existingContent[i] === '[') bracketCount++;
    if (existingContent[i] === ']') {
      if (bracketCount === 0) {
        endIdx = i + 2; // includes ];
        break;
      }
      bracketCount--;
    }
  }

  if (endIdx === -1) {
    throw new Error('Cannot find the end marker of GITHUB_COPILOT_MODELS array');
  }

  const newContent = existingContent.substring(0, startIdx) +
    `${startMarker}\n${modelsTs}\n${endMarker}` +
    existingContent.substring(endIdx);

  fs.writeFileSync(OUTPUT_FILE, newContent, 'utf8');
  console.log(`✅ Updated ${OUTPUT_FILE}`);
  console.log(`📊 Synced ${models.length} models in total`);

  // List model IDs
  const modelIds = models.map(m => m.id);
  console.log('\n📋 Model ID list:');
  modelIds.forEach(id => console.log(`   - ${id}`));
}

main();
