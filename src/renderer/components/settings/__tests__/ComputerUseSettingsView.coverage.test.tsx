/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockShowSuccess = vi.hoisted(() => vi.fn())
const mockShowError = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockGetStatus = vi.hoisted(() => vi.fn())

let mockProfile: Record<string, any> | null = {}

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}))

vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: () => mockRefresh() },
}))

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ data: { profile: mockProfile } }),
}))

vi.mock('../ComputerUseSettingsHeaderView', () => ({
  default: () => <div data-testid="header" />,
}))

vi.mock('../ComputerUseSettingsContentView', () => ({
  default: (props: any) => (
    <div data-testid="content">
      <span data-testid="enabled">{String(props.enabled)}</span>
      <span data-testid="rc">{String(props.requireConfirmation)}</span>
      <span data-testid="apps">{props.alwaysAllowedApps.join(',')}</span>
      <span data-testid="platform-supported">{String(props.platformSupported)}</span>
      <span data-testid="unsupported-reason">{props.unsupportedReason || ''}</span>
      <span data-testid="perms">
        {props.permissions
          ? `${props.permissions.screenRecording}:${String(props.permissions.accessibility)}`
          : 'none'}
      </span>
      {props.error && <span data-testid="error">{props.error}</span>}
      <button data-testid="toggle-on" onClick={() => props.onToggle(true)} />
      <button data-testid="toggle-off" onClick={() => props.onToggle(false)} />
      <button data-testid="rc-on" onClick={() => props.onToggleRequireConfirmation(true)} />
      <button data-testid="rc-off" onClick={() => props.onToggleRequireConfirmation(false)} />
      <button data-testid="add-safari" onClick={() => props.onAddApp('Safari')} />
      <button data-testid="add-safari-lower" onClick={() => props.onAddApp('safari')} />
      <button data-testid="add-safari-exe" onClick={() => props.onAddApp('Safari.exe')} />
      <button data-testid="add-blank" onClick={() => props.onAddApp('   ')} />
      <button data-testid="add-notes" onClick={() => props.onAddApp('Notes')} />
      <button data-testid="remove-safari" onClick={() => props.onRemoveApp('Safari')} />
      <button data-testid="grant" onClick={() => props.onGrantPermissions()} />
    </div>
  ),
}))

import ComputerUseSettingsView from '../ComputerUseSettingsView'

beforeEach(() => {
  vi.clearAllMocks()
  mockProfile = { alias: 'alice' }
  mockUpdate.mockResolvedValue({ success: true })
  mockGetStatus.mockResolvedValue({
    success: true,
    status: { screenRecording: 'granted', accessibility: true, platform: 'darwin', arch: 'arm64', platformSupported: true },
  })
  ;(globalThis as any).window.electronAPI = {
    profile: { updateComputerUseSettings: mockUpdate, getComputerUseStatus: mockGetStatus },
  }
})

describe('ComputerUseSettingsView', () => {
  it('renders header and content with defaults', async () => {
    await act(async () => {
      render(<ComputerUseSettingsView />)
    })
    expect(screen.getByTestId('header')).toBeTruthy()
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('rc').textContent).toBe('true')
    expect(screen.getByTestId('apps').textContent).toBe('')
  })

  it('initializes from the profile', async () => {
    mockProfile = { alias: 'alice', computerUse: { enabled: true, requireConfirmation: false, alwaysAllowedApps: ['Safari'] } }
    await act(async () => {
      render(<ComputerUseSettingsView />)
    })
    expect(screen.getByTestId('enabled').textContent).toBe('true')
    expect(screen.getByTestId('rc').textContent).toBe('false')
    expect(screen.getByTestId('apps').textContent).toBe('Safari')
  })

  it('treats a shared enabled profile as locally disabled on unsupported platforms', async () => {
    mockProfile = { alias: 'alice', computerUse: { enabled: true } }
    mockGetStatus.mockResolvedValue({
      success: true,
      status: {
        screenRecording: 'granted',
        accessibility: true,
        platform: 'win32',
        arch: 'arm64',
        platformSupported: false,
        unsupportedReason: 'Computer Use is unavailable on Windows ARM64.',
      },
    })
    render(<ComputerUseSettingsView />)
    await waitFor(() => expect(screen.getByTestId('platform-supported').textContent).toBe('false'))

    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(screen.getByTestId('unsupported-reason').textContent).toContain('Windows ARM64')
  })

  it('enables and disables computer use', async () => {
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('alice', { enabled: true })
      expect(mockShowSuccess).toHaveBeenCalledWith('Computer Use enabled')
    })
    await act(async () => fireEvent.click(screen.getByTestId('toggle-off')))
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('alice', { enabled: false })
      expect(mockShowSuccess).toHaveBeenCalledWith('Computer Use disabled')
    })
  })

  it('toggles the confirmation requirement both ways', async () => {
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('rc-off')))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('alice', { requireConfirmation: false }),
    )
    await act(async () => fireEvent.click(screen.getByTestId('rc-on')))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('alice', { requireConfirmation: true }),
    )
    expect(mockShowSuccess).toHaveBeenCalledWith('Confirmation requirement relaxed')
    expect(mockShowSuccess).toHaveBeenCalledWith('Confirmation required for actions')
  })

  it('adds a new app but skips duplicates', async () => {
    mockProfile = { alias: 'alice', computerUse: { enabled: true, alwaysAllowedApps: ['Safari'] } }
    render(<ComputerUseSettingsView />)
    // duplicate -> no call
    await act(async () => fireEvent.click(screen.getByTestId('add-safari')))
    expect(mockUpdate).not.toHaveBeenCalled()
    // new -> appended
    await act(async () => fireEvent.click(screen.getByTestId('add-notes')))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('alice', { alwaysAllowedApps: ['Safari', 'Notes'] }),
    )
    expect(mockShowSuccess).toHaveBeenCalledWith('Added Notes to always-allowed apps')
  })

  it('skips case-insensitive / .exe duplicates and blank entries', async () => {
    mockProfile = { alias: 'alice', computerUse: { enabled: true, alwaysAllowedApps: ['Safari'] } }
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('add-safari-lower')))
    await act(async () => fireEvent.click(screen.getByTestId('add-safari-exe')))
    await act(async () => fireEvent.click(screen.getByTestId('add-blank')))
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('removes an app', async () => {
    mockProfile = { alias: 'alice', computerUse: { enabled: true, alwaysAllowedApps: ['Safari'] } }
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('remove-safari')))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('alice', { alwaysAllowedApps: [] }),
    )
    expect(mockShowSuccess).toHaveBeenCalledWith('Removed Safari from always-allowed apps')
  })

  it('accumulates two rapid adds instead of overwriting from a stale snapshot', async () => {
    // Both clicks resolve before the profile cache re-renders. Reading the render snapshot would
    // make the second add start from the original empty list and drop the first app; building on
    // the synchronously-updated ref keeps both.
    render(<ComputerUseSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-safari'))
      fireEvent.click(screen.getByTestId('add-notes'))
    })
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('alice', { alwaysAllowedApps: ['Safari', 'Notes'] }),
    )
  })

  it('rolls back a failed allowlist edit before applying the next edit', async () => {
    mockUpdate
      .mockResolvedValueOnce({ success: false, error: 'disk full' })
      .mockResolvedValueOnce({ success: true })
    render(<ComputerUseSettingsView />)

    await act(async () => fireEvent.click(screen.getByTestId('add-safari')))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('disk full')
      expect(mockUpdate).toHaveBeenNthCalledWith(1, 'alice', { alwaysAllowedApps: ['Safari'] })
    })

    await act(async () => fireEvent.click(screen.getByTestId('add-notes')))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenNthCalledWith(2, 'alice', { alwaysAllowedApps: ['Notes'] }),
    )
  })

  it('re-syncs the allowlist ref when the profile loads later and builds edits on it', async () => {
    // The allowlist can arrive a render AFTER mount (async profile load). A new add must build on
    // the loaded list, not wipe it by starting from the mount-time empty snapshot.
    const { rerender } = render(<ComputerUseSettingsView />)
    mockProfile = { alias: 'alice', computerUse: { enabled: true, alwaysAllowedApps: ['Chrome'] } }
    await act(async () => {
      rerender(<ComputerUseSettingsView />)
    })
    expect(screen.getByTestId('apps').textContent).toBe('Chrome')
    await act(async () => fireEvent.click(screen.getByTestId('add-notes')))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('alice', { alwaysAllowedApps: ['Chrome', 'Notes'] }),
    )
  })

  it('shows an error when there is no signed-in user', async () => {
    mockProfile = {}
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('No signed-in user')
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: No signed-in user')
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('surfaces a failed update result', async () => {
    mockUpdate.mockResolvedValue({ success: false, error: 'disk full' })
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('disk full')
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: disk full')
    })
  })

  it('surfaces a thrown update error', async () => {
    mockUpdate.mockRejectedValue(new Error('ipc broke'))
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('ipc broke')
    })
  })

  it('surfaces a failed update without an error message', async () => {
    mockUpdate.mockResolvedValue({ success: false })
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('Unknown error')
    })
  })

  it('refreshes the renderer MCP tool cache after a successful enable toggle', async () => {
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('alice', { enabled: true })
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('does not refresh the MCP tool cache when the toggle fails to persist', async () => {
    mockUpdate.mockResolvedValue({ success: false, error: 'nope' })
    render(<ComputerUseSettingsView />)
    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toContain('nope'))
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('blocks enable attempts on unsupported platforms without writing the profile', async () => {
    mockGetStatus.mockResolvedValue({
      success: true,
      status: {
        screenRecording: 'granted',
        accessibility: true,
        platform: 'win32',
        arch: 'arm64',
        platformSupported: false,
        unsupportedReason: 'Computer Use is unavailable on Windows ARM64.',
      },
    })
    render(<ComputerUseSettingsView />)
    await waitFor(() => expect(screen.getByTestId('platform-supported').textContent).toBe('false'))

    await act(async () => fireEvent.click(screen.getByTestId('toggle-on')))

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Windows ARM64'))
  })

  it('loads the OS permission status on mount', async () => {
    render(<ComputerUseSettingsView />)
    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledWith(false)
      expect(screen.getByTestId('perms').textContent).toBe('granted:true')
    })
  })

  it('requests a permission grant when the Grant button is clicked', async () => {
    render(<ComputerUseSettingsView />)
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith(false))
    await act(async () => fireEvent.click(screen.getByTestId('grant')))
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith(true))
  })

  it('ignores an unsuccessful permission status response', async () => {
    mockGetStatus.mockResolvedValue({ success: false })
    render(<ComputerUseSettingsView />)
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith(false))
    expect(screen.getByTestId('perms').textContent).toBe('none')
  })

  it('tolerates a thrown permission status read', async () => {
    mockGetStatus.mockRejectedValue(new Error('boom'))
    render(<ComputerUseSettingsView />)
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith(false))
    expect(screen.getByTestId('perms').textContent).toBe('none')
  })
})
