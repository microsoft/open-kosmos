/**
 * readCrashBundleTool — L2 crash bundle deep-read.
 *
 * Given a bundle name from get_crash_status, return a markdown digest of:
 *   - manifest.json (full)
 *   - recovered-crash.json OR event.json (structured extraction by eventType)
 *   - system.json (host/memory/uptime — versions.* already in get_app_info)
 *   - breadcrumbs.json (last 30, as markdown table)
 *
 * Hard cap on output (~12KB) so this never blows up the LLM context. Path traversal is rejected.
 */

import * as fs from 'fs';
import * as path from 'path';
import { crashCaptureManager } from '../../crash/CrashCaptureManager';
import { truncateMiddle } from '../chatSession/truncate';

export const readCrashBundleToolDef = {
  type: 'function' as const,
  function: {
    name: 'read_crash_bundle',
    description: `Read one crash bundle in detail and return a compact markdown digest containing manifest, event payload (error message + stack), host/memory snapshot, and the last 30 breadcrumbs as a table. Use this only after get_crash_status, on the bundle most relevant to the bug. Output is hard-capped to ~12KB.`,
    parameters: {
      type: 'object',
      properties: {
        bundleName: {
          type: 'string',
          description: `The bundle directory name as returned by get_crash_status (e.g. "20260323-144328-791-recovered-unclean-exit-session-...").`,
        },
      },
      required: ['bundleName'],
    },
  },
};

const MAX_OUTPUT_CHARS = 12 * 1024;
const MAX_BREADCRUMBS = 30;
const MAX_METADATA_CHARS_PER_BREADCRUMB = 200;
const MAX_STACK_CHARS = 3000;
const MAX_ERROR_MESSAGE_CHARS = 1000;

interface Breadcrumb {
  timestamp?: string;
  category?: string;
  message?: string;
  metadata?: unknown;
}

export async function executeReadCrashBundle(args: { bundleName: string }): Promise<string> {
  const bundleName = args?.bundleName;
  if (!bundleName || typeof bundleName !== 'string') {
    return errorBlock('bundleName is required.');
  }
  // Whitelist: must be a single directory name. Reject path separators, traversal segments,
  // and absolute paths up front so path.resolve() can't escape crashRootDir.
  if (
    bundleName.includes('/') ||
    bundleName.includes('\\') ||
    bundleName === '.' ||
    bundleName === '..' ||
    path.isAbsolute(bundleName)
  ) {
    return errorBlock('Invalid bundleName: must be a single directory name (no path separators).');
  }

  const status = crashCaptureManager.getStatus();
  const crashRootDir = status.crashRootDir;
  if (!crashRootDir) {
    return errorBlock('Crash capture is not initialized.');
  }

  const resolvedRoot = path.resolve(crashRootDir);
  const resolvedBundle = path.resolve(crashRootDir, bundleName);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (!resolvedBundle.startsWith(rootWithSep)) {
    return errorBlock('Invalid bundleName: path escapes crash root.');
  }
  if (!fs.existsSync(resolvedBundle) || !fs.statSync(resolvedBundle).isDirectory()) {
    return errorBlock(`Bundle "${bundleName}" not found.`);
  }

  const sections: string[] = [];
  sections.push(`# Crash Bundle: ${bundleName}\n`);

  // 1) manifest.json — full
  const manifest = readJsonSafe<Record<string, unknown>>(path.join(resolvedBundle, 'manifest.json'));
  if (manifest) {
    sections.push(`## Manifest\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\``);
  }

  // 2) recovered-crash.json or event.json — structured extraction
  const recovered = readJsonSafe<Record<string, unknown>>(path.join(resolvedBundle, 'recovered-crash.json'));
  if (recovered) {
    sections.push(`## Recovered Crash\n\n\`\`\`json\n${JSON.stringify(recovered, null, 2)}\n\`\`\``);
  }
  const event = readJsonSafe<Record<string, unknown>>(path.join(resolvedBundle, 'event.json'));
  if (event) {
    sections.push(formatEventPayload(event, manifest?.eventType as string | undefined));
  }

  // 3) system.json — drop versions.* (already in get_app_info), keep host/memory snapshot
  const system = readJsonSafe<Record<string, unknown>>(path.join(resolvedBundle, 'system.json'));
  if (system) {
    const trimmed = { ...system };
    delete trimmed.versions;
    sections.push(`## System Snapshot (versions.* omitted — see get_app_info)\n\n\`\`\`json\n${JSON.stringify(trimmed, null, 2)}\n\`\`\``);
  }

  // 4) breadcrumbs.json — last 30, as markdown table
  const breadcrumbs = readJsonSafe<Breadcrumb[]>(path.join(resolvedBundle, 'breadcrumbs.json'));
  if (Array.isArray(breadcrumbs) && breadcrumbs.length > 0) {
    const totalCount = breadcrumbs.length;
    const tail = breadcrumbs.slice(-MAX_BREADCRUMBS);
    const omittedNote =
      totalCount > tail.length
        ? `_(Showing last ${tail.length} of ${totalCount} breadcrumbs.)_\n\n`
        : '';
    const header = '| Time | Category | Message | Metadata |\n| --- | --- | --- | --- |';
    const rows = tail.map((b) => formatBreadcrumbRow(b));
    sections.push(`## Breadcrumbs\n\n${omittedNote}${header}\n${rows.join('\n')}`);
  }

  let output = sections.join('\n\n');

  // Final hard cap — truncateMiddle's budget is in characters, matching MAX_OUTPUT_CHARS.
  if (output.length > MAX_OUTPUT_CHARS) {
    output = truncateMiddle(output, MAX_OUTPUT_CHARS) +
      `\n\n_[Output exceeded ${MAX_OUTPUT_CHARS} chars and was truncated.]_`;
  }

  return output;
}

function formatEventPayload(event: Record<string, unknown>, eventType?: string): string {
  if (eventType === 'main-uncaught-exception' || eventType === 'renderer-error') {
    return formatErrorEvent(event, eventType);
  }
  // renderer-process-gone, child-process-gone — small payloads, output as-is
  return `## Event Payload (${eventType ?? 'unknown'})\n\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``;
}

function formatErrorEvent(event: Record<string, unknown>, eventType: string): string {
  const lines: string[] = [`## Event Payload (${eventType})`];

  if (eventType === 'main-uncaught-exception') {
    const origin = event.origin as string | undefined;
    const error = event.error as Record<string, unknown> | undefined;
    if (origin) lines.push(`\n**Origin:** ${origin}`);
    if (error) {
      appendErrorFields(lines, error);
    }
  } else if (eventType === 'renderer-error') {
    const report = event.report as Record<string, unknown> | undefined;
    if (report) {
      const kind = report.kind as string | undefined;
      if (kind) lines.push(`\n**Kind:** ${kind}`);
      appendErrorFields(lines, report);
      const url = report.url as string | undefined;
      const source = report.source as string | undefined;
      if (url) lines.push(`**URL:** ${url}`);
      if (source) lines.push(`**Source:** ${source}`);
    }
  }

  return lines.join('\n');
}

function appendErrorFields(lines: string[], obj: Record<string, unknown>): void {
  const name = obj.name as string | undefined;
  const message = obj.message as string | undefined;
  const stack = obj.stack as string | undefined;
  const cause = obj.cause as Record<string, unknown> | undefined;

  if (name) lines.push(`**Error:** ${name}`);
  if (message) {
    const truncMsg = message.length > MAX_ERROR_MESSAGE_CHARS
      ? message.slice(0, MAX_ERROR_MESSAGE_CHARS) + '…'
      : message;
    lines.push(`**Message:** ${truncMsg}`);
  }
  if (stack) {
    const truncStack = stack.length > MAX_STACK_CHARS
      ? stack.slice(0, MAX_STACK_CHARS) + '\n…[stack truncated]'
      : stack;
    lines.push(`\n\`\`\`\n${truncStack}\n\`\`\``);
  }
  if (cause) {
    lines.push(`\n**Cause:**`);
    appendErrorFields(lines, cause);
  }
}

function formatBreadcrumbRow(b: Breadcrumb): string {
  const ts = b.timestamp ? b.timestamp.replace(/^.*T/, '').replace('Z', '') : '';
  const cat = b.category ?? '';
  const msg = b.message ?? '';
  let meta = '';
  if (b.metadata !== undefined && b.metadata !== null) {
    try {
      meta = JSON.stringify(b.metadata);
    } catch {
      meta = String(b.metadata);
    }
    if (meta.length > MAX_METADATA_CHARS_PER_BREADCRUMB) {
      meta = meta.slice(0, MAX_METADATA_CHARS_PER_BREADCRUMB) + '…';
    }
    meta = meta.replace(/\|/g, '\\|');
  }
  return `| ${ts} | ${cat} | ${msg} | ${meta} |`;
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function errorBlock(message: string): string {
  return JSON.stringify({ error: message });
}
