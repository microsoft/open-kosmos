/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import HookDetailPanel from '../HookDetailPanel';
import type { HookDefinition } from '@shared/ipc/agentHooks';

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: 'h1',
    name: 'My Hook',
    description: 'A description',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    matcher: 'execute_command',
    action: { type: 'command', command: 'fmt' },
    createdAt: 'created-ts',
    updatedAt: 'updated-ts',
    ...overrides,
  };
}

function propertyValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.parentElement?.querySelector('.hook-detail-property-value')?.textContent ?? '';
}

describe('HookDetailPanel', () => {
  it('shows an empty state when no hook is selected', () => {
    render(<HookDetailPanel hook={null} />);
    expect(screen.getByText('Select a hook to view its configuration.')).toBeTruthy();
  });

  it('renders a tool-detail-style header with name, summary, status, source and version', () => {
    render(<HookDetailPanel hook={makeHook()} />);

    expect(screen.getByText('My Hook', { selector: '.hook-detail-name' })).toBeTruthy();
    expect(screen.getAllByText('Runs a local command')).toHaveLength(2);
    expect(screen.getByText('enabled', { selector: '.hook-status.enabled' })).toBeTruthy();
    expect(screen.getByText('ON-DEVICE')).toBeTruthy();
    expect(screen.getByText('v1.0.0')).toBeTruthy();
  });

  it('renders description and trigger sections from hook semantics', () => {
    render(
      <HookDetailPanel
        hook={makeHook({
          action: { type: 'command', command: 'fmt', if: 'execute_command(*.ts)' },
        })}
      />,
    );

    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('A description')).toBeTruthy();
    expect(screen.getByText('Trigger')).toBeTruthy();
    expect(propertyValue('Event')).toBe('PreToolUse');
    expect(propertyValue('Matcher')).toBe('execute_command');
    expect(propertyValue('Condition')).toBe('execute_command(*.ts)');
  });

  it('falls back to useful trigger and description values when optional fields are absent', () => {
    render(<HookDetailPanel hook={makeHook({ description: undefined, matcher: undefined, version: '' })} />);

    expect(screen.getByText('No description available')).toBeTruthy();
    expect(propertyValue('Matcher')).toBe('All tools');
    expect(screen.queryByText('Condition')).toBeNull();
    expect(screen.queryByText(/^v1\.0\.0$/)).toBeNull();
  });

  it('renders a command action as a focused command block with execution properties', () => {
    render(
      <HookDetailPanel
        hook={makeHook({
          action: {
            type: 'command',
            command: 'fmt',
            args: ['--write', 'src'],
            timeout: 30,
            async: true,
          },
        })}
      />,
    );

    expect(screen.getByText('Action')).toBeTruthy();
    expect(screen.getByText('Command')).toBeTruthy();
    expect(screen.getByTestId('detail-command').textContent).toBe('fmt --write src');
    expect(propertyValue('Async execution')).toBe('Yes');
    expect(propertyValue('Timeout')).toBe('30s');
  });

  it('renders command defaults when args, async and timeout are absent', () => {
    render(<HookDetailPanel hook={makeHook({ action: { type: 'command', command: 'notify' } })} />);

    expect(screen.getByTestId('detail-command').textContent).toBe('notify');
    expect(propertyValue('Async execution')).toBe('No');
    expect(propertyValue('Timeout')).toBe('Default');
  });

  it('renders timeoutMs when only legacy millisecond timeout is present', () => {
    render(<HookDetailPanel hook={makeHook({ action: { type: 'command', command: 'notify', timeoutMs: 30000 } })} />);
    expect(propertyValue('Timeout')).toBe('30000ms');
  });

  it('renders an http action as an endpoint block with headers and body blocks', () => {
    render(
      <HookDetailPanel
        hook={makeHook({
          event: 'PostToolUse',
          matcher: undefined,
          action: {
            type: 'http',
            if: 'Fetch(*)',
            url: 'https://x.test/hook',
            method: 'PUT',
            headers: { Authorization: 'Bearer token', 'X-Trace': 'on' },
            body: '{"kind":"review"}',
          },
        })}
      />,
    );

    expect(screen.getByText('HTTP')).toBeTruthy();
    expect(screen.getAllByText('Sends a PUT request')).toHaveLength(2);
    expect(screen.getByText('PUT', { selector: '.hook-detail-method' })).toBeTruthy();
    expect(screen.getByText('https://x.test/hook')).toBeTruthy();
    expect(propertyValue('Condition')).toBe('Fetch(*)');
    expect(screen.getByTestId('detail-headers').textContent).toContain('Authorization: Bearer token');
    expect(screen.getByTestId('detail-headers').textContent).toContain('X-Trace: on');
    expect(screen.getByTestId('detail-body').textContent).toBe('{"kind":"review"}');
  });

  it('renders http defaults and omits empty header/body blocks', () => {
    render(
      <HookDetailPanel
        hook={makeHook({
          action: { type: 'http', url: 'https://y.test/hook' },
        })}
      />,
    );

    expect(screen.getAllByText('Sends a POST request')).toHaveLength(2);
    expect(screen.getByText('POST', { selector: '.hook-detail-method' })).toBeTruthy();
    expect(screen.queryByText('Headers')).toBeNull();
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('renders metadata while hiding remote version when unavailable', () => {
    render(<HookDetailPanel hook={makeHook()} />);

    expect(screen.getByText('Metadata')).toBeTruthy();
    expect(propertyValue('Hook ID')).toBe('h1');
    expect(propertyValue('Created')).toBe('created-ts');
    expect(propertyValue('Updated')).toBe('updated-ts');
    expect(screen.queryByText('Remote version')).toBeNull();
  });

  it('renders remote version metadata when available', () => {
    render(<HookDetailPanel hook={makeHook({ remoteVersion: '2.0.0' })} />);
    expect(propertyValue('Remote version')).toBe('v2.0.0');
  });

  it('renders disabled status in the header', () => {
    render(<HookDetailPanel hook={makeHook({ enabled: false })} />);
    expect(screen.getByText('disabled', { selector: '.hook-status.disabled' })).toBeTruthy();
  });
});
