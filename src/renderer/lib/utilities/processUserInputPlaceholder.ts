import { createLogger } from './logger';
const logger = createLogger('[ProcessUserInputPlaceholder]');

/**
 * Unified USER_INPUT placeholder processing utilities for the renderer.
 *
 * Responsibilities:
 * - Backend: parse only (analyze config, output InputFields[])
 * - Frontend: render form, validate input, replace placeholders
 */

/**
 * User input field definition (mirrors backend UserInputField)
 */
export interface UserInputField {
  /** Environment variable key */
  key: string;
  /** Original placeholder value */
  originalValue: string;
  /** Data type: STRING | INT | DOUBLE | BOOLEAN */
  type: 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN';
  /** Input control: folder | file | text */
  control: 'folder' | 'file' | 'text';
  /** Variable name (extracted from placeholder) */
  varName: string;
  /** Whether the field is required */
  isRequired: boolean;
  /** Field label (for UI display) */
  label: string;
  /** Default value (optional) */
  defaultValue?: string;
}

/**
 * Parse result
 */
export interface ParseUserInputResult {
  /** Parsed field list */
  fields: UserInputField[];
  /** Whether there are fields requiring user input */
  hasUserInputFields: boolean;
}

/**
 * Parse @USER_INPUT_ placeholders in MCP config via backend IPC.
 * Backend only parses and returns InputFields[].
 *
 * @param config MCP config object or object containing env
 * @returns Parse result
 */
export async function parseUserInputPlaceholders(config: any): Promise<ParseUserInputResult> {
  try {
    const result = await window.electronAPI.openkosmos.parseUserInputPlaceholders(config);

    if (!result.success) {
      logger.error('[UserInputPlaceholderParser] Failed to parse:', result.error);
      return { fields: [], hasUserInputFields: false };
    }

    return result.data as ParseUserInputResult;
  } catch (error) {
    logger.error('[UserInputPlaceholderParser] Error calling IPC:', error);
    return { fields: [], hasUserInputFields: false };
  }
}

// ============================================================================
// Frontend responsibilities: validate, convert, replace
// ============================================================================

/**
 * Apply user inputs to env config (replace placeholders)
 *
 * @param originalEnv Original env config
 * @param userInputs User input values { key: value }
 * @param fields Parsed field list
 * @returns Updated env config
 */
export function applyUserInputsToEnv(
  originalEnv: Record<string, string>,
  userInputs: Record<string, any>,
  fields: UserInputField[]
): Record<string, string> {
  const result = { ...originalEnv };

  for (const field of fields) {
    const inputValue = userInputs[field.key];
    const isInputEmpty = inputValue === null || inputValue === undefined || String(inputValue).trim() === '';

    if (!field.isRequired && isInputEmpty) {
      // Optional field with no input -> remove the env var
      delete result[field.key];
    } else if (userInputs.hasOwnProperty(field.key)) {
      // Required field or has input -> update value (env vars must be strings)
      result[field.key] = String(inputValue);
    }
  }

  return result;
}

/**
 * Apply user inputs to URL field (replace placeholders)
 *
 * @param originalUrl Original URL string
 * @param userInputs User input values { key: value }
 * @param fields Parsed field list
 * @returns Updated URL string
 */
export function applyUserInputsToUrl(
  originalUrl: string,
  userInputs: Record<string, any>,
  fields: UserInputField[]
): string {
  if (!originalUrl) return originalUrl;

  let result = originalUrl;

  // Find URL-related fields (key is 'url')
  const urlFields = fields.filter(f => f.key === 'url');

  for (const field of urlFields) {
    const inputValue = userInputs[field.key];
    if (inputValue !== null && inputValue !== undefined) {
      // Replace entire URL (if the URL itself is a placeholder)
      result = String(inputValue);
    }
  }

  return result;
}

/**
 * Apply user inputs to args array (replace placeholders).
 * For optional fields left empty, removes both the --flag and the placeholder value.
 *
 * @param originalArgs Original args array
 * @param userInputs User input values { key: value }
 * @param fields Parsed field list
 * @returns Updated args array
 */
export function applyUserInputsToArgs(
  originalArgs: string[],
  userInputs: Record<string, any>,
  fields: UserInputField[]
): string[] {
  const result: string[] = [];
  for (let i = 0; i < originalArgs.length; i++) {
    const arg = originalArgs[i];
    const field = fields.find(f => f.originalValue === arg);
    if (!field) { result.push(arg); continue; }
    const value = userInputs[field.key];
    const isEmpty = value === null || value === undefined || String(value).trim() === '';
    if (!field.isRequired && isEmpty) {
      // Remove this placeholder AND the preceding --flag if present
      if (result.length > 0 && result[result.length - 1].startsWith('--')) result.pop();
      continue;
    }
    result.push(String(value));
  }
  return result;
}

/**
 * Convert user input value to the correct type
 * @param value User input string value
 * @param type Target type
 */
export function convertUserInputValue(value: string, type: UserInputField['type']): any {
  if (value === null || value === undefined || value === '') {
    return value;
  }

  switch (type) {
    case 'STRING':
      return value;
    case 'INT':
      const intValue = parseInt(value, 10);
      if (isNaN(intValue)) {
        throw new Error(`Invalid integer value: ${value}`);
      }
      return intValue;
    case 'DOUBLE':
      const doubleValue = parseFloat(value);
      if (isNaN(doubleValue)) {
        throw new Error(`Invalid double value: ${value}`);
      }
      return doubleValue;
    case 'BOOLEAN':
      const lowerValue = value.toLowerCase().trim();
      if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
        return true;
      } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
        return false;
      } else {
        throw new Error(`Invalid boolean value: ${value}. Expected: true/false, 1/0, yes/no`);
      }
    default:
      return value;
  }
}

/**
 * Validate user input value
 * @param value User input value
 * @param field Field definition
 */
export function validateUserInputValue(
  value: string,
  field: UserInputField
): { isValid: boolean; error?: string } {
  // Required field check
  if (field.isRequired && (!value || String(value).trim() === '')) {
    return { isValid: false, error: 'This field is required' };
  }

  // Empty value is valid for optional fields
  if (!value || String(value).trim() === '') {
    return { isValid: true };
  }

  // Try type conversion to validate
  try {
    convertUserInputValue(value, field.type);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : /* v8 ignore next */ 'Invalid value'
    };
  }
}
