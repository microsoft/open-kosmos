import React from 'react';

interface ProgressIndicatorProps {
  progress: number;
  status: 'downloading' | 'installing' | 'complete';
  speed?: string;
  transferred?: string;
  total?: string;
  eta?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  progress,
  status,
  speed,
  transferred,
  total,
  eta
}) => {
  const getStatusText = () => {
    switch (status) {
      case 'downloading': return 'Downloading...';
      case 'installing': return 'Installing...';
      case 'complete': return 'Download complete';
      default: return 'Preparing...';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'downloading': return '⬇️';
      case 'installing': return '⚙️';
      case 'complete': return '✅';
      default: return '🔄';
    }
  };

  const calculateETA = () => {
    if (!speed || !total || !transferred) return null;

    try {
      // Simple ETA calculation
      const speedBytes = parseFloat(speed.replace(/[^0-9.]/g, ''));
      const totalBytes = parseFloat(total.replace(/[^0-9.]/g, ''));
      const transferredBytes = parseFloat(transferred.replace(/[^0-9.]/g, ''));

      if (speedBytes > 0) {
        const remainingBytes = totalBytes - transferredBytes;
        const etaSeconds = remainingBytes / speedBytes;

        if (etaSeconds < 60) {
          return `${Math.round(etaSeconds)}s`;
        } else if (etaSeconds < 3600) {
          return `${Math.round(etaSeconds / 60)}m`;
        } else {
          return `${Math.round(etaSeconds / 3600)}h`;
        }
      }
    } catch {
      // Return null when calculation fails
    }

    return null;
  };

  const estimatedTime = eta || calculateETA();

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex items-center mb-2">
        <span className="mr-2 text-lg">{getStatusIcon()}</span>
        <span className="font-medium">{getStatusText()}</span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
};