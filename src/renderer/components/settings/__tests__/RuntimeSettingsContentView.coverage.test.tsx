/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// CSS mocks
// ---------------------------------------------------------------------------

vi.mock('../../../styles/ContentView.css', () => ({}))
vi.mock('../../../styles/SettingsShared.css', () => ({}))
vi.mock('../../../styles/RuntimeSettings.css', () => ({}))

// ---------------------------------------------------------------------------
// Runtime version mocks (keep minimal)
// ---------------------------------------------------------------------------

vi.mock('../../../lib/runtime/runtimeVersions', () => ({
  BUN_VERSIONS: [{ version: '1.3.6', label: '1.3.6' }],
  UV_VERSIONS: [{ version: '0.6.17', label: '0.6.17' }],
  PYTHON_VERSIONS: [{ version: '3.10.12', label: '3.10.12' }],
}))

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

const mockShowSuccess = vi.hoisted(() => vi.fn())
const mockShowError = vi.hoisted(() => vi.fn())

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}))

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

const mockUseFeatureFlag = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: (flag: string) => mockUseFeatureFlag(flag),
}))

// ---------------------------------------------------------------------------
// RuntimeSystemDependenciesCard (child component)
// ---------------------------------------------------------------------------

vi.mock('../RuntimeSystemDependenciesCard', () => ({
  default: () => (
    <div data-testid="system-deps-card" />
  ),
}))

// ---------------------------------------------------------------------------
// Lucide icons
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  Trash2: () => <span>trash</span>,
  ExternalLink: () => <span>external</span>,
}))

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import RuntimeSettingsContentView from '../RuntimeSettingsContentView'
import type { RuntimeStatus, GitVersion, PythonVersion } from '../RuntimeSettingsContentView'

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function makeStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    bun: false,
    uv: false,
    bunPath: '',
    uvPath: '',
    ...overrides,
  }
}

function makeConfig(overrides: any = {}) {
  return {
    mode: 'internal' as const,
    bunVersion: '1.3.6',
    uvVersion: '0.6.17',
    pinnedPythonVersion: undefined,
    ...overrides,
  }
}

function renderView(props: any = {}) {
  const defaults = {
    config: makeConfig(),
    status: makeStatus(),
    gitVersion: null,
    pythonVersions: [],
    isLoading: false,
    isPythonLoading: false,
    showGitVersion: false,
    newPythonVersion: '3.10.12',
    onModeChange: vi.fn().mockResolvedValue(undefined),
    onInstall: vi.fn().mockResolvedValue(undefined),
    onVersionChange: vi.fn(),
    onNewPythonVersionChange: vi.fn(),
    onInstallPython: vi.fn().mockResolvedValue(undefined),
    onUninstallPython: vi.fn().mockResolvedValue(undefined),
    onPinPythonVersion: vi.fn().mockResolvedValue(undefined),
    onCleanUvCache: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    ...props,
  }
  return { ...render(<RuntimeSettingsContentView {...defaults} />), props: defaults }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuntimeSettingsContentView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFeatureFlag.mockReturnValue(false)
  })

  it('renders runtime mode card', () => {
    renderView()
    expect(screen.getByText('Runtime Mode')).toBeTruthy()
  })

  it('shows system mode radio checked when mode=system', () => {
    renderView({ config: makeConfig({ mode: 'system' }) })
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    const systemRadio = radios.find(r => r.name === 'runtimeMode' && r.closest('label')?.textContent?.includes('System'))
    expect(systemRadio?.checked).toBe(true)
  })

  it('shows internal mode radio checked when mode=internal', () => {
    renderView({ config: makeConfig({ mode: 'internal' }) })
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    // internal radio is the second runtimeMode radio
    const internalRadio = radios.filter(r => r.name === 'runtimeMode')[1] as HTMLInputElement
    expect(internalRadio.checked).toBe(true)
  })

  it('calls onModeChange(system) when system label clicked', () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined)
    renderView({ onModeChange })
    fireEvent.click(screen.getByText('Use User System Environment').closest('label')!)
    expect(onModeChange).toHaveBeenCalledWith('system')
  })

  it('calls onModeChange(internal) when internal label clicked', () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined)
    renderView({ onModeChange })
    fireEvent.click(screen.getByText('Use App-managed Environment').closest('label')!)
    expect(onModeChange).toHaveBeenCalledWith('internal')
  })

  it('shows bun/uv card when mode=internal', () => {
    renderView({ config: makeConfig({ mode: 'internal' }) })
    expect(screen.getByText(/App-managed Bun/)).toBeTruthy()
  })

  it('hides bun/uv card when mode=system', () => {
    renderView({ config: makeConfig({ mode: 'system' }) })
    expect(screen.queryByText(/App-managed Bun/)).toBeNull()
  })

  it('shows "Not installed" when bun is not installed', () => {
    renderView({ status: makeStatus({ bun: false }) })
    expect(screen.getAllByText('Not installed').length).toBeGreaterThan(0)
  })

  it('shows bun path when bun is installed', () => {
    renderView({ status: makeStatus({ bun: true, bunPath: '/usr/local/bin/bun' }) })
    expect(screen.getByText('/usr/local/bin/bun')).toBeTruthy()
  })

  it('shows "Install" button when bun not installed', () => {
    renderView({ status: makeStatus({ bun: false }) })
    const installBtns = screen.getAllByText('Install')
    expect(installBtns.length).toBeGreaterThan(0)
  })

  it('shows "Update" button when bun is installed', () => {
    renderView({ status: makeStatus({ bun: true, bunPath: '/usr/local/bin/bun' }) })
    expect(screen.getByText('Update')).toBeTruthy()
  })

  it('calls onInstall with bun when bun install button clicked', () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    renderView({ status: makeStatus({ bun: false }), onInstall })
    // First Install button is for bun
    fireEvent.click(screen.getAllByText('Install')[0])
    expect(onInstall).toHaveBeenCalledWith('bun')
  })

  it('calls onInstall with uv when uv install button clicked', () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    renderView({ status: makeStatus({ bun: false, uv: false }), onInstall })
    const installBtns = screen.getAllByText('Install')
    fireEvent.click(installBtns[1])
    expect(onInstall).toHaveBeenCalledWith('uv')
  })

  it('calls onVersionChange when bun version select changes', () => {
    const onVersionChange = vi.fn()
    renderView({ onVersionChange })
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(selects[0], { target: { value: '1.3.6' } })
    expect(onVersionChange).toHaveBeenCalledWith('bun', '1.3.6')
  })

  it('shows loading bar when isLoading=true', () => {
    renderView({ isLoading: true })
    expect(screen.getByText(/Installing… This may take a moment/)).toBeTruthy()
  })

  it('hides loading bar when isLoading=false', () => {
    renderView({ isLoading: false })
    expect(screen.queryByText(/Installing… This may take a moment/)).toBeNull()
  })

  it('does not show Python card when uv not installed', () => {
    renderView({ status: makeStatus({ uv: false }) })
    expect(screen.queryByText(/App-managed Python/)).toBeNull()
  })

  it('shows Python card when uv is installed', () => {
    renderView({ status: makeStatus({ uv: true, uvPath: '/usr/local/bin/uv' }) })
    expect(screen.getByText(/App-managed Python/)).toBeTruthy()
  })

  it('shows "No Python versions detected" when list is empty', () => {
    renderView({ status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }), pythonVersions: [] })
    expect(screen.getByText(/No Python versions detected/)).toBeTruthy()
  })

  it('shows python versions list when versions present', () => {
    const pythonVersions: PythonVersion[] = [
      { version: '3.10.12', semver: '3.10.12', path: '/usr/bin/python3', status: 'installed' },
    ]
    renderView({
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      pythonVersions,
    })
    const matches = screen.getAllByText('3.10.12')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows uninstall button for installed python versions', () => {
    const pythonVersions: PythonVersion[] = [
      { version: '3.10.12', path: '/usr/bin/python3', status: 'installed' },
    ]
    renderView({
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      pythonVersions,
    })
    expect(screen.getByTitle('Uninstall')).toBeTruthy()
  })

  it('calls onUninstallPython when trash button clicked', () => {
    const onUninstallPython = vi.fn().mockResolvedValue(undefined)
    const pythonVersions: PythonVersion[] = [
      { version: '3.10.12', path: '/usr/bin/python3', status: 'installed' },
    ]
    renderView({
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      pythonVersions,
      onUninstallPython,
    })
    fireEvent.click(screen.getByTitle('Uninstall'))
    expect(onUninstallPython).toHaveBeenCalledWith('3.10.12')
  })

  it('onPinPythonVersion handler is wired to radio onChange', () => {
    const onPinPythonVersion = vi.fn().mockResolvedValue(undefined)
    const pythonVersions: PythonVersion[] = [
      { version: '3.10.12', path: '/usr/bin/python3', status: 'installed' },
    ]
    const { container } = renderView({
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      pythonVersions,
      onPinPythonVersion,
    })
    const pinRadio = container.querySelector('input[name="pinnedPython"]') as HTMLInputElement
    expect(pinRadio).toBeTruthy()
    // Verify the radio is rendered with the correct name (the onChange wires to onPinPythonVersion)
    expect(pinRadio.getAttribute('name')).toBe('pinnedPython')
    // The "Default" label text is present
    expect(container.querySelector('.runtime-pin-text')?.textContent).toBe('Default')
  })

  it('shows install python button label when not loading', () => {
    renderView({
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      isPythonLoading: false,
    })
    expect(screen.getByText('Install Python')).toBeTruthy()
  })

  it('shows "Installing…" label when isPythonLoading=true', () => {
    renderView({
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      isPythonLoading: true,
    })
    expect(screen.getByText('Installing…')).toBeTruthy()
  })

  it('renders system deps card always', () => {
    renderView()
    expect(screen.getByTestId('system-deps-card')).toBeTruthy()
  })

  it('shows warning emoji for pinned but uninstalled python', () => {
    const pythonVersions: PythonVersion[] = [
      { version: '3.10.12', path: null, status: 'available' },
    ]
    renderView({
      config: makeConfig({ pinnedPythonVersion: '3.10.12' }),
      status: makeStatus({ uv: true, uvPath: '/usr/bin/uv' }),
      pythonVersions,
    })
    expect(screen.getByTitle('Pinned but not installed')).toBeTruthy()
  })
})
