/**
 * Command Parser — parses a command string into a command and argument list.
 * Used to safely extract path parameters from commands.
 */

export interface ParsedCommand {
  command: string;
  parameters: string[];
}

export class CommandParser {
  /**
   * Parse a command string into <command, parameters[]>.
   * Supports quoted arguments and escape characters.
   *
   * @param commandString - The full command string
   * @returns The parsed command and argument list
   *
   * @example
   * parseCommand('dir "C:\\Program Files" /S')
   * // => { command: 'dir', parameters: ['C:\\Program Files', '/S'] }
   *
   * parseCommand('cp /home/user/file.txt /tmp/')
   * // => { command: 'cp', parameters: ['/home/user/file.txt', '/tmp/'] }
   */
  static parseCommand(commandString: string): ParsedCommand {
    if (!commandString || typeof commandString !== 'string') {
      return { command: '', parameters: [] };
    }

    // 🔥 Added: truncate overly long command strings to avoid performance issues
    let processString = commandString;
    if (commandString.length > 2000) {
      // Try to find a reasonable truncation point (blank line or specific pattern)
      const truncateAt = Math.min(2000, commandString.length);
      processString = commandString.substring(0, truncateAt);
    }

    const tokens: string[] = [];
    let currentToken = '';
    let inQuotes = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = 0; i < processString.length; i++) {
      const char = processString[i];

      // Handle escape characters
      if (escaped) {
        currentToken += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        // Check whether this is an escape character (next char is a quote or backslash)
        const nextChar = processString[i + 1];
        if (nextChar === '"' || nextChar === "'" || nextChar === '\\') {
          escaped = true;
          continue;
        }
        // Backslash in a Windows path — add directly
        currentToken += char;
        continue;
      }

      // Handle quotes
      if (char === '"' || char === "'") {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        } else {
          currentToken += char;
        }
        continue;
      }

      // Handle spaces (delimiters)
      if (char === ' ' && !inQuotes) {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
        continue;
      }

      // Regular characters
      currentToken += char;
    }

    // Add the last token
    if (currentToken) {
      tokens.push(currentToken);
    }

    // The first token is the command; the rest are parameters
    const [command = '', ...parameters] = tokens;

    return {
      command,
      parameters
    };
  }

  /**
   * Identify path parameters from the argument list.
   * Uses heuristic rules to determine whether an argument is a path.
   *
   * @param command - Command name
   * @param parameters - Argument list
   * @returns Array of identified path arguments
   */
  static extractPathParameters(command: string, parameters: string[]): string[] {
    const paths: string[] = [];
    const lowerCommand = command.toLowerCase();

    // Special handling: echo command — only recognize paths after redirection operators
    if (lowerCommand === 'echo') {
      return this.extractPathsFromEchoCommand(parameters);
    }

    // Special handling: PowerShell New-Item command
    if (lowerCommand === 'new-item') {
      return this.extractPathsFromNewItemCommand(parameters);
    }

    // General handling: check redirection operators
    const redirectPaths = this.extractPathsAfterRedirection(parameters);
    if (redirectPaths.length > 0) {
      return redirectPaths;
    }

    // General handling: PowerShell command parameters
    const psParams = this.extractPathsFromPowerShellParams(parameters);
    if (psParams.length > 0) {
      return psParams;
    }

    // Default logic: iterate parameters and identify paths
    for (const param of parameters) {
      if (this.isPathParameter(param)) {
        paths.push(param);
      }
    }

    return paths;
  }

  /**
   * Extract paths from an echo command (only paths after redirection operators)
   */
  private static extractPathsFromEchoCommand(parameters: string[]): string[] {
    const redirectionOperators = ['>', '>>', '2>', '2>>', '1>', '&>'];

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];

      // Check for a standalone redirection operator
      if (redirectionOperators.includes(param)) {
        // The next argument should be the target file path
        if (i + 1 < parameters.length) {
          const nextParam = parameters[i + 1];
          if (this.isPathParameter(nextParam)) {
            return [nextParam];
          }
        }
      }

      // Check for a redirection operator at the start of a token (e.g., ">file.txt")
      for (const op of redirectionOperators) {
        if (param.startsWith(op)) {
          const path = param.substring(op.length).trim();
          if (path && this.isPathParameter(path)) {
            return [path];
          }
        }
      }
    }

    return [];
  }

  /**
   * Extract paths from a PowerShell New-Item command
   */
  private static extractPathsFromNewItemCommand(parameters: string[]): string[] {
    const paths: string[] = [];

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];

      // Check for a -Path parameter
      if (param === '-Path' && i + 1 < parameters.length) {
        const pathValue = parameters[i + 1];
        if (this.isPathParameter(pathValue)) {
          paths.push(pathValue);
        }
        i++; // Skip the already-processed value
        continue;
      }

      // Check for the -Path "value" format (parameter and value joined together)
      if (param.startsWith('-Path')) {
        const pathValue = param.substring(5).trim();
        if (pathValue && this.isPathParameter(pathValue)) {
          paths.push(pathValue);
        }
        continue;
      }

      // -Value contains file content and should not be treated as a path
      if (param === '-Value') {
        i++; // Skip the -Value content
        continue;
      }
    }

    return paths;
  }

  /**
   * Extract paths after redirection operators
   */
  private static extractPathsAfterRedirection(parameters: string[]): string[] {
    const redirectionOperators = ['>', '>>', '<', '2>', '2>>', '1>', '&>', '2>&1'];

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];

      // Check for a standalone redirection operator
      if (redirectionOperators.includes(param)) {
        if (i + 1 < parameters.length) {
          const nextParam = parameters[i + 1];
          if (this.isPathParameter(nextParam)) {
            return [nextParam];
          }
        }
      }

      // Check for a redirection operator at the start of a token (e.g., ">file.txt")
      for (const op of redirectionOperators) {
        if (param.startsWith(op)) {
          const path = param.substring(op.length).trim();
          if (path && this.isPathParameter(path)) {
            return [path];
          }
        }
      }
    }

    return [];
  }

  /**
   * Extract paths from PowerShell command parameters
   */
  private static extractPathsFromPowerShellParams(parameters: string[]): string[] {
    const pathParams = ['-Path', '-FilePath', '-File', '-LiteralPath', '-Destination', '-Source'];
    const paths: string[] = [];

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];

      // Check whether this is a path parameter name
      if (pathParams.includes(param) && i + 1 < parameters.length) {
        const pathValue = parameters[i + 1];
        // Only treat as a path if the next argument is not another parameter name
        if (!pathValue.startsWith('-') && this.isPathParameter(pathValue)) {
          paths.push(pathValue);
        }
        i++; // Skip the already-processed value
      }
    }

    return paths;
  }

  /**
   * Determine whether an argument is a path.
   *
   * @param param - The argument string
   * @returns Whether the argument is a path parameter
   */
  private static isPathParameter(param: string): boolean {
    if (!param || typeof param !== 'string') {
      return false;
    }

    // Exclude command-line switches
    // Unix/Linux: -flag, --flag
    if (param.startsWith('-')) {
      return false;
    }

    // Windows: /FLAG (single letter or uppercase flag)
    if (/^\/[A-Z]$/i.test(param)) {
      return false;
    }

    // Common Windows switch patterns: /FLAG or /FLAG:value
    // Extended: support /o:d, /s, /b and other common dir/command parameters
    if (/^\/[A-Z0-9]+(:[A-Z0-9-]*)?$/i.test(param) && param.length <= 15) {
      return false;
    }

    // Check for path patterns

    // Windows absolute path: C:\path or D:/path
    if (/^[A-Za-z]:[\\\/]/.test(param)) {
      return true;
    }

    // UNC path: \\server\share
    if (param.startsWith('\\\\')) {
      return true;
    }

    // Unix absolute path: /path/to/file
    if (param.startsWith('/')) {
      // Exclude a standalone root directory (usually a command-line flag)
      if (param === '/') {
        return false;
      }
      return true;
    }

    // Relative path patterns: ./path or ../path
    if (param.startsWith('./') || param.startsWith('../')) {
      return true;
    }

    // Windows relative paths: .\path or ..\path
    if (param.startsWith('.\\') || param.startsWith('..\\')) {
      return true;
    }

    // Strings containing path separators (possibly relative paths),
    // but excluding plain text (no obvious path features)
    if (param.includes('/') || param.includes('\\')) {
      // Exclude strings containing newlines (usually code or long text)
      if (param.includes('\n') || param.includes('\r')) {
        return false;
      }

      // Exclude overly long strings (possibly code) — lower threshold for early filtering
      if (param.length > 200) {
        return false;
      }

      // Exclude strings with code-like characteristics
      // Strings containing common code keywords, brackets, semicolons, etc. are likely code, not paths
      const codePatterns = [
        /import\s+/,           // import statement
        /from\s+.*\s+import/,  // from ... import
        /print\s*\(/,          // print function call
        /def\s+\w+\s*\(/,      // function definition
        /class\s+\w+/,         // class definition
        /;\s*\w+/,             // semicolon followed by an identifier (multiple statements)
        /\(\s*['"][^'"]*['"]\s*,/, // function arguments (quoted content as argument)
      ];

      if (codePatterns.some(pattern => pattern.test(param))) {
        return false;
      }

      // Check for a file extension or directory structure
      if (/\.[a-zA-Z0-9]+$/.test(param) || param.includes('/') && param.length > 3) {
        return true;
      }
    }

    // Relative file name: contains a file extension but no path separator
    // e.g., script.js, config.json, data.txt
    if (/^[^\/\\]+\.[a-zA-Z0-9]+$/.test(param)) {
      // Exclude pure numbers and single letters (e.g., 1.2, a.b)
      if (param.length > 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract all path arguments from a command string.
   * This is the main public interface.
   *
   * @param commandString - The full command string
   * @returns Array of extracted paths
   */
  static extractPathsFromCommand(commandString: string): string[] {
    // 🔥 Added: handle overly long command strings (typically heredocs or commands with large content)
    if (commandString && commandString.length > 1000) {
      // Check for heredoc syntax (cat > file << 'EOF')
      const heredocMatch = commandString.match(/^(cat\s*>\s*[^\s]+\s*<<\s*['"']?(\w+)['"']?)\s/);
      if (heredocMatch) {
        // For heredocs, only parse the command part and ignore the content
        const commandPart = heredocMatch[1];
        const parsed = this.parseCommand(commandPart);
        return this.extractPathParameters(parsed.command, parsed.parameters);
      }

      // For other overly long commands, only parse the first 1000 characters to avoid performance issues
      const truncatedCommand = commandString.substring(0, 1000);
      const parsed = this.parseCommand(truncatedCommand);
      return this.extractPathParameters(parsed.command, parsed.parameters);
    }

    const parsed = this.parseCommand(commandString);
    return this.extractPathParameters(parsed.command, parsed.parameters);
  }
}
