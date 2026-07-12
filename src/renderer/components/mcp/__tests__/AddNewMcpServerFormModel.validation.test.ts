import { describe, expect, it } from 'vitest'
import { validateServerConfig } from '../AddNewMcpServerFormModel'

describe('AddNewMcpServerFormModel default validation messages', () => {
  it('returns the default empty-config validation message', () => {
    expect(validateServerConfig('', 'stdio')).toBe('MCP configuration cannot be empty')
  })

  it('returns the default invalid JSON validation message', () => {
    expect(validateServerConfig('{ bad json', 'stdio')).toContain('Configuration must be valid JSON format. Error:')
  })

  it('returns the default object validation message for env', () => {
    const config = JSON.stringify({
      command: 'node',
      args: ['server.js'],
      env: [],
    })

    expect(validateServerConfig(config, 'stdio')).toBe('env field must be an object with string key-value pairs')
  })

  it('returns the default string-entry validation message for env', () => {
    const config = JSON.stringify({
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 123 },
    })

    expect(validateServerConfig(config, 'stdio')).toBe('All env entries must be string key-value pairs')
  })
})
