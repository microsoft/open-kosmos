// src/renderer/components/update/UpdateProvider.tsx
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { UpdateDialog, UpdateInfo, CheckPhase } from './UpdateDialog';
import { RestartingOverlay } from './RestartingOverlay';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[UpdateProvider]');

// Types for update states and events
export type UpdateStatus = 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update';

export interface UpdateProgress {
  percent: number;
  transferred: number | string;  // Can be either number (bytes) or string (formatted)
  total: number | string;        // Can be either number (bytes) or string (formatted)
  speed: number | string;        // Can be either number (bytes/s) or string (formatted)
}

interface UpdateContextType {
  status: UpdateStatus;
  updateInfo?: UpdateInfo;
  progress?: UpdateProgress;
  error?: string;
  isDialogOpen: boolean;
  checkPhase: CheckPhase;
  updaterProgress?: UpdateProgress;
  checkForUpdates: () => Promise<void>;
  silentCheckForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: (filePathOverride?: string) => Promise<void>;
  skipVersion: (version: string) => Promise<void>;
  dismissDialog: () => void;
  showUpdateDialog: () => void;
}

const UpdateContext = createContext<UpdateContextType | null>(null);

export const useUpdate = () => {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error('useUpdate must be used within UpdateProvider');
  }
  return context;
};

interface UpdateProviderProps {
  children: React.ReactNode;
}

export const UpdateProvider: React.FC<UpdateProviderProps> = ({ children }) => {
  const [status, setStatus] = useState<UpdateStatus>('no-update');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | undefined>();
  const [progress, setProgress] = useState<UpdateProgress | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [lastNotificationTime, setLastNotificationTime] = useState<number>(0);
  const [updateCheckCount, setUpdateCheckCount] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>();
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | undefined>();
  const [lastManualCheckTime, setLastManualCheckTime] = useState<number>(0);
  const [checkPhase, setCheckPhase] = useState<CheckPhase>('idle');
  const [updaterProgress, setUpdaterProgress] = useState<UpdateProgress | undefined>();
  const [isRestarting, setIsRestarting] = useState<boolean>(false);

  // 🔒 Use useRef to prevent duplicate initialization
  const isInitializedRef = useRef(false);
  const listenersRef = useRef<(() => void)[]>([]);

  // Check if Electron API is available
  const isElectronAvailable = typeof window !== 'undefined' && window.electronAPI?.update;

  // Smart notification configuration
  const NOTIFICATION_COOLDOWN = 24 * 60 * 60 * 1000; // 24-hour cooldown
  const MAX_AUTO_CHECKS_PER_DAY = 3; // Maximum 3 automatic checks per day
  const MANUAL_CHECK_COOLDOWN = 30 * 60 * 1000; // 30-minute cooldown: skip auto check within 30 minutes after manual check
  const CRITICAL_UPDATE_KEYWORDS = ['security', 'critical', 'urgent', 'vulnerability', 'secure', 'emergency', 'bug'];

  // Format bytes to human readable format
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Check for updates
  const checkForUpdates = useCallback(async () => {
    if (!isElectronAvailable) {
      return;
    }

    try {
      // 🔒 Record manual check time to prevent conflicts with automatic checks
      const manualCheckTime = Date.now();
      setLastManualCheckTime(manualCheckTime);

      setStatus('checking');
      setCheckPhase('idle'); // Reset check phase
      setUpdaterProgress(undefined); // Reset updater progress
      setError(undefined);
      setIsDialogOpen(true);

      const result = await window.electronAPI.update.checkForUpdates();

      if (result.success) {
        // Backend will notify results through events, this just triggers the check
      } else {
        setStatus('error');
        setError(result.error || 'Check for updates failed');
        // Remove toast notification, keep only log records
      }
    } catch (err) {
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
      setError(errorMessage);

      // Ensure dialog is open to display error
      setIsDialogOpen(true);
    }
  }, [isElectronAvailable]);

  // Silent check for updates - don't show dialog
  const silentCheckForUpdates = useCallback(async () => {
    if (!isElectronAvailable) {
      return;
    }

    try {
      // 🔒 Pass silent: true parameter to tell the backend this is a silent check
      const result = await window.electronAPI.update.checkForUpdates(true);

      if (result.success) {
      } else {
      }
    } catch (err) {
    }
  }, [isElectronAvailable]);

  // Download update
  const downloadUpdate = useCallback(async () => {
    if (!isElectronAvailable) return;

    try {
      setStatus('downloading');
      setError(undefined);
      await window.electronAPI.update.downloadUpdate(downloadUrl);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Download update failed');
      // Remove toast notification, keep only log records
    }
  }, [isElectronAvailable, downloadUrl]);

  // Install update with optional file path parameter
  const installUpdate = useCallback(async (filePathOverride?: string) => {

    if (!isElectronAvailable) {
      return;
    }

    try {
      // Use passed file path or file path from state
      const targetFilePath = filePathOverride || downloadedFilePath;

      // 🔍 Debug: Check file path state

      // Ensure targetFilePath is a string
      if (typeof targetFilePath !== 'string') {
        // Force use downloadedFilePath as fallback
        const finalFilePath = downloadedFilePath;
        if (typeof finalFilePath !== 'string') {
          throw new Error('No valid file path available for installation');
        }
      }

      // The final file path to use must be a string
      const finalFilePath = typeof targetFilePath === 'string' ? targetFilePath : downloadedFilePath;

      if (!finalFilePath) {
        return;
      }

      // 🚀 Optimize installation process: show confirmation dialog
      const confirmed = await new Promise<boolean>((resolve) => {
        // Use browser's confirm dialog (simple implementation)
        const result = window.confirm(
          'Installing the new version requires closing the app.\n\nDo you want to continue with the installation?'
        );
        resolve(result);
      });

      if (!confirmed) {
        return;
      }

      // 🎬 Show full-screen restart prompt
      setIsDialogOpen(false); // Close update dialog
      setIsRestarting(true);  // Show restart prompt

      try {
        // Call install function, which will launch the installer and close the app
        const result = window.electronAPI.update.quitAndInstall(finalFilePath);
      } catch (installError) {
        // If installation fails, hide the restart prompt
        setIsRestarting(false);
        throw installError;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Install update failed';
      // Ensure the restart prompt is hidden
      setIsRestarting(false);
    }
  }, [isElectronAvailable, downloadedFilePath, status]);

  // Skip version
  const skipVersion = useCallback(async (version: string) => {
    if (!isElectronAvailable) return;

    try {
      await window.electronAPI.update.skipVersion(version);
      setStatus('no-update');
      setIsDialogOpen(false);
    } catch (err) {
    }
  }, [isElectronAvailable]);

  // Dismiss dialog
  const dismissDialog = useCallback(() => {
    setIsDialogOpen(false);
  }, []);

  // Show update dialog
  const showUpdateDialog = useCallback(() => {
    setIsDialogOpen(true);
  }, []);


  // Setup event listeners
  useEffect(() => {
    if (!isElectronAvailable) return;

    // 🔒 Prevent duplicate execution caused by React StrictMode
    if (isInitializedRef.current) {
      return;
    }
    isInitializedRef.current = true;

    // Listen for update events using the generic onUpdateEvent method
    const removeUpdateAvailableListener = window.electronAPI.update.onUpdateEvent('updateAvailable', (updateInfo: any) => {
      setStatus('available');

      const newUpdateInfo = {
        version: updateInfo.latest || updateInfo.version,
        releaseNotes: updateInfo.releaseNotes,
        releaseDate: updateInfo.releaseDate,
        downloadSize: updateInfo.files?.[0]?.size
      };

      setUpdateInfo(newUpdateInfo);

      // Save download URL (if available)
      if (updateInfo.downloadUrl) {
        setDownloadUrl(updateInfo.downloadUrl);
      }

      // Smart notification decision
      if (shouldShowUpdateNotification(newUpdateInfo)) {
        setIsDialogOpen(true);
        setLastNotificationTime(Date.now());
      }
    });

    const removeUpdateNotAvailableListener = window.electronAPI.update.onUpdateEvent('updateNotAvailable', (data: any) => {
      setStatus('no-update');
      // Set current version info for display
      if (data?.version) {
        setUpdateInfo({
          version: data.version,
          releaseNotes: undefined,
          releaseDate: undefined,
          downloadSize: undefined
        });
      }
      // Close update dialog as no updates are available
      setIsDialogOpen(false);
      // Remove toast notification, keep only log records
    });

    const removeDownloadProgressListener = window.electronAPI.update.onUpdateEvent('downloadProgress', (progressInfo: any) => {
      setStatus('downloading');
      setCheckPhase('downloadingApp'); // Set to app package download phase
      setProgress({
        percent: progressInfo.percent,
        transferred: progressInfo.transferred,    // Already formatted string like "15.2 MB"
        total: progressInfo.total,               // Already formatted string like "150.0 MB"
        speed: progressInfo.bytesPerSecond       // Already formatted string like "1.5 MB/s"
      });
    });

    const removeUpdateDownloadedListener = window.electronAPI.update.onUpdateEvent('updateDownloaded', (downloadInfo: any) => {
      setStatus('downloaded');
      setProgress(undefined);

      // Save downloaded file path
      if (downloadInfo?.filePath) {
        setDownloadedFilePath(downloadInfo.filePath);
      }

      // 🎯 Update updateInfo with version information from downloadInfo
      if (downloadInfo?.version || downloadInfo?.releaseNotes || downloadInfo?.releaseDate) {
        const updatedUpdateInfo = {
          version: downloadInfo.version || downloadInfo.latest || updateInfo?.version || updateInfo?.latest || 'Unknown',
          releaseNotes: downloadInfo.releaseNotes || updateInfo?.releaseNotes,
          releaseDate: downloadInfo.releaseDate || updateInfo?.releaseDate,
          downloadSize: updateInfo?.downloadSize
        };
        setUpdateInfo(updatedUpdateInfo);
      }

      // Update button will be shown in UserSection component when status is 'downloaded'
      // No toast notification needed
    });

    const removeUpdateErrorListener = window.electronAPI.update.onUpdateEvent('updateError', (error: any) => {
      setStatus('error');
      setCheckPhase('idle'); // Reset check phase on error

      // Extract error message
      const errorMessage = typeof error === 'string'
        ? error
        : (error?.message || 'An error occurred during the update process');

      setError(errorMessage);

      // Ensure dialog is open to display error
      setIsDialogOpen(true);
    });

    // 🔧 Added: listen for check phase change events
    const removeCheckPhaseChangedListener = window.electronAPI.update.onUpdateEvent('checkPhaseChanged', (data: any) => {
      logger.debug('[UpdateProvider] Check phase changed:', data?.phase);
      const phaseMap: Record<string, CheckPhase> = {
        'checkingUpdater': 'checkingUpdater',
        'downloadingUpdater': 'downloadingUpdater',
        'updaterReady': 'updaterReady',
        'checkingVersion': 'checkingVersion'
      };
      const newPhase = phaseMap[data?.phase] || 'idle';
      setCheckPhase(newPhase);
    });

    // 🔧 Added: listen for Updater download progress events
    const removeUpdaterDownloadProgressListener = window.electronAPI.update.onUpdateEvent('updaterDownloadProgress', (progressInfo: any) => {
      logger.debug('[UpdateProvider] Updater download progress:', progressInfo);
      setUpdaterProgress({
        percent: progressInfo.percent,
        transferred: progressInfo.transferred,
        total: progressInfo.total,
        speed: '0 B/s' // Updater progress doesn't track speed
      });
    });

    // 🔧 Added: listen for Updater download failure events
    const removeUpdaterDownloadFailedListener = window.electronAPI.update.onUpdateEvent('updaterDownloadFailed', (data: any) => {
      logger.debug('[UpdateProvider] Updater download failed:', data?.error);
      setStatus('error');
      setCheckPhase('idle');
      setError(data?.error || 'Failed to download updater');
      setIsDialogOpen(true);
    });

    // 🚀 Simplified startup check strategy: first silent check 30 seconds after launch
    // UpdateManager internally handles conflict detection and 24-hour periodic checks
    const startupCheckTimer = setTimeout(() => {
      const autoUpdateEnabled = localStorage.getItem('autoUpdateEnabled');
      if (autoUpdateEnabled !== 'false') {
        logger.debug('[UpdateProvider] First automatic update check after startup');
        silentCheckForUpdates();
      }
    }, 30000); // Launch after 30 seconds

    // Save cleanup functions
    listenersRef.current = [
      removeUpdateAvailableListener,
      removeUpdateNotAvailableListener,
      removeDownloadProgressListener,
      removeUpdateDownloadedListener,
      removeUpdateErrorListener,
      removeCheckPhaseChangedListener,
      removeUpdaterDownloadProgressListener,
      removeUpdaterDownloadFailedListener
    ];

    // Cleanup
    return () => {
      clearTimeout(startupCheckTimer);

      // Clean up event listeners
      listenersRef.current.forEach(cleanup => cleanup());
      listenersRef.current = [];

      // 🔒 Reset initialization flag
      isInitializedRef.current = false;
    };
  }, [isElectronAvailable, checkForUpdates]);

  // Smart notification decision function
  const shouldShowUpdateNotification = (updateInfo: UpdateInfo): boolean => {
    // 1. Check cooldown time
    const timeSinceLastNotification = Date.now() - lastNotificationTime;
    if (timeSinceLastNotification < NOTIFICATION_COOLDOWN) {
      return false;
    }

    // 2. Check if it's a critical update
    const isCriticalUpdate = updateInfo.releaseNotes &&
      CRITICAL_UPDATE_KEYWORDS.some(keyword =>
        updateInfo.releaseNotes!.toLowerCase().includes(keyword.toLowerCase())
      );

    if (isCriticalUpdate) {
      return true;
    }

    // 3. Check version importance (major version change)
    try {
      const currentVersion = process.env.npm_package_version || '1.0.0';
      const [currentMajor] = currentVersion.split('.').map(Number);
      const [updateMajor] = updateInfo.version.split('.').map(Number);

      if (updateMajor > currentMajor) {
        return true;
      }
    } catch (error) {
    }

    // 4. Check update release time (newly released versions get priority notification)
    if (updateInfo.releaseDate) {
      const releaseTime = new Date(updateInfo.releaseDate).getTime();
      const timeSinceRelease = Date.now() - releaseTime;
      const isRecentRelease = timeSinceRelease < 7 * 24 * 60 * 60 * 1000; // Within 7 days

      if (isRecentRelease) {
        return true;
      }
    }

    // 5. By default, show when user actively checks
    return false;
  };


  const contextValue: UpdateContextType = {
    status,
    updateInfo,
    progress,
    error,
    isDialogOpen,
    checkPhase,
    updaterProgress,
    checkForUpdates,
    silentCheckForUpdates,
    downloadUpdate,
    installUpdate,
    skipVersion,
    dismissDialog,
    showUpdateDialog
  };

  return (
    <UpdateContext.Provider value={contextValue}>
      {children}

      {/* Update Dialog */}
      <UpdateDialog
        isOpen={isDialogOpen}
        onClose={dismissDialog}
        updateInfo={updateInfo}
        status={status}
        progress={progress}
        error={error}
        checkPhase={checkPhase}
        updaterProgress={updaterProgress}
        onCheckForUpdates={checkForUpdates}
        onDownloadUpdate={downloadUpdate}
        onInstallUpdate={installUpdate}
        onSkipVersion={skipVersion}
        onDismiss={dismissDialog}
      />

      {/* Full-screen restart prompt */}
      <RestartingOverlay isVisible={isRestarting} />
    </UpdateContext.Provider>
  );
};

export default UpdateProvider;