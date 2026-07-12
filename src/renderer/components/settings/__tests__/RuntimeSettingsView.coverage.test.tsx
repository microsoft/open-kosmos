/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckStatus = vi.hoisted(() => vi.fn())
const mockCheckCore = vi.hoisted(() => vi.fn())
const mockCheckGitVersion = vi.hoisted(() => vi.fn())
const mockSetMode = vi.hoisted(() => vi.fn())
const mockInstall = vi.hoisted(() => vi.fn())
const mockCleanUvCache = vi.hoisted(() => vi.fn())
const mockListPythonVersions = vi.hoisted(() => vi.fn())
const mockInstallPythonVersion = vi.hoisted(() => vi.fn())
const mockUninstallPythonVersion = vi.hoisted(() => vi.fn())
const mockSetPinnedPythonVersion = vi.hoisted(() => vi.fn())
const mockAppDataSubscribe = vi.hoisted(() => vi.fn())
const mockGetRuntimeEnvironment = vi.hoisted(() => vi.fn())
const mockShowSuccess = vi.hoisted(() => vi.fn())
const mockShowError = vi.hoisted(() => vi.fn())
const mockUseFeatureFlag = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/userData/appDataManager', () => ({
  appDataManager: {
    getRuntimeEnvironment: mockGetRuntimeEnvironment,
    subscribe: mockAppDataSubscribe,
    updateConfig: vi.fn(),
  },
}))

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}))

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: mockUseFeatureFlag,
}))

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../styles/RuntimeSettings.css', () => ({}))
vi.mock('../RuntimeSettingsHeaderView', () => ({
  default: ({ onRefresh, isRefreshing }: any) => (
    <div data-testid="runtime-header">
      <button data-testid="refresh-btn" onClick={onRefresh}>Refresh</button>
      {isRefreshing && <span data-testid="refreshing">refreshing</span>}
    </div>
  ),
}))
vi.mock('../RuntimeSettingsContentView', () => ({
  default: (props: any) => (
    <div data-testid="runtime-content">
      <button data-testid="mode-system" onClick={() => props.onModeChange('system')}>System</button>
      <button data-testid="install-bun" onClick={() => props.onInstall('bun')}>Install Bun</button>
      <button data-testid="clean-cache" onClick={() => props.onCleanUvCache()}>Clean</button>
      <button data-testid="install-python" onClick={() => props.onInstallPython()}>Install Python</button>
      <button data-testid="version-bun" onClick={() => props.onVersionChange('bun', '2.0')}>Version</button>
      <button data-testid="python-version-empty" onClick={() => props.onNewPythonVersionChange('')}>Empty Python</button>
    </div>
  ),
}))
vi.mock('../../../lib/runtime/runtimeVersions', () => ({
  DEFAULT_PYTHON_VERSION: '3.11',
}))

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mockUseFeatureFlag.mockReturnValue(false)
  mockGetRuntimeEnvironment.mockReturnValue(null)
  mockAppDataSubscribe.mockReturnValue(() => {})

  ;(window as any).electronAPI = {
    runtime: {
      checkStatus: mockCheckStatus,
      checkCore: mockCheckCore,
      checkGitVersion: mockCheckGitVersion,
      setMode: mockSetMode,
      install: mockInstall,
      cleanUvCache: mockCleanUvCache,
      listPythonVersions: mockListPythonVersions,
      installPythonVersion: mockInstallPythonVersion,
      uninstallPythonVersion: mockUninstallPythonVersion,
      setPinnedPythonVersion: mockSetPinnedPythonVersion,
    },
  }

  mockCheckStatus.mockResolvedValue({ bun: true, uv: true })
  mockCheckCore.mockResolvedValue({ bun: true, uv: true, bunPath: '/bun', uvPath: '/uv' })
  mockCheckGitVersion.mockResolvedValue({ installed: true, version: '2.40.0', path: '/usr/bin/git' })
  mockListPythonVersions.mockResolvedValue([])
  mockSetMode.mockResolvedValue({})
  mockInstall.mockResolvedValue({})
  mockCleanUvCache.mockResolvedValue({})
  mockInstallPythonVersion.mockResolvedValue({})
  mockUninstallPythonVersion.mockResolvedValue({})
  mockSetPinnedPythonVersion.mockResolvedValue({})
})

import RuntimeSettingsView from '../RuntimeSettingsView'

describe('RuntimeSettingsView', () => {
  it('shows loading state when the runtime environment is not ready', () => {
    render(<RuntimeSettingsView />)
    expect(screen.getByText('Loading runtime status...')).toBeTruthy()
  })

  it('renders header and content once the runtime environment is available', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({
      mode: 'internal',
      bunVersion: '1.1.0',
      uvVersion: '0.2.0',
      pinnedPythonVersion: '3.11',
    })

    await act(async () => {
      render(<RuntimeSettingsView />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('runtime-header')).toBeTruthy()
      expect(screen.getByTestId('runtime-content')).toBeTruthy()
    })
  })

  it('loads python versions when uv is installed', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })
    mockCheckCore.mockResolvedValue({ bun: true, uv: true, bunPath: '/bun', uvPath: '/uv' })

    await act(async () => {
      render(<RuntimeSettingsView />)
    })

    await waitFor(() => {
      expect(mockListPythonVersions).toHaveBeenCalled()
    })
  })

  it('does not load Python versions when uv is unavailable', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'system', bunVersion: '', uvVersion: '' })
    mockCheckCore.mockResolvedValue({ bun: false, uv: false, bunPath: '', uvPath: '' })
    render(<RuntimeSettingsView />)
    await waitFor(() => expect(mockCheckCore).toHaveBeenCalled())
    expect(mockListPythonVersions).not.toHaveBeenCalled()
  })

  it('handles a Python version listing failure independently', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'system', bunVersion: '', uvVersion: '' })
    mockCheckCore.mockResolvedValue({ bun: false, uv: true, bunPath: '', uvPath: '/uv' })
    mockListPythonVersions.mockRejectedValueOnce(new Error('listing failed'))
    render(<RuntimeSettingsView />)
    await waitFor(() => expect(mockListPythonVersions).toHaveBeenCalled())
    expect(screen.getByTestId('runtime-content')).toBeTruthy()
  })

  it('checks git when the git feature flag is enabled', async () => {
    mockUseFeatureFlag.mockReturnValue(true)
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })

    await act(async () => {
      render(<RuntimeSettingsView />)
    })

    await waitFor(() => {
      expect(mockCheckGitVersion).toHaveBeenCalled()
    })
  })

  it('does not check git when the git feature flag is disabled', async () => {
    mockUseFeatureFlag.mockReturnValue(false)
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })

    await act(async () => {
      render(<RuntimeSettingsView />)
    })

    expect(mockCheckGitVersion).not.toHaveBeenCalled()
  })

  it('refresh button triggers another round of checks', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })

    await act(async () => {
      render(<RuntimeSettingsView />)
    })
    await waitFor(() => expect(mockCheckCore).toHaveBeenCalled())
    const initialCheckCount = mockCheckCore.mock.calls.length

    fireEvent.click(screen.getByTestId('refresh-btn'))
    await waitFor(() => expect(mockCheckCore).toHaveBeenCalledTimes(initialCheckCount + 1))
    expect(mockShowSuccess).toHaveBeenCalled()
  })

  it('delegates mode changes, installs, and Python install actions through the runtime API', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })

    await act(async () => {
      render(<RuntimeSettingsView />)
    })

    fireEvent.click(screen.getByTestId('mode-system'))
    fireEvent.click(screen.getByTestId('install-bun'))
    fireEvent.click(screen.getByTestId('install-python'))

    await waitFor(() => {
      expect(mockSetMode).toHaveBeenCalledWith('system')
      expect(mockInstall).toHaveBeenCalledWith('bun', '')
      expect(mockInstallPythonVersion).toHaveBeenCalled()
      expect(mockSetPinnedPythonVersion).toHaveBeenCalled()
    })
  })

  it('reacts to pushed runtime configuration and uses the edited install version', async () => {
    mockGetRuntimeEnvironment.mockReturnValue(null)
    let subscriber: (config: any) => void = () => {}
    mockAppDataSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    render(<RuntimeSettingsView />)

    await act(async () => {
      subscriber({ runtimeEnvironment: { mode: 'internal', bunVersion: '1.0', uvVersion: '0.1' } })
    })
    fireEvent.click(screen.getByTestId('version-bun'))
    fireEvent.click(screen.getByTestId('install-bun'))
    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('bun', '2.0'))
  })

  it('ignores pushes without runtime configuration', () => {
    let subscriber: (config: any) => void = () => {}
    mockAppDataSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    render(<RuntimeSettingsView />)
    act(() => subscriber({}))
    expect(screen.getByText('Loading runtime status...')).toBeTruthy()
  })

  it('pauses and resumes polling as page visibility changes', async () => {
    vi.useFakeTimers()
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })
    let hidden = false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    const view = render(<RuntimeSettingsView />)
    await act(async () => {})
    const initialChecks = mockCheckCore.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(mockCheckCore).toHaveBeenCalledTimes(initialChecks + 1)

    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {
      vi.advanceTimersByTime(120_000)
    })
    expect(mockCheckCore).toHaveBeenCalledTimes(initialChecks + 1)

    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {})
    expect(mockCheckCore).toHaveBeenCalledTimes(initialChecks + 2)

    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(mockCheckCore).toHaveBeenCalledTimes(initialChecks + 4)

    view.unmount()
    vi.advanceTimersByTime(60_000)
    expect(mockCheckCore).toHaveBeenCalledTimes(initialChecks + 4)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    vi.useRealTimers()
  })

  it('reports failures for mode, tool, Python, and cache operations', async () => {
      mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '1.0', uvVersion: '0.1' })
      mockSetMode.mockRejectedValueOnce(new Error('mode failed'))
      mockInstall.mockRejectedValueOnce(new Error('install failed'))
      mockInstallPythonVersion.mockRejectedValueOnce(new Error('python failed'))
      mockCleanUvCache.mockRejectedValueOnce(new Error('cache failed'))
      render(<RuntimeSettingsView />)

      fireEvent.click(screen.getByTestId('mode-system'))
      fireEvent.click(screen.getByTestId('install-bun'))
      fireEvent.click(screen.getByTestId('install-python'))
      fireEvent.click(screen.getByTestId('clean-cache'))

      await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(4))
      expect(mockSetPinnedPythonVersion).not.toHaveBeenCalled()
  })

  it('reports successful cache cleanup', async () => {
    mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })
    render(<RuntimeSettingsView />)
    fireEvent.click(screen.getByTestId('clean-cache'))
    await waitFor(() => expect(mockCleanUvCache).toHaveBeenCalled())
    expect(mockShowSuccess).toHaveBeenCalled()
  })

  it('logs independent probe failures without preventing the view from rendering', async () => {
      mockUseFeatureFlag.mockReturnValue(true)
      mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })
      mockCheckCore.mockRejectedValueOnce(new Error('core unavailable'))
      mockCheckGitVersion.mockRejectedValueOnce(new Error('git unavailable'))
      render(<RuntimeSettingsView />)

      await waitFor(() => {
        expect(mockCheckCore).toHaveBeenCalled()
        expect(mockCheckGitVersion).toHaveBeenCalled()
        expect(screen.getByTestId('runtime-content')).toBeTruthy()
      })
  })

  it('skips Python installation after the version draft is cleared', async () => {
      mockGetRuntimeEnvironment.mockReturnValue({ mode: 'internal', bunVersion: '', uvVersion: '' })
      render(<RuntimeSettingsView />)
      fireEvent.click(screen.getByTestId('python-version-empty'))
      fireEvent.click(screen.getByTestId('install-python'))
      expect(mockInstallPythonVersion).not.toHaveBeenCalled()
  })
})
