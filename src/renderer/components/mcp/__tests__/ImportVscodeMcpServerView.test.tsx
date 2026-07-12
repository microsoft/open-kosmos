/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { fireEvent, render } from '@testing-library/react'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}))

vi.mock('../ImportVscodeMcpServerViewHeader', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <button data-testid="back-btn" onClick={onBack}>Back</button>
  ),
}))

vi.mock('../ImportVscodeMcpServerViewContent', () => ({
  default: ({ onImportComplete }: { onImportComplete?: (count: number) => void }) => (
    <button data-testid="import-complete-btn" onClick={() => onImportComplete?.(2)}>Import</button>
  ),
}))

import ImportVscodeMcpServerView from '../ImportVscodeMcpServerView'

beforeEach(() => {
  mockNavigate.mockClear()
})

describe('ImportVscodeMcpServerView', () => {
  it('navigates back to MCP settings from the header', () => {
    render(<ImportVscodeMcpServerView />)
    fireEvent.click(document.querySelector('[data-testid="back-btn"]')!)
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp')
  })

  it('navigates back to MCP settings after import completes', () => {
    render(<ImportVscodeMcpServerView />)
    fireEvent.click(document.querySelector('[data-testid="import-complete-btn"]')!)
    expect(mockNavigate).toHaveBeenCalledWith('/settings/mcp')
  })
})
