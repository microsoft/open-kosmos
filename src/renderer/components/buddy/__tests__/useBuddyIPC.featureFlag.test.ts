/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { useBuddyIPC } from '../useBuddyIPC';

const mockSet = vi.fn();
const mockRefresh = vi.fn();

vi.mock('../buddy.atom', () => ({
  BuddyAtom: {
    use: () => [
      { activeBuddyId: '' },
      { refresh: mockRefresh, set: mockSet },
    ],
  },
}));

const mockOn = vi.fn();
const mockOff = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).electronAPI = {
    buddy: { on: mockOn, off: mockOff },
  };
});

afterEach(() => {
  delete (window as any).electronAPI;
});

describe('useBuddyIPC', () => {
  it('subscribes to IPC events and calls refresh on mount', () => {
    renderHook(() => useBuddyIPC());
    expect(mockOn).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });
});
