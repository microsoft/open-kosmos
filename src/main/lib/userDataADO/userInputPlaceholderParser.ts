import { createLogger } from '../unifiedLogger';
const logger = createLogger();

/**
 * User Input Placeholder Parser
 *
 * Parses @USER_INPUT_ placeholder variables from arbitrary JSON config objects.
 * Recursively traverses the object tree and extracts InputFields[].
 *
 * Placeholder format: @USER_INPUT_[TYPE]_[CONTROL]_[REQUIRED|OPTIONAL]_{KEYNAME}
 * With default value: @USER_INPUT_[TYPE]_[CONTROL]_[REQUIRED|OPTIONAL]_{KEYNAME=DEFAULT_VALUE}
 *
 * - TYPE: STRING | INT | DOUBLE | BOOLEAN - data type
 * - CONTROL: FOLDER | FILE | TEXT - input control
 *   - FOLDER: folder picker
 *   - FILE: file picker
 *   - TEXT: plain text input
 * - REQUIRED | OPTIONAL: whether the field is required
 * - KEYNAME: variable name
 *
 * Note: INT, DOUBLE, BOOLEAN types can only be used with TEXT control
 */

/**
 * User input field definition
 */
export interface UserInputField {
  /** JSON object key */
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
 * User input placeholder regex
 * Matches: @USER_INPUT_[TYPE]_[CONTROL]_[REQUIRED|OPTIONAL]_{KEYNAME}
 */
const USER_INPUT_PLACEHOLDER_REGEX = /^@USER_INPUT_([A-Z]+)_([A-Z]+)_(REQUIRED|OPTIONAL)_(.+)$/;

/**
 * Valid data types
 */
const VALID_TYPES = ['STRING', 'INT', 'DOUBLE', 'BOOLEAN'] as const;

/**
 * Valid input controls
 */
const VALID_CONTROLS = ['FOLDER', 'FILE', 'TEXT'] as const;

/**
 * User Input Placeholder Parser class
 * Parses @USER_INPUT_ placeholder variables from arbitrary JSON configs
 */
export class UserInputPlaceholderParser {
  private static instance: UserInputPlaceholderParser;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): UserInputPlaceholderParser {
    if (!UserInputPlaceholderParser.instance) {
      UserInputPlaceholderParser.instance = new UserInputPlaceholderParser();
    }
    return UserInputPlaceholderParser.instance;
  }

  /**
   * Check whether a value is a USER_INPUT placeholder
   * @param value The value to check
   */
  isUserInputPlaceholder(value: string): boolean {
    return typeof value === 'string' && value.startsWith('@USER_INPUT_');
  }

  /**
   * Parse a single placeholder variable
   * @param key The env/config key
   * @param value The placeholder value
   * @returns Parsed field, or null if the format is invalid
   */
  parseSinglePlaceholder(key: string, value: string): UserInputField | null {
    if (!this.isUserInputPlaceholder(value)) {
      return null;
    }

    const match = value.match(USER_INPUT_PLACEHOLDER_REGEX);
    if (!match) {
      logger.warn(`[UserInputPlaceholderParser] Invalid placeholder format: ${value}. Expected: @USER_INPUT_[TYPE]_[CONTROL]_[REQUIRED|OPTIONAL]_{KEYNAME}`);
      return null;
    }

    const [, typeStr, controlStr, requiredStr, varName] = match;

    // Validate type
    if (!VALID_TYPES.includes(typeStr as any)) {
      logger.warn(`[UserInputPlaceholderParser] Invalid type: ${typeStr}. Valid types: ${VALID_TYPES.join(', ')}`);
      return null;
    }

    // Validate control
    if (!VALID_CONTROLS.includes(controlStr as any)) {
      logger.warn(`[UserInputPlaceholderParser] Invalid control: ${controlStr}. Valid controls: ${VALID_CONTROLS.join(', ')}`);
      return null;
    }

    // Validate type+control combination: INT, DOUBLE, BOOLEAN only work with TEXT
    if ((typeStr === 'INT' || typeStr === 'DOUBLE' || typeStr === 'BOOLEAN') && controlStr !== 'TEXT') {
      logger.warn(`[UserInputPlaceholderParser] Type ${typeStr} can only be used with TEXT control, got ${controlStr}`);
      return null;
    }

    const type = typeStr as UserInputField['type'];
    const control = controlStr.toLowerCase() as UserInputField['control'];
    const isRequired = requiredStr === 'REQUIRED';

    // Extract default value from {KEYNAME=default} or KEYNAME=default syntax
    let actualVarName = varName;
    let defaultValue: string | undefined;
    const braceMatch = varName.match(/^\{(.+)\}$/);
    const inner = braceMatch ? braceMatch[1] : varName;
    const eqIndex = inner.indexOf('=');
    if (eqIndex !== -1) {
      const nameOnly = inner.substring(0, eqIndex);
      defaultValue = inner.substring(eqIndex + 1);
      actualVarName = braceMatch ? `{${nameOnly}}` : nameOnly;
    }

    return {
      key,
      originalValue: value,
      type,
      control,
      varName: actualVarName,
      isRequired,
      label: this.generateFieldLabel(type, control, actualVarName, isRequired),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  }

  /**
   * Generate a human-readable field label
   * @param type Data type
   * @param control Input control
   * @param varName Variable name
   * @param isRequired Whether the field is required
   */
  private generateFieldLabel(
    type: UserInputField['type'],
    control: UserInputField['control'],
    varName: string,
    isRequired: boolean
  ): string {
    // Convert variable name to readable format (underscores to spaces, capitalize first letters)
    const readableName = varName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    // Add control-specific hints
    let typeHint = '';
    switch (control) {
      case 'folder':
        typeHint = ' (Select folder)';
        break;
      case 'file':
        typeHint = ' (Select file)';
        break;
      default:
        // For text control, add type hint for non-string types
        if (type !== 'STRING') {
          typeHint = ` (${type.toLowerCase()})`;
        }
    }

    const requiredHint = isRequired ? '' : ' (optional)';

    return `${readableName}${typeHint}${requiredHint}`;
  }

  /**
   * Recursively traverse a JSON object, extracting all USER_INPUT placeholder fields
   * @param obj Any JSON object
   * @param parentKey Parent key name (for nested objects)
   * @returns Extracted field list
   */
  private traverseAndParse(
    obj: any,
    parentKey?: string
  ): UserInputField[] {
    const fields: UserInputField[] = [];

    if (obj === null || obj === undefined) {
      return fields;
    }

    if (typeof obj === 'string') {
      // If it's a string and a placeholder, parse it
      if (this.isUserInputPlaceholder(obj) && parentKey) {
        const field = this.parseSinglePlaceholder(parentKey, obj);
        if (field) {
          fields.push(field);
        }
      }
    } else if (Array.isArray(obj)) {
      // Traverse array
      obj.forEach((item, index) => {
        fields.push(...this.traverseAndParse(item, `${parentKey || ''}[${index}]`));
      });
    } else if (typeof obj === 'object') {
      // Traverse all key-value pairs
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && this.isUserInputPlaceholder(value)) {
          const field = this.parseSinglePlaceholder(key, value);
          if (field) {
            fields.push(field);
          }
        } else {
          // Recursively process nested objects/arrays
          fields.push(...this.traverseAndParse(value, key));
        }
      }
    }

    return fields;
  }

  /**
   * Parse an arbitrary JSON config object, extracting all USER_INPUT placeholder fields.
   * Recursively traverses the entire object tree to find placeholders.
   *
   * @param config Any config object or JSON string
   * @returns Parse result
   */
  parseConfig(config: any): ParseUserInputResult {
    let configData: any;

    // Handle JSON string input
    if (typeof config === 'string') {
      try {
        configData = JSON.parse(config);
      } catch {
        return { fields: [], hasUserInputFields: false };
      }
    } else if (typeof config === 'object') {
      configData = config;
    } else {
      return { fields: [], hasUserInputFields: false };
    }

    const fields = this.traverseAndParse(configData);

    return {
      fields,
      hasUserInputFields: fields.length > 0
    };
  }

}

// Export singleton instance
export const userInputPlaceholderParser = UserInputPlaceholderParser.getInstance();
