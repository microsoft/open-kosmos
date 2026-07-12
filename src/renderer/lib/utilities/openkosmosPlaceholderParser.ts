import { createLogger } from './logger';
const logger = createLogger('[OpenKosmosPlaceholderParser]');

/**
 * OpenKosmos placeholder parsing utility (renderer side)
 *
 * Used in the renderer process to detect and replace @OPENKOSMOS_ placeholder variables.
 * Actual value computation is performed in the main process.
 *
 * Placeholder format: @OPENKOSMOS_[NAME]
 * - Must start with @OPENKOSMOS_
 * - Composed of uppercase letters, underscores, and digits
 *
 * Example:
 * @OPENKOSMOS_PROFILE_WORKSPACES_FOLDER -> {OpenKosmos app user data folder}/profiles/{alias}/chat_workspaces
 */

/**
 * OpenKosmos placeholder regular expression
 * Matches format: @OPENKOSMOS_[A-Z0-9_]+
 */
export const OPENKOSMOS_PLACEHOLDER_REGEX = /@OPENKOSMOS_[A-Z0-9_]+/g;

/**
 * Check whether a string contains OpenKosmos placeholders
 */
export function containsOpenKosmosPlaceholder(value: string): boolean {
  if (typeof value !== 'string') return false;
  // Reset the regex lastIndex
  OPENKOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
  return OPENKOSMOS_PLACEHOLDER_REGEX.test(value);
}

/**
 * Check whether any value in an object contains OpenKosmos placeholders
 */
export function hasOpenKosmosPlaceholdersInObject(obj: Record<string, any>): boolean {
  if (!obj || typeof obj !== 'object') return false;

  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && containsOpenKosmosPlaceholder(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract all OpenKosmos placeholders from a string
 */
export function extractOpenKosmosPlaceholders(value: string): string[] {
  if (typeof value !== 'string') return [];
  // Reset the regex lastIndex
  OPENKOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
  const matches = value.match(OPENKOSMOS_PLACEHOLDER_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Replace OpenKosmos placeholders by calling the main process via IPC
 * @param envObj env object containing placeholders
 * @returns env object with replacements applied; returns original object on failure
 */
export async function replaceOpenKosmosPlaceholders(
  envObj: Record<string, string>
): Promise<Record<string, string>> {
  try {
    if (!window.electronAPI?.openkosmos?.replacePlaceholders) {
      logger.warn('[OpenKosmosPlaceholderParser] OpenKosmos placeholder API not available');
      return envObj;
    }

    const result = await window.electronAPI.openkosmos.replacePlaceholders(envObj);

    if (result.success && result.data) {
      return result.data;
    } else {
      logger.error('[OpenKosmosPlaceholderParser] Failed to replace placeholders:', result.error);
      return envObj;
    }
  } catch (error) {
    logger.error('[OpenKosmosPlaceholderParser] Error replacing placeholders:', error);
    return envObj;
  }
}
