/**
 * readSchedulesTool — two-level access to the current user's scheduled jobs.
 *
 *   - list:   markdown table of all jobs with message skeleton columns (length, lines, firstLine
 *             preview). Includes runtime-state header and cold-start catch-up summary.
 *   - detail: one job's `message` prompt body (truncated to 2 KB) + `description` (truncated to
 *             512 chars) + cold-start catch-up record. Call after list identifies a relevant job.
 *
 * Source files live under {userData}/profiles/<alias>/schedules/:
 *   - runtime-state.json: alias-level state (isActive, last activated/deactivated, cold-start catch-ups)
 *   - YYYY-MM.json:       monthly file holding `{ schedulerJobs: SchedulerJob[] }`
 *
 * Only call this when the bug description involves cron / scheduling / "didn't trigger" /
 * "triggered when it shouldn't have".
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { mainAuthManager } from '../../auth/authManager';
import { normalizeScheduleMonthFile, type SchedulerJob } from '../../scheduler/types';
import { truncateMiddle } from '../chatSession/truncate';

export const readSchedulesToolDef = {
  type: 'function' as const,
  function: {
    name: 'read_schedules',
    description: `Read the current user's scheduled jobs. Two modes:
• "list" — markdown table of every job with skeleton columns: metadata (id, name, type, cron/runAt, enabled, status, agentId, lastRunAt, lastFinishedAt) plus message skeleton (msg.len, msg.lines, msg.firstLine preview) and description length. Includes scheduler runtime-state header.
• "detail" — one job's prompt body (truncated to 2 KB) + description (truncated to 512 chars) + cold-start catch-up record if present. Call after "list" identifies a relevant job.
ONLY call this when the user's bug description involves scheduled tasks / cron / "didn't trigger" — do not call for unrelated bugs.`,
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['list', 'detail'],
          description: `list = markdown table of all jobs with message skeleton; detail = one job's prompt body + description (requires scheduleId).`,
        },
        scheduleId: {
          type: 'string',
          description: 'Required when mode="detail". The job id from the list output.',
        },
      },
      required: ['mode'],
    },
  },
};

const MAX_JOBS_IN_LIST = 50;
const MESSAGE_BUDGET = 2 * 1024;
const DESCRIPTION_BUDGET = 512;
const FIRST_LINE_PREVIEW_CHARS = 80;

interface RuntimeStateFile {
  alias?: string;
  isActive?: boolean;
  lastActivatedAt?: string;
  lastDeactivatedAt?: string;
  pendingColdStartCatchUps?: Record<string, { occurrenceAt: string; recordedAt: string }>;
}

export async function executeReadSchedules(args: {
  mode: 'list' | 'detail';
  scheduleId?: string;
}): Promise<string> {
  const mode = args?.mode;
  if (mode !== 'list' && mode !== 'detail') {
    return errorBlock('mode must be "list" or "detail".');
  }

  const alias = mainAuthManager.getCurrentAuth()?.ghcAuth?.alias;
  if (!alias) {
    return errorBlock('No active user alias — cannot read schedules.');
  }

  const schedulesDir = path.join(app.getPath('userData'), 'profiles', alias, 'schedules');
  if (!fs.existsSync(schedulesDir)) {
    return '## Schedules\n\nNo schedules directory exists for this user.';
  }

  const runtimeState = readJsonSafe<RuntimeStateFile>(path.join(schedulesDir, 'runtime-state.json'));
  const allJobs = loadAllJobs(schedulesDir);

  if (mode === 'list') {
    return formatList(alias, runtimeState, allJobs);
  }

  const scheduleId = args.scheduleId;
  if (!scheduleId) {
    return errorBlock('scheduleId is required when mode="detail".');
  }
  const job = allJobs.find((j) => j.id === scheduleId);
  if (!job) {
    return errorBlock(`Schedule "${scheduleId}" not found.`);
  }
  return formatDetail(job, runtimeState);
}

function loadAllJobs(schedulesDir: string): SchedulerJob[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(schedulesDir);
  } catch {
    return [];
  }
  const monthFiles = entries.filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  const jobs: SchedulerJob[] = [];
  for (const name of monthFiles) {
    const content = readJsonSafe<unknown>(path.join(schedulesDir, name));
    if (!content) continue;
    const normalized = normalizeScheduleMonthFile(content);
    jobs.push(...normalized.schedulerJobs);
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// list mode — markdown table with message skeleton columns
// ---------------------------------------------------------------------------

function formatList(
  alias: string,
  runtimeState: RuntimeStateFile | null,
  allJobs: SchedulerJob[],
): string {
  const out: string[] = [];

  out.push('## Schedules');
  out.push('');
  out.push(`- alias: ${alias}`);
  out.push(`- totalJobs: ${allJobs.length}`);
  if (runtimeState) {
    out.push(`- scheduler.isActive: ${runtimeState.isActive ?? 'unknown'}`);
    if (runtimeState.lastActivatedAt) out.push(`- scheduler.lastActivatedAt: ${runtimeState.lastActivatedAt}`);
    if (runtimeState.lastDeactivatedAt) out.push(`- scheduler.lastDeactivatedAt: ${runtimeState.lastDeactivatedAt}`);
    const catchUpCount = runtimeState.pendingColdStartCatchUps
      ? Object.keys(runtimeState.pendingColdStartCatchUps).length
      : 0;
    if (catchUpCount > 0) out.push(`- scheduler.pendingColdStartCatchUps: ${catchUpCount}`);
  }
  out.push('');

  if (allJobs.length === 0) {
    out.push('No scheduled jobs found.');
    return out.join('\n');
  }

  const sorted = [...allJobs].sort((a, b) => {
    const ta = Date.parse(a.lastRunAt || a.executedAt || '') || 0;
    const tb = Date.parse(b.lastRunAt || b.executedAt || '') || 0;
    if (ta !== tb) return tb - ta;
    return b.id.localeCompare(a.id);
  });
  const visible = sorted.slice(0, MAX_JOBS_IN_LIST);

  const cols = [
    '#', 'id', 'name', 'type', 'cron/runAt', 'enabled', 'status',
    'agentId', 'msg.len', 'msg.lines', 'msg.firstLine', 'desc.len',
    'lastRunAt', 'lastFinishedAt',
  ] as const;

  out.push('### Jobs');
  out.push('');
  out.push(renderTable(
    cols,
    visible.map((j, idx) => {
      const msgLines = j.message.split(/\r?\n/);
      const firstLine = msgLines[0] ?? '';
      const preview = firstLine.length > FIRST_LINE_PREVIEW_CHARS
        ? firstLine.slice(0, FIRST_LINE_PREVIEW_CHARS) + '…'
        : firstLine;
      return [
        String(idx),
        j.id,
        escapeCell(j.name),
        j.scheduleType,
        j.cronExpression || j.runAt || '',
        String(j.enabled),
        j.status,
        j.agentId,
        String(j.message.length),
        String(msgLines.length),
        escapeCell(preview),
        String(j.description.length),
        j.lastRunAt ?? '',
        j.lastFinishedAt ?? '',
      ];
    }),
  ));

  if (allJobs.length > visible.length) {
    out.push('');
    out.push(`_(Showing ${visible.length} of ${allJobs.length} jobs.)_`);
  }

  out.push('');
  out.push(
    'Message/description bodies not included. ' +
    'Use mode="detail" with a job id to read the prompt.',
  );

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// detail mode — prompt body deep-read + cold-start catch-up
// ---------------------------------------------------------------------------

function formatDetail(job: SchedulerJob, runtimeState: RuntimeStateFile | null): string {
  const message = truncateMiddle(job.message, MESSAGE_BUDGET);
  const description = truncateMiddle(job.description, DESCRIPTION_BUDGET);
  const out: string[] = [];

  out.push(`## Schedule Detail: ${escapeCell(job.name)}`);
  out.push('');
  out.push(`- id: ${job.id}`);
  out.push(`- scheduleType: ${job.scheduleType}`);
  if (job.cronExpression) out.push(`- cronExpression: ${job.cronExpression}`);
  if (job.runAt) out.push(`- runAt: ${job.runAt}`);
  out.push(`- enabled: ${job.enabled}`);
  out.push(`- status: ${job.status}`);
  out.push(`- agentId: ${job.agentId}`);
  if (job.lastRunAt) out.push(`- lastRunAt: ${job.lastRunAt}`);
  if (job.lastFinishedAt) out.push(`- lastFinishedAt: ${job.lastFinishedAt}`);
  if (job.executedAt) out.push(`- executedAt: ${job.executedAt}`);
  out.push('');

  // Message body
  out.push('### message');
  if (message.length < job.message.length) {
    out.push(`_(Truncated: showing ${message.length} of ${job.message.length} chars — head 60% + tail 40%)_`);
  }
  out.push('');
  out.push('```');
  out.push(message);
  out.push('```');
  out.push('');

  // Description body
  out.push('### description');
  if (description.length < job.description.length) {
    out.push(`_(Truncated: showing ${description.length} of ${job.description.length} chars)_`);
  }
  out.push('');
  out.push('```');
  out.push(description);
  out.push('```');

  // Cold-start catch-up
  const coldStart = runtimeState?.pendingColdStartCatchUps?.[job.id];
  if (coldStart) {
    out.push('');
    out.push('### Cold-Start Catch-Up');
    out.push('');
    out.push(`- occurrenceAt: ${coldStart.occurrenceAt}`);
    out.push(`- recordedAt: ${coldStart.recordedAt}`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(cols: readonly string[], rows: string[][]): string {
  const header = `| ${cols.join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  if (rows.length === 0) {
    return [header, sep].join('\n');
  }
  const body = rows
    .map((r) => `| ${r.map((c) => escapeCell(c)).join(' | ')} |`)
    .join('\n');
  return [header, sep, body].join('\n');
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
  return `## Error\n\nread_schedules failed: ${message}`;
}
