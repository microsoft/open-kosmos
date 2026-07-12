/** @vitest-environment happy-dom */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock CSS files
vi.mock('../../styles/ContentView.css', () => ({}))
vi.mock('../../styles/ToolbarSettingsView.css', () => ({}))
vi.mock('../../styles/RuntimeSettings.css', () => ({}))
vi.mock('../../styles/Header.css', () => ({}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Globe: () => React.createElement('span', { 'data-testid': 'icon-globe' }),
}))

import BrowserSettingsContentView from '../BrowserSettingsContentView'
import BrowserSettingsHeaderView from '../BrowserSettingsHeaderView'

describe('BrowserSettingsContentView', () => {
  const makeProps = (overrides: any = {}) => ({
    enabled: false,
    error: null,
    onToggle: vi.fn(),
    ...overrides,
  })

  it('renders the Enable Browser toggle label', () => {
    render(<BrowserSettingsContentView {...makeProps()} />)
    expect(screen.getByText('Enable Browser')).toBeInTheDocument()
  })

  it('reflects the disabled state (checkbox unchecked)', () => {
    render(<BrowserSettingsContentView {...makeProps({ enabled: false })} />)
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('reflects the enabled state (checkbox checked)', () => {
    render(<BrowserSettingsContentView {...makeProps({ enabled: true })} />)
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('calls onToggle(true) when an unchecked box is clicked', () => {
    const onToggle = vi.fn()
    render(<BrowserSettingsContentView {...makeProps({ enabled: false, onToggle })} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('calls onToggle(false) when a checked box is clicked', () => {
    const onToggle = vi.fn()
    render(<BrowserSettingsContentView {...makeProps({ enabled: true, onToggle })} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('does not render an error block when error is null', () => {
    render(<BrowserSettingsContentView {...makeProps({ error: null })} />)
    expect(screen.queryByText('Error:')).not.toBeInTheDocument()
  })

  it('renders the error block when error is set', () => {
    render(<BrowserSettingsContentView {...makeProps({ error: 'Boom' })} />)
    expect(screen.getByText('Error:')).toBeInTheDocument()
    expect(screen.getByText('Boom')).toBeInTheDocument()
  })
})

describe('BrowserSettingsHeaderView', () => {
  it('renders the Browser title and Globe icon', () => {
    render(<BrowserSettingsHeaderView />)
    expect(screen.getByText('Browser')).toBeInTheDocument()
    expect(screen.getByTestId('icon-globe')).toBeInTheDocument()
  })
})
