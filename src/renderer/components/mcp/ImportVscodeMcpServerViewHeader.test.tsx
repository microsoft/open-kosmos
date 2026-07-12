/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ImportVscodeMcpServerViewHeader from './ImportVscodeMcpServerViewHeader'

describe('ImportVscodeMcpServerViewHeader', () => {
  it('renders the Import from VS Code title', () => {
    render(
      <MemoryRouter>
        <ImportVscodeMcpServerViewHeader />
      </MemoryRouter>
    )
    expect(screen.getByText('Import from VS Code')).toBeTruthy()
  })

  it('calls onBack when provided and the back button is clicked', () => {
    const onBack = vi.fn()
    render(
      <MemoryRouter>
        <ImportVscodeMcpServerViewHeader onBack={onBack} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByTitle('Back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('falls back to navigation when no onBack is provided', () => {
    render(
      <MemoryRouter>
        <ImportVscodeMcpServerViewHeader />
      </MemoryRouter>
    )
    expect(() => fireEvent.click(screen.getByTitle('Back'))).not.toThrow()
  })
})
