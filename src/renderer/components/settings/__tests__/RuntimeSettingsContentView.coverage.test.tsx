/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WithStore } from '../../../atom'
import { appDataManager } from '../../../lib/userData/appDataManager'

vi.mock('../../../styles/ContentView.css', () => ({}))
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}))
vi.mock('../../../styles/RuntimeSettings.css', () => ({}))
vi.mock('../../../lib/runtime/runtimeVersions', () => ({
  BUN_VERSIONS: [{ version: '1.3.6', label: '1.3.6' }],
  UV_VERSIONS: [{ version: '0.6.17', label: '0.6.17' }],
  PYTHON_VERSIONS: [{ version: '3.10.12', label: '3.10.12' }],
}))

const pythonPackagesRowState = vi.hoisted(() => ({ props: undefined as any }))
vi.mock('../RuntimePythonPackagesRow', () => ({
  default: (props: any) => {
    pythonPackagesRowState.props = props
    return (
      <div data-testid="python-packages-row">
        {String(props.ready)}
        <button data-testid="packages-busy" onClick={() => props.onBusyChange(true)}>busy</button>
      </div>
    )
  },
}))
vi.mock('../RuntimeSystemDependencyRows', () => ({
  default: () => <div data-testid="system-deps-card" />,
}))
vi.mock('lucide-react', () => ({
  Trash2: () => <span>trash</span>,
  ExternalLink: () => <span>external</span>,
}))

import RuntimeSettingsContentView, { truncatePath } from '../RuntimeSettingsContentView'
import type { RuntimeStatus, GitVersion, PythonVersion } from '../RuntimeSettingsContentView'

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
    checking: { core: false, git: false },
    gitVersion: null as GitVersion | null,
    pythonVersions: [] as PythonVersion[],
    isLoading: false,
    isPythonLoading: false,
    showGitVersion: false,
    newPythonVersion: '3.10.12',
    onModeChange: vi.fn().mockResolvedValue(undefined),
    onInstall: vi.fn().mockResolvedValue(undefined),
    onVersionChange: vi.fn(),
    onNewPythonVersionChange: vi.fn(),
    onInstallPython: vi.fn().mockResolvedValue(undefined),
    onCleanUvCache: vi.fn().mockResolvedValue(undefined),
    ...props,
  }
  return {
    ...render(
      <WithStore>
        <RuntimeSettingsContentView {...defaults} />
      </WithStore>
    ),
    props: defaults,
  }
}

describe('RuntimeSettingsContentView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(appDataManager as any).cache = { uiLanguage: 'en' }
    pythonPackagesRowState.props = undefined
  })

  it('renders runtime mode card', () => {
    renderView()
    expect(screen.getByText('Runtime Mode')).toBeTruthy()
  })

  it('calls onModeChange(system) when the system radio is clicked', () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined)
    renderView({ onModeChange })
    fireEvent.click(screen.getByText('Use User System Environment').closest('label')!)
    expect(onModeChange).toHaveBeenCalledWith('system')
  })

  it('handles radio change events for both runtime modes', () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined)
    const internalView = renderView({
      config: makeConfig({ mode: 'system' }),
      onModeChange,
    })
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(onModeChange).toHaveBeenCalledWith('internal')
    internalView.unmount()

    renderView({ onModeChange })
    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(onModeChange).toHaveBeenCalledWith('system')
  })

  it('calls onInstall for bun and uv buttons', () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    renderView({ onInstall })
    const installButtons = screen.getAllByText('Install')
    fireEvent.click(installButtons[0])
    fireEvent.click(installButtons[1])
    expect(onInstall).toHaveBeenNthCalledWith(1, 'bun')
    expect(onInstall).toHaveBeenNthCalledWith(2, 'uv')
  })

  it('calls onVersionChange when the bun and uv selects change', () => {
    const onVersionChange = vi.fn()
    renderView({ onVersionChange })
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(selects[0], { target: { value: '1.3.6' } })
    fireEvent.change(selects[1], { target: { value: '0.6.17' } })
    expect(onVersionChange).toHaveBeenNthCalledWith(1, 'bun', '1.3.6')
    expect(onVersionChange).toHaveBeenNthCalledWith(2, 'uv', '0.6.17')
  })

  it('calls Python handlers from the Python row controls', () => {
    const onNewPythonVersionChange = vi.fn()
    const onInstallPython = vi.fn().mockResolvedValue(undefined)
    renderView({ onNewPythonVersionChange, onInstallPython })
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(selects[2], { target: { value: '3.10.12' } })
    fireEvent.click(screen.getAllByText('Update')[0])
    expect(onNewPythonVersionChange).toHaveBeenCalledWith('3.10.12')
    expect(onInstallPython).toHaveBeenCalled()
  })

  it('shows Python checking state while the core probe is in flight', () => {
    renderView({
      config: makeConfig({ pinnedPythonVersion: '3.10.12' }),
      checking: { core: true, git: false },
      pythonVersions: [],
    })
    expect(screen.getAllByText('Checking…').length).toBeGreaterThanOrEqual(1)
  })

  it('shows loading notice and updating label while busy', () => {
    renderView({ isLoading: true, isPythonLoading: true })
    expect(screen.getByText('Installing… This may take a moment depending on your connection.')).toBeTruthy()
    expect(screen.getByText('Updating…')).toBeTruthy()
  })

  it('renders system dependency rows and Python packages row', () => {
    renderView({
      showGitVersion: true,
      status: makeStatus({ uv: true }),
      config: makeConfig({ pinnedPythonVersion: '3.10.12' }),
      pythonVersions: [{ version: '3.10.12', semver: '3.10.12', path: '/venv/python', status: 'installed' }],
    })
    expect(screen.getByTestId('system-deps-card')).toBeTruthy()
    expect(screen.getByTestId('python-packages-row')).toBeTruthy()
    expect(pythonPackagesRowState.props.ready).toBe(true)
  })

  it('matches an installed Python by semver and renders installed tool paths', () => {
    renderView({
      status: makeStatus({
        bun: true,
        uv: true,
        bunPath: '/a/very/long/path/with/many/components/to/the/bun/executable',
        uvPath: '/usr/local/bin/uv',
      }),
      config: makeConfig({ pinnedPythonVersion: '3.10' }),
      pythonVersions: [{
        version: 'cpython-3.10.12',
        semver: '3.10',
        path: '/managed/python',
        status: 'installed',
      }],
    })
    expect(screen.getByTitle('/usr/local/bin/uv')).toBeTruthy()
    expect(screen.getByTitle('/managed/python')).toBeTruthy()
    expect(screen.getAllByText('Update').length).toBeGreaterThanOrEqual(3)
  })

  it('blocks runtime mutations while package management is busy', () => {
    const onModeChange = vi.fn().mockResolvedValue(undefined)
    const onInstall = vi.fn().mockResolvedValue(undefined)
    const view = renderView({ onModeChange, onInstall })
    fireEvent.click(screen.getByTestId('packages-busy'))
    fireEvent.click(screen.getByText('Use User System Environment').closest('label')!)
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(screen.getAllByText('Install')[0]).toHaveProperty('disabled', true)
    expect(onModeChange).not.toHaveBeenCalled()
    expect(onInstall).not.toHaveBeenCalled()
    view.unmount()
  })

  it('hides the runtime components card in system mode', () => {
    renderView({ config: makeConfig({ mode: 'system' }) })
    expect(screen.queryByText('App-managed Environment')).toBeNull()
  })

  it('renders the development-only clean cache button', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const onCleanUvCache = vi.fn().mockResolvedValue(undefined)
    try {
      renderView({ onCleanUvCache })
      fireEvent.click(screen.getByText('Clean Cache'))
      expect(onCleanUvCache).toHaveBeenCalled()
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

describe('truncatePath', () => {
  it('returns a dash for empty paths', () => {
    expect(truncatePath(null)).toBe('-')
  })

  it('preserves short paths and truncates long paths', () => {
    expect(truncatePath('/short/path')).toBe('/short/path')
    expect(truncatePath('/one/two/three/four/five/six/seven/eight/nine/ten/file.txt', 20)).toMatch(/^…\//)
  })

  it('truncates Windows paths using backslashes', () => {
    expect(truncatePath('C:\\one\\two\\three\\four\\five\\file.txt', 18)).toMatch(/^…\\/)
  })
})
