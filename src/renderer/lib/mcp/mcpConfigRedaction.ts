const REDACTED_SENTINEL = '<REDACTED>'

/**
 * Regex fallback for redacting header values in non-JSON text.
 * Two-pass approach: first find each "headers": { ... } block,
 * then redact all "key": "value" pairs within each block.
 */
const HEADERS_BLOCK_PATTERN = /("headers"\s*:\s*\{)([^}]*)\}/g
const KV_VALUE_PATTERN = /("[\w-]+"\s*:\s*)"([^"]+)"/g

function regexRedactHeaders(text: string): { redacted: string; hadHeaders: boolean } {
  let hadHeaders = false
  const redacted = text.replace(HEADERS_BLOCK_PATTERN, (_match, prefix, body) => {
    hadHeaders = true
    const redactedBody = body.replace(KV_VALUE_PATTERN, (_m: string, kvPrefix: string) => {
      return `${kvPrefix}"${REDACTED_SENTINEL}"`
    })
    return `${prefix}${redactedBody}}`
  })
  return { redacted, hadHeaders }
}

export interface RedactionResult {
  redacted: string
  originalHeaders?: Record<string, Record<string, string>>
}

/**
 * Check if an object looks like an MCP server config (has url or command).
 */
function looksLikeServerConfig(obj: any): boolean {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    (typeof obj.url === 'string' || typeof obj.command === 'string')
}

/**
 * Redact sensitive header values before sending config to LLM for formatting.
 * Handles all supported config shapes:
 *   - flat: { url, headers: {...} }
 *   - mcp.json: { servers: { name: { headers } } }
 *   - settings.json: { mcp: { servers: { name: { headers } } } }
 *   - wrapper: { mcpServers: { name: { headers } } }
 *   - server-fragment: { "serverName": { url, headers } }
 *
 * For valid JSON: parses, redacts, and returns original headers for restoration.
 * For invalid JSON: uses regex fallback to redact ALL header values in every
 * "headers": { ... } block.
 */
export function redactHeadersForLlm(configText: string): RedactionResult {
  try {
    const parsed = JSON.parse(configText)
    const originalHeaders: Record<string, Record<string, string>> = {}

    const redactObj = (obj: Record<string, string>, path: string) => {
      originalHeaders[path] = { ...obj }
      for (const key of Object.keys(obj)) {
        obj[key] = REDACTED_SENTINEL
      }
    }

    const redactServersMap = (servers: any, pathPrefix: string) => {
      if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
        for (const name of Object.keys(servers)) {
          const srv = servers[name]
          if (srv?.headers && typeof srv.headers === 'object' && !Array.isArray(srv.headers)) {
            redactObj(srv.headers, pathPrefix ? `${pathPrefix}.${name}` : name)
          }
        }
      }
    }

    // Flat: { headers: {...} }
    if (parsed.headers && typeof parsed.headers === 'object' && !Array.isArray(parsed.headers)) {
      redactObj(parsed.headers, 'headers')
    }
    // mcp.json: { servers: { name: { headers } } }
    redactServersMap(parsed.servers, 'servers')
    // settings.json: { mcp: { servers: { name: { headers } } } }
    redactServersMap(parsed.mcp?.servers, 'mcp.servers')
    // wrapper: { mcpServers: { name: { headers } } }
    redactServersMap(parsed.mcpServers, 'mcpServers')

    // Server-fragment: { "serverName": { url/command, headers } }
    // Detect top-level keys that look like server configs but weren't
    // caught by the known wrappers above.
    if (Object.keys(originalHeaders).length === 0) {
      for (const key of Object.keys(parsed)) {
        const val = parsed[key]
        if (looksLikeServerConfig(val) && val.headers && typeof val.headers === 'object' && !Array.isArray(val.headers)) {
          redactObj(val.headers, key)
        }
      }
    }

    if (Object.keys(originalHeaders).length > 0) {
      return { redacted: JSON.stringify(parsed), originalHeaders }
    }
    return { redacted: configText }
  } catch {
    const { redacted, hadHeaders } = regexRedactHeaders(configText)
    if (hadHeaders) {
      return { redacted }
    }
    return { redacted: configText }
  }
}

/**
 * Restore original header values into a flat config object returned by the LLM.
 *
 * Matching priority:
 *   1. Flat 'headers' path (input was { url, headers })
 *   2. Match by serverName from LLM response against originalHeaders paths
 *   3. Single-server fallback (only one entry in originalHeaders)
 *
 * After restoration, scans for any residual REDACTED sentinels and removes them.
 */
export function restoreHeadersAfterLlm(
  config: Record<string, any>,
  originalHeaders: Record<string, Record<string, string>>,
  serverName?: string,
): void {
  // Priority 1: flat headers path
  const flat = originalHeaders['headers']
  if (flat) {
    config.headers = { ...flat }
  } else if (serverName) {
    // Priority 2: match by server name against stored paths
    // Paths look like "servers.myServer", "mcp.servers.myServer", "myServer"
    const match = Object.entries(originalHeaders).find(([path]) =>
      path === serverName || path.endsWith(`.${serverName}`)
    )
    if (match) {
      config.headers = { ...match[1] }
    }
  }

  // Priority 3: single-server fallback (unambiguous)
  if (!config.headers) {
    const entries = Object.entries(originalHeaders)
    if (entries.length === 1) {
      config.headers = { ...entries[0][1] }
    }
  }

  // Safety: remove any residual REDACTED sentinels
  if (config.headers && typeof config.headers === 'object') {
    for (const [key, value] of Object.entries(config.headers)) {
      if (value === REDACTED_SENTINEL) {
        delete config.headers[key]
      }
    }
    if (Object.keys(config.headers).length === 0) {
      delete config.headers
    }
  }
}
