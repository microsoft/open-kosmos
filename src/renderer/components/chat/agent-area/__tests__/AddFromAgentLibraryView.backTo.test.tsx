/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, fireEvent } from '@testing-library/react'

const mockNavigate = vi.fn()
let mockLocationState: Record<string, unknown> = {}

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState, pathname: '/agent/chat/creation/agent-library' }),
}))

vi.mock('../AddFromAgentLibraryViewHeader', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <button data-testid="back-btn" onClick={onBack}>Back</button>
  ),
}))

vi.mock('../AddFromAgentLibraryViewContent', () => ({ default: () => <div>content</div> }))

import AddFromAgentLibraryView from '../AddFromAgentLibraryView'

beforeEach(() => {
  mockNavigate.mockClear()
  mockLocationState = {}
})

describe('AddFromAgentLibraryView back navigation', () => {
  it('navigates to default creation route when no backTo state', () => {
    render(<AddFromAgentLibraryView />)
    fireEvent.click(document.querySelector('[data-testid="back-btn"]')!)
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation')
  })

  it('navigates to PM Project creation when backTo is set', () => {
    mockLocationState = { backTo: '/agent/chat/creation/pm-project' }
    render(<AddFromAgentLibraryView />)
    fireEvent.click(document.querySelector('[data-testid="back-btn"]')!)
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/creation/pm-project')
  })
})
