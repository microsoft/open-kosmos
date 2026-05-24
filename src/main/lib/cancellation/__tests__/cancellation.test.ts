import {
  CancellationTokenSource,
  CancellationError,
  isCancellationError,
  CancellationTokenStatic,
} from '../index';

// Mock the logger
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CancellationTokenSource', () => {
  it('creates with token not cancelled', () => {
    const source = new CancellationTokenSource();
    expect(source.token.isCancellationRequested).toBe(false);
    source.dispose();
  });

  it('cancel sets isCancellationRequested to true', () => {
    const source = new CancellationTokenSource();
    source.cancel();
    expect(source.token.isCancellationRequested).toBe(true);
    source.dispose();
  });

  it('cancel fires onCancellationRequested listeners', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);
    source.cancel();
    expect(listener).toHaveBeenCalledTimes(1);
    source.dispose();
  });

  it('multiple cancels only fire once', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);
    source.cancel();
    source.cancel();
    expect(listener).toHaveBeenCalledTimes(1);
    source.dispose();
  });

  it('cancel after dispose does nothing', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);
    source.dispose();
    source.cancel();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispose is idempotent', () => {
    const source = new CancellationTokenSource();
    source.dispose();
    source.dispose(); // no error
  });

  it('listener dispose removes the listener', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    const { dispose } = source.token.onCancellationRequested(listener);
    dispose();
    source.cancel();
    expect(listener).not.toHaveBeenCalled();
    source.dispose();
  });

  it('listener errors do not affect other listeners', () => {
    const source = new CancellationTokenSource();
    const badListener = vi.fn(() => { throw new Error('oops'); });
    const goodListener = vi.fn();
    source.token.onCancellationRequested(badListener);
    source.token.onCancellationRequested(goodListener);
    source.cancel();
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();
    source.dispose();
  });

  it('disposing a listener twice is safe (index === -1 branch)', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    const { dispose } = source.token.onCancellationRequested(listener);
    dispose();
    dispose(); // second dispose — listener already removed, index === -1
    source.cancel();
    expect(listener).not.toHaveBeenCalled();
    source.dispose();
  });
});

describe('CancellationError', () => {
  it('creates with default message', () => {
    const err = new CancellationError();
    expect(err.message).toBe('Operation was cancelled');
    expect(err.name).toBe('CancellationError');
    expect(err).toBeInstanceOf(Error);
  });

  it('creates with custom message', () => {
    const err = new CancellationError('Custom cancellation');
    expect(err.message).toBe('Custom cancellation');
  });

  it('works when Error.captureStackTrace is unavailable', () => {
    const original = Error.captureStackTrace;
    try {
      // @ts-expect-error — temporarily remove captureStackTrace
      Error.captureStackTrace = undefined;
      const err = new CancellationError('no stack capture');
      expect(err.name).toBe('CancellationError');
      expect(err.message).toBe('no stack capture');
    } finally {
      Error.captureStackTrace = original;
    }
  });
});

describe('isCancellationError', () => {
  it('returns true for CancellationError instance', () => {
    expect(isCancellationError(new CancellationError())).toBe(true);
  });

  it('returns true for Error with name CancellationError', () => {
    const err = new Error('test');
    err.name = 'CancellationError';
    expect(isCancellationError(err)).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isCancellationError(new Error('nope'))).toBe(false);
  });

  it('returns false for non-error', () => {
    expect(isCancellationError('string')).toBe(false);
    expect(isCancellationError(null)).toBe(false);
    expect(isCancellationError(undefined)).toBe(false);
  });
});

describe('CancellationTokenStatic', () => {
  describe('None', () => {
    it('is never cancelled', () => {
      expect(CancellationTokenStatic.None.isCancellationRequested).toBe(false);
    });

    it('onCancellationRequested returns disposable', () => {
      const { dispose } = CancellationTokenStatic.None.onCancellationRequested(vi.fn());
      expect(typeof dispose).toBe('function');
      dispose(); // no error
    });
  });

  describe('Cancelled', () => {
    it('is already cancelled', () => {
      expect(CancellationTokenStatic.Cancelled.isCancellationRequested).toBe(true);
    });

    it('onCancellationRequested returns disposable', () => {
      const { dispose } = CancellationTokenStatic.Cancelled.onCancellationRequested(vi.fn());
      expect(typeof dispose).toBe('function');
      dispose(); // no error
    });
  });
});
