/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import ComputerUseSettingsContentView from '../ComputerUseSettingsContentView'

function setup(overrides: Partial<React.ComponentProps<typeof ComputerUseSettingsContentView>> = {}) {
  const props = {
    enabled: true,
    requireConfirmation: true,
    alwaysAllowedApps: [] as string[],
    permissions: null as { screenRecording: string; accessibility: boolean } | null,
    error: null as string | null,
    platformSupported: true,
    unsupportedReason: null as string | null,
    onToggle: vi.fn(),
    onToggleRequireConfirmation: vi.fn(),
    onAddApp: vi.fn(),
    onRemoveApp: vi.fn(),
    onGrantPermissions: vi.fn(),
    ...overrides,
  }
  render(<ComputerUseSettingsContentView {...props} />)
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('ComputerUseSettingsContentView', () => {
  it('toggles the master switch', () => {
    const props = setup({ enabled: false })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(props.onToggle).toHaveBeenCalledWith(true)
  })

  it('disables confirmation toggle and app input when master is off', () => {
    setup({ enabled: false })
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[1].disabled).toBe(true)
    const input = screen.getByLabelText('App name or process name') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('disables Computer Use controls on unsupported platforms', () => {
    setup({
      enabled: true,
      platformSupported: false,
      unsupportedReason: 'Computer Use is unavailable on Windows ARM64.',
    })
    expect(screen.getByTestId('unsupported-platform-card').textContent).toContain('Windows ARM64')
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[0].checked).toBe(false)
    expect(checkboxes[0].disabled).toBe(true)
    expect(checkboxes[1].disabled).toBe(true)
    expect((screen.getByLabelText('App name or process name') as HTMLInputElement).disabled).toBe(true)
  })

  it('toggles the confirmation requirement when enabled', () => {
    const props = setup({ enabled: true, requireConfirmation: true })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    expect(props.onToggleRequireConfirmation).toHaveBeenCalledWith(false)
  })

  it('renders the empty allowlist placeholder', () => {
    setup({ alwaysAllowedApps: [] })
    expect(screen.getByTestId('allowlist-empty')).toBeTruthy()
  })

  it('renders the allowlist and removes an app', () => {
    const props = setup({ alwaysAllowedApps: ['Safari', 'Notes'] })
    expect(screen.getByTestId('allowlist')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove Safari'))
    expect(props.onRemoveApp).toHaveBeenCalledWith('Safari')
  })

  it('displays an error message', () => {
    setup({ error: 'boom' })
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('adds an app via the button and clears the input', () => {
    const props = setup()
    const input = screen.getByLabelText('App name or process name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Mail' } })
    const addButton = screen.getByText('Add') as HTMLButtonElement
    expect(addButton.disabled).toBe(false)
    fireEvent.click(addButton)
    expect(props.onAddApp).toHaveBeenCalledWith('Mail')
    expect(input.value).toBe('')
  })

  it('adds an app via the Enter key', () => {
    const props = setup()
    const input = screen.getByLabelText('App name or process name')
    fireEvent.change(input, { target: { value: 'Xcode' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onAddApp).toHaveBeenCalledWith('Xcode')
  })

  it('ignores a non-Enter key', () => {
    const props = setup()
    const input = screen.getByLabelText('App name or process name')
    fireEvent.change(input, { target: { value: 'Xcode' } })
    fireEvent.keyDown(input, { key: 'a' })
    expect(props.onAddApp).not.toHaveBeenCalled()
  })

  it('does not add blank input on Enter', () => {
    const props = setup()
    const input = screen.getByLabelText('App name or process name')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onAddApp).not.toHaveBeenCalled()
  })

  it('keeps the Add button disabled for blank input', () => {
    setup()
    const addButton = screen.getByText('Add') as HTMLButtonElement
    expect(addButton.disabled).toBe(true)
  })

  it('hides the permissions card when status is unknown (null)', () => {
    setup({ permissions: null })
    expect(screen.queryByTestId('permissions-card')).toBeNull()
  })

  it('hides the permissions card when all permissions are granted', () => {
    setup({ permissions: { screenRecording: 'granted', accessibility: true } })
    expect(screen.queryByTestId('permissions-card')).toBeNull()
  })

  it('shows the permissions card with per-permission status when a permission is missing', () => {
    const props = setup({ permissions: { screenRecording: 'granted', accessibility: false } })
    expect(screen.getByTestId('permissions-card')).toBeTruthy()
    expect(screen.getByTestId('perm-screen-recording').textContent).toBe('Granted')
    expect(screen.getByTestId('perm-accessibility').textContent).toBe('Required')
    fireEvent.click(screen.getByTestId('grant-permissions'))
    expect(props.onGrantPermissions).toHaveBeenCalledTimes(1)
  })

  it('marks screen recording Required when it is not granted', () => {
    setup({ permissions: { screenRecording: 'denied', accessibility: true } })
    expect(screen.getByTestId('permissions-card')).toBeTruthy()
    expect(screen.getByTestId('perm-screen-recording').textContent).toBe('Required')
    expect(screen.getByTestId('perm-accessibility').textContent).toBe('Granted')
  })
})
