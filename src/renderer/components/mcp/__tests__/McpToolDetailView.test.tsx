/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import McpToolDetailView from '../McpToolDetailView'

const tool = {
  name: 'search_web',
  description: 'Search the web',
  serverId: 'server-1',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
}

describe('McpToolDetailView', () => {
  it('renders the empty selection state when no tool is selected', () => {
    render(<McpToolDetailView tool={null} />)

    expect(screen.getByText('Select a Tool')).toBeInTheDocument()
    expect(screen.getByText('Choose a tool from the list to view detailed information')).toBeInTheDocument()
  })

  it('renders tool details and the managed back icon color', () => {
    const onBack = vi.fn()
    const { container } = render(<McpToolDetailView tool={tool as any} serverName="Main MCP" onBack={onBack} />)

    expect(screen.getByRole('heading', { name: 'search_web' })).toBeInTheDocument()
    expect(screen.getByText('Search the web')).toBeInTheDocument()
    expect(screen.getByText('server-1')).toBeInTheDocument()
    expect(screen.getByText(/"query"/)).toBeInTheDocument()

    const backPath = container.querySelector('button.back-btn path')
    expect(backPath?.getAttribute('fill')).toBe('var(--color-warm-900)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)

    fireEvent.click(screen.getByTitle('Back to tool list'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('uses fallback text for missing descriptions and invalid schemas', () => {
    render(<McpToolDetailView tool={{ ...tool, description: '', inputSchema: null } as any} />)

    expect(screen.getByText('No description available')).toBeInTheDocument()
    expect(screen.getByText('N/A')).toBeInTheDocument()
    expect(screen.queryByTitle('Back to tool list')).not.toBeInTheDocument()
  })

  it('stringifies schemas that cannot be JSON serialized', async () => {
    const circular: any = { type: 'object' }
    circular.self = circular

    render(<McpToolDetailView tool={{ ...tool, inputSchema: circular } as any} />)

    await waitFor(() => {
      expect(screen.getByText('[object Object]')).toBeInTheDocument()
    })
  })
})
