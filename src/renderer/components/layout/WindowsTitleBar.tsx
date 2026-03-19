import React, { useEffect, useState } from 'react';
import { Menu, Minus, Square, X, Copy } from 'lucide-react';
import '../../styles/WindowsTitleBar.css';
import { APP_NAME, BRAND_NAME } from '@shared/constants/branding';

let appIcon: string;
try {
  const iconModule = require(`../../assets/${BRAND_NAME}/app.svg`);
  appIcon = iconModule.default || iconModule;
} catch (error) {
  console.error(`Failed to load app icon for brand ${BRAND_NAME}:`, error);
  // Fallback to avoid crash if possible, or let it be empty/undefined
  appIcon = '';
}

const WindowsTitleBar: React.FC = () => {
  const [isWindows, setIsWindows] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

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
