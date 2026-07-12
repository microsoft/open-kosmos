/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockShowSuccess = vi.hoisted(() => vi.fn())
const mockShowError = vi.hoisted(() => vi.fn())
const mockUpdateBrowserSettings = vi.hoisted(() => vi.fn())

let mockProfile: Record<string, any> | null = {}

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}))

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ data: { profile: mockProfile } }),
}))

vi.mock('../BrowserSettingsHeaderView', () => ({
  default: () => <div data-testid="browser-header" />,
}))

vi.mock('../BrowserSettingsContentView', () => ({
  default: (props: any) => (
    <div data-testid="browser-content">
      <input
        data-testid="enable-toggle"
        type="checkbox"
        checked={props.enabled}
        onChange={(e) => props.onToggle(e.target.checked)}
      />
      <span data-testid="enabled-val">{String(props.enabled)}</span>
      {props.error && <span data-testid="error-val">{props.error}</span>}
    </div>
  ),
}))

import BrowserSettingsView from '../BrowserSettingsView'

beforeEach(() => {
  vi.clearAllMocks()
  mockProfile = { alias: 'alice' }
  mockUpdateBrowserSettings.mockResolvedValue({ success: true })
  ;(globalThis as any).window.electronAPI = {
    profile: { updateBrowserSettings: mockUpdateBrowserSettings },
  }
})

describe('BrowserSettingsView', () => {
  it('renders header and content', () => {
    render(<BrowserSettingsView />)
    expect(screen.getByTestId('browser-header')).toBeTruthy()
    expect(screen.getByTestId('browser-content')).toBeTruthy()
  })

  it('defaults to disabled when no browser config present', () => {
    render(<BrowserSettingsView />)
    expect(screen.getByTestId('enabled-val').textContent).toBe('false')
  })

  it('initializes enabled from the profile', () => {
    mockProfile = { alias: 'alice', browser: { enabled: true } }
    render(<BrowserSettingsView />)
    expect(screen.getByTestId('enabled-val').textContent).toBe('true')
  })

  it('enables the browser and shows success toast', async () => {
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockUpdateBrowserSettings).toHaveBeenCalledWith('alice', { enabled: true })
      expect(mockShowSuccess).toHaveBeenCalledWith('Embedded browser enabled')
    })
  })

  it('disables the browser and shows success toast', async () => {
    mockProfile = { alias: 'alice', browser: { enabled: true } }
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockUpdateBrowserSettings).toHaveBeenCalledWith('alice', { enabled: false })
      expect(mockShowSuccess).toHaveBeenCalledWith('Embedded browser disabled')
    })
  })

  it('shows error when there is no signed-in user', async () => {
    mockProfile = null
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: No signed-in user')
      expect(screen.getByTestId('error-val').textContent).toContain('No signed-in user')
    })
    expect(mockUpdateBrowserSettings).not.toHaveBeenCalled()
  })

  it('shows error when update reports failure', async () => {
    mockUpdateBrowserSettings.mockResolvedValue({ success: false, error: 'disk full' })
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: disk full')
      expect(screen.getByTestId('error-val').textContent).toContain('Failed to update')
    })
  })

  it('falls back to "Unknown error" when failure has no error field', async () => {
    mockUpdateBrowserSettings.mockResolvedValue({ success: false })
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: Unknown error')
    })
  })

  it('shows error when update throws an Error', async () => {
    mockUpdateBrowserSettings.mockRejectedValue(new Error('ipc crash'))
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: ipc crash')
    })
  })

  it('stringifies a non-Error rejection value', async () => {
    mockUpdateBrowserSettings.mockRejectedValue('plain string boom')
    render(<BrowserSettingsView />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('enable-toggle'))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to update: plain string boom')
      expect(screen.getByTestId('error-val').textContent).toContain('plain string boom')
    })
  })
})
