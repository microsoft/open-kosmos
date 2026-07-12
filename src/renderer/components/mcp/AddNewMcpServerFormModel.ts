'use client'

export type McpServerTransport = 'stdio' | 'sse' | 'StreamableHttp'

export interface McpConfigFormatterResponse {
  success: boolean;
  originalFormat?: string;
  transportType?: string;
  serverName?: string;
  nameSource?: string;
  config?: Record<string, any>;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

export interface McpValidationMessages {
  stringRecordObject: (fieldName: string) => string
  stringRecordEntries: (fieldName: string) => string
  serverNameEmpty: string
  serverNameExists: string
  configEmpty: string
  modifyExample: string
  invalidJson: (error: string) => string
  requiredFields: (transport: McpServerTransport, fields: string) => string
  invalidFields: (transport: McpServerTransport, fields: string, allowedFields: string) => string
  commandRequired: string
  argsMustBeArray: string
  argsCannotBeEmpty: string
  argsMustBeStrings: string
  urlRequired: string
}

const defaultValidationMessages: McpValidationMessages = {
  stringRecordObject: (fieldName) => `${fieldName} field must be an object with string key-value pairs`,
  stringRecordEntries: (fieldName) => `All ${fieldName} entries must be string key-value pairs`,
  serverNameEmpty: 'Server name cannot be empty',
  serverNameExists: 'Server name already exists, please use a different name',
  configEmpty: 'MCP configuration cannot be empty',
  modifyExample: 'Please modify the example configuration, cannot use default examples',
  invalidJson: (error) => `Configuration must be valid JSON format. Error: ${error}`,
  requiredFields: (transport, fields) => `${transport} configuration must contain required fields: ${fields}`,
  invalidFields: (transport, fields, allowedFields) => `${transport} configuration contains invalid fields: ${fields}. Only allowed: ${allowedFields}`,
  commandRequired: 'command field must be a non-empty string',
  argsMustBeArray: 'args field must be an array',
  argsCannotBeEmpty: 'args array cannot be empty',
  argsMustBeStrings: 'All elements in args array must be strings',
  urlRequired: 'url field must be a non-empty string',
}

export const cleanInvisibleCharacters = (text: string): string => {
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/\u202F/g, ' ')
    .replace(/\u2060/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\u180E/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\u200C/g, '')
    .replace(/\u200D/g, '')
}

export const generateTimestampServerName = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `mcp-server-${year}${month}${day}${hours}${minutes}${seconds}`
}

export const incrementPatchVersion = (version: string): string => {
  const parts = version.split('.')
  if (parts.length === 3) {
    const patch = parseInt(parts[2], 10)
    if (!isNaN(patch)) {
      return `${parts[0]}.${parts[1]}.${patch + 1}`
    }
  }
  return version
}

const validateStringRecord = (
  value: unknown,
  fieldName: string,
  messages: McpValidationMessages,
): string | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return messages.stringRecordObject(fieldName)
  }
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || typeof entryValue !== 'string') {
      return messages.stringRecordEntries(fieldName)
    }
  }
  return null
}

export const validateServerName = (
  name: string,
  serverNames: string[],
  messages: McpValidationMessages = defaultValidationMessages,
): string | null => {
  const errors: string[] = []

  if (!name.trim()) {
    errors.push(messages.serverNameEmpty)
  }

  if (name.trim() && serverNames.includes(name.trim())) {
    errors.push(messages.serverNameExists)
  }

  return errors.length > 0 ? errors.join('; ') : null
}

export const validateServerConfig = (
  config: string,
  serverType: McpServerTransport,
  messages: McpValidationMessages = defaultValidationMessages,
): string | null => {
  const errors: string[] = []

  if (!config.trim()) {
    errors.push(messages.configEmpty)
    return errors.join('; ')
  }

  const stdioExample = `{
  "command": "python",
  "args": [
    "main.py"
  ],
  "env": {
    "API_KEY": "value"
  }
}`
  const sseExample = `{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "value"
  }
}`

  const normalizedConfig = config.replace(/\s+/g, ' ').trim()
  const normalizedStdioExample = stdioExample.replace(/\s+/g, ' ').trim()
  const normalizedSseExample = sseExample.replace(/\s+/g, ' ').trim()

  if (normalizedConfig === normalizedStdioExample || normalizedConfig === normalizedSseExample) {
    errors.push(messages.modifyExample)
    return errors.join('; ')
  }

  const cleanedConfig = cleanInvisibleCharacters(config)

  let parsedConfig: any
  try {
    parsedConfig = JSON.parse(cleanedConfig)
  } catch (e) {
    errors.push(messages.invalidJson(e instanceof Error ? e.message : 'Unknown error'))
    return errors.join('; ')
  }

  if (serverType === 'stdio') {
    const configKeys = Object.keys(parsedConfig)
    const requiredKeys = ['command', 'args']
    const optionalKeys = ['env']
    const allowedKeys = [...requiredKeys, ...optionalKeys]

    const missingKeys = requiredKeys.filter(key => !configKeys.includes(key))
    if (missingKeys.length > 0) {
      errors.push(messages.requiredFields(serverType, missingKeys.join(', ')))
    }

    const invalidKeys = configKeys.filter(key => !allowedKeys.includes(key))
    if (invalidKeys.length > 0) {
      errors.push(messages.invalidFields(serverType, invalidKeys.join(', '), allowedKeys.join(', ')))
    }

    if (typeof parsedConfig.command !== 'string' || !parsedConfig.command.trim()) {
      errors.push(messages.commandRequired)
    }

    if (!Array.isArray(parsedConfig.args)) {
      errors.push(messages.argsMustBeArray)
    } else if (parsedConfig.args.length === 0) {
      errors.push(messages.argsCannotBeEmpty)
    } else if (!parsedConfig.args.every((arg: any) => typeof arg === 'string')) {
      errors.push(messages.argsMustBeStrings)
    }

    if (parsedConfig.env !== undefined) {
      const envError = validateStringRecord(parsedConfig.env, 'env', messages)
      if (envError) errors.push(envError)
    }
  } else if (serverType === 'sse') {
    const configKeys = Object.keys(parsedConfig)
    const requiredKeys = ['url']
    const optionalKeys = ['env', 'headers']
    const allowedKeys = [...requiredKeys, ...optionalKeys]

    const missingKeys = requiredKeys.filter(key => !configKeys.includes(key))
    if (missingKeys.length > 0) {
      errors.push(messages.requiredFields(serverType, missingKeys.join(', ')))
    }

    const invalidKeys = configKeys.filter(key => !allowedKeys.includes(key))
    if (invalidKeys.length > 0) {
      errors.push(messages.invalidFields(serverType, invalidKeys.join(', '), allowedKeys.join(', ')))
    }

    if (typeof parsedConfig.url !== 'string' || !parsedConfig.url.trim()) {
      errors.push(messages.urlRequired)
    }

    if (parsedConfig.env !== undefined) {
      const envError = validateStringRecord(parsedConfig.env, 'env', messages)
      if (envError) errors.push(envError)
    }

    if (parsedConfig.headers !== undefined) {
      const headersError = validateStringRecord(parsedConfig.headers, 'headers', messages)
      if (headersError) errors.push(headersError)
    }
  } else if (serverType === 'StreamableHttp') {
    const configKeys = Object.keys(parsedConfig)
    const requiredKeys = ['url']
    const optionalKeys = ['env', 'headers']
    const allowedKeys = [...requiredKeys, ...optionalKeys]

    const missingKeys = requiredKeys.filter(key => !configKeys.includes(key))
    if (missingKeys.length > 0) {
      errors.push(messages.requiredFields(serverType, missingKeys.join(', ')))
    }

    const invalidKeys = configKeys.filter(key => !allowedKeys.includes(key))
    if (invalidKeys.length > 0) {
      errors.push(messages.invalidFields(serverType, invalidKeys.join(', '), allowedKeys.join(', ')))
    }

    if (typeof parsedConfig.url !== 'string' || !parsedConfig.url.trim()) {
      errors.push(messages.urlRequired)
    }

    if (parsedConfig.env !== undefined) {
      const envError = validateStringRecord(parsedConfig.env, 'env', messages)
      if (envError) errors.push(envError)
    }

    if (parsedConfig.headers !== undefined) {
      const headersError = validateStringRecord(parsedConfig.headers, 'headers', messages)
      if (headersError) errors.push(headersError)
    }
  }

  return errors.length > 0 ? errors.join('; ') : null
}
