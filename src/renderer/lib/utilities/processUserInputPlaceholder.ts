/**
 * Unified USER_INPUT placeholder processing utility for the frontend
 * 
 * Responsibility division:
 * - Backend: Only parses (analyzes config, outputs InputFields[])
 * - Frontend: Renders forms, validates input, replaces placeholders
 */

/**
 * User input field definition (consistent with backend UserInputField)
 */
export interface UserInputField {
  /** Environment variable key */
  key: string;
  /** Original placeholder value */
  originalValue: string;
  /** Data type: STRING | INT | DOUBLE | BOOLEAN */
  type: 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN';
  /** Input type: FOLDER | EMAIL | NORMAL */
  subtype: 'FOLDER' | 'EMAIL' | 'NORMAL';
  /** Variable name (extracted from placeholder) */
  varName: string;
  /** Whether the field is required */
  isRequired: boolean;
  /** Field label (for UI display) */
  label: string;
  /** Default value (optional, e.g. EMAIL type will auto-fill) */
  defaultValue?: string;
}

/**
 * Parse result
 */
export interface ParseUserInputResult {
  /** List of parsed fields */
  fields: UserInputField[];
  /** Whether there are fields requiring user input */
  hasUserInputFields: boolean;
}

/**
 * Call backend via IPC to parse @USER_INPUT_ placeholders in MCP config
 * Backend only handles parsing, returns InputFields[]
 * 
 * @param config MCP config object or object containing env
 * @returns Parse result
 */
export async function parseUserInputPlaceholders(config: any): Promise<ParseUserInputResult> {
  try {
    const result = await window.electronAPI.kosmos.parseUserInputPlaceholders(config);
    
    if (!result.success) {
      console.error('[UserInputPlaceholderParser] Failed to parse:', result.error);
      return { fields: [], hasUserInputFields: false };
    }
    
    return result.data as ParseUserInputResult;
  } catch (error) {
    console.error('[UserInputPlaceholderParser] Error calling IPC:', error);
    return { fields: [], hasUserInputFields: false };
  }
}

// ============================================================================
// Below are frontend responsibilities: validation, conversion, replacement
// ============================================================================

/**
 * Apply user inputs to environment variable config (replace placeholders)
 * 
 * @param originalEnv Original environment variable config
 * @param userInputs User input values { key: value }
 * @param fields List of parsed fields
 * @returns Updated environment variable config
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
      // Optional field with no user input -> delete the environment variable
      delete result[field.key];
    } else if (userInputs.hasOwnProperty(field.key)) {
      // Required field or has input value -> update value (env variables must be strings)
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
 * @param fields List of parsed fields
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
      // Replace entire URL (if URL itself is a placeholder)
      result = String(inputValue);
    }
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
      error: error instanceof Error ? error.message : 'Invalid value'
    };
  }
}
