import React, { useEffect, useRef } from 'react';
import { ContextOption, ContextMenuOptionType } from '../../lib/chat/contextMentions';

interface ContextMenuProps {
  options: ContextOption[];
  selectedIndex: number;
  onSelect: (option: ContextOption) => void;
  onClose: () => void;
  onHover?: (index: number) => void; // Add hover callback
  position: { top: number; left: number; width: number };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  options,
  selectedIndex,
  onSelect,
  onClose,
  onHover,
  position
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to selected item
  useEffect(() => {
    if (menuRef.current && options.length > 0) {
      const items = menuRef.current.querySelectorAll('.context-menu-item');
      const selectedElement = items[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, options.length]);
  
  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
  
  const renderOptionContent = (option: ContextOption) => {
    const hasValue = Boolean(option.value || option.relativePath);
    
    // 🆕 NoResults type option display (hint message)
    if (option.type === ContextMenuOptionType.NoResults) {
      return (
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            textAlign: 'left',
          }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--vscode-errorForeground, #e74c3c)' }}>
            {option.fileName}
          </span>
          {option.description && (
            <span
              style={{
                fontSize: '11px',
                opacity: 0.7,
              }}>
              {option.description}
            </span>
          )}
        </div>
      );
    }
    
    // Skill type option display
    if (option.type === ContextMenuOptionType.Skill) {
      return (
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            gap: '0.5em',
            whiteSpace: 'nowrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            textAlign: 'left',
          }}>
          <span style={{ fontSize: '13px', fontWeight: 500 }}>{option.fileName}</span>
          {option.description && (
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'right',
                flex: 1,
                opacity: 0.65,
                fontSize: '11px',
              }}>
              {option.description}
            </span>
          )}
        </div>
      );
    }
    
    if (option.type === ContextMenuOptionType.File || option.type === ContextMenuOptionType.Folder
        || option.type === ContextMenuOptionType.KnowledgeBase || option.type === ContextMenuOptionType.ChatSession) {
      if (hasValue) {
        // Display file/folder path
        let path = option.value || option.relativePath || '';
        
        // Remove @knowledge-base:, @chat-session:, @workspace: prefixes (if present)
        const prefixes = ['@knowledge-base:/', '@knowledge-base:', '@chat-session:/', '@chat-session:', '@workspace:/', '@workspace:'];
        for (const prefix of prefixes) {
          if (path.startsWith(prefix)) {
            path = path.substring(prefix.length);
            break;
          }
        }
        
        const pathParts = path.split(/[\\/]/).filter(Boolean);
        const filename = pathParts[pathParts.length - 1] || option.fileName;
        const folderPath = pathParts.slice(0, -1).join('/');
        
        // Build display path: if there's a parent directory, show ./parent/path; otherwise show .
        const displayPath = folderPath ? `./${folderPath}` : '.';
        
        return (
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              gap: '0.5em',
              whiteSpace: 'nowrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: 'left',
            }}>
            <span style={{ fontSize: '13px' }}>{filename}</span>
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textAlign: 'right',
                flex: 1,
                opacity: 0.75,
                fontSize: '11px',
              }}>
              {displayPath}
            </span>
          </div>
        );
      } else {
        // Display default option
        let label = option.fileName;
        if (!label) {
          if (option.type === ContextMenuOptionType.KnowledgeBase) {
            label = 'Add Knowledge File';
          } else if (option.type === ContextMenuOptionType.ChatSession) {
            label = 'Add Chat Session File';
          } else {
            label = `Add ${option.type === ContextMenuOptionType.File ? 'Files' : 'Folder'}`;
          }
        }
        return <span style={{ fontSize: '13px' }}>{label}</span>;
      }
    }
    
    return <span style={{ fontSize: '13px' }}>{option.fileName}</span>;
  };
  
  const isOptionSelectable = (option: ContextOption): boolean => {
    return option.type !== ContextMenuOptionType.NoResults;
  };
  
  // Get emoji icon for file/folder/Skill
  const getIcon = (option: ContextOption): string => {
    if (option.type === ContextMenuOptionType.Folder) {
      return '📁';
    }
    
    if (option.type === ContextMenuOptionType.Skill) {
      return '⚡';
    }
    
    // 🆕 KnowledgeBase type icon
    if (option.type === ContextMenuOptionType.KnowledgeBase) {
      return '📚';
    }
    
    // 🆕 ChatSession type icon
    if (option.type === ContextMenuOptionType.ChatSession) {
      return '💬';
    }
    
    if (option.type === ContextMenuOptionType.File) {
      // Return different icons based on file extension
      const filename = option.fileName || option.value || '';
      const ext = filename.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'ts':
        case 'tsx':
          return '📘';
        case 'js':
        case 'jsx':
          return '📒';
        case 'json':
          return '📋';
        case 'md':
          return '📝';
        case 'css':
        case 'scss':
          return '🎨';
        case 'html':
          return '🌐';
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'svg':
          return '🖼️';
        default:
          return '📄';
      }
    }
    
    // NoResults type
    return 'ℹ️';
  };
  
  // Calculate menu style
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: `calc(100vh - ${position.top}px + 2px)`, // 2px above ChatInput
    left: position.left + 16, // Add left margin
    width: position.width - 32, // Subtract left and right margins (16px * 2)
    zIndex: 10000,
    backgroundColor: 'rgba(255, 255, 255, 0.98)', // Solid background
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(203, 213, 225, 0.8)',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
    maxHeight: '300px',
    overflowY: 'auto',
    overflowX: 'hidden',
  };
  
  return (
    <div ref={menuRef} style={menuStyle}>
      {options && options.length > 0 ? (
        options.map((option, index) => {
          const isSelected = index === selectedIndex && isOptionSelectable(option);
          
          return (
            <div
              key={`${option.type}-${option.value || option.relativePath || index}`}
              className="context-menu-item"
              onClick={() => {
                if (isOptionSelectable(option)) {
                  onSelect(option);
                }
              }}
              onMouseEnter={() => {
                // Update parent component's selectedIndex on mouse hover
                if (isOptionSelectable(option) && onHover) {
                  onHover(index);
                }
              }}
              style={{
                padding: '6px 8px',
                cursor: isOptionSelectable(option) ? 'pointer' : 'default',
                color: 'var(--vscode-dropdown-foreground)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'relative',
                transition: 'background-color 0.1s ease',
                backgroundColor: isSelected
                  ? 'rgba(0, 120, 212, 0.15)' // Blue background when selected
                  : 'transparent',
              }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                {/* File/Folder Icon - using emoji icons consistent with FileTreeExplorer */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontSize: '16px',
                    lineHeight: 1,
                    marginRight: '8px',
                    flexShrink: 0,
                  }}>
                  {getIcon(option)}
                </span>
                {renderOptionContent(option)}
              </div>
              {/* Chevron for default options */}
              {(option.type === ContextMenuOptionType.File || option.type === ContextMenuOptionType.Folder
                || option.type === ContextMenuOptionType.KnowledgeBase || option.type === ContextMenuOptionType.ChatSession) &&
                !option.value &&
                !option.relativePath && (
                  <span style={{ flexShrink: 0, marginLeft: 8, opacity: 0.6, fontSize: '10px' }}>▶</span>
                )}
            </div>
          );
        })
      ) : (
        <div
          style={{
            padding: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--vscode-foreground)',
            opacity: 0.7,
          }}>
          <span style={{ fontSize: '13px' }}>No results found</span>
        </div>
      )}
    </div>
  );
};