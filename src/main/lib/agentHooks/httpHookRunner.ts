/**
 * HTTP Hook runner (Phase 3, tech-doc §18).
 *
 * Sends the Hook input to a remote endpoint over HTTP(S) and maps the response
 * onto the same `CommandHookResult` shape the executor already understands
 * (`stdout` = response body, `exitCode` = HTTP status, `success` = response.ok),
 * so the existing `parseHookOutput` / `aggregateHookOutcomes` pipeline applies
 * unchanged. Like the command runner, it NEVER throws — every failure is
 * reported through the result so a misbehaving Hook can never crash the loop.
 *
 * Safety: HTTP Hooks are lower-friction than command Hooks (configured through
 * the UI), so the URL is validated more strictly — only http/https, no embedded
 * credentials, and private/loopback/link-local/reserved hosts are rejected.
 * Redirects are disabled (`redirect: 'error'`) to prevent redirect-based SSRF,
 * the response body is read incrementally and capped, and no app cookies or auth
 * headers are attached. Hostnames are resolved before fetch and any private or
 * loopback resolved address is rejected.
 */

import { lookup } from 'dns/promises';
import type { LookupOptions } from 'dns';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { createLogger } from '../unifiedLogger';
import {
  MAX_HOOK_HTTP_BODY_LENGTH,
  MAX_HOOK_HTTP_HEADER_CHARS,
  MAX_HOOK_HTTP_HEADERS,
  MAX_HOOK_OUTPUT_BYTES,
  resolveHookTimeoutMs,
} from './types';
import type { AgentHookInput, CommandHookResult, HttpHookAction, HttpHookMethod } from './types';
import type { CommandHookEnv } from './commandHookRunner';

const logger = createLogger();

const ALLOWED_METHODS: ReadonlySet<HttpHookMethod> = new Set<HttpHookMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** Apply the IPv4 loopback/private/link-local/reserved-range rules. */
function isBlockedIpv4(a: number, b: number): boolean {
  if (a === 0) return true; // "this" network
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Extract an embedded IPv4 address (dotted form) from an IPv4-mapped / embedded
 * IPv6 literal, e.g. `::ffff:127.0.0.1` or the hex form `::ffff:7f00:1`. Returns
 * undefined when the host carries no embedded IPv4 tail.
 */
function extractEmbeddedIpv4(host: string): string | undefined {
  const dotted = host.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return undefined;
}

/** True when a hostname resolves to a loopback/private/link-local/reserved range. */
function isBlockedHostname(hostname: string): boolean {
  // Normalize: lowercase, strip IPv6 brackets, strip a trailing FQDN dot so
  // `localhost.` and `example.com.` are treated like their bare forms.
  let host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;

  // Collapse an IPv4-mapped / embedded IPv6 literal to its IPv4 tail and apply
  // the IPv4 rules (blocks e.g. http://[::ffff:7f00:1]/ === 127.0.0.1).
  if (host.includes(':')) {
    const embedded = extractEmbeddedIpv4(host);
    if (embedded) host = embedded;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    return isBlockedIpv4(Number(v4[1]), Number(v4[2]));
  }

  // IPv6 loopback/private/link-local prefixes only apply to IPv6 literals or
  // resolved IPv6 addresses, not DNS names such as `fc.example.com`.
  if (host.includes(':')) {
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique local
    if (/^fe[89ab]/.test(host)) return true; // link-local fe80::/10
    if (host.startsWith('ff')) return true; // multicast
    if (host.startsWith('2001:db8')) return true; // documentation/reserved
  }
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function isIpLiteral(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host.includes(':') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function validateRequestHeaders(headers: Record<string, string>): string | undefined {
  const entries = Object.entries(headers);
  if (entries.length > MAX_HOOK_HTTP_HEADERS) {
    return `Hook headers exceed ${MAX_HOOK_HTTP_HEADERS} custom entries`;
  }
  const headerChars = entries.reduce((total, [key, value]) => total + key.length + value.length, 0);
  if (headerChars > MAX_HOOK_HTTP_HEADER_CHARS) {
    return `Hook headers exceed ${MAX_HOOK_HTTP_HEADER_CHARS} characters`;
  }
  return undefined;
}

function validateRequestBody(body: string | undefined): string | undefined {
  if (body !== undefined && body.length > MAX_HOOK_HTTP_BODY_LENGTH) {
    return `Hook body exceeds ${MAX_HOOK_HTTP_BODY_LENGTH} characters`;
  }
  return undefined;
}

/** Validate an HTTP Hook URL. Returns an error string, or undefined when safe. */
export function validateHookUrl(rawUrl: string): string | undefined {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return 'Empty hook URL';
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Hook URL is not a valid URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Hook URL must use http or https';
  }
  if (url.username !== '' || url.password !== '') {
    return 'Hook URL must not contain credentials';
  }
  if (isBlockedHostname(url.hostname)) {
    return 'Hook URL targets a blocked (private, loopback, or reserved) host';
  }
  return undefined;
}

async function lookupWithAbort(hostname: string, signal: AbortSignal): Promise<Array<{ address: string; family: number }>> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  ]);
}

async function resolveAndValidateHookUrl(rawUrl: string, signal: AbortSignal): Promise<{ url?: URL; addresses?: Array<{ address: string; family: number }>; error?: string; aborted?: boolean }> {
  const staticError = validateHookUrl(rawUrl);
  if (staticError) return { error: staticError };

  const url = new URL(rawUrl);
  if (isIpLiteral(url.hostname)) return { url };

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupWithAbort(url.hostname, signal);
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { error: 'Hook cancelled before DNS resolution completed', aborted: true };
    }
    logger.warn('[AgentHooks] HTTP hook DNS lookup failed', 'validateResolvedHookUrl', {
      hostname: url.hostname,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Hook URL hostname could not be resolved' };
  }

  if (addresses.some(({ address }) => isBlockedHostname(address))) {
    return { error: 'Hook URL resolves to a blocked (private, loopback, or reserved) address' };
  }
  return { url, addresses };
}

function readCappedStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer | string) => {
      let value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total >= MAX_HOOK_OUTPUT_BYTES) return;
      if (total + value.length > MAX_HOOK_OUTPUT_BYTES) {
        value = value.subarray(0, MAX_HOOK_OUTPUT_BYTES - total);
      }
      chunks.push(value);
      total += value.length;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks, total).toString('utf8')));
  });
}

function buildPinnedLookup(
  originalHostname: string,
  addresses: Array<{ address: string; family: number }> | undefined,
): NonNullable<Parameters<typeof httpRequest>[1]>['lookup'] | undefined {
  if (!addresses || addresses.length === 0) return undefined;
  const normalizedOriginal = normalizeHostname(originalHostname);
  return (hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void;
    const opts = typeof options === 'object' && options !== null ? options as { all?: boolean } : {};
    if (normalizeHostname(hostname) !== normalizedOriginal) {
      lookup(hostname, { all: opts.all === true, verbatim: true } as LookupOptions)
        .then((result) => {
          if (Array.isArray(result)) cb(null, result);
          else cb(null, result.address, result.family);
        })
        .catch((error) => cb(error));
      return;
    }
    if (opts.all) {
      cb(null, addresses);
      return;
    }
    cb(null, addresses[0].address, addresses[0].family);
  };
}

function sendPinnedRequest(options: {
  url: URL;
  addresses?: Array<{ address: string; family: number }>;
  method: HttpHookMethod;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal;
}): Promise<{ ok: boolean; status: number; stdout: string }> {
  const transport = options.url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = transport(options.url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal,
      lookup: buildPinnedLookup(options.url.hostname, options.addresses),
    }, async (res) => {
      try {
        const status = res.statusCode ?? 0;
        const stdout = await readCappedStream(res);
        resolve({ ok: status >= 200 && status < 300, status, stdout });
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Execute a single HTTP Hook action. Resolves with a structured result; never
 * rejects.
 */
export async function runHttpHook(
  action: HttpHookAction,
  input: AgentHookInput,
  envCtx: CommandHookEnv,
  signal?: AbortSignal,
): Promise<CommandHookResult> {
  const start = Date.now();
  if (signal?.aborted) {
    return { success: false, stdout: '', stderr: '', durationMs: 0, error: 'Hook cancelled before start' };
  }

  const timeoutMs = resolveHookTimeoutMs(action, input);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onParentAbort);

  try {
    const resolvedUrl = await resolveAndValidateHookUrl(action.url, controller.signal);
    if (resolvedUrl.error || !resolvedUrl.url) {
      const durationMs = Date.now() - start;
      const error = timedOut
        ? `Hook timed out after ${timeoutMs}ms`
        : resolvedUrl.error ?? 'Hook URL is not a valid URL';
      if (!resolvedUrl.aborted) logger.warn(`[AgentHooks] HTTP hook blocked: ${error}`);
      return { success: false, stdout: '', stderr: '', durationMs, ...(timedOut ? { timedOut: true } : {}), error };
    }

    const method: HttpHookMethod =
      action.method && ALLOWED_METHODS.has(action.method) ? action.method : 'POST';
    const headerError = validateRequestHeaders(action.headers ?? {});
    if (headerError) {
      const durationMs = Date.now() - start;
      return { success: false, stdout: '', stderr: '', durationMs, error: headerError };
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(action.headers ?? {}),
      'x-openkosmos-hook-event': envCtx.event,
    };
    const requestBody =
      method === 'GET' ? undefined : action.body !== undefined ? action.body : JSON.stringify(input);
    const bodyError = validateRequestBody(requestBody);
    if (bodyError) {
      const durationMs = Date.now() - start;
      return { success: false, stdout: '', stderr: '', durationMs, error: bodyError };
    }

    const res = await sendPinnedRequest({
      url: resolvedUrl.url,
      addresses: resolvedUrl.addresses,
      method,
      headers,
      body: requestBody,
      signal: controller.signal,
    });
    const durationMs = Date.now() - start;
    const success = res.ok;
    return {
      success,
      stdout: res.stdout,
      stderr: '',
      exitCode: res.status,
      durationMs,
      ...(success ? {} : { error: `HTTP hook returned status ${res.status}` }),
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    if (timedOut) {
      return { success: false, stdout: '', stderr: '', durationMs, timedOut: true, error: `Hook timed out after ${timeoutMs}ms` };
    }
    if (signal?.aborted) {
      return { success: false, stdout: '', stderr: '', durationMs, error: 'Hook cancelled' };
    }
    return { success: false, stdout: '', stderr: '', durationMs, error: `HTTP hook error: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}
