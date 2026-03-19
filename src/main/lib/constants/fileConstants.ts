/**
 * File handling constants
 * Extracted FILE_ATTACHMENT_LIMITS from src/renderer/types/chatTypes.ts
 * Used for the main process built-in tools system
 */

// File size limits - aligned with VSCode
export const FILE_ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB - aligned with VSCode
  MAX_TEXT_LINES: 2000, // Maximum line count limit
  MAX_TOKEN_BUDGET: 600, // Token budget control
  SUPPORTED_TEXT_EXTENSIONS: [
    // Basic text files
    '.txt', '.md', '.rst',
    // Web technologies
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.css', '.scss', '.sass', '.less', '.stylus',
    '.html', '.htm', '.xhtml', '.vue', '.svelte',
    '.json', '.json5', '.jsonc', '.xml', '.svg',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    // Programming languages - C/C++ family
    '.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hpp', '.hxx', '.h++',
    // Programming languages - Others
    '.py', '.pyw', '.pyc', '.pyi', '.pyx',
    '.java', '.class', '.jar', '.scala', '.kt', '.kts',
    '.cs', '.vb', '.fs', '.fsx', '.fsi',
    '.rs', '.go', '.mod', '.sum',
    '.rb', '.rbw', '.gem', '.rake',
    '.php', '.php3', '.php4', '.php5', '.phtml',
    '.pl', '.pm', '.t', '.pod',
    '.swift', '.m', '.mm', '.h',
    '.r', '.R', '.rmd', '.rnw',
    '.jl', '.julia',
    '.dart', '.flutter',
    '.lua', '.luac',
    '.sh', '.bash', '.zsh', '.fish', '.csh', '.tcsh',
    '.ps1', '.psm1', '.psd1',
    '.bat', '.cmd',
    '.asm', '.s', '.S',
    '.sql', '.mysql', '.pgsql', '.sqlite',
    '.dockerfile', '.containerfile',
    // Configuration and data files
    '.env', '.envrc', '.editorconfig', '.gitignore', '.gitattributes',
    '.eslintrc', '.prettierrc', '.babelrc', '.npmrc', '.yarnrc',
    '.tsconfig', '.jsconfig', '.webpack', '.rollup', '.vite',
    '.makefile', '.cmake', '.gradle', '.maven', '.ant',
    '.properties', '.lock', '.sum', '.mod',
    // Markup languages and documentation
    '.tex', '.latex', '.bib', '.cls', '.sty',
    '.org', '.adoc', '.asciidoc',
    '.wiki', '.mediawiki',
    // Data formats
    '.csv', '.tsv', '.psv', '.dsv',
    '.log', '.out', '.err', '.trace',
    // Other text formats
    '.patch', '.diff', '.rej',
    '.spec', '.rpm', '.deb',
    '.pem', '.crt', '.key', '.pub'
  ]
} as const;