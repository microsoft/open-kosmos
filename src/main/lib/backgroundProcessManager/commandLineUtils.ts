/**
 * Shared command-line building utility.
 * Used by both BackgroundProcessManager and ExecuteCommandTool.
 */

/**
 * Quote a shell argument if it contains whitespace or quote characters.
 */
export function quoteArg(value: string): string {
  if (!value) return '""';
  if (!/[\s"']/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Build a single command-line string from a command and optional arguments.
 */
export function buildCommandLine(command: string, args?: string[]): string {
  if (!args || args.length === 0) {
    return command;
  }
  return [command, ...args.map(quoteArg)].join(' ');
}
