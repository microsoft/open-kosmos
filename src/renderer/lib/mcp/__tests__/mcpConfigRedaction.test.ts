import { describe, it, expect } from 'vitest'
import { redactHeadersForLlm, restoreHeadersAfterLlm } from '../mcpConfigRedaction'

describe('redactHeadersForLlm', () => {
  it('redacts flat headers', () => {
    const input = JSON.stringify({ url: 'http://x', headers: { 'x-apikey': 'secret' } })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.headers['x-apikey']).toBe('<REDACTED>')
    expect(result.originalHeaders?.['headers']).toEqual({ 'x-apikey': 'secret' })
  })

  it('redacts multiple headers in flat config', () => {
    const input = JSON.stringify({
      url: 'http://x',
      headers: { 'x-apikey': 'secret1', Authorization: 'Bearer secret2' }
    })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.headers['x-apikey']).toBe('<REDACTED>')
    expect(parsed.headers.Authorization).toBe('<REDACTED>')
    expect(result.originalHeaders?.['headers']).toEqual({
      'x-apikey': 'secret1', Authorization: 'Bearer secret2'
    })
  })

  it('redacts nested servers.*.headers (mcp.json format)', () => {
    const input = JSON.stringify({
      servers: { 'my-srv': { type: 'http', url: 'http://x', headers: { Authorization: 'Bearer tok' } } }
    })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.servers['my-srv'].headers.Authorization).toBe('<REDACTED>')
    expect(result.originalHeaders?.['servers.my-srv']).toEqual({ Authorization: 'Bearer tok' })
  })

  it('redacts nested mcp.servers.*.headers (settings.json format)', () => {
    const input = JSON.stringify({
      mcp: { servers: { webiq: { url: 'http://x', headers: { 'x-apikey': 'key123' } } } }
    })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.mcp.servers.webiq.headers['x-apikey']).toBe('<REDACTED>')
    expect(result.originalHeaders?.['mcp.servers.webiq']).toEqual({ 'x-apikey': 'key123' })
  })

  it('redacts nested mcpServers.*.headers (wrapper format)', () => {
    const input = JSON.stringify({
      mcpServers: { srv: { url: 'http://x', headers: { key: 'val' } } }
    })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.mcpServers.srv.headers.key).toBe('<REDACTED>')
    expect(result.originalHeaders?.['mcpServers.srv']).toEqual({ key: 'val' })
  })

  it('redacts server-fragment shape { "serverName": { url, headers } }', () => {
    const input = JSON.stringify({
      search: { url: 'https://mcp.example.com/api', headers: { 'x-apikey': 'LEAK' } }
    })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.search.headers['x-apikey']).toBe('<REDACTED>')
    expect(result.originalHeaders?.['search']).toEqual({ 'x-apikey': 'LEAK' })
  })

  it('redacts multiple servers in server-fragment shape', () => {
    const input = JSON.stringify({
      a: { url: 'http://a', headers: { Auth: 'TOK_A' } },
      b: { url: 'http://b', headers: { Auth: 'TOK_B' } },
    })
    const result = redactHeadersForLlm(input)
    const parsed = JSON.parse(result.redacted)
    expect(parsed.a.headers.Auth).toBe('<REDACTED>')
    expect(parsed.b.headers.Auth).toBe('<REDACTED>')
    expect(result.originalHeaders?.['a']).toEqual({ Auth: 'TOK_A' })
    expect(result.originalHeaders?.['b']).toEqual({ Auth: 'TOK_B' })
  })

  it('returns unchanged text when no headers present', () => {
    const input = JSON.stringify({ url: 'http://x' })
    const result = redactHeadersForLlm(input)
    expect(result.redacted).toBe(input)
    expect(result.originalHeaders).toBeUndefined()
  })

  it('returns unchanged text on invalid JSON without headers', () => {
    const input = '{ not valid json'
    const result = redactHeadersForLlm(input)
    expect(result.redacted).toBe(input)
    expect(result.originalHeaders).toBeUndefined()
  })

  it('regex fallback redacts ALL headers in invalid JSON', () => {
    const input = `{
  "url": "http://x",
  // comment
  "headers": {
    "x-apikey": "secret1",
    "Authorization": "Bearer secret2"
  },
}`
    const result = redactHeadersForLlm(input)
    expect(result.redacted).not.toContain('secret1')
    expect(result.redacted).not.toContain('secret2')
    expect(result.redacted).toContain('<REDACTED>')
    expect(result.originalHeaders).toBeUndefined()
  })

  it('regex fallback handles trailing commas', () => {
    const input = `{ "headers": { "Authorization": "Bearer tok123", } }`
    const result = redactHeadersForLlm(input)
    expect(result.redacted).not.toContain('tok123')
    expect(result.redacted).toContain('<REDACTED>')
  })

  it('handles multiple nested formats simultaneously', () => {
    const input = JSON.stringify({
      headers: { a: '1' },
      servers: { s1: { headers: { b: '2' } } },
    })
    const result = redactHeadersForLlm(input)
    expect(result.originalHeaders?.['headers']).toEqual({ a: '1' })
    expect(result.originalHeaders?.['servers.s1']).toEqual({ b: '2' })
  })

  it('ignores servers that are arrays', () => {
    const input = JSON.stringify({ servers: [{ headers: { key: 'val' } }] })
    const result = redactHeadersForLlm(input)
    expect(result.redacted).toBe(input)
    expect(result.originalHeaders).toBeUndefined()
  })

  it('ignores headers that are arrays', () => {
    const input = JSON.stringify({ headers: ['not', 'an', 'object'] })
    const result = redactHeadersForLlm(input)
    expect(result.redacted).toBe(input)
    expect(result.originalHeaders).toBeUndefined()
  })

  it('does not detect server-fragment if known wrappers matched', () => {
    const input = JSON.stringify({
      servers: { s1: { url: 'http://x', headers: { key: 'val' } } },
      otherKey: { url: 'http://y', headers: { key2: 'val2' } },
    })
    const result = redactHeadersForLlm(input)
    // servers.s1 matched by known wrapper, otherKey should NOT be treated as fragment
    expect(result.originalHeaders?.['servers.s1']).toEqual({ key: 'val' })
    expect(result.originalHeaders?.['otherKey']).toBeUndefined()
  })
})

describe('restoreHeadersAfterLlm', () => {
  it('restores from flat headers path', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, { headers: { key: 'real-secret' } })
    expect(config.headers).toEqual({ key: 'real-secret' })
  })

  it('restores by matching serverName against paths', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, {
      'servers.a': { Auth: 'TOK_A' },
      'servers.b': { Auth: 'TOK_B' },
    }, 'b')
    expect(config.headers).toEqual({ Auth: 'TOK_B' })
  })

  it('restores by matching bare serverName (fragment shape)', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, {
      webiq: { 'x-apikey': 'SECRET' },
    }, 'webiq')
    expect(config.headers).toEqual({ 'x-apikey': 'SECRET' })
  })

  it('single-server fallback when no serverName match', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, { 'servers.my-srv': { Authorization: 'Bearer tok' } })
    expect(config.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('does NOT fallback when multiple servers and no match', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, {
      'servers.a': { Auth: 'TOK_A' },
      'servers.b': { Auth: 'TOK_B' },
    }, 'c')
    // No match, multiple entries — should NOT restore to avoid cross-routing
    expect(config.headers).toBeUndefined()
  })

  it('removes residual REDACTED sentinels', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, { headers: { good: 'val', leaked: '<REDACTED>' } })
    expect(config.headers).toEqual({ good: 'val' })
  })

  it('removes headers entirely if all values are REDACTED', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, { headers: { key: '<REDACTED>' } })
    expect(config.headers).toBeUndefined()
  })

  it('flat path takes priority over serverName match', () => {
    const config: Record<string, any> = { url: 'http://x' }
    restoreHeadersAfterLlm(config, {
      headers: { key: 'flat-val' },
      'servers.srv': { key: 'nested-val' },
    }, 'srv')
    expect(config.headers).toEqual({ key: 'flat-val' })
  })
})
