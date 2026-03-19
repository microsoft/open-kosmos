'use client'

import React, { useState, useEffect } from 'react'
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
import '../../styles/BrowserControlView.css'

// Progress type for download
interface DownloadProgress {
  percent: number
  transferred: string
  total: string
}

/**
 * Browser Control settings view
 * Provides an Enable/Disable Browser Control toggle
 */
type BrowserType = 'chrome' | 'edge'

const BrowserControlView: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true)
  const [isEnabled, setIsEnabled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [phase, setPhase] = useState<string>('idle')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({ percent: 0, transferred: '0', total: '0' })
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserType>('edge')
  
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

  // Check current status (registry) and installation progress (main process memory)
  useEffect(() => {
    const checkStatus = async () => {
      try {
        // 1. Load browser settings
        const browserResult = await window.electronAPI?.browserControl?.getSettings()
        if (browserResult?.success && browserResult.data) {
          setSelectedBrowser(browserResult.data.browser || 'edge')
        }

        // 2. Check if installed (registry)
        const statusResult = await window.electronAPI?.browserControl?.getStatus()
        if (statusResult?.success && statusResult.data) {
          setIsEnabled(statusResult.data.enabled || false)
        }

        // 3. Check if currently installing (main process memory) - for restoring state when component remounts
        const installResult = await window.electronAPI?.browserControl?.getInstallStatus()
        if (installResult?.success && installResult.data) {
          const { isInstalling: installing, phase: currentPhase, progress } = installResult.data
          if (installing) {
            setIsInstalling(true)
            setPhase(currentPhase)
            setDownloadProgress({ percent: progress, transferred: '0', total: '0' })
          }
        }
      } catch (err) {
        console.error('Failed to check Browser Control status:', err)
      } finally {
        setIsLoading(false)
      }
    }
    checkStatus()
  }, [])

  // Listen for progress events
  useEffect(() => {
    const cleanupPhaseChange = window.electronAPI?.browserControl?.onPhaseChange((newPhase) => {
      setPhase(newPhase)
      
      // Reset progress when entering downloading phase
      if (newPhase === 'downloading') {
        setDownloadProgress({ percent: 0, transferred: '0', total: '0' })
      }
      
      // When completed, update enabled state
      if (newPhase === 'completed') {
        setIsEnabled(true)
        setIsInstalling(false)
        // Reset to idle after a short delay
        setTimeout(() => {
          setPhase('idle')
        }, 1000)
      }
      
      // On error, stop installing state
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

  // Listen for browser install confirmation event
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

  // Listen for Native Server download confirmation event
  useEffect(() => {
    const cleanup = window.electronAPI?.browserControl?.onShowNativeServerDownloadConfirm((data) => {
      setNativeServerDownloadConfirm({
        isOpen: true,
        requestId: data.requestId
      })
    })
    return () => cleanup?.()
  }, [])

  // Handle browser install confirmation response
  const handleBrowserInstallConfirmResponse = async (confirmed: boolean) => {
    const { requestId } = browserInstallConfirm
    setBrowserInstallConfirm({ isOpen: false, requestId: '', browserName: '' })
    await window.electronAPI?.browserControl?.respondBrowserInstallConfirm(requestId, confirmed)
    
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
    await window.electronAPI?.browserControl?.respondNativeServerDownloadConfirm(requestId, confirmed)
    
    // If user cancels, reset installation state
    if (!confirmed) {
      setIsInstalling(false)
      setPhase('idle')
    }
  }

  const handleLaunchBrowser = async () => {
    try {
      const result = await window.electronAPI?.browserControl?.launchWithSnap()
      if (!result?.success) {
        console.error('Failed to launch browser with snap:', result?.error)
      }
    } catch (err) {
      console.error('Failed to launch browser with snap:', err)
    }
  }

  const handleToggle = async () => {
    if (!isEnabled) {
      // Enable: requires admin privileges for installation
      setIsInstalling(true)
      setPhase('idle')

      try {
        const result = await window.electronAPI?.browserControl?.enable()
        if (!result?.success) {
          console.error('Failed to enable Browser Control:', result?.error)
          setPhase('error')
        }
        // Success case is handled by onPhaseChange listener
      } catch (err: any) {
        console.error('Failed to enable Browser Control:', err)
        setPhase('error')
        setIsInstalling(false)
      }
    } else {
      // Disable
      setIsInstalling(true)
      setPhase('idle')

      try {
        const result = await window.electronAPI?.browserControl?.disable()
        if (result?.success) {
          setIsEnabled(false)
        } else {
          console.error('Failed to disable Browser Control:', result?.error)
        }
      } catch (err: any) {
        console.error('Failed to disable Browser Control:', err)
      } finally {
        setIsInstalling(false)
      }
    }
  }

  const handleBrowserChange = async (browser: BrowserType) => {
    setSelectedBrowser(browser)
    try {
      await window.electronAPI?.browserControl?.updateSettings({ browser })
    } catch (err) {
      console.error('Failed to save browser setting:', err)
    }
  }

  return (
    <div className="browser-control-view">
      <BrowserControlHeaderView />

      <BrowserControlContentView
        isEnabled={isEnabled}
        isInstalling={isInstalling}
        isLoading={isLoading}
        onToggle={handleToggle}
        onLaunchBrowser={handleLaunchBrowser}
        phase={phase}
        downloadProgress={downloadProgress}
        selectedBrowser={selectedBrowser}
        onBrowserChange={handleBrowserChange}
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
    </div>
  )
}

export default BrowserControlView
