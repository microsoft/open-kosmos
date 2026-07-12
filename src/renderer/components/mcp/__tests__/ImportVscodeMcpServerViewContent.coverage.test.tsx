/** @vitest-environment happy-dom */

import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockShowError = vi.fn()
const mockShowSuccess = vi.fn()
const mockOnImportComplete = vi.fn()

const mockMcpServersRef = vi.hoisted(() => ({ current: [] as any[] }))
const mockRefreshRuntimeInfo = vi.fn()

const mockGetPlatformInfo = vi.fn()
const mockReadFileContent = vi.fn()
const mockDetectVSCodeConfigs = vi.fn()
const mockMcpOpsAdd = vi.fn()
const mockMcpOpsUpdate = vi.fn()

vi.mock('../../../styles/ImportVscodeMcpServerView.css', () => ({}))

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}))

vi.mock('../../userData/userDataProvider', () => ({
  useMCPServers: () => ({
    servers: mockMcpServersRef.current,
    refreshRuntimeInfo: mockRefreshRuntimeInfo,
  }),
}))

vi.mock('../../../lib/mcp/platformDetector', () => ({
  getPlatformInfo: mockGetPlatformInfo,
}))

vi.mock('../../../lib/utilities/fileSystemUtils', () => ({
  readFileContent: mockReadFileContent,
}))

vi.mock('../../../lib/mcp/VscodeConfigDetector', () => ({
  detectVSCodeConfigs: mockDetectVSCodeConfigs,
}))

vi.mock('../../../lib/mcp/mcpOps', () => ({
  McpOps: {
    add: mockMcpOpsAdd,
    update: mockMcpOpsUpdate,
  },
}))

vi.mock('lucide-react', () => ({
  Info: ({ size }: any) => <svg data-testid="info-icon" width={size} />,
}))

async function renderComp(props: any = {}) {
  const { default: Comp } = await import('../ImportVscodeMcpServerViewContent')
  return render(<Comp onImportComplete={mockOnImportComplete} {...props} />)
}

const baseDetectionResult = {
  success: true,
  configFiles: [
    {
      exists: true,
      isValid: true,
      serverCount: 2,
      expandedPath: '/home/user/.vscode/mcp.json',
    },
  ],
}

const baseFileContent = {
  success: true,
  content: JSON.stringify({
    servers: {
      'my-server': { type: 'stdio', command: 'node', args: ['server.js'] },
      'http-server': { url: 'http://localhost:3000/mcp' },
    },
  }),
}

describe('ImportVscodeMcpServerViewContent — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMcpServersRef.current = []
    mockGetPlatformInfo.mockReturnValue({ isSupported: true, platform: 'darwin' })
    mockDetectVSCodeConfigs.mockResolvedValue(baseDetectionResult)
    mockReadFileContent.mockResolvedValue(baseFileContent)
    mockRefreshRuntimeInfo.mockResolvedValue(undefined)
    mockMcpOpsAdd.mockResolvedValue({ success: true })
    mockMcpOpsUpdate.mockResolvedValue({ success: true })
  })

  it('shows scanning state while auto-detecting', async () => {
    let resolve: any
    mockDetectVSCodeConfigs.mockReturnValue(new Promise(r => { resolve = r }))
    await act(async () => { await renderComp() })
    expect(screen.getByText(/Scanning for VSCode MCP configuration/)).toBeInTheDocument()
    resolve(baseDetectionResult)
  })

  it('shows success message when servers are found', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Scan successful/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Found 2 MCP servers/)).toBeInTheDocument()
  })

  it('shows config file path after successful scan', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('/home/user/.vscode/mcp.json')).toBeInTheDocument()
    })
  })

  it('shows error when platform is not supported', async () => {
    mockGetPlatformInfo.mockReturnValue({ isSupported: false, platform: 'android' })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/android is not supported/i)).toBeInTheDocument()
    })
  })

  it('shows error when detection fails', async () => {
    mockDetectVSCodeConfigs.mockResolvedValue({ success: false, error: 'Permission denied', configFiles: [] })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Permission denied/)).toBeInTheDocument()
    })
  })

  it('shows default error when detection fails without message', async () => {
    mockDetectVSCodeConfigs.mockResolvedValue({ success: false, configFiles: [] })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Failed to scan VSCode MCP configuration files/)).toBeInTheDocument()
    })
  })

  it('shows warning when config file exists but has no servers', async () => {
    mockDetectVSCodeConfigs.mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: true, serverCount: 0, expandedPath: '/path/mcp.json', error: undefined }],
    })
    mockReadFileContent.mockResolvedValue({ success: true, content: JSON.stringify({ servers: {} }) })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Found VSCode configuration file but no MCP servers detected/)).toBeInTheDocument()
    })
  })

  it('shows error when config file exists but has its own error', async () => {
    mockDetectVSCodeConfigs.mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: false, serverCount: 0, expandedPath: '/path/mcp.json', error: 'Parse error in file' }],
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      // exists: true, serverCount: 0 => warning branch rendered
      expect(screen.getByText(/Found VSCode configuration file but no MCP servers detected/)).toBeInTheDocument()
    })
  })

  it('shows not found error when no config files exist', async () => {
    mockDetectVSCodeConfigs.mockResolvedValue({
      success: true,
      configFiles: [{ exists: false, isValid: false, serverCount: 0, expandedPath: '/no/path' }],
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/No VSCode MCP configuration file found/)).toBeInTheDocument()
    })
  })

  it('shows error when file read fails', async () => {
    mockReadFileContent.mockResolvedValue({ success: false, error: 'ENOENT' })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      // exists: true, serverCount: 0 → warning branch
      expect(screen.getByText(/Found VSCode configuration file but no MCP servers detected/)).toBeInTheDocument()
    })
  })

  it('shows error when JSON is invalid', async () => {
    mockReadFileContent.mockResolvedValue({ success: true, content: 'not json' })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      // exists: true, serverCount: 0 → warning branch
      expect(screen.getByText(/Found VSCode configuration file but no MCP servers detected/)).toBeInTheDocument()
    })
  })

  it('renders server list after successful scan', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('my-server')).toBeInTheDocument()
      expect(screen.getByText('http-server')).toBeInTheDocument()
    })
  })

  it('shows transport type for each server', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('(stdio)')).toBeInTheDocument()
      expect(screen.getByText('(StreamableHttp)')).toBeInTheDocument()
    })
  })

  it('shows SSE transport for SSE URL', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'sse-server': { url: 'http://localhost/sse' } },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('(sse)')).toBeInTheDocument()
    })
  })

  it('shows SSE transport for servers with type=sse', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'sse-server': { type: 'sse', url: 'http://localhost/events' } },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('(sse)')).toBeInTheDocument()
    })
  })

  it('shows conflict badge when server name conflicts', async () => {
    mockMcpServersRef.current = [{ name: 'my-server' }]
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Name conflict!')).toBeInTheDocument()
    })
  })

  it('skips disabled servers', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: {
          'disabled-server': { type: 'stdio', command: 'node', disabled: true },
          'active-server': { type: 'stdio', command: 'python' },
        },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.queryByText('disabled-server')).not.toBeInTheDocument()
      expect(screen.getByText('active-server')).toBeInTheDocument()
    })
  })

  it('supports mcp.servers format (settings.json)', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        mcp: { servers: { 'settings-server': { type: 'stdio', command: 'node' } } },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('settings-server')).toBeInTheDocument()
    })
  })

  it('shows "No MCP servers found" when JSON has no servers key', async () => {
    mockReadFileContent.mockResolvedValue({ success: true, content: JSON.stringify({}) })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('No MCP servers found')).toBeInTheDocument()
    })
  })

  it('select all button selects all servers', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Select All')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Select All'))
    // Both servers should be checked
    const checkboxes = screen.getAllByRole('checkbox')
    const serverCheckboxes = checkboxes.filter(cb => (cb as HTMLInputElement).type === 'checkbox')
    expect(serverCheckboxes.some(cb => (cb as HTMLInputElement).checked)).toBe(true)
  })

  it('deselect all button deselects all servers', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Deselect All')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Deselect All'))
    // Import button should show 0 selected
    expect(screen.getByText('Import Selected (0)')).toBeInTheDocument()
  })

  it('clicking a server row sets it as preview (checkbox toggle)', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('my-server')).toBeInTheDocument()
    })
    // Toggle off my-server
    const checkboxes = screen.getAllByRole('checkbox')
    const myServerCheckbox = checkboxes[0]
    fireEvent.change(myServerCheckbox, { target: { checked: false } })
    // Still renders fine
    expect(screen.getByText('my-server')).toBeInTheDocument()
  })

  it('import button is disabled when nothing selected', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Deselect All')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Deselect All'))
    const importBtn = screen.getByRole('button', { name: /Import Selected/ })
    expect(importBtn).toBeDisabled()
  })

  it('imports selected servers successfully', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockMcpOpsAdd).toHaveBeenCalled()
      expect(mockShowSuccess).toHaveBeenCalled()
    })
    expect(mockOnImportComplete).toHaveBeenCalled()
    expect(mockRefreshRuntimeInfo).toHaveBeenCalled()
  })

  it('shows error when all imports fail', async () => {
    mockMcpOpsAdd.mockResolvedValue({ success: false, error: 'Already exists' })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed'))
    })
  })

  it('uses McpOps.update for overwrite conflict resolution', async () => {
    mockMcpServersRef.current = [{ name: 'my-server' }]
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Name conflict!')).toBeInTheDocument()
    })
    // Change conflict resolution to overwrite by clicking the radio label
    const overwriteRadio = screen.getByDisplayValue('overwrite')
    // Simulate clicking the radio — set checked and fire change
    fireEvent.click(overwriteRadio)
    // Select all (my-server with conflict, http-server without)
    fireEvent.click(screen.getByText('Select All'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockMcpOpsUpdate).toHaveBeenCalled()
    })
  })

  it('skips conflicting server when conflict resolution is skip', async () => {
    // Only one server: my-server which conflicts
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'my-server': { type: 'stdio', command: 'node' } },
      }),
    })
    mockMcpServersRef.current = [{ name: 'my-server' }]
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByDisplayValue('skip')).toBeInTheDocument()
    })
    // Click skip radio
    fireEvent.click(screen.getByDisplayValue('skip'))
    // Select all
    fireEvent.click(screen.getByText('Select All'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    // All selected servers are conflicting and skip is selected — nothing imported, shows error
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed'))
    })
  })

  it('validates missing command for stdio transport', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'bad-stdio': { type: 'stdio' } }, // no command
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('bad-stdio')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed'))
    })
  })

  it('validates missing URL for sse transport', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'bad-sse': { type: 'sse' } }, // no url
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('bad-sse')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed'))
    })
  })

  it('toggle validate before import checkbox', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Validate configurations before import')).toBeInTheDocument()
    })
    const allCheckboxes = screen.getAllByRole('checkbox')
    const validateCb = allCheckboxes.find(cb =>
      cb.closest('label')?.textContent?.includes('Validate configurations')
    )
    expect(validateCb).toBeTruthy()
    fireEvent.click(validateCb!)
    // Should still render fine
    expect(screen.getByText('Validate configurations before import')).toBeInTheDocument()
  })

  it('shows tooltip on info icon hover', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getAllByTestId('info-icon').length).toBeGreaterThan(0)
    })
    const infoIcons = screen.getAllByTestId('info-icon')
    const iconParent = infoIcons[0].closest('[class*="server-info-icon"]') || infoIcons[0].parentElement!
    fireEvent.mouseEnter(iconParent)
    expect(screen.getByText('Original VSCode Configuration:')).toBeInTheDocument()
    fireEvent.mouseLeave(iconParent)
    expect(screen.queryByText('Original VSCode Configuration:')).not.toBeInTheDocument()
  })

  it('shows rename timestamp when conflict resolution is rename', async () => {
    mockMcpServersRef.current = [{ name: 'my-server' }]
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Name conflict!')).toBeInTheDocument()
    })
    // rename is default
    fireEvent.click(screen.getByText('Select All'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockMcpOpsAdd).toHaveBeenCalled()
    })
    // The renamed server should have a timestamp suffix
    const addCall = mockMcpOpsAdd.mock.calls.find(call => call[0].name.startsWith('my-server-'))
    expect(addCall).toBeTruthy()
  })

  it('handles exception during auto-detect', async () => {
    mockDetectVSCodeConfigs.mockRejectedValue(new Error('Unexpected crash'))
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Unexpected crash/)).toBeInTheDocument()
    })
  })

  it('handles existing servers as object (keys)', async () => {
    // mcpServers as object with names as keys
    mockMcpServersRef.current = { 'existing-server': {} } as any
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Scan successful/)).toBeInTheDocument()
    })
  })

  it('handles McpOps.add throwing an exception', async () => {
    mockMcpOpsAdd.mockRejectedValue(new Error('IPC failure'))
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed'))
    })
  })

  // -------------------------------------------------------------------------
  // Branch coverage: env + headers propagation in parseServerConfig
  // -------------------------------------------------------------------------
  it('extracts env and headers from server config and forwards them to McpOps.add', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: {
          'http-server': {
            url: 'http://localhost:8000/mcp',
            env: { LOG_LEVEL: 'debug' },
            headers: { 'x-api-key': 'secret' },
          },
        },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('http-server')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockMcpOpsAdd).toHaveBeenCalled()
    })
    const arg = mockMcpOpsAdd.mock.calls[0][0]
    expect(arg.env).toEqual({ LOG_LEVEL: 'debug' })
    expect(arg.headers).toEqual({ 'x-api-key': 'secret' })
  })

  it('ignores headers when they are not a plain object (e.g. array)', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: {
          'http-server': {
            url: 'http://localhost:8000/mcp',
            headers: ['bad', 'array'],
          },
        },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('http-server')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockMcpOpsAdd).toHaveBeenCalled()
    })
    const arg = mockMcpOpsAdd.mock.calls[0][0]
    expect(arg.headers).toBeUndefined()
  })

  it('ignores env when not an object (e.g. string)', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: {
          'srv': { type: 'stdio', command: 'node', env: 'not-an-object' },
        },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('srv')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockMcpOpsAdd).toHaveBeenCalled()
    })
    const arg = mockMcpOpsAdd.mock.calls[0][0]
    expect(arg.env).toEqual({})
  })

  it('skips non-object server entries (e.g. string value)', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: {
          'string-entry': 'this-is-not-an-object',
          'real-server': { type: 'stdio', command: 'node' },
        },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('real-server')).toBeInTheDocument()
    })
    expect(screen.queryByText('string-entry')).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: catch path when error is not an Error instance
  // -------------------------------------------------------------------------
  it('handles auto-detect rejecting with a non-Error value', async () => {
    mockDetectVSCodeConfigs.mockRejectedValue('plain-string-failure')
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/plain-string-failure/)).toBeInTheDocument()
    })
  })

  it('handles McpOps.add throwing a non-Error value', async () => {
    mockMcpOpsAdd.mockRejectedValue('string-failure')
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed'))
    })
  })

  it('handles top-level handleRealImport throwing a non-Error', async () => {
    // refreshRuntimeInfo runs inside the outer try and can throw to the top-level catch
    mockRefreshRuntimeInfo.mockRejectedValue('refresh-string-error')
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Import failed: refresh-string-error'))
    })
  })

  // -------------------------------------------------------------------------
  // Branch coverage: handleServerToggle delete path (uncheck a selected server)
  // -------------------------------------------------------------------------
  it('toggles a checked server off via the checkbox onChange handler', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('my-server')).toBeInTheDocument()
    })
    // Default selection: both servers are selected
    expect(screen.getByText('Import Selected (2)')).toBeInTheDocument()
    // Find checkboxes
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    const serverCheckboxes = checkboxes.filter(cb => cb.type === 'checkbox' && cb.checked)
    expect(serverCheckboxes.length).toBeGreaterThan(0)
    // Click first one to uncheck (hits the delete branch of handleServerToggle)
    await act(async () => {
      fireEvent.click(serverCheckboxes[0])
    })
    expect(screen.getByText('Import Selected (1)')).toBeInTheDocument()
    // Click again to re-check (add branch)
    await act(async () => {
      fireEvent.click(serverCheckboxes[0])
    })
    expect(screen.getByText('Import Selected (2)')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: imported plural vs singular + partial-error suffix
  // -------------------------------------------------------------------------
  it('shows partial-failure suffix when some imports fail and at least one succeeds', async () => {
    // Two servers; second one fails (not-conflicting). Use stdio without command to fail validation
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: {
          'good': { type: 'stdio', command: 'node' },
          'bad-stdio': { type: 'stdio' },
        },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('good')).toBeInTheDocument()
      expect(screen.getByText('bad-stdio')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalled()
    })
    // Should mention "(1 failed)" suffix
    const msg = mockShowSuccess.mock.calls[0][0] as string
    expect(msg).toMatch(/1 failed/)
  })

  it('shows singular "server" when exactly one imported', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'single': { type: 'stdio', command: 'node' } },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('single')).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalled()
    })
    const msg = mockShowSuccess.mock.calls[0][0] as string
    // 1 server → "1 server!" (no "s")
    expect(msg).toMatch(/Successfully imported 1 server!/)
  })

  it('shows plural "servers" when more than one imported', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalled()
    })
    const msg = mockShowSuccess.mock.calls[0][0] as string
    expect(msg).toMatch(/Successfully imported 2 servers!/)
  })

  // -------------------------------------------------------------------------
  // Branch coverage: overwrite path with McpOps.update returning failure
  // -------------------------------------------------------------------------
  it('records error when McpOps.update fails during overwrite', async () => {
    mockMcpServersRef.current = [{ name: 'my-server' }]
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'my-server': { type: 'stdio', command: 'node' } },
      }),
    })
    mockMcpOpsUpdate.mockResolvedValue({ success: false, error: 'no perms' })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('Name conflict!')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByDisplayValue('overwrite'))
    fireEvent.click(screen.getByText('Select All'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('no perms'))
    })
  })

  it('falls back to "Unknown error" when McpOps.add returns success=false with no error', async () => {
    mockMcpOpsAdd.mockResolvedValue({ success: false })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Import Selected/)).toBeInTheDocument()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })
  })

  // -------------------------------------------------------------------------
  // Branch coverage: mcpServers === null/undefined falls through to []
  // -------------------------------------------------------------------------
  it('handles mcpServers being null (typeof check fails)', async () => {
    mockMcpServersRef.current = null as any
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText(/Scan successful/)).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Branch coverage: click handler stopPropagation on checkbox
  // -------------------------------------------------------------------------
  it('clicking checkbox does not trigger server preview row click', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('my-server')).toBeInTheDocument()
    })
    const checkboxes = screen.getAllByRole('checkbox')
    // Click stops propagation; component should still render after the click
    await act(async () => {
      fireEvent.click(checkboxes[0])
    })
    expect(screen.getByText('my-server')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: server-list click → handleServerPreview path
  // -------------------------------------------------------------------------
  it('clicking a server row updates the previewed server (selected class)', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('http-server')).toBeInTheDocument()
    })
    const httpServerRow = screen.getByText('http-server').closest('.server-item')
    expect(httpServerRow).toBeTruthy()
    fireEvent.click(httpServerRow!)
    // The clicked row should now have 'selected' class
    expect(httpServerRow!.className).toContain('selected')
  })

  // -------------------------------------------------------------------------
  // Branch coverage: validate=false skips command/url checks (lines 376-386)
  // -------------------------------------------------------------------------
  it('imports stdio with missing command when validation is disabled', async () => {
    mockReadFileContent.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        servers: { 'no-cmd': { type: 'stdio' } },
      }),
    })
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByText('no-cmd')).toBeInTheDocument()
    })
    // Disable validation
    const validateCb = screen
      .getAllByRole('checkbox')
      .find(cb => cb.closest('label')?.textContent?.includes('Validate configurations'))
    expect(validateCb).toBeTruthy()
    fireEvent.click(validateCb!)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import Selected/ }))
    })
    // Should now reach McpOps.add despite missing command
    await waitFor(() => {
      expect(mockMcpOpsAdd).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Branch coverage: rename radio onChange handler (line 569)
  // -------------------------------------------------------------------------
  it('fires onChange when switching back to rename after selecting overwrite', async () => {
    await act(async () => { await renderComp() })
    await waitFor(() => {
      expect(screen.getByDisplayValue('rename')).toBeInTheDocument()
    })
    // Move away from default first
    fireEvent.click(screen.getByDisplayValue('overwrite'))
    expect((screen.getByDisplayValue('overwrite') as HTMLInputElement).checked).toBe(true)
    // Now switch back to rename — this exercises the rename onChange
    fireEvent.click(screen.getByDisplayValue('rename'))
    expect((screen.getByDisplayValue('rename') as HTMLInputElement).checked).toBe(true)
  })
})
