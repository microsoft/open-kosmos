import { spawn, ChildProcess } from 'child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface QueuedCommand {
  id: string;
  command: string;
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Serialized command execution queue with a persistent shell session.
 * Maintains environment state (e.g., Edge dev env vars) across commands.
 */
export class EdgeCommandQueue {
  private queue: QueuedCommand[] = [];
  private isProcessing = false;
  private currentCommandId: string | null = null;
  private shellSession: ChildProcess | null = null;
  private sessionBuffer = '';
  private stderrBuffer = '';

  private filterProgressLines(output: string): string {
    return output
      .split('\n')
      .filter((line) => {
        if (line.includes('running')) return false;
        if (/^\[\d+\/\d+\]\s+\d+m?\d+\.\d+s\s+[SFC]\s+(STAMP|LIB|CXX|LINK)/.test(line)) return false;
        if (line.trim().length === 0) return false;
        return true;
      })
      .join('\n');
  }

  enqueue(command: string): Promise<CommandResult> {
    const id = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise<CommandResult>((resolve, reject) => {
      if (this.isProcessing || this.queue.length > 0) {
        console.info(`[EdgeCommandQueue] Command queued, waiting: ${command}`);
      }

      this.queue.push({ id, command, resolve, reject, timestamp: Date.now() });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const queuedCommand = this.queue.shift()!;
      this.currentCommandId = queuedCommand.id;

      try {
        const result = await this.executeCommand(queuedCommand.command);
        queuedCommand.resolve(result);
      } catch (error) {
        console.error(`[EdgeCommandQueue] Command failed: ${queuedCommand.command}`, error);
        queuedCommand.reject(error as Error);
      }
    }

    this.isProcessing = false;
    this.currentCommandId = null;
  }

  private async executeCommand(command: string): Promise<CommandResult> {
    try {
      console.info(`[EdgeCommandQueue] Executing: ${command}`);

      if (!this.shellSession) {
        await this.initializeShellSession();
      }

      if (!this.shellSession || !this.shellSession.stdin) {
        throw new Error('Shell session not available');
      }

      this.sessionBuffer = '';
      this.stderrBuffer = '';

      const marker = `__COMMAND_COMPLETE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}__`;
      const echoCommand = process.platform === 'win32' ? `echo ${marker}` : `echo "${marker}"`;
      const fullCommand = `${command} && ${echoCommand} || (echo ERROR_CODE_%ERRORLEVEL%_ && ${echoCommand})`;
      const commandToSend = process.platform === 'win32'
        ? `${fullCommand}\r\n`
        : `${fullCommand}; echo "EXIT_CODE_$?"\n`;

      this.shellSession.stdin.write(commandToSend);
      return await this.waitForCommandCompletion(marker);
    } catch (error: any) {
      console.error(`[EdgeCommandQueue] Execution error: ${command}`, error);
      return { stdout: '', stderr: error.message || '', code: 1 };
    }
  }

  private async waitForCommandCompletion(marker: string): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const checkOutput = () => {
        if (this.sessionBuffer.includes(marker)) {
          const output = this.sessionBuffer.split(marker)[0];
          let stdout = output;
          const stderr = this.stderrBuffer;
          let code = 0;

          const errorMatch = output.match(/ERROR_CODE_(\d+)_/);
          if (errorMatch) {
            code = parseInt(errorMatch[1], 10);
            stdout = output.replace(/ERROR_CODE_\d+_/, '');
          }

          const exitMatch = output.match(/EXIT_CODE_(\d+)/);
          if (exitMatch) {
            code = parseInt(exitMatch[1], 10);
            stdout = output.replace(/EXIT_CODE_\d+/, '');
          }

          if (process.platform === 'win32' && code === 0) {
            const windowsErrorPatterns = [
              /'.*' is not recognized as an internal or external command/,
              /is not recognized as an internal or external command/,
              /The system cannot find the file specified/,
              /The system cannot find the path specified/,
              /Access is denied/,
              /The filename, directory name, or volume label syntax is incorrect/,
              /Parameter format not correct/,
            ];
            for (const pattern of windowsErrorPatterns) {
              if (pattern.test(stdout)) {
                code = 1;
                break;
              }
            }
          }

          resolve({ stdout: this.filterProgressLines(stdout.trim()), stderr: stderr.trim(), code });
        } else {
          setImmediate(checkOutput);
        }
      };
      checkOutput();
    });
  }

  private async initializeShellSession(): Promise<void> {
    if (this.shellSession) return;

    console.info('[EdgeCommandQueue] Initializing shell session');

    const shellCmd = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs = process.platform === 'win32' ? ['/q'] : ['-i'];

    this.shellSession = spawn(shellCmd, shellArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, PROMPT: '$P$G' },
    });

    if (!this.shellSession.stdout || !this.shellSession.stderr || !this.shellSession.stdin) {
      throw new Error('Failed to initialize shell session streams');
    }

    this.shellSession.stdout.on('data', (data) => { this.sessionBuffer += data.toString(); });
    this.shellSession.stderr.on('data', (data) => { this.stderrBuffer += data.toString(); });

    this.shellSession.on('close', () => {
      this.shellSession = null;
      this.sessionBuffer = '';
      this.stderrBuffer = '';
    });

    this.shellSession.on('error', (error) => {
      console.error('[EdgeCommandQueue] Shell session error:', error);
      this.shellSession = null;
      this.sessionBuffer = '';
      this.stderrBuffer = '';
    });

    await new Promise<void>((resolve) => {
      const checkReady = () => {
        if (this.sessionBuffer.includes('>') || this.sessionBuffer.includes('$')) {
          resolve();
        } else {
          setImmediate(checkReady);
        }
      };
      checkReady();
    });

    this.sessionBuffer = '';
    this.stderrBuffer = '';
    console.info('[EdgeCommandQueue] Shell session initialized');
  }

  async terminateShellSession(): Promise<void> {
    if (!this.shellSession) return;

    console.info('[EdgeCommandQueue] Terminating shell session');
    this.clearQueue();

    return new Promise<void>((resolve) => {
      if (this.shellSession) {
        this.shellSession.on('close', () => {
          this.shellSession = null;
          this.sessionBuffer = '';
          this.stderrBuffer = '';
          resolve();
        });

        if (process.platform === 'win32') {
          this.shellSession.stdin?.write('exit\r\n');
        } else {
          this.shellSession.stdin?.write('exit\n');
        }

        setTimeout(() => {
          if (this.shellSession) {
            this.shellSession.kill('SIGTERM');
            this.shellSession = null;
            this.sessionBuffer = '';
            this.stderrBuffer = '';
            resolve();
          }
        }, 1000);
      } else {
        resolve();
      }
    });
  }

  async cleanup(): Promise<void> {
    await this.terminateShellSession();
  }

  private clearQueue(): void {
    this.queue.forEach((cmd) => cmd.reject(new Error('Command queue cleared')));
    this.queue = [];
  }
}

export const edgeCommandQueue = new EdgeCommandQueue();
