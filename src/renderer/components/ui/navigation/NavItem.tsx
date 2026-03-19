import React from 'react';
import '../../../styles/NavItem.css';

interface NavItemProps {
  icon?: string | React.ReactNode;
  label?: string | React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
  role?: string;
  tabIndex?: number;
  children?: React.ReactNode;
  rightContent?: React.ReactNode;
}

const NavItem: React.FC<NavItemProps> = ({
  icon,
  label,
  isActive = false,
  onClick,
  onKeyDown,
  ariaLabel,
  disabled = false,
  title,
  role,
  tabIndex,
  children,
  rightContent
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onKeyDown) {
      onKeyDown(e);
    } else if ((e.key === 'Enter' || e.key === ' ') && !disabled && onClick) {
      e.preventDefault();
      onClick();
    }
  };

  // Compute aria-label: only use label when it is a string
  const computedAriaLabel = ariaLabel || (typeof label === 'string' ? label : undefined);

  return (
    <button
      className={`nav-item ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={computedAriaLabel}
      aria-current={isActive ? 'page' : undefined}
      disabled={disabled}
      type="button"
      title={title}
      role={role}
      tabIndex={tabIndex}
    >
      {children ? (
        children
      ) : (
        <>
          <div className="nav-item-content">
            {icon && (
              <div className="nav-item-icon">
                {typeof icon === 'string' ? (
                  <span aria-hidden="true">{icon}</span>
                ) : (
                  icon
                )}
              </div>
            )}
            {label && (
              <span className="nav-item-label">
                {typeof label === 'string' ? label : label}
              </span>
            )}
          </div>
          {rightContent && <div className="nav-item-right">{rightContent}</div>}
          {isActive && <span className="nav-item-indicator" aria-hidden="true" />}
        </>
      )}
    </button>
  );
};

export default NavItem;