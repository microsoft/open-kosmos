import React from 'react';

/**
 * File type category enum
 */
export type FileCategory =
  | 'text'       // Text/code files
  | 'pdf'        // PDF files
  | 'word'       // Word documents
  | 'excel'      // Excel spreadsheets
  | 'ppt'        // PowerPoint presentations
  | 'archive'    // Archives (ZIP/RAR/7z etc.)
  | 'executable' // Executable files
  | 'image'      // Image files
  | 'video'      // Video files
  | 'audio'      // Audio files
  | 'code'       // Code files
  | 'data'       // Data files (JSON/XML/CSV)
  | 'other';     // Other files

/**
 * Get file category by filename
 */
export function getFileCategory(fileName: string): FileCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  // PDF
  if (ext === 'pdf') return 'pdf';

  // Word
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';

  // Excel
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv'].includes(ext)) return 'excel';

  // PPT
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'ppt';

  // Archives
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst', 'lz', 'cab', 'iso', 'dmg'].includes(ext)) return 'archive';

  // Executable files
  if (['exe', 'msi', 'app', 'bat', 'cmd', 'sh', 'bash', 'ps1', 'dll', 'so', 'dylib', 'bin', 'run', 'deb', 'rpm', 'pkg', 'apk', 'ipa'].includes(ext)) return 'executable';

  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'ico', 'webp', 'tiff', 'tif', 'avif', 'heic', 'heif'].includes(ext)) return 'image';

  // Videos
  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', '3gp'].includes(ext)) return 'video';

  // Audio
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(ext)) return 'audio';

  // Code files
  if ([
    'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'h', 'hpp',
    'php', 'rb', 'go', 'rs', 'kt', 'swift', 'scala', 'lua', 'r', 'dart',
    'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  ].includes(ext)) return 'code';

  // Data/config files
  if ([
    'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
    'env', 'properties', 'sql', 'graphql', 'proto',
  ].includes(ext)) return 'data';

  // Plain text
  if (['txt', 'md', 'log', 'readme', 'license', 'changelog'].includes(ext)) return 'text';

  return 'other';
}

interface FileTypeIconProps {
  /** Filename (with extension) */
  fileName: string;
  /** Icon size, default 20 */
  size?: number;
  /** Additional className */
  className?: string;
}

/**
 * Unified file type icon component
 * Displays the corresponding SVG icon based on file extension
 */
const FileTypeIcon: React.FC<FileTypeIconProps> = ({ fileName, size = 20, className = '' }) => {
  const category = getFileCategory(fileName);
  const iconColor = getCategoryColor(category);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`file-type-icon file-type-icon--${category} ${className}`.trim()}
      aria-label={`${category} file icon`}
    >
      {renderIcon(category, iconColor)}
    </svg>
  );
};

/**
 * Get the color for a file type category
 */
function getCategoryColor(category: FileCategory): string {
  switch (category) {
    case 'pdf':        return '#E5252A';
    case 'word':       return '#2B579A';
    case 'excel':      return '#217346';
    case 'ppt':        return '#D24726';
    case 'archive':    return '#F0A30A';
    case 'executable': return '#6B7280';
    case 'image':      return '#8B5CF6';
    case 'video':      return '#EC4899';
    case 'audio':      return '#06B6D4';
    case 'code':       return '#3B82F6';
    case 'data':       return '#F59E0B';
    case 'text':       return '#6B7280';
    case 'other':      return '#9CA3AF';
    default:           return '#9CA3AF';
  }
}

/**
 * Render the SVG icon for a specific file type
 */
function renderIcon(category: FileCategory, color: string): React.ReactNode {
  switch (category) {
    case 'text':
      return (
        <>
          {/* Document base shape */}
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          {/* Text lines */}
          <line x1="12" y1="14" x2="22" y2="14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="18" x2="20" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="22" x2="18" y2="22" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          {/* Document border */}
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
        </>
      );

    case 'pdf':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* PDF text label */}
          <rect x="10" y="17" width="14" height="9" rx="1.5" fill={color} />
          <text x="17" y="24" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial, sans-serif">PDF</text>
        </>
      );

    case 'word':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* W label */}
          <rect x="10" y="17" width="14" height="9" rx="1.5" fill={color} />
          <text x="17" y="24" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="Arial, sans-serif">W</text>
        </>
      );

    case 'excel':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* X label */}
          <rect x="10" y="17" width="14" height="9" rx="1.5" fill={color} />
          <text x="17" y="24" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="Arial, sans-serif">X</text>
        </>
      );

    case 'ppt':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* P label */}
          <rect x="10" y="17" width="14" height="9" rx="1.5" fill={color} />
          <text x="17" y="24" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="Arial, sans-serif">P</text>
        </>
      );

    case 'archive':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Zipper texture */}
          <rect x="15" y="4" width="4" height="2" rx="0.5" fill={color} fillOpacity="0.5" />
          <rect x="15" y="7.5" width="4" height="2" rx="0.5" fill={color} fillOpacity="0.5" />
          <rect x="15" y="11" width="4" height="2" rx="0.5" fill={color} fillOpacity="0.5" />
          <rect x="15" y="14.5" width="4" height="2" rx="0.5" fill={color} fillOpacity="0.5" />
          {/* Clasp */}
          <rect x="14.5" y="18" width="5" height="4" rx="1" fill={color} />
          <rect x="16" y="19" width="2" height="2" rx="0.5" fill="white" />
        </>
      );

    case 'executable':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Gear icon */}
          <circle cx="17" cy="20" r="3.5" stroke={color} strokeWidth="1.5" fill="none" />
          <circle cx="17" cy="20" r="1.2" fill={color} />
          <line x1="17" y1="15" x2="17" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="17" y1="24" x2="17" y2="25" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12.5" y1="20" x2="13" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="21" y1="20" x2="21.5" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </>
      );

    case 'image':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Mountain landscape image icon */}
          <circle cx="14.5" cy="16" r="2" fill={color} fillOpacity="0.5" />
          <path d="M11 25L15 19L18 22L20 20L23 25H11Z" fill={color} fillOpacity="0.5" />
        </>
      );

    case 'video':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Play button */}
          <path d="M14 16V24L22 20L14 16Z" fill={color} fillOpacity="0.6" />
        </>
      );

    case 'audio':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Music note icon */}
          <circle cx="14" cy="23" r="2.5" fill={color} fillOpacity="0.5" />
          <line x1="16.5" y1="23" x2="16.5" y2="14" stroke={color} strokeWidth="1.5" />
          <path d="M16.5 14C16.5 14 20 13 21 12V16C21 16 18 17 16.5 17" fill={color} fillOpacity="0.5" />
        </>
      );

    case 'code':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Code brackets </>*/}
          <path d="M14 16L11 20L14 24" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M20 16L23 20L20 24" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="18" y1="15" x2="16" y2="25" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        </>
      );

    case 'data':
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Curly braces {} */}
          <path d="M13 15C13 15 12 15 12 16.5V18.5C12 19.5 11 20 11 20C11 20 12 20.5 12 21.5V23.5C12 25 13 25 13 25" stroke={color} strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <path d="M21 15C21 15 22 15 22 16.5V18.5C22 19.5 23 20 23 20C23 20 22 20.5 22 21.5V23.5C22 25 21 25 21 25" stroke={color} strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </>
      );

    case 'other':
    default:
      return (
        <>
          <path d="M8 4C8 2.89543 8.89543 2 10 2H19L26 9V28C26 29.1046 25.1046 30 24 30H10C8.89543 30 8 29.1046 8 28V4Z" fill={color} fillOpacity="0.12" />
          <path d="M19 2L26 9H21C19.8954 9 19 8.10457 19 7V2Z" fill={color} fillOpacity="0.3" />
          <path d="M10 2C8.89543 2 8 2.89543 8 4V28C8 29.1046 8.89543 30 10 30H24C25.1046 30 26 29.1046 26 28V9L19 2H10Z" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Question mark icon */}
          <circle cx="17" cy="19" r="5" stroke={color} strokeWidth="1.5" fill="none" />
          <path d="M15.5 17.5C15.5 16.5 16.5 15.5 17 15.5C17.5 15.5 18.5 16 18.5 17C18.5 18 17 18.5 17 19.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <circle cx="17" cy="21.5" r="0.7" fill={color} />
        </>
      );
  }
}

export default FileTypeIcon;
