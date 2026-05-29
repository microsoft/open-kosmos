// src/renderer/components/update/UpdateDialog.tsx
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
  X,
  SkipForward,
  Clock,
  Download,
  Minimize2,
  Clock3,
  PackageCheck,
  XCircle,
  RotateCw,
  CheckCircle,
  PartyPopper,
  CheckCircle2,
  Lightbulb,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Settings,
  Search
} from 'lucide-react';

export interface UpdateInfo {
  version: string;
  latest?: string;  // Added latest field support
  releaseNotes?: string;
  releaseDate?: string;
  downloadSize?: number;
}

// Check phase type - unified 4-step flow
export type CheckPhase = 'idle' | 'checkingUpdater' | 'downloadingUpdater' | 'updaterReady' | 'checkingVersion' | 'downloadingApp';

export interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo?: UpdateInfo;
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update';
  progress?: {
    percent: number;
    transferred: number | string;
    total: number | string;
    speed: number | string;
  };
  error?: string;
  checkPhase?: CheckPhase;
  updaterProgress?: {
    percent: number;
    transferred: number | string;
    total: number | string;
    speed: number | string;
  };
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onSkipVersion: (version: string) => void;
  onDismiss: () => void;
}

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  isOpen,
  onClose,
  updateInfo,
  status,
  progress,
  error,
  checkPhase = 'idle',
  updaterProgress,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onSkipVersion,
  onDismiss
}) => {
  // Render a single step item
  const renderStepItem = (
    title: string,
    description: string,
    state: 'pending' | 'active' | 'completed',
    icon: 'settings' | 'download' | 'search' | 'package',
    progressInfo?: {
      percent: number;
      transferred: number | string;
      total: number | string;
      speed?: number | string;
    },
    showSimpleProgress: boolean = false // New parameter: whether to show simplified progress (progress bar only, no detail info)
  ) => {
    const getIcon = () => {
      switch (icon) {
        case 'settings':
          return state === 'active'
            ? <Settings className="h-5 w-5 text-blue-600 animate-spin" />
            : state === 'completed'
            ? <CheckCircle className="h-5 w-5 text-green-600" />
            : <Settings className="h-5 w-5 text-gray-400" />;
        case 'download':
          return state === 'active'
            ? <Download className="h-5 w-5 text-blue-600 animate-bounce" />
            : state === 'completed'
            ? <CheckCircle className="h-5 w-5 text-green-600" />
            : <Download className="h-5 w-5 text-gray-400" />;
        case 'search':
          return state === 'active'
            ? <Search className="h-5 w-5 text-blue-600 animate-pulse" />
            : state === 'completed'
            ? <CheckCircle className="h-5 w-5 text-green-600" />
            : <Search className="h-5 w-5 text-gray-400" />;
        case 'package':
          return state === 'active'
            ? <Download className="h-5 w-5 text-blue-600 animate-bounce" />
            : state === 'completed'
            ? <CheckCircle className="h-5 w-5 text-green-600" />
            : <PackageCheck className="h-5 w-5 text-gray-400" />;
        default:
          return null;
      }
    };

    const getTextColor = () => {
      switch (state) {
        case 'active': return 'text-gray-900';
        case 'completed': return 'text-gray-900';
        case 'pending': return 'text-gray-400';
        default: return 'text-gray-400';
      }
    };

    const getDescColor = () => {
      switch (state) {
        case 'active': return 'text-gray-500';
        case 'completed': return 'text-green-600';
        case 'pending': return 'text-gray-400';
        default: return 'text-gray-400';
      }
    };

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            {getIcon()}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-medium ${getTextColor()}`}>
              {title}
            </p>
            {description && (
              <p className={`text-xs ${getDescColor()}`}>
                {description}
              </p>
            )}
          </div>
        </div>
        {/* Always reserve placeholder space for the progress bar area to avoid layout jumps */}
        <div className="ml-8 h-2">
          {state === 'active' && progressInfo ? (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressInfo.percent}%` }}
              ></div>
            </div>
          ) : (
            /* Empty placeholder to keep layout stable */
            <div className="w-full h-2"></div>
          )}
        </div>
      </div>
    );
  };

  // Get current step state
  const getStepState = (stepPhase: CheckPhase[], currentPhase: CheckPhase): 'pending' | 'active' | 'completed' => {
    const phaseOrder: CheckPhase[] = ['idle', 'checkingUpdater', 'downloadingUpdater', 'updaterReady', 'checkingVersion', 'downloadingApp'];
    const currentIndex = phaseOrder.indexOf(currentPhase);

    // Check if any related phase is currently active
    for (const phase of stepPhase) {
      const phaseIndex = phaseOrder.indexOf(phase);
      if (phaseIndex === currentIndex) return 'active';
    }

    // Check if all related phases are completed
    const allCompleted = stepPhase.every(phase => {
      const phaseIndex = phaseOrder.indexOf(phase);
      return phaseIndex < currentIndex;
    });

    if (allCompleted) return 'completed';
    return 'pending';
  };

  // Render the unified update flow UI
  const renderUnifiedUpdateFlow = () => {
    // Determine the current effective phase
    // downloaded status means both steps are complete
    const effectivePhase: CheckPhase = status === 'downloaded' ? 'downloadingApp' :
                                        (status === 'downloading' ? 'downloadingApp' : checkPhase);

    // Determine if the Updater is currently downloading (via checkPhase or updaterProgress having a value)
    const isUpdaterDownloading = checkPhase === 'downloadingUpdater' ||
                                  (status === 'checking' && updaterProgress && updaterProgress.percent > 0 && updaterProgress.percent < 100);

    // Step 1: Updater check/download
    // In downloaded status, Step 1 is always complete
    const step1State = status === 'downloaded' ? 'completed' : getStepState(['checkingUpdater', 'downloadingUpdater', 'updaterReady'], effectivePhase);
    // If there is an ongoing updater download progress, force state to active
    const step1EffectiveState = isUpdaterDownloading ? 'active' : step1State;
    const step1Title = step1EffectiveState === 'completed' ? 'Update service is ready.' : 'Preparing update service …';
    const step1Desc = '';
    const step1Icon = isUpdaterDownloading ? 'download' : 'settings';

    // Step 2: App updates check/download (merges original Step 2 and Step 3)
    // In downloaded status, Step 2 is always complete
    const step2State = status === 'downloaded' ? 'completed' : getStepState(['checkingVersion', 'downloadingApp'], effectivePhase);
    const versionStr = updateInfo?.version ? updateInfo.version : '';
    const step2Title = (step2State === 'completed' || status === 'downloaded')
                         ? `Version ${versionStr} is ready. Restart to finish updating.`
                         : 'Downloading update …';
    const step2Desc = '';
    const step2Icon = status === 'downloading' ? 'download' : (status === 'downloaded' ? 'package' : 'search');

    return (
      <div className="space-y-4">
        {renderStepItem(
          step1Title,
          step1Desc,
          step1EffectiveState,
          step1Icon as 'settings' | 'download',
          isUpdaterDownloading ? updaterProgress : undefined,
          true // Use simplified progress display for Updater download
        )}

        {renderStepItem(
          step2Title,
          step2Desc,
          step2State,
          step2Icon as 'search' | 'download',
          status === 'downloading' ? progress : undefined,
          true // Also use simplified progress display for App download
        )}
      </div>
    );
  };

  const renderContent = () => {
    switch (status) {
      case 'checking':
      case 'downloading':
      case 'downloaded':
        return (
          <div className="py-4 min-h-[120px]">
            {renderUnifiedUpdateFlow()}
          </div>
        );

      case 'available':
        return (
          <div className="space-y-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center">
                <div className="shrink-0">
                  <PartyPopper className="h-5 w-5 text-green-600" />
                </div>
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-green-800">
                    New version v{updateInfo?.version || 'Unknown'} found
                  </h4>
                  <p className="text-sm text-green-700 mt-1">
                    A new version is available. We recommend updating promptly to get the latest features and security fixes.
                  </p>
                </div>
              </div>
            </div>

            {updateInfo?.releaseNotes && (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h5 className="text-sm font-medium text-gray-900 mb-2">
                  Update Notes
                </h5>
                <div className="text-sm text-gray-600 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {updateInfo.releaseNotes}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-gray-500">
              {updateInfo?.releaseDate && (
                <span>Release Date: {new Date(updateInfo.releaseDate).toLocaleDateString('en-US')}</span>
              )}
              {updateInfo?.downloadSize && (
                <span>Size: {(updateInfo.downloadSize / 1024 / 1024).toFixed(1)} MB</span>
              )}
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="space-y-4">
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="flex items-start">
                <div className="shrink-0 mt-0.5">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                </div>
                <div className="ml-3 flex-1">
                  <h4 className="text-sm font-medium text-red-800">
                    Update Check Failed
                  </h4>
                  <div className="text-sm text-red-700 mt-2 space-y-2">
                    <p className="whitespace-pre-wrap">
                      {error || 'An unknown error occurred while checking for updates. Please try again later.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Show troubleshooting tips if error contains network-related keywords */}
            {error && (error.includes('network') || error.includes('connection') || error.includes('VPN') || error.includes('DNS') || error.includes('SSL')) && (
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="flex items-start">
                  <div className="shrink-0">
                    <Lightbulb className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="ml-2">
                    <h5 className="text-xs font-medium text-blue-800 mb-1">
                      Troubleshooting Tips
                    </h5>
                    <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                      <li>Check your network connection</li>
                      <li>If on corporate network, ensure MSFT VPN is connected</li>
                      <li>Check if firewall or proxy settings are blocking the connection</li>
                      <li>Verify system time settings are correct</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'no-update':
        return (
          <div className="text-center py-4">
            <div className="flex items-center justify-center mb-4">
              <Sparkles className="h-6 w-6 text-green-600" />
            </div>
            <h4 className="text-sm font-medium text-gray-900">
              You are using the latest version {updateInfo?.version || ''}
            </h4>
          </div>
        );

      default:
        return null;
    }
  };

  const renderFooter = () => {
    switch (status) {
      case 'checking':
        return (
          <DialogFooter>
            <Button variant="outline" onClick={onDismiss}>
              <Minimize2 className="mr-2 h-4 w-4" />
              Download in Background
            </Button>
          </DialogFooter>
        );

      case 'available':
        return (
          <DialogFooter className="space-y-2 sm:space-y-0">
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-0 sm:space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateInfo && onSkipVersion(updateInfo.version)}
                className="order-3 sm:order-1"
              >
                <SkipForward className="mr-2 h-4 w-4" />
                Skip This Version
              </Button>
              <Button
                variant="outline"
                onClick={onDismiss}
                className="order-2"
              >
                <Clock className="mr-2 h-4 w-4" />
                Remind Later
              </Button>
              <Button
                onClick={onDownloadUpdate}
                className="order-1 sm:order-3"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Now
              </Button>
            </div>
          </DialogFooter>
        );

      case 'downloading':
        return (
          <DialogFooter>
            <Button variant="outline" onClick={onDismiss}>
              <Minimize2 className="mr-2 h-4 w-4" />
              Download in Background
            </Button>
          </DialogFooter>
        );

      case 'downloaded':
        return (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              <Clock3 className="mr-2 h-4 w-4" />
              Restart Later
            </Button>
            <Button onClick={onInstallUpdate}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Restart Now
            </Button>
          </DialogFooter>
        );

      case 'error':
        return (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              <XCircle className="mr-2 h-4 w-4" />
              Close
            </Button>
            <Button onClick={onCheckForUpdates}>
              <RotateCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </DialogFooter>
        );

      case 'no-update':
        return (
          <DialogFooter>
            <Button onClick={onClose}>
              <CheckCircle className="mr-2 h-4 w-4" />
              OK
            </Button>
          </DialogFooter>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-blue-600" />
            App Update
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {renderContent()}
        </div>

        {renderFooter()}
      </DialogContent>
    </Dialog>
  );
};

export default UpdateDialog;