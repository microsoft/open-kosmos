import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../auth/AuthProvider';
import { useProfileData } from '../userData/userDataProvider';
import '../../styles/DataLoadingPage.css';
import { useI18n } from '../../lib/i18n/useI18n';

export interface DataLoadingPageProps {
  onDataReady: () => void;
}

export const DataLoadingPage: React.FC<DataLoadingPageProps> = ({ onDataReady }) => {
  const { user } = useAuthContext();
  const { isInitialized, isLoading, data } = useProfileData();
  const [dots, setDots] = useState('');
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);
  const { t } = useI18n();

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
      return t('dataLoading.connectingToServer');
    } else if (elapsed < 5) {
      return t('dataLoading.loadingConfiguration');
    } else if (elapsed < 8) {
      return t('dataLoading.initializingMcp');
    } else if (elapsed < 12) {
      return t('dataLoading.syncingModels');
    } else {
      return t('dataLoading.almostComplete');
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
              {t('dataLoading.welcomeBack', { name: user?.name || user?.login || '' })}
            </h2>
            <p className="data-loading-subtitle">
              {t('dataLoading.subtitle')}
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
                {t('dataLoading.loadingYourData', { dots })}
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
                {t('dataLoading.initializeUserConfiguration', { status: isInitialized ? '✓' : '...' })}
              </span>
            </div>

            <div className="data-loading-detail-item">
              <div className={`data-loading-detail-indicator ${data?.chats && data.chats.length >= 0 ? 'completed' : 'loading'}`}></div>
              <span className={`data-loading-detail-text ${data?.chats && data.chats.length >= 0 ? 'completed' : 'loading'}`}>
                {t('dataLoading.loadChatConfigurations', { status: data?.chats && data.chats.length >= 0 ? '✓' : '...' })}
              </span>
            </div>
          </div>

          {/* Time indicator */}
          <div className="data-loading-time-section">
            <p className="data-loading-time-text">
              {t('dataLoading.loadingTime', { time: formatElapsedTime(elapsedTime) })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};