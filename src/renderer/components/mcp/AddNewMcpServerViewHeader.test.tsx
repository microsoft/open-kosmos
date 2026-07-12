/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AddNewMcpServerViewHeader from './AddNewMcpServerViewHeader'

describe('AddNewMcpServerViewHeader', () => {
  it('shows the add title when not in edit mode and falls back to navigation', () => {
    render(
      <MemoryRouter>
        <AddNewMcpServerViewHeader />
      </MemoryRouter>
    )
    expect(screen.getByText('Add New Server')).toBeTruthy()
    expect(() => fireEvent.click(screen.getByTitle('Back'))).not.toThrow()
  })

  it('shows the edit title when an edit server name is provided and calls onBack', () => {
    const onBack = vi.fn()
    render(
      <MemoryRouter>
        <AddNewMcpServerViewHeader onBack={onBack} editServerName="my-server" />
      </MemoryRouter>
    )
    expect(screen.getByText('Edit Server')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
