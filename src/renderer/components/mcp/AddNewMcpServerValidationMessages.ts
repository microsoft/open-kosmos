import type { TranslationKey, TranslationParams } from '../../lib/i18n'
import type { McpValidationMessages, McpServerTransport } from './AddNewMcpServerFormModel'

type Translate = (key: TranslationKey, params?: TranslationParams) => string

export function buildMcpValidationMessages(t: Translate): McpValidationMessages {
  const withField = (key: TranslationKey, fieldName: string) => t(key, { fieldName })
  const withError = (key: TranslationKey, error: string) => t(key, { error })
  const withFields = (
    key: TranslationKey,
    transport: McpServerTransport,
    fields: string,
    allowedFields?: string,
  ) => t(key, { transport, fields, allowedFields: allowedFields ?? '' })

  return {
    stringRecordObject: (fieldName) => withField('mcp.add.validation.stringRecordObject', fieldName),
    stringRecordEntries: (fieldName) => withField('mcp.add.validation.stringRecordEntries', fieldName),
    serverNameEmpty: t('mcp.add.validation.serverNameEmpty'),
    serverNameExists: t('mcp.add.validation.serverNameExists'),
    configEmpty: t('mcp.add.validation.configEmpty'),
    modifyExample: t('mcp.add.validation.modifyExample'),
    invalidJson: (error) => withError('mcp.add.validation.invalidJson', error),
    requiredFields: (transport, fields) => withFields('mcp.add.validation.requiredFields', transport, fields),
    invalidFields: (transport, fields, allowedFields) =>
      withFields('mcp.add.validation.invalidFields', transport, fields, allowedFields),
    commandRequired: t('mcp.add.validation.commandRequired'),
    argsMustBeArray: t('mcp.add.validation.argsMustBeArray'),
    argsCannotBeEmpty: t('mcp.add.validation.argsCannotBeEmpty'),
    argsMustBeStrings: t('mcp.add.validation.argsMustBeStrings'),
    urlRequired: t('mcp.add.validation.urlRequired'),
  }
}
