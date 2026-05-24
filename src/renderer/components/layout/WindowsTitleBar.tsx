import React, { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Minus, Square, X, Copy, ZoomIn, ZoomOut, PanelLeft } from 'lucide-react';
import '../../styles/WindowsTitleBar.css';
import { APP_NAME } from '@shared/constants/branding';
import { useAppZoomLevel } from '../../lib/userData/useAppZoomLevel';
import { LeftNavCollapsedAtom } from '@renderer/states/left-nav.atom';
import { appIcon } from '../../lib/brandIcon';

const WindowsTitleBar: React.FC = () => {
  const location = useLocation();
  const [isWindows, setIsWindows] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const zoomLevel = useAppZoomLevel();
  const [leftSidebarCollapsed, { toggle: handleSidebarToggle }] = LeftNavCollapsedAtom.use();
  const showSidebarToggle = location.pathname.startsWith('/agent');
  const [showPercent, setShowPercent] = useState(false);
  const percentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomPercent = Math.round(Math.pow(1.2, zoomLevel) * 100);

  // Show percentage briefly when zoom changes
  const prevZoomRef = useRef(zoomLevel);
  useEffect(() => {
    if (prevZoomRef.current !== zoomLevel) {
      prevZoomRef.current = zoomLevel;
      setShowPercent(true);
      if (percentTimerRef.current) clearTimeout(percentTimerRef.current);
      percentTimerRef.current = setTimeout(() => setShowPercent(false), 1500);
    }
    return () => { if (percentTimerRef.current) clearTimeout(percentTimerRef.current); };
  }, [zoomLevel]);

  useEffect(() => {
    const checkPlatform = async () => {
      if (window.electronAPI && window.electronAPI.platform === 'win32') {
        setIsWindows(true);
      } else {
        try {
          const info = await window.electronAPI.getPlatformInfo();
          if (info.platform === 'win32') {
            setIsWindows(true);
          }
        } catch (e) {
          // Ignore
        }
      }
    };
    checkPlatform();
  }, []);

  useEffect(() => {
    if (!isWindows) return;

    const checkMaximized = async () => {
      const max = await window.electronAPI?.window?.isMaximized();
      setIsMaximized(!!max);
    };
    checkMaximized();

    if (window.electronAPI?.window?.onWindowStateChanged) {
      const cleanup = window.electronAPI.window.onWindowStateChanged((state) => {
        setIsMaximized(state === 'maximized');
      });
      return cleanup;
    }
  }, [isWindows]);

  if (!isWindows) return null;

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (window.electronAPI?.window?.showAppMenu) {
      window.electronAPI.window.showAppMenu(rect.left, rect.bottom);
    }
  };

  const handleMinimize = () => window.electronAPI?.window?.minimize();
  const handleMaximize = () => {
    if (isMaximized) {
      window.electronAPI?.window?.unmaximize();
    } else {
      window.electronAPI?.window?.maximize();
    }
  };
  const handleClose = () => window.electronAPI?.window?.close();

  return (
    <div className="windows-title-bar">
      <div className="app-title-container">
        <img src={appIcon} alt={APP_NAME} className="app-icon" />
        <div className="app-title">{APP_NAME}</div>
      </div>

      <div className="title-bar-right-section">
              {showSidebarToggle && (
                <button
                  className={`menu-button sidebar-toggle-button ${leftSidebarCollapsed ? 'active' : ''}`}
                  onClick={handleSidebarToggle}
                  aria-label={leftSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                  aria-pressed={leftSidebarCollapsed}
                  title={leftSidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
                >
                  <PanelLeft size={15} />
                </button>
              )}
        {zoomPercent !== 100 && (
          <button
            className="menu-button"
            onClick={() => window.electronAPI?.window?.resetZoom?.()}
            title={`Zoom: ${zoomPercent}% (Click to reset)`}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0 6px' }}
          >
            {showPercent ? (
              <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{zoomPercent}%</span>
            ) : (
              zoomPercent > 100 ? <ZoomIn size={14} /> : <ZoomOut size={14} />
            )}
          </button>
        )}
        <button
          className="menu-button"
          onClick={handleMenuClick}
          title="Menu"
        >
          <Menu size={18} />
        </button>

        <div className="window-controls">
          <button className="window-control-button minimize" onClick={handleMinimize} title="Minimize">
            <Minus size={16} />
          </button>
          <button className="window-control-button maximize" onClick={handleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
            {isMaximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button className="window-control-button close" onClick={handleClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WindowsTitleBar;
