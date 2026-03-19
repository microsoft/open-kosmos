/**
 * Utility functions for parsing user input variables
 * Supports parsing variables in @USER_INPUT_ format
 *
 * Format: @USER_INPUT_[STRING|INT|DOUBLE|BOOLEAN]_[FOLDER|EMAIL|NORMAL]_[REQUIRED|OPTIONAL]_{KEYNAME}
 *
 * Format description:
 * - TYPE: STRING | INT | DOUBLE | BOOLEAN - Data type
 * - SUBTYPE: FOLDER | EMAIL | NORMAL - Input type
 *   - FOLDER: Folder selector
 *   - EMAIL: Automatically generates email from current user alias
 *   - NORMAL: Normal text input
 * - REQUIRED | OPTIONAL: Whether the field is required
 * - KEYNAME: Variable name
 *
 * Note: INT, DOUBLE, BOOLEAN types can only be used with NORMAL subtype
 */

export interface UserInputVariable {
  key: string;
  type: 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN';
  inputType: 'FOLDER' | 'EMAIL' | 'NORMAL';
  variableName: string;
  originalValue: string;
  isRequired: boolean;
}

export interface ParsedUserInputs {
  variables: UserInputVariable[];
  hasUserInputs: boolean;
}

/**
 * Parse @USER_INPUT_ variable format
 * Format: @USER_INPUT_[STRING|INT|DOUBLE|BOOLEAN]_[FOLDER|EMAIL|NORMAL]_[REQUIRED|OPTIONAL]_{KEYNAME}
 */
export const parseUserInputVariables = (env: Record<string, string>): ParsedUserInputs => {
  const variables: UserInputVariable[] = [];
  
  if (!env || typeof env !== 'object') {
    return { variables: [], hasUserInputs: false };
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.startsWith('@USER_INPUT_')) {
      const parsed = parseUserInputVariable(key, value);
      if (parsed) {
        variables.push(parsed);
      }
    }
  }

  return {
    variables,
    hasUserInputs: variables.length > 0
  };
};

/**
 * Parse a single @USER_INPUT_ variable
 * Format: @USER_INPUT_[TYPE]_[INPUT_TYPE]_[REQUIRED|OPTIONAL]_{VARIABLE_NAME}
 */
export const parseUserInputVariable = (key: string, value: string): UserInputVariable | null => {
  // Match format: @USER_INPUT_[TYPE]_[INPUT_TYPE]_[REQUIRED|OPTIONAL]_{VARIABLE_NAME}
  const match = value.match(/^@USER_INPUT_([A-Z]+)_([A-Z]+)_(REQUIRED|OPTIONAL)_(.+)$/);
  
  if (!match) {
    console.warn(`Invalid user input variable format: ${value}. Expected format: @USER_INPUT_[TYPE]_[SUBTYPE]_[REQUIRED|OPTIONAL]_{KEYNAME}`);
    return null;
  }
  
  const [, typeStr, inputTypeStr, requiredStr, variableName] = match;
  return validateAndCreateVariable(key, value, typeStr, inputTypeStr, variableName, requiredStr === 'REQUIRED');
};

/**
 * Validate and create UserInputVariable object
 */
const validateAndCreateVariable = (
  key: string,
  originalValue: string,
  typeStr: string,
  inputTypeStr: string,
  variableName: string,
  isRequired: boolean
): UserInputVariable | null => {
  // Validate type
  const validTypes = ['STRING', 'INT', 'DOUBLE', 'BOOLEAN'];
  if (!validTypes.includes(typeStr)) {
    console.warn(`Invalid type in user input variable: ${typeStr}`);
    return null;
  }

  const validInputTypes = ['FOLDER', 'EMAIL', 'NORMAL'];
  if (!validInputTypes.includes(inputTypeStr)) {
    console.warn(`Invalid input type in user input variable: ${inputTypeStr}`);
    return null;
  }

  // Validate input type combination: INT, DOUBLE, BOOLEAN can only be NORMAL
  if ((typeStr === 'INT' || typeStr === 'DOUBLE' || typeStr === 'BOOLEAN') && inputTypeStr !== 'NORMAL') {
    console.warn(`Type ${typeStr} can only be used with NORMAL input type, got ${inputTypeStr}`);
    return null;
  }

  return {
    key,
    type: typeStr as 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN',
    inputType: inputTypeStr as 'FOLDER' | 'EMAIL' | 'NORMAL',
    variableName,
    originalValue,
    isRequired
  };
};

/**
 * Convert user input value to the correct type
 */
export const convertUserInputValue = (value: string, type: UserInputVariable['type']): any => {
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
};

/**
 * Generate user email address (based on alias)
 */
export const generateUserEmail = (alias: string): string => {
  // If alias already contains _microsoft suffix, generate email directly
  if (alias.endsWith('_microsoft')) {
    const username = alias.replace('_microsoft', '');
    return `${username}@microsoft.com`;
  }
  
  // Otherwise add suffix then generate email
  return `${alias}@microsoft.com`;
};

/**
 * Validate user input value
 */
export const validateUserInputValue = (value: string, variable: UserInputVariable): { isValid: boolean; error?: string } => {
  if (!value && variable.isRequired) {
    return { isValid: false, error: 'This field is required' };
  }

  if (!value) {
    return { isValid: true };
  }

  try {
    // Try converting the value to validate
    convertUserInputValue(value, variable.type);
    return { isValid: true };
  } catch (error) {
    return { 
      isValid: false, 
      error: error instanceof Error ? error.message : 'Invalid value' 
    };
  }
};

/**
 * Apply user inputs to environment variables
 */
export const applyUserInputsToEnv = (
  originalEnv: Record<string, string>,
  userInputs: Record<string, any>
): Record<string, string> => {
  const result = { ...originalEnv };
  
  // 1. Apply user inputs
  for (const [key, value] of Object.entries(userInputs)) {
    if (key in result) {
      // Convert user input to string (env variables must be strings)
      result[key] = String(value);
    }
  }
  
  // 2. Handle remaining placeholders: Remove optional variables that have no input
  for (const key of Object.keys(result)) {
    const value = result[key];
    // Check if it's still a placeholder
    if (typeof value === 'string' && value.startsWith('@USER_INPUT_')) {
      // Attempt to parse
      const variable = parseUserInputVariable(key, value);
      
      if (variable && !variable.isRequired) {
        // If it's Optional and still a placeholder (meaning no user input overwrote it), remove the env variable
        delete result[key];
      }
    }
  }
  
  return result;
};