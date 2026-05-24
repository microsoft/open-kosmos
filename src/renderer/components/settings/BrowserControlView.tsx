'use client'

import React, { useState, useEffect, useCallback } from 'react'
import BrowserControlHeaderView from './BrowserControlHeaderView'
import BrowserControlContentView from './BrowserControlContentView'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../ui/dialog'
import { Button } from '../ui/button'
import { useToast } from '../ui/ToastProvider'
import { browserControlApi } from '../../ipc/browserControl'
import '../../styles/BrowserControlView.css'
import '../../styles/RuntimeSettings.css'
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[BrowserControlView]');

// Progress type for download
interface DownloadProgress {
  percent: number
  transferred: string
  total: string
}

/**
 * Browser Control Settings View
 * Provides Enable/Disable Browser Control toggle
 */
type BrowserType = 'chrome' | 'edge'
export type BrowserControlMode = 'extension' | 'cdp'

const CDP_INSPECT_URL = 'chrome://inspect/#remote-debugging'

const BrowserControlView: React.FC = () => {
  const { showSuccess, showError } = useToast()
  const [mode, setMode] = useState<BrowserControlMode>('extension')
  const [modeSwitchBlockedDialog, setModeSwitchBlockedDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isEnabled, setIsEnabled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [phase, setPhase] = useState<string>('idle')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({ percent: 0, transferred: '0', total: '0' })
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserType>('edge')

  // Native server update state
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'up-to-date' | 'available' | 'updating' | 'done'>('checking')
  const [updateVersions, setUpdateVersions] = useState<{ local: string; remote: string | null }>({ local: '', remote: null })
  const [updateProgress, setUpdateProgress] = useState<DownloadProgress>({ percent: 0, transferred: '0', total: '0' })
  const [updatePhase, setUpdatePhase] = useState<string>('idle')

  // Extension reinstall state
  const [isReinstalling, setIsReinstalling] = useState(false)
  const [reinstallDone, setReinstallDone] = useState(false)

  // Browser install confirmation dialog state
  const [browserInstallConfirm, setBrowserInstallConfirm] = useState<{
    isOpen: boolean
    requestId: string
    browserName: string
  }>({ isOpen: false, requestId: '', browserName: '' })

  // Native Server download confirmation dialog state
  const [nativeServerDownloadConfirm, setNativeServerDownloadConfirm] = useState<{
    isOpen: boolean
    requestId: string
  }>({ isOpen: false, requestId: '' })

  // Browser restart confirmation dialog state
  const [browserRestartConfirm, setBrowserRestartConfirm] = useState<{
    isOpen: boolean
    requestId: string
    browserName: string
  }>({ isOpen: false, requestId: '', browserName: '' })

  // CDP (DevTools MCP) state
  const [isCdpEnabled, setIsCdpEnabled] = useState(false)
  const [isCdpBusy, setIsCdpBusy] = useState(false)
  const [cdpStatusMessage, setCdpStatusMessage] = useState('')
  const [enableCdpDialog, setEnableCdpDialog] = useState(false)
  const [disableCdpDialog, setDisbleCdpDialog] = useState(false)
  const [cdpCopied, setCdpCopied] = useState(false)

  // Check current state (registry) and installation progress (main process memory)
  useEffect(() => {
    const checkStatus = async () => {
      try {
        // 1. Load browser settings
        const browserResult = await browserControlApi.getSettings()
        if (browserResult?.success && browserResult.data) {
          setSelectedBrowser(browserResult.data.browser || 'edge')
          if (browserResult.data.mode) {
            setMode(browserResult.data.mode)
          }
        }

        // 2. Check if installed (registry)
        const statusResult = await browserControlApi.getStatus()
        if (statusResult?.success && statusResult.data) {
          setIsEnabled(statusResult.data.enabled || false)
        }

        // 3. Check if installing (main process memory) - for restoring state on component remount
        const installResult = await browserControlApi.getInstallStatus()
        if (installResult?.success && installResult.data) {
          const { isInstalling: installing, phase: currentPhase, progress } = installResult.data
          if (installing) {
            setIsInstalling(true)
            setPhase(currentPhase)
            setDownloadProgress({ percent: progress, transferred: '0', total: '0' })
          }
        }

        // 4. Check if updating (main process memory) - for restoring update state on component remount
        const updateResult = await browserControlApi.getUpdateStatus()
        if (updateResult?.success && updateResult.data) {
          const { isUpdating, phase: uPhase, progress: uProgress, localVersion, remoteVersion } = updateResult.data
          if (isUpdating) {
            setIsEnabled(true) // Keep enabled during update even if files are temporarily missing
            setUpdateStatus('updating')
            setUpdatePhase(uPhase)
            setUpdateProgress({ percent: uProgress, transferred: '0', total: '0' })
            if (localVersion || remoteVersion) {
              setUpdateVersions({ local: localVersion, remote: remoteVersion })
            }
          }
        }

        // 5. Check CDP (DevTools MCP) status
        try {
          const cdpStatus = await window.electronAPI.devToolsMcp.getStatus()
          if (cdpStatus?.success && cdpStatus.data) {
            setIsCdpEnabled(cdpStatus.data.enabled)
          }
        } catch {
          // ignore — will just show as disabled
        }
      } catch (err) {
        logger.error('Failed to check Browser Control status:', err)
      } finally {
        setIsLoading(false)
      }
    }
    checkStatus()
  }, [])

  // Check for native server update when enabled (skip if already updating)
  useEffect(() => {
    if (!isEnabled || isLoading || updateStatus === 'updating') return
    const checkUpdate = async () => {
      setUpdateStatus('checking')
      try {
        const result = await browserControlApi.checkNativeServerUpdate()
        if (result?.success && result.data) {
          setUpdateVersions({ local: result.data.localVersion, remote: result.data.remoteVersion })
          setUpdateStatus(result.data.needsUpdate ? 'available' : 'up-to-date')
        } else {
          setUpdateStatus('up-to-date')
        }
      } catch {
        setUpdateStatus('up-to-date')
      }
    }
    checkUpdate()
  }, [isEnabled, isLoading])

  // Listen to enable/install progress events
  useEffect(() => {
    const cleanupPhaseChange = window.electronAPI?.browserControl?.onPhaseChange((newPhase) => {
      setPhase(newPhase)

      if (newPhase === 'downloading') {
        setDownloadProgress({ percent: 0, transferred: '0', total: '0' })
      }

      if (newPhase === 'completed') {
        setIsEnabled(true)
        setIsInstalling(false)
        setTimeout(() => setPhase('idle'), 1000)
      }

      if (newPhase === 'error') {
        setIsInstalling(false)
      }
    })

    const cleanupDownloadProgress = window.electronAPI?.browserControl?.onDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })

    return () => {
      cleanupPhaseChange?.()
      cleanupDownloadProgress?.()
    }
  }, [])

  // Listen to update progress events (independent channel)
  useEffect(() => {
    const cleanupUpdatePhase = window.electronAPI?.browserControl?.onUpdatePhaseChange((newPhase) => {
      setUpdatePhase(newPhase)
      if (newPhase === 'downloading') {
        setUpdateProgress({ percent: 0, transferred: '0', total: '0' })
      }
      if (newPhase === 'completed') {
        setUpdateStatus('up-to-date')
        setUpdateVersions(prev => ({ local: prev.remote ?? prev.local, remote: null }))
        setTimeout(() => setUpdatePhase('idle'), 1000)
      }
      if (newPhase === 'error') {
        setUpdateStatus('available')
        setUpdatePhase('idle')
      }
    })

    const cleanupUpdateProgress = window.electronAPI?.browserControl?.onUpdateDownloadProgress((progress) => {
      setUpdateProgress(progress)
    })

    return () => {
      cleanupUpdatePhase?.()
      cleanupUpdateProgress?.()
    }
  }, [])

  // Listen to browser installation confirmation events
  useEffect(() => {
    const cleanup = window.electronAPI?.browserControl?.onShowBrowserInstallConfirm((data) => {
      setBrowserInstallConfirm({
        isOpen: true,
        requestId: data.requestId,
        browserName: data.browserName
      })
    })
    return () => cleanup?.()
  }, [])

  // Listen to Native Server download confirmation events
  useEffect(() => {
    const cleanup = window.electronAPI?.browserControl?.onShowNativeServerDownloadConfirm((data) => {
      setNativeServerDownloadConfirm({
        isOpen: true,
        requestId: data.requestId
      })
    })
    return () => cleanup?.()
  }, [])

  // Listen to browser restart confirmation events
  useEffect(() => {
    const cleanup = window.electronAPI?.browserControl?.onShowBrowserRestartConfirm((data) => {
      setBrowserRestartConfirm({
        isOpen: true,
        requestId: data.requestId,
        browserName: data.browserName
      })
    })
    return () => cleanup?.()
  }, [])

  // Handle browser installation confirmation response
  const handleBrowserInstallConfirmResponse = async (confirmed: boolean) => {
    const { requestId } = browserInstallConfirm
    setBrowserInstallConfirm({ isOpen: false, requestId: '', browserName: '' })
    await browserControlApi.respondBrowserInstallConfirm(requestId, confirmed)

    // If user cancels, reset installation state
    if (!confirmed) {
      setIsInstalling(false)
      setPhase('idle')
    }
  }

  // Handle Native Server download confirmation response
  const handleNativeServerDownloadConfirmResponse = async (confirmed: boolean) => {
    const { requestId } = nativeServerDownloadConfirm
    setNativeServerDownloadConfirm({ isOpen: false, requestId: '' })
    await browserControlApi.respondNativeServerDownloadConfirm(requestId, confirmed)

    // If user cancels, reset installation state
    if (!confirmed) {
      setIsInstalling(false)
      setPhase('idle')
    }
  }

  // Handle browser restart confirmation response
  const handleBrowserRestartConfirmResponse = async (confirmed: boolean) => {
    const { requestId } = browserRestartConfirm
    setBrowserRestartConfirm({ isOpen: false, requestId: '', browserName: '' })
    await browserControlApi.respondBrowserRestartConfirm(requestId, confirmed)
  }

  const handleUpdate = async () => {
    setUpdateStatus('updating')
    setUpdatePhase('idle')
    setUpdateProgress({ percent: 0, transferred: '0', total: '0' })
    try {
      const result = await browserControlApi.updateNativeServer()
      if (!result?.success) {
        logger.error('Failed to update native server:', result?.error)
      }
    } catch (err) {
      logger.error('Failed to update native server:', err)
      setUpdateStatus('available')
      setUpdatePhase('idle')
    }
  }

  const handleReinstallExtension = async () => {
    setIsReinstalling(true)
    setReinstallDone(false)
    try {
      const result = await browserControlApi.reinstallExtension()
      if (result?.success) {
        setReinstallDone(true)
        setIsEnabled(true)
      } else {
        logger.error('Failed to reinstall extension:', result?.error)
      }
    } catch (err) {
      logger.error('Failed to reinstall extension:', err)
    } finally {
      setIsReinstalling(false)
    }
  }

  const handleLaunchBrowser = async () => {
    try {
      const result = await browserControlApi.launchWithSnap()
      if (!result?.success) {
        logger.error('Failed to launch browser with snap:', result?.error)
      }
    } catch (err) {
      logger.error('Failed to launch browser with snap:', err)
    }
  }

  const handleToggle = async () => {
    if (!isEnabled) {
      // Enable: requires admin privileges to install
      setIsInstalling(true)
      setPhase('idle')

      try {
        const result = await browserControlApi.enable()
        if (!result?.success) {
          logger.error('Failed to enable Browser Control:', result?.error)
          setPhase('error')
        }
        // Success case is handled by onPhaseChange listener
      } catch (err: any) {
        logger.error('Failed to enable Browser Control:', err)
        setPhase('error')
        setIsInstalling(false)
      }
    } else {
      // Disable
      try {
        const result = await browserControlApi.disable()
        if (result?.success) {
          setIsEnabled(false)
        } else {
          logger.error('Failed to disable Browser Control:', result?.error)
        }
      } catch (err: any) {
        logger.error('Failed to disable Browser Control:', err)
      }
    }
  }

  const handleBrowserChange = async (browser: BrowserType) => {
    setSelectedBrowser(browser)
    try {
      await browserControlApi.updateSettings({ browser })
    } catch (err) {
      logger.error('Failed to save browser setting:', err)
    }
  }

  // Mode switch handler
  const handleModeChange = useCallback(async (newMode: BrowserControlMode) => {
    if (newMode === mode) return
    // Block switch if current mode has something enabled
    if (mode === 'extension' && (isEnabled || isInstalling)) {
      setModeSwitchBlockedDialog(true)
      return
    }
    if (mode === 'cdp' && (isCdpEnabled || isCdpBusy)) {
      setModeSwitchBlockedDialog(true)
      return
    }
    setMode(newMode)
    showSuccess(`Switched to ${newMode === 'extension' ? 'Extension' : 'CDP'} mode`)
    // Persist mode
    try {
      await browserControlApi.updateSettings({ mode: newMode })
    } catch {
      // ignore
    }
  }, [mode, isEnabled, isInstalling, isCdpEnabled, isCdpBusy, showSuccess])

  // CDP handlers
  const handleCdpCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CDP_INSPECT_URL)
      setCdpCopied(true)
      setTimeout(() => setCdpCopied(false), 2000)
    } catch {
      // fallback: ignore
    }
  }, [])

  const handleCdpToggleEnable = useCallback(() => {
    if (isCdpBusy) return
    setEnableCdpDialog(true)
    setCdpCopied(false)
  }, [isCdpBusy])

  const handleCdpToggleDisable = useCallback(() => {
    if (isCdpBusy) return
    setDisbleCdpDialog(true)
    setCdpCopied(false)
  }, [isCdpBusy])

  const handleCdpEnableConfirm = useCallback(async () => {
    setEnableCdpDialog(false)
    setIsCdpBusy(true)
    setCdpStatusMessage('')
    try {
      const result = await window.electronAPI.devToolsMcp.enable()
      if (!result.success) {
        setCdpStatusMessage(`Failed to enable: ${result.error || 'Unknown error'}`)
      } else {
        setIsCdpEnabled(true)
        setCdpStatusMessage('MCP server configured successfully.')
      }
    } catch (error) {
      setCdpStatusMessage(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsCdpBusy(false)
    }
  }, [])

  const handleCdpDisableConfirm = useCallback(async () => {
    setDisbleCdpDialog(false)
    setIsCdpBusy(true)
    setCdpStatusMessage('')
    try {
      const result = await window.electronAPI.devToolsMcp.disable()
      if (!result.success) {
        setCdpStatusMessage(`Failed to disable: ${result.error || 'Unknown error'}`)
      } else {
        setIsCdpEnabled(false)
        setCdpStatusMessage('')
      }
    } catch (error) {
      setCdpStatusMessage(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsCdpBusy(false)
    }
  }, [])

  return (
    <div className="browser-control-view">
      <BrowserControlHeaderView />

      <BrowserControlContentView
        mode={mode}
        onModeChange={handleModeChange}
        isEnabled={isEnabled}
        isInstalling={isInstalling}
        isLoading={isLoading}
        onToggle={handleToggle}
        onLaunchBrowser={handleLaunchBrowser}
        phase={phase}
        downloadProgress={downloadProgress}
        selectedBrowser={selectedBrowser}
        onBrowserChange={handleBrowserChange}
        updateStatus={updateStatus}
        updateVersions={updateVersions}
        updatePhase={updatePhase}
        updateProgress={updateProgress}
        onUpdate={handleUpdate}
        isReinstalling={isReinstalling}
        reinstallDone={reinstallDone}
        onReinstallExtension={handleReinstallExtension}
        isCdpEnabled={isCdpEnabled}
        isCdpBusy={isCdpBusy}
        cdpStatusMessage={cdpStatusMessage}
        onCdpEnable={handleCdpToggleEnable}
        onCdpDisable={handleCdpToggleDisable}
      />

      {/* Browser Install Confirmation Dialog */}
      <Dialog
        open={browserInstallConfirm.isOpen}
        onOpenChange={(open) => !open && handleBrowserInstallConfirmResponse(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Browser Not Installed</DialogTitle>
            <DialogDescription>
              {browserInstallConfirm.browserName} is not installed on your system.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Would you like to automatically download and install {browserInstallConfirm.browserName}?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleBrowserInstallConfirmResponse(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleBrowserInstallConfirmResponse(true)}>
              Install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Native Server Download Confirmation Dialog */}
      <Dialog
        open={nativeServerDownloadConfirm.isOpen}
        onOpenChange={(open) => !open && handleNativeServerDownloadConfirmResponse(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Native Server Required</DialogTitle>
            <DialogDescription>
              The Native Server component is required for Browser Control.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Would you like to download the Native Server component now?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleNativeServerDownloadConfirmResponse(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleNativeServerDownloadConfirmResponse(true)}>
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Browser Restart Confirmation Dialog */}
      <Dialog
        open={browserRestartConfirm.isOpen}
        onOpenChange={(open) => !open && handleBrowserRestartConfirmResponse(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Browser Restart Required</DialogTitle>
            <DialogDescription>
              {browserRestartConfirm.browserName} needs to be restarted to load the Browser Control extension.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {browserRestartConfirm.browserName} is currently running. Would you like to close and restart it now?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleBrowserRestartConfirmResponse(false)}>
              Skip
            </Button>
            <Button onClick={() => handleBrowserRestartConfirmResponse(true)}>
              Restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CDP Enable Dialog */}
      <Dialog open={enableCdpDialog} onOpenChange={(open) => !open && setEnableCdpDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enable Remote Debugging</DialogTitle>
            <DialogDescription>
              Before enabling, please open the following URL in Google Chrome and check
              &quot;Allow remote debugging for this browser instance&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#f3f4f6',
              borderRadius: '6px',
              padding: '10px 12px',
              border: '1px solid #e5e7eb',
            }}>
              <code style={{
                flex: 1,
                fontSize: '13px',
                fontFamily: 'monospace',
                color: '#374151',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}>
                {CDP_INSPECT_URL}
              </code>
              <button
                onClick={handleCdpCopyUrl}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  backgroundColor: 'white',
                  color: '#374151',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {cdpCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnableCdpDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCdpEnableConfirm}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode Switch Blocked Dialog */}
      <Dialog open={modeSwitchBlockedDialog} onOpenChange={(open) => !open && setModeSwitchBlockedDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cannot Switch Mode</DialogTitle>
            <DialogDescription>
              Please disable the current {mode === 'extension' ? 'Browser Control' : 'CDP'} feature before switching to another mode.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setModeSwitchBlockedDialog(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CDP Disable Dialog */}
      <Dialog open={disableCdpDialog} onOpenChange={(open) => !open && setDisbleCdpDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disable Remote Debugging</DialogTitle>
            <DialogDescription>
              Before disabling, please open the following URL in Google Chrome and uncheck
              &quot;Allow remote debugging for this browser instance&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#f3f4f6',
              borderRadius: '6px',
              padding: '10px 12px',
              border: '1px solid #e5e7eb',
            }}>
              <code style={{
                flex: 1,
                fontSize: '13px',
                fontFamily: 'monospace',
                color: '#374151',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}>
                {CDP_INSPECT_URL}
              </code>
              <button
                onClick={handleCdpCopyUrl}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  backgroundColor: 'white',
                  color: '#374151',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {cdpCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisbleCdpDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCdpDisableConfirm}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default BrowserControlView
