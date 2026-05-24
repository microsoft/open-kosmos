/**
 * OpenKosmos Placeholder Variables Manager
 *
 * Manages preset, value computation, and replacement of OpenKosmos variable placeholders.
 *
 * Placeholder format: @OPENKOSMOS_[NAME]
 * - Starts with @OPENKOSMOS_
 * - Composed of uppercase English letters, underscores, and digits
 *
 * Example:
 * @OPENKOSMOS_PROFILE_WORKSPACES_FOLDER -> {OpenKosmos app user data folder}/profiles/{alias}/chat_workspaces
 */

import * as path from 'path';
import * as os from 'os';
import { getUserDataPath } from './pathUtils';
import { createLogger } from '../unifiedLogger';
const logger = createLogger();

/**
 * Enum of OpenKosmos placeholder variable names
 */
export enum OpenKosmosPlaceholder {
  /** Path to the profile's chat_workspaces folder */
  PROFILE_WORKSPACES_FOLDER = '@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER',
}

/**
 * Placeholder type: used to identify the value type returned by a placeholder
 */
export enum PlaceholderType {
  /** File path or folder path */
  PATH = 'PATH',
  /** Plain string */
  STRING = 'STRING',
}

/**
 * Placeholder metadata: contains type information for a placeholder
 */
const PLACEHOLDER_METADATA: Record<string, { type: PlaceholderType }> = {
  [OpenKosmosPlaceholder.PROFILE_WORKSPACES_FOLDER]: { type: PlaceholderType.PATH },
};

/**
 * OpenKosmos placeholder regular expression
 * Match format: @OPENKOSMOS_[A-Z0-9_]+
 */
export const OPENKOSMOS_PLACEHOLDER_REGEX = /@OPENKOSMOS_[A-Z0-9_]+/g;

/**
 * Check whether a string contains OpenKosmos placeholders
 */
export function containsOpenKosmosPlaceholder(value: string): boolean {
  if (typeof value !== 'string') return false;
  return OPENKOSMOS_PLACEHOLDER_REGEX.test(value);
}

/**
 * Get all OpenKosmos placeholders in a string
 */
export function extractOpenKosmosPlaceholders(value: string): string[] {
  if (typeof value !== 'string') return [];
  // Reset the regular expression's lastIndex
  OPENKOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
  const matches = value.match(OPENKOSMOS_PLACEHOLDER_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * OpenKosmos placeholder manager
 * Responsible for parsing and replacing OpenKosmos variable placeholders
 */
export class OpenKosmosPlaceholderManager {
  private static instance: OpenKosmosPlaceholderManager;

  private constructor() {}

  static getInstance(): OpenKosmosPlaceholderManager {
    if (!OpenKosmosPlaceholderManager.instance) {
      OpenKosmosPlaceholderManager.instance = new OpenKosmosPlaceholderManager();
    }
    return OpenKosmosPlaceholderManager.instance;
  }

  /**
   * Get the actual value for a placeholder
   * @param placeholder Placeholder name, e.g., @OPENKOSMOS_PROFILE_WORKSPACES_FOLDER
   * @param context Context information, including required parameters such as alias
   */
  getPlaceholderValue(placeholder: string, context: { alias: string }): string | null {
    if (!context.alias) {
      logger.error('[OpenKosmosPlaceholderManager] Missing required context: alias');
      return null;
    }

    let value: string | null = null;

    switch (placeholder) {
      case OpenKosmosPlaceholder.PROFILE_WORKSPACES_FOLDER:
        value = this.getProfileWorkspacesFolderPath(context.alias);
        break;
      default:
        logger.warn(`[OpenKosmosPlaceholderManager] Unknown placeholder: ${placeholder}`);
        return null;
    }

    // If it's a path type, format for the current platform
    if (value !== null) {
      const metadata = PLACEHOLDER_METADATA[placeholder];
      if (metadata?.type === PlaceholderType.PATH) {
        value = this.formatPathForPlatform(value);
      }
    }

    return value;
  }

  /**
   * Format a path for the current operating system
   * - Windows: use backslash \
   * - Mac/Linux: use forward slash /
   */
  private formatPathForPlatform(filePath: string): string {
    const platform = os.platform();

    if (platform === 'win32') {
      // Windows: replace all forward slashes with backslashes
      return filePath.replace(/\//g, '\\');
    } else {
      // Mac/Linux: replace all backslashes with forward slashes
      return filePath.replace(/\\/g, '/');
    }
  }

  /**
   * Format a full string containing a path.
   * When the string contains a path portion, format the entire string for the current platform.
   * @param value String that may contain a path
   * @param isPath Whether it is a path type
   */
  formatValueForPlatform(value: string, isPath: boolean): string {
    if (!isPath) return value;
    return this.formatPathForPlatform(value);
  }

  /**
   * Get the chat_workspaces folder path for a profile
   * Format: {OpenKosmos app user data folder}/profiles/{alias}/chat_workspaces
   */
  private getProfileWorkspacesFolderPath(alias: string): string {
    const userDataPath = getUserDataPath();
    return path.join(userDataPath, 'profiles', alias, 'chat_workspaces');
  }

  /**
   * Check whether the string contains path-type placeholders
   */
  private containsPathPlaceholder(value: string): boolean {
    OPENKOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
    const matches = value.match(OPENKOSMOS_PLACEHOLDER_REGEX);
    if (!matches) return false;

    return matches.some(placeholder => {
      const metadata = PLACEHOLDER_METADATA[placeholder];
      return metadata?.type === PlaceholderType.PATH;
    });
  }

  /**
   * Replace all OpenKosmos placeholders in a string
   * @param value String containing placeholders
   * @param context Context information
   * @returns The string after replacement
   */
  replacePlaceholders(value: string, context: { alias: string }): string {
    if (typeof value !== 'string') return value;

    // Check whether the string contains path-type placeholders (for formatting the entire string afterwards)
    const hasPathPlaceholder = this.containsPathPlaceholder(value);

    // Reset the regular expression's lastIndex
    OPENKOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;

    let result = value.replace(OPENKOSMOS_PLACEHOLDER_REGEX, (match) => {
      const replacement = this.getPlaceholderValue(match, context);
      if (replacement !== null) {
        return replacement;
      }
      // If no matching value is found, keep the original placeholder
      logger.warn(`[OpenKosmosPlaceholderManager] Could not resolve placeholder: ${match}`);
      return match;
    });

    // If the string contains path-type placeholders, format the entire result string for the current platform path.
    // This handles cases like "@OPENKOSMOS_PROFILE_WORKSPACES_FOLDER/pm-agent"
    if (hasPathPlaceholder) {
      result = this.formatPathForPlatform(result);
    }

    return result;
  }

  /**
   * Replace OpenKosmos placeholders in all values of an object (e.g., env configuration)
   * @param obj Object containing placeholders
   * @param context Context information
   * @returns A new object with replacements applied (does not modify the original object)
   */
  replacePlaceholdersInObject<T extends Record<string, any>>(obj: T, context: { alias: string }): T {
    if (!obj || typeof obj !== 'object') return obj;

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.replacePlaceholders(value, context);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively handle nested objects
        result[key] = this.replacePlaceholdersInObject(value, context);
      } else {
        result[key] = value;
      }
    }

    return result as T;
  }

  /**
   * Get all supported placeholders and their descriptions
   */
  getSupportedPlaceholders(): Array<{ name: string; description: string }> {
    return [
      {
        name: OpenKosmosPlaceholder.PROFILE_WORKSPACES_FOLDER,
        description: 'Path to the profile\'s chat_workspaces folder: {user data}/profiles/{alias}/chat_workspaces'
      },
    ];
  }
}

// Export singleton instance
export const openkosmosPlaceholderManager = OpenKosmosPlaceholderManager.getInstance();
