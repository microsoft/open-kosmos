import {
  getScheduledSessionDisplayState,
  getScheduledSessionInterruptionReason,
} from '../SchedulesSidepane.utils';
import { INTERRUPTED_SCHEDULED_SESSION_ERROR } from '@shared/constants/scheduler';

describe('getScheduledSessionDisplayState', () => {
  it('returns running for active scheduled sessions', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'running',
      } as any),
    ).toBe('running');
  });

  it('returns interrupted for recovered interrupted sessions', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'failed',
        schedulerError: INTERRUPTED_SCHEDULED_SESSION_ERROR,
      } as any),
    ).toBe('interrupted');
  });

  it('returns interrupted for skipped scheduler sessions', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'failed',
        schedulerError: 'skipped-mcp-not-ready',
      } as any),
    ).toBe('interrupted');
  });

  it('returns interrupted for cancelled scheduler sessions', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'failed',
        schedulerError: 'Operation cancelled during tool execution',
      } as any),
    ).toBe('interrupted');
  });

  it('returns failed for non-interruption failures', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'failed',
        schedulerError: 'Request timed out',
      } as any),
    ).toBe('failed');
  });

  it('returns completed by default', () => {
    expect(
      getScheduledSessionDisplayState({
        schedulerExecutionStatus: 'completed',
      } as any),
    ).toBe('completed');
  });

  it('formats the generic interrupted reason', () => {
    expect(
      getScheduledSessionInterruptionReason({
        schedulerError: INTERRUPTED_SCHEDULED_SESSION_ERROR,
      } as any),
    ).toBe('App closed before completion');
  });

  it('formats skipped MCP readiness as an interrupted reason', () => {
    expect(
      getScheduledSessionInterruptionReason({
        schedulerError: 'skipped-mcp-not-ready',
      } as any),
    ).toBe('MCP server not ready');
  });

  it('formats interrupted details with skipped codes', () => {
    expect(
      getScheduledSessionInterruptionReason({
        schedulerError: 'Interrupted before completion: skipped-mcp-not-ready',
      } as any),
    ).toBe('MCP server not ready');
  });

  it('formats cancellation as an interrupted reason', () => {
    expect(
      getScheduledSessionInterruptionReason({
        schedulerError: 'Operation cancelled during model streaming',
      } as any),
    ).toBe('Cancelled by user');
  });
});