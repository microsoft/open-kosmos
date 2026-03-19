import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../auth/AuthProvider';
import { useProfileData } from '../userData/userDataProvider';
import '../../styles/DataLoadingPage.css';

export interface DataLoadingPageProps {
  onDataReady: () => void;
}

export const DataLoadingPage: React.FC<DataLoadingPageProps> = ({ onDataReady }) => {
  const { user } = useAuthContext();
  const { isInitialized, isLoading, data } = useProfileData();
  const [dots, setDots] = useState('');
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);

  // Animated dots effect
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '') return '.';
        if (prev === '.') return '..';
        if (prev === '..') return '...';
        return '';
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // Update elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime]);

  // Listen to ProfileDataManager state changes
  useEffect(() => {

    // When ProfileDataManager first sync is complete, data is ready
    if (isInitialized) {
      
      // Add a small delay to let users see the loading completion status
      setTimeout(() => {
        onDataReady();
      }, 800);
    }
  }, [isInitialized, data, onDataReady]);

  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  const getLoadingMessage = (): string => {
    const elapsed = Math.floor(elapsedTime / 1000);
    
    if (elapsed < 2) {
      return 'Connecting to server';
    } else if (elapsed < 5) {
      return 'Loading configuration files';
    } else if (elapsed < 8) {
      return 'Initializing MCP servers';
    } else if (elapsed < 12) {
      return 'Syncing GitHub Copilot models';
    } else {
      return 'Almost complete';
    }
  };

  const getProgressPercentage = (): number => {
    const elapsed = Math.floor(elapsedTime / 1000);
    
    if (!isInitialized) {
      // Time-based progress estimation while waiting for first sync
      if (elapsed < 3) return Math.min(elapsed * 20, 60);
      if (elapsed < 6) return Math.min(60 + (elapsed - 3) * 15, 85);
      if (elapsed < 10) return Math.min(85 + (elapsed - 6) * 2, 93);
      return 95;
    } else {
      // First sync completed
      return 100;
    }
  };

  return (
    <div className="data-loading-page">
      {/* Transition page content */}
      <div className="data-loading-content">
        <div className="data-loading-card">
          {/* User avatar and welcome message */}
          <div className="data-loading-user-section">
            <div className="data-loading-avatar">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                />
              ) : (
                <span className="data-loading-avatar-text">
                  {user?.name?.charAt(0)?.toUpperCase() || user?.login?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <h2 className="data-loading-welcome">
              Welcome back, {user?.name || user?.login}!
            </h2>
            <p className="data-loading-subtitle">
              Preparing your personalized AI assistant environment
            </p>
          </div>

          {/* Loading progress */}
          <div className="data-loading-progress-section">
            <div className="data-loading-progress-bar">
              <div 
                className="data-loading-progress-fill"
                style={{ width: `${getProgressPercentage()}%` }}
              ></div>
            </div>
            <div className="data-loading-progress-text-container">
              <p className="data-loading-progress-title">
                Loading your data{dots}
              </p>
              <p className="data-loading-progress-message">
                {getLoadingMessage()}
              </p>
            </div>
          </div>

          {/* Loading details */}
          <div className="data-loading-details">
            <div className="data-loading-detail-item">
              <div className={`data-loading-detail-indicator ${isInitialized ? 'completed' : 'loading'}`}></div>
              <span className={`data-loading-detail-text ${isInitialized ? 'completed' : 'loading'}`}>
                Initialize user configuration {isInitialized ? '✓' : '...'}
              </span>
            </div>
            
            <div className="data-loading-detail-item">
              <div className={`data-loading-detail-indicator ${data?.chats && data.chats.length >= 0 ? 'completed' : 'loading'}`}></div>
              <span className={`data-loading-detail-text ${data?.chats && data.chats.length >= 0 ? 'completed' : 'loading'}`}>
                Load Chat configurations {data?.chats && data.chats.length >= 0 ? '✓' : '...'}
              </span>
            </div>
            
            <div className="data-loading-detail-item">
              <div className={`data-loading-detail-indicator ${data?.mcp_servers && data.mcp_servers.length >= 0 ? 'completed' : 'loading'}`}></div>
              <span className={`data-loading-detail-text ${data?.mcp_servers && data.mcp_servers.length >= 0 ? 'completed' : 'loading'}`}>
                Connect MCP servers {data?.mcp_servers && data.mcp_servers.length >= 0 ? '✓' : '...'}
              </span>
            </div>
          </div>

          {/* Time indicator */}
          <div className="data-loading-time-section">
            <p className="data-loading-time-text">
              Loading time: {formatElapsedTime(elapsedTime)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};