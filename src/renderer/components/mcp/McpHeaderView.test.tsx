/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import McpHeaderView from './McpHeaderView'

describe('McpHeaderView', () => {
  it('renders the title and status badges', () => {
    render(
      <McpHeaderView
        totalServers={3}
        connectedServers={2}
        totalTools={10}
        onAddMenuToggle={vi.fn()}
      />
    )
    expect(screen.getByText('MCP Connector')).toBeTruthy()
    expect(screen.getByText('total servers: 3')).toBeTruthy()
    expect(screen.getByText('connected: 2')).toBeTruthy()
    expect(screen.getByText('available tools: 10')).toBeTruthy()
  })

  it('invokes onAddMenuToggle with the button element when clicked', () => {
    const onAddMenuToggle = vi.fn()
    render(
      <McpHeaderView
        totalServers={0}
        connectedServers={0}
        totalTools={0}
        onAddMenuToggle={onAddMenuToggle}
      />
    )
    fireEvent.click(screen.getByTitle('Add MCP Server'))
    expect(onAddMenuToggle).toHaveBeenCalledTimes(1)
    expect(onAddMenuToggle.mock.calls[0][0]).toBeInstanceOf(HTMLElement)
  })
})
