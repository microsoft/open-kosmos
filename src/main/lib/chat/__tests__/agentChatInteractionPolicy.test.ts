import { describe, it, expect } from 'vitest';
import {
  NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED,
  NonInteractiveRuntimeInteractionError,
  isNonInteractiveRuntimeInteractionError,
  createBlockedInteractionMessage,
} from '../agentChatInteractionPolicy';
import type { AgentChatInteractionPolicy, BlockedInteractiveRequestType } from '../agentChatInteractionPolicy';

describe('agentChatInteractionPolicy', () => {
  describe('NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED constant', () => {
    it('is the expected string value', () => {
      expect(NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED).toBe('NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED');
    });
  });

  describe('NonInteractiveRuntimeInteractionError', () => {
    it('sets name, message, code, and details correctly', () => {
      const err = new NonInteractiveRuntimeInteractionError({
        policy: 'forbid',
        requestType: 'approval',
        message: 'No interaction allowed',
      });
      expect(err.name).toBe('NonInteractiveRuntimeInteractionError');
      expect(err.message).toBe('No interaction allowed');
      expect(err.code).toBe(NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED);
      expect(err.details.code).toBe(NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED);
      expect(err.details.policy).toBe('forbid');
      expect(err.details.requestType).toBe('approval');
      expect(err.details.message).toBe('No interaction allowed');
    });

    it('passes through optional title', () => {
      const err = new NonInteractiveRuntimeInteractionError({
        policy: 'plain-text-only',
        requestType: 'choice',
        title: 'Some Title',
        message: 'Cannot show UI',
      });
      expect(err.details.title).toBe('Some Title');
    });

    it('is an instance of Error', () => {
      const err = new NonInteractiveRuntimeInteractionError({
        policy: 'allow-ui',
        requestType: 'form',
        message: 'test',
      });
      expect(err instanceof Error).toBe(true);
    });

    it('handles all requestType values', () => {
      const types: BlockedInteractiveRequestType[] = ['approval', 'choice', 'form'];
      for (const requestType of types) {
        const err = new NonInteractiveRuntimeInteractionError({
          policy: 'forbid',
          requestType,
          message: 'test',
        });
        expect(err.details.requestType).toBe(requestType);
      }
    });
  });

  describe('isNonInteractiveRuntimeInteractionError', () => {
    it('returns true for NonInteractiveRuntimeInteractionError instances', () => {
      const err = new NonInteractiveRuntimeInteractionError({
        policy: 'forbid',
        requestType: 'approval',
        message: 'test',
      });
      expect(isNonInteractiveRuntimeInteractionError(err)).toBe(true);
    });

    it('returns false for plain Error instances', () => {
      expect(isNonInteractiveRuntimeInteractionError(new Error('test'))).toBe(false);
    });

    it('returns false for null', () => {
      expect(isNonInteractiveRuntimeInteractionError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isNonInteractiveRuntimeInteractionError(undefined)).toBe(false);
    });

    it('returns false for plain objects', () => {
      expect(isNonInteractiveRuntimeInteractionError({ code: NON_INTERACTIVE_RUNTIME_INTERACTION_REQUIRED })).toBe(false);
    });
  });

  describe('createBlockedInteractionMessage', () => {
    it('returns the scheduled-run message when policy is forbid', () => {
      const msg = createBlockedInteractionMessage('forbid');
      expect(msg).toContain('scheduled runs');
      expect(msg).toContain('interactive user input');
    });

    it('returns the remote-session message for plain-text-only', () => {
      const msg = createBlockedInteractionMessage('plain-text-only');
      expect(msg).toContain('interactive UI components');
    });

    it('returns the remote-session message for allow-ui', () => {
      const msg = createBlockedInteractionMessage('allow-ui');
      expect(msg).toContain('interactive UI components');
    });

    it('forbid message differs from plain-text-only message', () => {
      const forbidMsg = createBlockedInteractionMessage('forbid');
      const softMsg = createBlockedInteractionMessage('plain-text-only');
      expect(forbidMsg).not.toBe(softMsg);
    });
  });
});
