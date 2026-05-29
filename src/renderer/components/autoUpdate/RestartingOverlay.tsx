// src/renderer/components/autoUpdate/RestartingOverlay.tsx
// Full-screen restart prompt component - similar to OS restart effect
import React from 'react';
import { RefreshCw } from 'lucide-react';
import '../../styles/RestartingOverlay.css';

export interface RestartingOverlayProps {
  isVisible: boolean;
  message?: string;
}

export const RestartingOverlay: React.FC<RestartingOverlayProps> = ({
  isVisible,
  message = 'Restarting ...'
}) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="restarting-overlay">
      <div className="restarting-content">
        {/* Spinning refresh icon */}
        <div className="restarting-icon-container">
          <RefreshCw className="restarting-icon" />
        </div>

        {/* Restart message text */}
        <div className="restarting-text">
          {message}
        </div>

        {/* Progress dots animation */}
        <div className="restarting-dots">
          <span className="restarting-dot"></span>
          <span className="restarting-dot"></span>
          <span className="restarting-dot"></span>
        </div>
      </div>
    </div>
  );
};

export default RestartingOverlay;