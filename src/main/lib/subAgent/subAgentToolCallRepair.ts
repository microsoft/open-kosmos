/**
 * subAgentToolCallRepair — Pure tool-call argument repair utilities
 *
 * Extracted from SubAgentChat so they can be unit-tested independently
 * and reused without instantiating the full chat engine.
 *
 * All functions are stateless (no `this` references).
 *
 * File location: src/main/lib/subAgent/subAgentToolCallRepair.ts
 */

import { createConsoleLogger } from '../unifiedLogger';

// Lazy-init logger
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/**
 * Attempt to repair a single tool_call's arguments field
 *
 * Multi-strategy repair:
 * 1. Trim and retry
 * 2. Remove code fences
 * 3. Repair truncated JSON (complete brackets/quotes)
 * 4. Extract the first valid JSON structure
 * 5. Final fallback: return "{}" empty object
 */
export function repairToolCallArguments(tc: any): any {
  const rawArgs = String(tc.function.arguments || '');
  const toolName = tc.function?.name || 'unknown';

  // Strategy 1: trim
  const trimmed = rawArgs.trim();
  try {
    JSON.parse(trimmed);
    getLogger().info?.(
      `[SubAgentChat] Repaired '${toolName}' args via trim`,
      'repairToolCallArguments'
    );
    return { ...tc, function: { ...tc.function, arguments: trimmed } };
  } catch { /* continue */ }

  // Strategy 2: remove code fences ```json ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      getLogger().info?.(
        `[SubAgentChat] Repaired '${toolName}' args by stripping code fence`,
        'repairToolCallArguments'
      );
      return { ...tc, function: { ...tc.function, arguments: inner } };
    } catch { /* continue */ }
  }

  // Strategy 3: repair truncated JSON (try completing brackets)
  const repaired = tryRepairTruncatedJson(trimmed);
  if (repaired) {
    try {
      JSON.parse(repaired);
      getLogger().info?.(
        `[SubAgentChat] Repaired '${toolName}' args by fixing truncated JSON`,
        'repairToolCallArguments'
      );
      return { ...tc, function: { ...tc.function, arguments: repaired } };
    } catch { /* continue */ }
  }

  // Strategy 4: extract the first complete JSON structure
  const extracted = extractFirstJson(trimmed);
  if (extracted) {
    try {
      JSON.parse(extracted);
      getLogger().info?.(
        `[SubAgentChat] Repaired '${toolName}' args by extracting first JSON structure`,
        'repairToolCallArguments'
      );
      return { ...tc, function: { ...tc.function, arguments: extracted } };
    } catch { /* continue */ }
  }

  // Strategy 5: final fallback — use empty object
  getLogger().error?.(
    `[SubAgentChat] Failed to repair tool_call arguments for '${toolName}'. ` +
    `Using empty object as fallback. Raw args: "${rawArgs.substring(0, 500)}"`,
    'repairToolCallArguments'
  );
  return { ...tc, function: { ...tc.function, arguments: '{}' } };
}

/**
 * Attempt to repair truncated JSON (complete missing brackets and quotes)
 */
export function tryRepairTruncatedJson(text: string): string | null {
  if (!text) return null;

  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { stack.push('}'); }
    else if (ch === '[') { stack.push(']'); }
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  if (stack.length === 0 && !inString) return null; // Not truncated

  let repaired = text;
  if (inString) repaired += '"';
  while (stack.length > 0) repaired += stack.pop();

  return repaired;
}

/**
 * Extract the first complete JSON structure from text
 */
export function extractFirstJson(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Detect truncated tool call arguments
 *
 * When finish_reason=length, LLM output was truncated by max_tokens,
 * and tool call arguments may be incomplete (critical fields missing).
 *
 * Detection logic:
 * 1. Count { and }, [ and ] in arguments — mismatch indicates truncation
 * 2. Check for unclosed quotes
 * 3. Try JSON.parse, failure also treated as truncation
 * 4. Even if JSON is valid (repaired by completion), missing expected fields is also treated as truncation
 *    (e.g., write_file missing content field)
 *
 * @returns List of tool_calls determined to be truncated
 */
export function detectTruncatedToolCalls(toolCalls: any[]): any[] {
  const truncated: any[] = [];

  for (const tc of toolCalls) {
    const args = tc?.function?.arguments || '';
    const name = tc?.function?.name || '';

    if (!args || args === '{}') {
      // Empty arguments — likely completely truncated
      if (name) {
        getLogger().warn?.(
          `[SubAgentChat] Tool '${name}' has empty arguments, likely truncated`,
          'detectTruncatedToolCalls'
        );
        truncated.push(tc);
      }
      continue;
    }

    // Strategy 1: Brace/bracket mismatch
    let openBraces = 0, closeBraces = 0;
    let openBrackets = 0, closeBrackets = 0;
    let inString = false, escaped = false;
    let unbalancedQuotes = 0;
    for (let i = 0; i < args.length; i++) {
      const ch = args[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = false; unbalancedQuotes--; }
        continue;
      }
      if (ch === '"') { inString = true; unbalancedQuotes++; continue; }
      if (ch === '{') openBraces++;
      else if (ch === '}') closeBraces++;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') closeBrackets++;
    }

    const braceImbalance = openBraces - closeBraces;
    const bracketImbalance = openBrackets - closeBrackets;

    if (braceImbalance !== 0 || bracketImbalance !== 0 || unbalancedQuotes !== 0) {
      getLogger().warn?.(
        `[SubAgentChat] Tool '${name}' arguments structurally truncated: ` +
        `braces=${openBraces}/${closeBraces}, brackets=${openBrackets}/${closeBrackets}, ` +
        `unbalancedQuotes=${unbalancedQuotes}`,
        'detectTruncatedToolCalls'
      );
      truncated.push(tc);
      continue;
    }

    // Strategy 2: JSON.parse failure
    let parsed: any = null;
    try {
      parsed = JSON.parse(args);
    } catch {
      getLogger().warn?.(
        `[SubAgentChat] Tool '${name}' arguments not valid JSON after repair`,
        'detectTruncatedToolCalls'
      );
      truncated.push(tc);
      continue;
    }

    // Strategy 3: Known tool critical field missing detection
    if (isMissingCriticalFields(name, parsed)) {
      getLogger().warn?.(
        `[SubAgentChat] Tool '${name}' arguments missing critical fields ` +
        `(likely truncated). Parsed keys: [${Object.keys(parsed).join(', ')}]`,
        'detectTruncatedToolCalls'
      );
      truncated.push(tc);
      continue;
    }
  }

  return truncated;
}

/**
 * Detect if known tools are missing critical fields
 *
 * When LLM output is truncated, tool argument JSON may be repair-completed into valid JSON,
 * but still missing critical fields (e.g., write_file missing content).
 */
export function isMissingCriticalFields(toolName: string, parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object') return false;

  // Common tool critical field mappings
  const criticalFieldsMap: Record<string, string[]> = {
    'write_file': ['filePath', 'content'],
    'create_file': ['filePath', 'content'],
    'append_file': ['filePath', 'content'],
    'execute_command': ['command'],
    'web_fetch': ['url'],
    'bing_web_search': ['query'],
  };

  const requiredFields = criticalFieldsMap[toolName];
  if (!requiredFields) return false;

  const missingFields = requiredFields.filter(f => !(f in parsed));
  return missingFields.length > 0;
}
