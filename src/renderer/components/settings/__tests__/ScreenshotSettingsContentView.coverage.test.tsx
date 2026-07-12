// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockShortcutRecorder } = vi.hoisted(() => ({
  mockShortcutRecorder: vi.fn((props) => (
    <button
      type="button"
      data-testid="shortcut-recorder"
      data-value={props.value}
      data-disabled={String(props.disabled)}
      data-require-modifier={String(props.requireModifier)}
      onClick={() => props.onChange('CommandOrControl+Shift+X')}
    >
      Shortcut recorder
    </button>
  )),
}))

vi.mock('../../ui/ShortcutRecorder', () => ({
  default: mockShortcutRecorder,
}))

vi.mock('../../../styles/ContentView.css', () => ({}))
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}))

import ScreenshotSettingsContentView from '../ScreenshotSettingsContentView'

const makeSettings = (overrides = {}) => ({
  enabled: true,
  shortcut: 'CommandOrControl+Shift+S',
  shortcutEnabled: true,
  savePath: '',
  freRejected: false,
  ...overrides,
})

const makeProps = (overrides = {}) => ({
  settings: makeSettings(),
  error: null,
  onSettingsChange: vi.fn(),
  onShortcutChange: vi.fn(),
  onSelectSavePath: vi.fn(),
  onResetSavePath: vi.fn(),
  ...overrides,
})

describe('ScreenshotSettingsContentView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders default save path, enabled shortcut recorder, and no error', () => {
    render(<ScreenshotSettingsContentView {...makeProps()} />)

    expect(screen.queryByText('Error:')).not.toBeInTheDocument()
    expect(screen.getByText('Enable Screenshot')).toBeInTheDocument()
    expect(screen.getByText('Enable Shortcut')).toBeInTheDocument()
    expect(screen.getByText('Downloads (Default)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to Default' })).not.toBeInTheDocument()

    const pathDisplay = screen.getByText('Downloads (Default)')
    expect(pathDisplay.style.backgroundColor).toBe('var(--color-neutral-100)')
    expect(pathDisplay.style.borderColor).toBe('var(--color-neutral-200)')
    expect(pathDisplay.style.color).toBe('var(--color-neutral-500)')

    const recorder = screen.getByTestId('shortcut-recorder')
    expect(recorder).toHaveAttribute('data-value', 'CommandOrControl+Shift+S')
    expect(recorder).toHaveAttribute('data-disabled', 'false')
    expect(recorder).toHaveAttribute('data-require-modifier', 'true')
    expect(mockShortcutRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'CommandOrControl+Shift+S',
        requireModifier: true,
        disabled: false,
      }),
      {}
    )
  })

  it('renders an error and updates screenshot enabled state', () => {
    const onSettingsChange = vi.fn()
    render(
      <ScreenshotSettingsContentView
        {...makeProps({
          error: 'Screenshot failed',
          settings: makeSettings({ enabled: false }),
          onSettingsChange,
        })}
      />
    )

    expect(screen.getByText('Error:')).toBeInTheDocument()
    expect(screen.getByText('Screenshot failed')).toBeInTheDocument()

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[0]).not.toBeChecked()
    fireEvent.click(checkboxes[0])
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        shortcutEnabled: true,
        shortcut: 'CommandOrControl+Shift+S',
      })
    )
  })

  it('updates shortcut enabled state and disables recorder when shortcut is off', () => {
    const onSettingsChange = vi.fn()
    render(
      <ScreenshotSettingsContentView
        {...makeProps({
          settings: makeSettings({ shortcutEnabled: false }),
          onSettingsChange,
        })}
      />
    )

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes[1]).not.toBeChecked()
    expect(screen.getByTestId('shortcut-recorder')).toHaveAttribute('data-disabled', 'true')

    fireEvent.click(checkboxes[1])
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcutEnabled: true,
      })
    )
  })

  it('forwards shortcut changes and browse clicks', async () => {
    const onShortcutChange = vi.fn()
    const onSelectSavePath = vi.fn()
    render(
      <ScreenshotSettingsContentView
        {...makeProps({
          onShortcutChange,
          onSelectSavePath,
        })}
      />
    )

    fireEvent.click(screen.getByTestId('shortcut-recorder'))
    expect(onShortcutChange).toHaveBeenCalledWith('CommandOrControl+Shift+X')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Browse...' }))
    })
    await waitFor(() => expect(onSelectSavePath).toHaveBeenCalledTimes(1))
  })

  it('renders custom save path token styles and resets to default', () => {
    const onResetSavePath = vi.fn()
    render(
      <ScreenshotSettingsContentView
        {...makeProps({
          settings: makeSettings({ savePath: '/Users/example/screenshots' }),
          onResetSavePath,
        })}
      />
    )

    const pathDisplay = screen.getByText('/Users/example/screenshots')
    expect(pathDisplay.style.color).toBe('var(--color-warm-900)')
    const resetButton = screen.getByRole('button', { name: 'Reset to Default' })
    expect(resetButton.style.color).toBe('var(--color-neutral-500)')

    fireEvent.click(resetButton)
    expect(onResetSavePath).toHaveBeenCalledTimes(1)
  })
})
