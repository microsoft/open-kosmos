import { describe, expect, it } from 'vitest'
import { translate } from '../../../lib/i18n'
import { buildMcpValidationMessages } from '../AddNewMcpServerValidationMessages'

describe('buildMcpValidationMessages', () => {
  it('builds localized Chinese MCP validation messages', () => {
    const messages = buildMcpValidationMessages((key, params) => translate('zh-CN', key, params))

    expect(messages.stringRecordObject('env')).toBe('env 字段必须是包含字符串键值对的对象')
    expect(messages.stringRecordEntries('headers')).toBe('所有 headers 条目都必须是字符串键值对')
    expect(messages.serverNameEmpty).toBe('服务器名称不能为空')
    expect(messages.serverNameExists).toBe('服务器名称已存在，请使用其他名称')
    expect(messages.configEmpty).toBe('MCP 配置不能为空')
    expect(messages.modifyExample).toBe('请修改示例配置，不能直接使用默认示例')
    expect(messages.invalidJson('Unexpected token')).toBe('配置必须是有效的 JSON 格式。错误：Unexpected token')
    expect(messages.requiredFields('stdio', 'command, args')).toBe('stdio 配置必须包含必填字段：command, args')
    expect(messages.invalidFields('sse', 'foo', 'url, env')).toBe('sse 配置包含无效字段：foo。仅允许：url, env')
    expect(messages.commandRequired).toBe('command 字段必须是非空字符串')
    expect(messages.argsMustBeArray).toBe('args 字段必须是数组')
    expect(messages.argsCannotBeEmpty).toBe('args 数组不能为空')
    expect(messages.argsMustBeStrings).toBe('args 数组中的所有元素都必须是字符串')
    expect(messages.urlRequired).toBe('url 字段必须是非空字符串')
  })
})
