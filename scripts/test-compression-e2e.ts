#!/usr/bin/env bun
/**
 * E2E Compression Test Script
 *
 * Calls the GitHub Copilot API (claude-haiku-4.5) and runs through the full compression flow,
 * verifying summaryPromptTokenBudget=100K + MAX_TOKENS=16000 + o200k_base behavior against the real API.
 *
 * Usage:
 *   bun scripts/test-compression-e2e.ts
 *
 * Tokens are read from a local auth.json file and are never written into code.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getEncoding } from 'js-tiktoken';

// ============================================================
// 0. Initialize o200k_base tokenizer (aligned with Haiku 4.5's actual tokenizer)
// ============================================================

const encoder = getEncoding('o200k_base');

function countTokens(text: string): number {
  return encoder.encode(text).length;
}

// ============================================================
// 1. Read Copilot token (from local auth.json)
// ============================================================

const BRAND_DIRS = ['openkosmos-app', 'Electron'];

function discoverAuthPaths(): string[] {
  const paths: string[] = [];

  // Allow explicit override via env var
  const envPath = process.env.COPILOT_AUTH_JSON;
  if (envPath) return [envPath];

  const platform = process.platform;
  let appDataBase: string;

  if (platform === 'darwin') {
    appDataBase = join(homedir(), 'Library/Application Support');
  } else if (platform === 'win32') {
    appDataBase = process.env.APPDATA || join(homedir(), 'AppData/Roaming');
  } else {
    appDataBase = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  }

  for (const brand of BRAND_DIRS) {
    const profilesDir = join(appDataBase, brand, 'profiles');
    try {
      const { readdirSync } = require('fs');
      for (const profile of readdirSync(profilesDir)) {
        paths.push(join(profilesDir, profile, 'auth.json'));
      }
    } catch { /* dir doesn't exist */ }
  }

  return paths;
}

function loadCopilotToken(): string {
  const authPaths = discoverAuthPaths();
  if (authPaths.length === 0) {
    throw new Error(
      'No auth paths found. Set COPILOT_AUTH_JSON env var or ensure a brand profile exists under the app data directory.'
    );
  }
  for (const p of authPaths) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      const token = data?.ghcAuth?.copilotTokens?.token;
      if (token) {
        console.log(`✅ Loaded token from: ${p}`);
        return token;
      }
    } catch { /* try next */ }
  }
  throw new Error(`Cannot find copilot token in any of: ${authPaths.join(', ')}`);
}

// ============================================================
// 2. GHC API call
// ============================================================

const API_ENDPOINT = 'https://api.githubcopilot.com';
const MODEL = 'claude-haiku-4.5';
const MAX_TOKENS = 16000;
const TEMPERATURE = 0.3;

interface ApiResponse {
  choices: Array<{
    message: { content: string };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function callHaiku(
  token: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = MAX_TOKENS
): Promise<{ content: string; usage?: ApiResponse['usage'] }> {
  const response = await fetch(`${API_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'Editor-Version': 'vscode/1.99.3',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: TEMPERATURE,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const result: ApiResponse = await response.json() as ApiResponse;
  const content = result.choices?.[0]?.message?.content || '';
  return { content, usage: result.usage };
}

// ============================================================
// 3. Build test data (simulating a real long conversation)
// ============================================================

function generateFakeConversation(targetTokens: number): string {
  // Simulate a typical coding conversation: code, tool call results, discussion, etc.
  const segments = [
    // User question
    `**user**: I need to refactor the authentication module in our Electron app. The current implementation has a race condition where the token refresh can overlap with active API calls.\n`,
    // Assistant reply + tool call
    `**assistant**: Let me analyze the auth module. [Tool calls: read_file]\n`,
    // Tool result (simulating a large file read)
    `**tool**: [Structured compression: read_file]\nfile=src/main/lib/auth/authManager.ts\nrange=1-250\ntotalLines=450\ncontentPreview=export class MainAuthManager {\n  private tokenRefreshPromise: Promise<void> | null = null;\n  private activeRequests = new Set<string>();\n  \n  async getToken(): Promise<string> {\n    if (this.isTokenExpired()) {\n      await this.refreshToken();\n    }\n    return this.currentToken;\n  }\n  \n  private async refreshToken(): Promise<void> {\n    // BUG: No mutex — multiple calls can trigger parallel refreshes\n    const response = await fetch(this.tokenEndpoint, {\n      method: 'POST',\n      body: JSON.stringify({ refresh_token: this.refreshToken })\n    });\n    this.currentToken = await response.json();\n  }\n}\n[Compressed for summary generation; originalLength=12500; role=tool; name=read_file]\n`,
    // Assistant analysis
    `**assistant**: I can see the race condition. The \`refreshToken()\` method has no concurrency guard. Here's my analysis:\n\n1. **Problem**: When token expires, multiple concurrent \`getToken()\` calls all evaluate \`isTokenExpired()\` as true simultaneously\n2. **Each call** triggers its own \`refreshToken()\`, causing parallel token endpoint hits\n3. **Result**: Token could be refreshed multiple times, wasting API calls and potentially causing auth state inconsistency\n\n**Proposed fix**: Use a promise-based mutex pattern:\n\`\`\`typescript\nasync getToken(): Promise<string> {\n  if (this.isTokenExpired()) {\n    if (!this.tokenRefreshPromise) {\n      this.tokenRefreshPromise = this.refreshToken()\n        .finally(() => { this.tokenRefreshPromise = null; });\n    }\n    await this.tokenRefreshPromise;\n  }\n  return this.currentToken;\n}\n\`\`\`\n\nShall I implement this fix? [Tool calls: execute_command]\n`,
    // Command execution result
    `**tool**: [Structured compression: command_output]\ncommand=git log --oneline -5\nexitCode=0\noutputPreview=a3f2b1c fix: token refresh race in auth module\n8d4e5f2 feat: add MCP browser automation\nc7b8a9d refactor: split agent chat into services\n1e2f3g4 docs: update ai.prompt.md for compression\n5h6i7j8 chore: bump electron to v35\n[Compressed for summary generation; originalLength=890; role=tool; name=execute_command]\n`,
    // More discussion
    `**user**: Yes, implement the fix. Also check if there are similar patterns in the MCP runtime token handling.\n`,
    `**assistant**: I'll fix the auth module and check MCP runtime. [Tool calls: read_file, search]\n`,
    // Search results
    `**tool**: [Structured compression: search]\nresultCount=3\ntopResults=1. src/main/lib/mcpRuntime/mcpAuth.ts :: similar pattern at line 45 | 2. src/main/lib/llm/ghcModelApi.ts :: getSessionFromAuthManager at line 87 | 3. src/main/lib/subAgent/subAgentChat.ts :: token reuse at line 120\n[Compressed for summary generation; originalLength=4500; role=tool; name=semantic_search]\n`,
    `**assistant**: Found 3 similar patterns. Let me fix them all:\n\n1. **authManager.ts** — Primary fix (promise mutex)\n2. **mcpAuth.ts** — Same race, same fix needed\n3. **ghcModelApi.ts** — Uses authManager internally, will benefit from fix #1\n\nImplementing now...\n`,
    // Web fetch result
    `**tool**: [Structured compression: fetch_web_content]\ntitle=Electron IPC Best Practices\nurl=https://www.electronjs.org/docs/latest/tutorial/ipc\ncontentPreview=Inter-Process Communication (IPC) is the backbone of Electron apps. The main process and renderer communicate via ipcMain and ipcRenderer channels. Best practices include: 1) Always validate IPC inputs 2) Use invoke/handle for request-response patterns 3) Avoid sending large objects...\n[Compressed for summary generation; originalLength=8900; role=tool; name=fetch_web_content]\n`,
  ];

  // Concatenate segments until the target token count is reached (incremental count avoids re-encoding the whole text each time)
  let conversation = '';
  let currentTokens = 0;
  let iteration = 0;
  while (currentTokens < targetTokens) {
    iteration++;
    for (const seg of segments) {
      const chunk = seg.replace(/authManager/g, `authManager_v${iteration}`);
      const chunkTokens = countTokens(chunk);
      conversation += chunk;
      currentTokens += chunkTokens;
      if (currentTokens >= targetTokens) break;
    }
  }
  return conversation;
}

// ============================================================
// 4. Compression system prompt (aligned with contextCompressionLlmSummarizer.ts)
// ============================================================

const SYSTEM_PROMPT = `You are a specialized conversation compression summarizer for a desktop AI coding assistant.

Your task is to compress prior conversation history into a continuation-safe handoff summary.

Rules:
- Preserve concrete technical facts, active tasks, decisions, constraints, and unresolved work.
- Preserve exact identifiers when they matter: file paths, symbol names, commands, URLs, model names, error messages, IDs, hashes, ports, and configuration values.
- Keep the summary dense, factual, and execution-oriented.
- Do not invent facts.
Return only the requested summary.`;

const SUMMARY_TEMPLATE = `Generate an 8-section structured handoff summary:

1. **Conversation Overview** - Main goal and context
2. **Technical Foundation** - Tech stack and frameworks involved
3. **Codebase Status** - Current code state and structure
4. **Problem Resolution** - Problems encountered and solutions
5. **Progress Tracking** - Completed and in-progress work
6. **Active Work State** - Current focus
7. **Recent Operations** - Latest actions and results
8. **Continuation Plan** - Next steps and pending items

### Conversation Content to Summarize:
`;

// ============================================================
// 5. Run tests
// ============================================================

interface TestResult {
  name: string;
  inputTokensLocal: number;
  inputTokensApi?: number;
  outputTokensApi?: number;
  summaryLength: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

async function runTest(
  token: string,
  name: string,
  targetInputTokens: number
): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 Test: ${name}`);
  console.log(`   Target input: ~${(targetInputTokens / 1000).toFixed(0)}K tokens`);
  console.log(`${'='.repeat(60)}`);

  const startTime = Date.now();

  try {
    // Generate conversation text
    const conversationText = generateFakeConversation(targetInputTokens);
    const fullPrompt = `${SUMMARY_TEMPLATE}${conversationText}\n\nPlease generate the 8-section structured handoff summary in English.`;
    const localEstimateTokens = countTokens(SYSTEM_PROMPT) + countTokens(fullPrompt);

    console.log(`   Conversation chars: ${conversationText.length.toLocaleString()}`);
    console.log(`   Local token estimate (o200k_base): ~${(localEstimateTokens / 1000).toFixed(1)}K`);
    console.log(`   Calling Haiku...`);

    const { content, usage } = await callHaiku(token, SYSTEM_PROMPT, fullPrompt);

    const durationMs = Date.now() - startTime;

    console.log(`\n   ✅ Success!`);
    console.log(`   ⏱️  Duration: ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   📊 API Usage:`);
    console.log(`      prompt_tokens:     ${usage?.prompt_tokens?.toLocaleString() ?? 'N/A'}`);
    console.log(`      completion_tokens: ${usage?.completion_tokens?.toLocaleString() ?? 'N/A'}`);
    console.log(`      total_tokens:      ${usage?.total_tokens?.toLocaleString() ?? 'N/A'}`);
    console.log(`   📝 Summary length: ${content.length} chars`);

    if (usage?.prompt_tokens && localEstimateTokens > 0) {
      const drift = ((usage.prompt_tokens - localEstimateTokens) / localEstimateTokens * 100).toFixed(1);
      console.log(`   📐 Token estimation drift: ${drift}% (local ${localEstimateTokens} vs API ${usage.prompt_tokens})`);
    }

    // Print first 500 chars of summary
    console.log(`\n   --- Summary Preview (first 500 chars) ---`);
    console.log(`   ${content.slice(0, 500).replace(/\n/g, '\n   ')}`);

    return {
      name,
      inputTokensLocal: localEstimateTokens,
      inputTokensApi: usage?.prompt_tokens,
      outputTokensApi: usage?.completion_tokens,
      summaryLength: content.length,
      durationMs,
      success: true,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n   ❌ FAILED: ${errMsg.slice(0, 200)}`);
    return {
      name,
      inputTokensLocal: targetInputTokens,
      summaryLength: 0,
      durationMs,
      success: false,
      error: errMsg.slice(0, 300),
    };
  }
}

async function main() {
  console.log('🚀 Compression E2E Test — verifying optimized parameters against real API\n');
  console.log('Config:');
  console.log(`  Model:          ${MODEL}`);
  console.log(`  MAX_TOKENS:     ${MAX_TOKENS}`);
  console.log(`  API Endpoint:   ${API_ENDPOINT}`);
  console.log(`  Budget target:  100K tokens (summaryPromptTokenBudget)`);
  console.log('');

  const token = loadCopilotToken();

  const results: TestResult[] = [];

  // Test 1: Small input (verify basic functionality)
  results.push(await runTest(token, 'Small conversation (~5K tokens)', 5_000));

  // Test 2: Medium input (typical single compression)
  results.push(await runTest(token, 'Medium conversation (~30K tokens)', 30_000));

  // Test 3: Large input (close to 100K budget)
  results.push(await runTest(token, 'Large conversation (~80K tokens)', 80_000));

  // Test 4: Boundary test (near the safe margin of max_prompt_tokens)
  results.push(await runTest(token, 'Near-limit conversation (~100K tokens)', 100_000));

  // ============================================================
  // Final report
  // ============================================================
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('📊 FINAL REPORT');
  console.log(`${'═'.repeat(70)}`);
  console.log('');
  console.log(
    '| Test | Input (local) | Input (API) | Output (API) | Duration | Drift | Status |'
  );
  console.log(
    '|------|--------------|-------------|--------------|----------|-------|--------|'
  );
  for (const r of results) {
    const drift = r.inputTokensApi && r.inputTokensLocal
      ? `${(((r.inputTokensApi - r.inputTokensLocal) / r.inputTokensLocal) * 100).toFixed(0)}%`
      : 'N/A';
    console.log(
      `| ${r.name.slice(0, 35).padEnd(35)} | ${(r.inputTokensLocal / 1000).toFixed(0).padStart(5)}K | ` +
      `${r.inputTokensApi ? (r.inputTokensApi / 1000).toFixed(0).padStart(5) + 'K' : '  N/A '} | ` +
      `${r.outputTokensApi ? (r.outputTokensApi / 1000).toFixed(1).padStart(5) + 'K' : '  N/A '} | ` +
      `${(r.durationMs / 1000).toFixed(1).padStart(5)}s | ` +
      `${drift.padStart(5)} | ${r.success ? '✅' : '❌'} |`
    );
  }

  const allPassed = results.every(r => r.success);
  console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  // Key metric validation
  console.log('\n📐 Key Observations:');
  const largeTest = results.find(r => r.name.includes('80K'));
  if (largeTest?.inputTokensApi && largeTest.inputTokensLocal) {
    const actualDrift = (largeTest.inputTokensApi - largeTest.inputTokensLocal) / largeTest.inputTokensLocal;
    if (Math.abs(actualDrift) < 0.28) {
      console.log(`   ✅ Token drift at 80K: ${(actualDrift * 100).toFixed(1)}% — within 28K safety margin`);
    } else {
      console.log(`   ⚠️  Token drift at 80K: ${(actualDrift * 100).toFixed(1)}% — WARNING: approaches safety margin!`);
    }
  }

  const nearLimitTest = results.find(r => r.name.includes('100K'));
  if (nearLimitTest?.inputTokensApi) {
    if (nearLimitTest.inputTokensApi < 128_000) {
      console.log(`   ✅ 100K test actual prompt: ${nearLimitTest.inputTokensApi.toLocaleString()} — safely below 128K limit`);
    } else {
      console.log(`   ❌ 100K test actual prompt: ${nearLimitTest.inputTokensApi.toLocaleString()} — EXCEEDS 128K limit!`);
    }
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
