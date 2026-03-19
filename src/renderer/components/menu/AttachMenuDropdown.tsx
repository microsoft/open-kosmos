import React, { useLayoutEffect } from 'react';
import { useScreenshotEnabled } from '../../lib/screenshot/useScreenshotEnabled';
import { useScreenshotHotkey } from '../../lib/screenshot/useScreenshotHotkey';

interface AttachMenuDropdownProps {
  attachMenuRef: React.RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  onClose: () => void;
}

const AttachMenuDropdown: React.FC<AttachMenuDropdownProps> = ({
  attachMenuRef,
  position,
  onClose,
}) => {
  const enableScreenshot = useScreenshotEnabled();
  const screenshotHotkey = useScreenshotHotkey();

  // Use measured height to adjust menu position: if it overflows the bottom, display above the button
  useLayoutEffect(() => {
    if (attachMenuRef.current) {
      const rect = attachMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      const triggerTop = (position as any).triggerTop;

      if (rect.bottom > windowHeight - padding && triggerTop !== undefined) {
        // Use the measured menu height (rect.height) to precisely calculate upward position
        const newTop = triggerTop - rect.height - 4;
        attachMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
      }
    }
  }, [position]);

  const handleSelectFiles = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('chatInput:selectFiles'));
    onClose();
  };

  const handleScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('chatInput:screenshot'));
    onClose();
  };

  return (
    <div
      ref={attachMenuRef}
      className="dropdown-menu attach-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      role="menu"
    >
      <button
        className="dropdown-menu-item"
        onClick={handleSelectFiles}
        role="menuitem"
      >
        <span className="dropdown-menu-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <span className="dropdown-menu-item-text">Add files & images</span>
      </button>
      {enableScreenshot && (
        <button
          className="dropdown-menu-item"
          onClick={handleScreenshot}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
          <span className="dropdown-menu-item-text">
            Add screenshot
            {screenshotHotkey && (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginLeft: 6 }}>
                ({screenshotHotkey})
              </span>
            )}
          </span>
        </button>
      )}
    </div>
  );
};

export default AttachMenuDropdown;
