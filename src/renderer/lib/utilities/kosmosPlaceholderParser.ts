/**
 * KOSMOS placeholder parsing utility functions (Renderer side)
 * 
 * Used to detect and replace @KOSMOS_ placeholder variables in the renderer process.
 * Actual value computation is done in the main process.
 * 
 * Placeholder format: @KOSMOS_[NAME]
 * - Starts with @KOSMOS_
 * - Composed of uppercase letters, underscores, and digits
 * 
 * Example:
 * @KOSMOS_PROFILE_WORKSPACES_FOLDER -> {KOSMOS app user data folder}/profiles/{alias}/chat_workspaces
 */

/**
 * KOSMOS placeholder regular expression
 * Match format: @KOSMOS_[A-Z0-9_]+
 */
export const KOSMOS_PLACEHOLDER_REGEX = /@KOSMOS_[A-Z0-9_]+/g;

/**
 * Check if a string contains KOSMOS placeholders
 */
export function containsKosmosPlaceholder(value: string): boolean {
  if (typeof value !== 'string') return false;
  // Reset regex lastIndex
  KOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
  return KOSMOS_PLACEHOLDER_REGEX.test(value);
}

/**
 * Check if any values in an object contain KOSMOS placeholders
 */
export function hasKosmosPlaceholdersInObject(obj: Record<string, any>): boolean {
  if (!obj || typeof obj !== 'object') return false;
  
  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && containsKosmosPlaceholder(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Get all KOSMOS placeholders in a string
 */
export function extractKosmosPlaceholders(value: string): string[] {
  if (typeof value !== 'string') return [];
  // Reset regex lastIndex
  KOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
  const matches = value.match(KOSMOS_PLACEHOLDER_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Replace KOSMOS placeholders by calling the main process via IPC
 * @param envObj env object containing placeholders
 * @returns Replaced env object, or the original object if the call fails
 */
export async function replaceKosmosPlaceholders(
  envObj: Record<string, string>
): Promise<Record<string, string>> {
  try {
    if (!window.electronAPI?.kosmos?.replacePlaceholders) {
      console.warn('[KosmosPlaceholderParser] KOSMOS placeholder API not available');
      return envObj;
    }
    
    const result = await window.electronAPI.kosmos.replacePlaceholders(envObj);
    
    if (result.success && result.data) {
      return result.data;
    } else {
      console.error('[KosmosPlaceholderParser] Failed to replace placeholders:', result.error);
      return envObj;
    }
  } catch (error) {
    console.error('[KosmosPlaceholderParser] Error replacing placeholders:', error);
    return envObj;
  }
}
