/**
 * User Input Placeholder Parser
 * 
 * Unified handling of @USER_INPUT_ placeholder variable analysis.
 * Takes any JSON config object, recursively traverses to find placeholders, and outputs InputFields[].
 * 
 * Placeholder format: @USER_INPUT_[TYPE]_[SUBTYPE]_[REQUIRED|OPTIONAL]_{KEYNAME}
 * 
 * - TYPE: STRING | INT | DOUBLE | BOOLEAN - data type
 * - SUBTYPE: FOLDER | EMAIL | NORMAL - input type
 *   - FOLDER: folder picker
 *   - EMAIL: auto-generate email from current user alias
 *   - NORMAL: plain text input
 * - REQUIRED | OPTIONAL: whether the field is required
 * - KEYNAME: variable name
 * 
 * Note: INT, DOUBLE, BOOLEAN types can only be used with the NORMAL subtype
 */

/**
 * User input field definition
 */
export interface UserInputField {
  /** Key in the JSON object */
  key: string;
  /** Original placeholder value */
  originalValue: string;
  /** Data type: STRING | INT | DOUBLE | BOOLEAN */
  type: 'STRING' | 'INT' | 'DOUBLE' | 'BOOLEAN';
  /** Input type: FOLDER | EMAIL | NORMAL */
  subtype: 'FOLDER' | 'EMAIL' | 'NORMAL';
  /** Variable name (extracted from the placeholder) */
  varName: string;
  /** Whether the field is required */
  isRequired: boolean;
  /** Field label (for UI display) */
  label: string;
  /** Default value (optional; e.g., EMAIL type auto-fills) */
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
 * User input placeholder regex
 * Matches format: @USER_INPUT_[TYPE]_[SUBTYPE]_[REQUIRED|OPTIONAL]_{KEYNAME}
 */
const USER_INPUT_PLACEHOLDER_REGEX = /^@USER_INPUT_([A-Z]+)_([A-Z]+)_(REQUIRED|OPTIONAL)_(.+)$/;

/**
 * Valid data types
 */
const VALID_TYPES = ['STRING', 'INT', 'DOUBLE', 'BOOLEAN'] as const;

/**
 * Valid input subtypes
 */
const VALID_SUBTYPES = ['FOLDER', 'EMAIL', 'NORMAL'] as const;

/**
 * User Input Placeholder Parser class
 * Responsible for parsing @USER_INPUT_ placeholder variables in any JSON config
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
   * Check if a value is a USER_INPUT placeholder
   * @param value Value to check
   */
  isUserInputPlaceholder(value: string): boolean {
    return typeof value === 'string' && value.startsWith('@USER_INPUT_');
  }
  
  /**
   * Parse a single placeholder variable
   * @param key Environment variable key
   * @param value Placeholder value
   * @returns Parse result, or null if the format is invalid
   */
  parseSinglePlaceholder(key: string, value: string): UserInputField | null {
    if (!this.isUserInputPlaceholder(value)) {
      return null;
    }
    
    const match = value.match(USER_INPUT_PLACEHOLDER_REGEX);
    if (!match) {
      console.warn(`[UserInputPlaceholderParser] Invalid placeholder format: ${value}. Expected: @USER_INPUT_[TYPE]_[SUBTYPE]_[REQUIRED|OPTIONAL]_{KEYNAME}`);
      return null;
    }
    
    const [, typeStr, subtypeStr, requiredStr, varName] = match;
    
    // Validate type
    if (!VALID_TYPES.includes(typeStr as any)) {
      console.warn(`[UserInputPlaceholderParser] Invalid type: ${typeStr}. Valid types: ${VALID_TYPES.join(', ')}`);
      return null;
    }
    
    // Validate subtype
    if (!VALID_SUBTYPES.includes(subtypeStr as any)) {
      console.warn(`[UserInputPlaceholderParser] Invalid subtype: ${subtypeStr}. Valid subtypes: ${VALID_SUBTYPES.join(', ')}`);
      return null;
    }
    
    // Validate type and subtype combination: INT, DOUBLE, BOOLEAN can only be used with NORMAL
    if ((typeStr === 'INT' || typeStr === 'DOUBLE' || typeStr === 'BOOLEAN') && subtypeStr !== 'NORMAL') {
      console.warn(`[UserInputPlaceholderParser] Type ${typeStr} can only be used with NORMAL subtype, got ${subtypeStr}`);
      return null;
    }
    
    const type = typeStr as UserInputField['type'];
    const subtype = subtypeStr as UserInputField['subtype'];
    const isRequired = requiredStr === 'REQUIRED';
    
    return {
      key,
      originalValue: value,
      type,
      subtype,
      varName,
      isRequired,
      label: this.generateFieldLabel(type, subtype, varName, isRequired)
    };
  }
  
  /**
   * Generate field label
   * @param type Data type
   * @param subtype Input subtype
   * @param varName Variable name
   * @param isRequired Whether the field is required
   */
  private generateFieldLabel(
    type: UserInputField['type'],
    subtype: UserInputField['subtype'],
    varName: string,
    isRequired: boolean
  ): string {
    // Convert variable name to readable format (underscores to spaces, capitalize first letter)
    const readableName = varName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    // Add specific hints based on subtype
    let typeHint = '';
    switch (subtype) {
      case 'FOLDER':
        typeHint = ' (Select folder)';
        break;
      case 'EMAIL':
        typeHint = ' (Email)';
        break;
      default:
        // For NORMAL type, add hints based on data type
        if (type !== 'STRING') {
          typeHint = ` (${type.toLowerCase()})`;
        }
    }
    
    const requiredHint = isRequired ? '' : ' (optional)';
    
    return `${readableName}${typeHint}${requiredHint}`;
  }

  /**
   * Recursively traverse any JSON object to extract all USER_INPUT placeholder fields
   * @param obj Any JSON object
   * @param context Context information (optional)
   * @param parentKey Parent key name (for nested objects)
   * @returns List of parsed fields
   */
  private traverseAndParse(
    obj: any, 
    context?: { currentUserAlias?: string },
    parentKey?: string
  ): UserInputField[] {
    const fields: UserInputField[] = [];
    
    if (obj === null || obj === undefined) {
      return fields;
    }
    
    if (typeof obj === 'string') {
      // If it's a string and is a placeholder, parse it
      if (this.isUserInputPlaceholder(obj) && parentKey) {
        const field = this.parseSinglePlaceholder(parentKey, obj);
        if (field) {
          if (field.subtype === 'EMAIL' && context?.currentUserAlias) {
            field.defaultValue = this.generateUserEmail(context.currentUserAlias);
          }
          fields.push(field);
        }
      }
    } else if (Array.isArray(obj)) {
      // Traverse array
      obj.forEach((item, index) => {
        fields.push(...this.traverseAndParse(item, context, `${parentKey || ''}[${index}]`));
      });
    } else if (typeof obj === 'object') {
      // Traverse all key-value pairs of the object
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && this.isUserInputPlaceholder(value)) {
          const field = this.parseSinglePlaceholder(key, value);
          if (field) {
            if (field.subtype === 'EMAIL' && context?.currentUserAlias) {
              field.defaultValue = this.generateUserEmail(context.currentUserAlias);
            }
            fields.push(field);
          }
        } else {
          // Recursively handle nested objects/arrays
          fields.push(...this.traverseAndParse(value, context, key));
        }
      }
    }
    
    return fields;
  }
  
  /**
   * Parse any JSON config object to extract all USER_INPUT placeholder fields
   * Recursively traverses the entire object tree to find placeholders
   * 
   * @param config Any config object or JSON string
   * @param context Context information (optional)
   * @returns Parse result
   */
  parseConfig(config: any, context?: { currentUserAlias?: string }): ParseUserInputResult {
    let configData: any;
    
    // Handle JSON string
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
    
    const fields = this.traverseAndParse(configData, context);
    
    return {
      fields,
      hasUserInputFields: fields.length > 0
    };
  }
  
  /**
   * Generate user email address (based on alias)
   * @param alias User alias
   */
  generateUserEmail(alias: string): string {
    if (!alias) return '';
    
    // If alias already contains _microsoft suffix, remove it before generating email
    const emailPrefix = alias.replace(/_microsoft$/i, '');
    return `${emailPrefix}@microsoft.com`;
  }
}

// Export singleton instance
export const userInputPlaceholderParser = UserInputPlaceholderParser.getInstance();
