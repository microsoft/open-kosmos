export const NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED = 'NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED' as const;

// `plain-text-only` is intentionally a soft restriction today: remote IM sessions rely on
// prompt guidance and targeted post-processing guards, while `forbid` is the hard fail-fast
// policy used for unattended scheduled execution.
export type AgentChatInteractionPolicy = 'allow-ui' | 'plain-text-only' | 'forbid';

export type BlockedInteractiveRequestType = 'approval' | 'choice' | 'form';

export interface BlockedInteractionDetails {
  code: typeof NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED;
  policy: AgentChatInteractionPolicy;
  requestType: BlockedInteractiveRequestType;
  title?: string;
  message: string;
}

export class NonInteractiveRuntimeInteractionError extends Error {
  readonly code = NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED;
  readonly details: BlockedInteractionDetails;

  constructor(details: Omit<BlockedInteractionDetails, 'code'>) {
    super(details.message);
    this.name = 'NonInteractiveRuntimeInteractionError';
    this.details = {
      code: NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED,
      ...details,
    };
  }
}

export function isNonInteractiveRuntimeInteractionError(
  error: unknown,
): error is NonInteractiveRuntimeInteractionError {
  return error instanceof NonInteractiveRuntimeInteractionError;
}

export function createBlockedInteractionMessage(policy: AgentChatInteractionPolicy): string {
  if (policy === 'forbid') {
    return 'This chat runtime does not allow interactive user input. Background scheduled runs must complete without user interaction.';
  }

  return 'This chat runtime does not allow interactive UI components for user input.';
}