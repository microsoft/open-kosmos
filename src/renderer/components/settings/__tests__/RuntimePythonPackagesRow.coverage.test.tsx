/** @vitest-environment happy-dom */
import React from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockShowSuccess = vi.hoisted(() => vi.fn())
const mockShowError = vi.hoisted(() => vi.fn())
vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}))
vi.mock('lucide-react', () => ({ Trash2: () => <span>trash</span> }))
vi.mock('../../../lib/utilities/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn() }) }))

const list = vi.fn()
const add = vi.fn()
const uninstall = vi.fn()
Object.defineProperty(window, 'electronAPI', {
  writable: true,
  value: { runtime: { listPythonPackages: list, addPythonPackages: add, uninstallPythonPackage: uninstall } },
})

import RuntimePythonPackagesRow from '../RuntimePythonPackagesRow'

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue([{ name: 'mcp', version: '1.0' }])
  add.mockResolvedValue(undefined)
  uninstall.mockResolvedValue(undefined)
})

describe('RuntimePythonPackagesRow', () => {
  it('renders nothing when not ready', () => {
    const { container } = render(<RuntimePythonPackagesRow ready={false} />)
    expect(container.firstChild).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('loads and lists packages when ready', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    await waitFor(() => expect(screen.getByText('mcp')).toBeTruthy())
  })

  it('adds packages and refreshes', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    fireEvent.change(screen.getByPlaceholderText(/mcp/), { target: { value: 'httpx, requests' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(add).toHaveBeenCalledWith(['httpx', 'requests']))
    expect(mockShowSuccess).toHaveBeenCalled()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('reports package busy state while adding', async () => {
    let resolveAdd!: () => void
    add.mockReturnValue(new Promise<void>((resolve) => { resolveAdd = resolve }))
    const onBusyChange = vi.fn()
    render(<RuntimePythonPackagesRow ready={true} onBusyChange={onBusyChange} />)
    fireEvent.change(screen.getByPlaceholderText(/mcp/), { target: { value: 'httpx' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true))

    await act(async () => { resolveAdd() })
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  })

  it('adds on Enter key', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    const input = screen.getByPlaceholderText(/mcp/)
    fireEvent.change(input, { target: { value: 'numpy' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(add).toHaveBeenCalledWith(['numpy']))
  })

  it('preserves comma version ranges', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    fireEvent.change(screen.getByPlaceholderText(/mcp/), { target: { value: 'mcp,httpx>=0.27,<1' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(add).toHaveBeenCalledWith(['mcp', 'httpx>=0.27,<1']))
  })

  it('does nothing on empty add', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/mcp/), { key: 'Enter' })
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(add).not.toHaveBeenCalled()
  })

  it('shows error toast when add fails', async () => {
    add.mockRejectedValue(new Error('bad'))
    render(<RuntimePythonPackagesRow ready={true} />)
    fireEvent.change(screen.getByPlaceholderText(/mcp/), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(mockShowError).toHaveBeenCalled())
  })

  it('shows error toast when add fails with non-Error', async () => {
    add.mockRejectedValue('boom')
    render(<RuntimePythonPackagesRow ready={true} />)
    fireEvent.change(screen.getByPlaceholderText(/mcp/), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(mockShowError).toHaveBeenCalled())
  })

  it('renders no list when there are no packages', async () => {
    list.mockResolvedValue([])
    const { container } = render(<RuntimePythonPackagesRow ready={true} />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(container.querySelector('.runtime-package-list')).toBeNull()
  })

  it('removes a package', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    await waitFor(() => expect(screen.getByText('mcp')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Remove mcp'))
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith('mcp'))
    expect(mockShowSuccess).toHaveBeenCalled()
  })

  it('shows error toast when remove fails', async () => {
    uninstall.mockRejectedValue('nope')
    render(<RuntimePythonPackagesRow ready={true} />)
    await waitFor(() => expect(screen.getByText('mcp')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Remove mcp'))
    await waitFor(() => expect(mockShowError).toHaveBeenCalled())
  })

  it('logs when initial load fails', async () => {
    list.mockRejectedValue(new Error('x'))
    render(<RuntimePythonPackagesRow ready={true} />)
    await waitFor(() => expect(list).toHaveBeenCalled())
  })

  it('keeps commas inside extras as one spec', async () => {
    render(<RuntimePythonPackagesRow ready={true} />)
    fireEvent.change(screen.getByPlaceholderText(/mcp/), { target: { value: 'requests[security,socks] mcp' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(add).toHaveBeenCalledWith(['requests[security,socks]', 'mcp']))
  })

  it('disables actions while the interpreter is updating', async () => {
    render(<RuntimePythonPackagesRow ready={true} updating={true} />)
    expect((screen.getByPlaceholderText(/mcp/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByText('Add') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reloads when the venv identity (refreshKey) changes', async () => {
    const { rerender } = render(<RuntimePythonPackagesRow ready={true} refreshKey="3.11" />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    rerender(<RuntimePythonPackagesRow ready={true} refreshKey="3.12" />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})
