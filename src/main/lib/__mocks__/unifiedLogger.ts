function createNoopLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), updateConfig: vi.fn() };
}

export const createLogger = vi.fn(() => createNoopLogger());
export const createConsoleLogger = vi.fn(() => createNoopLogger());
export const getUnifiedLogger = vi.fn(() => createNoopLogger());
export const createHighPerformanceLogger = vi.fn(() => createNoopLogger());
export const createDebugLogger = vi.fn(() => createNoopLogger());
export const getRefactoredLogger = vi.fn(() => createNoopLogger());
export const getGlobalLogger = vi.fn(() => createNoopLogger());
export const initializeGlobalLogger = vi.fn(() => createNoopLogger());
export const resetGlobalLogger = vi.fn();
export const isGlobalLoggerInitialized = vi.fn(() => false);
export default vi.fn(() => createNoopLogger());
