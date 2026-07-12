import { randomUUID } from 'crypto';
import type { RequestInteractiveInputArgs } from '@shared/types/requestInteractiveInputTypes';
import type { ComputerUseToolArgs } from './types';

export const COMPUTER_USE_CONFIRMATION_METADATA_KEY = 'computerUseConfirmationId';
export const COMPUTER_USE_CONFIRMATION_APPROVE_VALUE = 'approve';
export const COMPUTER_USE_CONFIRMATION_CANCEL_VALUE = 'cancel';

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

interface ConfirmationRecord {
  chatSessionId?: string;
  fingerprint: string;
  approved: boolean;
  createdAt: number;
  trustedRequest?: RequestInteractiveInputArgs;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function buildComputerUseConfirmationFingerprint(args: ComputerUseToolArgs): string {
  const { confirmed: _confirmed, confirmationId: _confirmationId, ...rest } = args;
  return stableStringify(rest);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeValue(value: unknown): string {
  return escapeHtml(String(value ?? 'unknown'));
}

function safeJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value ?? '') ?? '""');
}

function describeAction(args: ComputerUseToolArgs): string {
  switch (args.action) {
    case 'click':
      return `Click ${safeValue(args.button ?? 'left')} at screenshot coordinates (${safeValue(args.x)}, ${safeValue(args.y)}).`;
    case 'double_click':
      return `Double-click at screenshot coordinates (${safeValue(args.x)}, ${safeValue(args.y)}).`;
    case 'right_click':
      return `Right-click at screenshot coordinates (${safeValue(args.x)}, ${safeValue(args.y)}).`;
    case 'drag':
      return `Drag from (${safeValue(args.from?.x)}, ${safeValue(args.from?.y)}) to (${safeValue(args.to?.x)}, ${safeValue(args.to?.y)}) in screenshot coordinates.`;
    case 'type_text':
      return `Type text: ${safeJson(args.text)}.`;
    case 'press_key':
      return `Press key: ${safeValue(args.key)}.`;
    case 'hotkey':
      return `Press hotkey: ${escapeHtml((args.keys ?? []).map((key) => String(key)).join('+'))}.`;
    default:
      return `Run Computer Use action: ${safeValue(args.action)}.`;
  }
}

export function buildComputerUseConfirmationRequest(
  confirmationId: string,
  args: ComputerUseToolArgs,
): RequestInteractiveInputArgs {
  return {
    title: 'Approve Computer Use action',
    description: `OpenKosmos wants to control your real desktop. ${describeAction(args)} Approve only if this exact action matches your intent.`,
    source: 'system',
    submitLabel: 'Approve',
    skipLabel: 'Cancel',
    metadata: { [COMPUTER_USE_CONFIRMATION_METADATA_KEY]: confirmationId },
    schema: {
      kind: 'choice',
      mode: 'single',
      minSelections: 1,
      maxSelections: 1,
      options: [
        {
          value: COMPUTER_USE_CONFIRMATION_APPROVE_VALUE,
          label: 'Approve this exact action',
          description: 'Allow OpenKosmos to perform only the Computer Use action described above.',
        },
        {
          value: COMPUTER_USE_CONFIRMATION_CANCEL_VALUE,
          label: 'Cancel',
          description: 'Do not perform this Computer Use action.',
        },
      ],
    },
  };
}

export function getComputerUseConfirmationIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const id = (metadata as Record<string, unknown>)[COMPUTER_USE_CONFIRMATION_METADATA_KEY];
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

export class ComputerUseConfirmationStore {
  private readonly records = new Map<string, ConfirmationRecord>();

  createPending(chatSessionId: string | undefined, fingerprint: string, now = Date.now()): string {
    this.cleanup(now);
    const id = randomUUID();
    this.records.set(id, { chatSessionId, fingerprint, approved: false, createdAt: now });
    return id;
  }

  createPendingWithRequest(
    chatSessionId: string | undefined,
    fingerprint: string,
    requestFactory: (confirmationId: string) => RequestInteractiveInputArgs,
    now = Date.now(),
  ): string {
    this.cleanup(now);
    const id = randomUUID();
    this.records.set(id, {
      chatSessionId,
      fingerprint,
      approved: false,
      createdAt: now,
      trustedRequest: requestFactory(id),
    });
    return id;
  }

  getTrustedRequest(id: string, chatSessionId: string | undefined, now = Date.now()): RequestInteractiveInputArgs | null {
    this.cleanup(now);
    const record = this.records.get(id);
    if (!record || record.chatSessionId !== chatSessionId || !record.trustedRequest) {
      return null;
    }
    return record.trustedRequest;
  }

  hasPending(id: string, chatSessionId: string | undefined, fingerprint: string, now = Date.now()): boolean {
    this.cleanup(now);
    const record = this.records.get(id);
    return !!record &&
      !record.approved &&
      record.chatSessionId === chatSessionId &&
      record.fingerprint === fingerprint;
  }

  approve(id: string, chatSessionId: string | undefined, now = Date.now()): boolean {
    this.cleanup(now);
    const record = this.records.get(id);
    if (!record || record.chatSessionId !== chatSessionId) {
      return false;
    }
    record.approved = true;
    return true;
  }

  approveTrustedRequest(
    id: string,
    chatSessionId: string | undefined,
    request: RequestInteractiveInputArgs,
    now = Date.now(),
  ): boolean {
    this.cleanup(now);
    const record = this.records.get(id);
    if (
      !record ||
      record.approved ||
      record.chatSessionId !== chatSessionId ||
      !record.trustedRequest ||
      stableStringify(record.trustedRequest) !== stableStringify(request)
    ) {
      return false;
    }
    record.approved = true;
    return true;
  }

  consumeApproved(id: string, chatSessionId: string | undefined, fingerprint: string, now = Date.now()): boolean {
    this.cleanup(now);
    const record = this.records.get(id);
    if (!record || !record.approved || record.chatSessionId !== chatSessionId || record.fingerprint !== fingerprint) {
      return false;
    }
    this.records.delete(id);
    return true;
  }

  clear(): void {
    this.records.clear();
  }

  private cleanup(now: number): void {
    for (const [id, record] of this.records) {
      if (now - record.createdAt > CONFIRMATION_TTL_MS) {
        this.records.delete(id);
      }
    }
  }
}

export const computerUseConfirmationStore = new ComputerUseConfirmationStore();
