import { BUILTIN_SERVER_NAME } from './builtinMcpClient';
import type { MCPServerStatus } from './mcpClientManager';

type StatusReader = (serverName: string) => MCPServerStatus | undefined;

export function isMcpServerSettled(status: MCPServerStatus | undefined): boolean {
  return !!status && status !== 'connecting' && status !== 'disconnecting';
}

export class McpServerSettleWaiter {
  private readonly waiters: Set<() => void> = new Set();

  constructor(private readonly readStatus: StatusReader) {}

  notify(): void {
    if (this.waiters.size === 0) {
      return;
    }
    for (const waiter of Array.from(this.waiters)) {
      waiter();
    }
  }

  async waitForServersSettled(serverNames: string[], timeoutMs: number): Promise<void> {
    const targets = Array.from(new Set(serverNames)).filter(
      (name) => !!name && name !== BUILTIN_SERVER_NAME,
    );
    if (targets.length === 0 || targets.every((name) => isMcpServerSettled(this.readStatus(name)))) {
      return;
    }

    await new Promise<void>((resolve) => {
      const settle = (): void => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };

      const waiter = (): void => {
        if (targets.every((name) => isMcpServerSettled(this.readStatus(name)))) {
          settle();
        }
      };

      const timer = setTimeout(settle, Math.max(0, timeoutMs));
      timer.unref();
      this.waiters.add(waiter);
    });
  }
}
