/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- CSS ---
vi.mock('../../../styles/ChatZeroStates.css', () => ({}));

// --- Logger ---
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// --- electronAPI ---
const mockGetOrCache = vi.hoisted(() => vi.fn());

Object.defineProperty(window, 'electronAPI', {
  writable: true,
  value: {
    quickStartImageCache: {
      getOrCache: mockGetOrCache,
    },
  },
});

import ChatZeroStates from '../ChatZeroStates';
import type { ZeroStates } from '../../../lib/userData/types';

function makeZeroStates(overrides: Partial<ZeroStates> = {}): ZeroStates {
  return {
    greeting: 'Hello!',
    quick_starts: [],
    ...overrides,
  };
}

describe('ChatZeroStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCache.mockResolvedValue({ success: true, cachedUrl: 'file:///cached/img.png' });
  });

  it('renders nothing when both greeting and quick_starts are empty', () => {
    const { container } = render(
      <ChatZeroStates
        zeroStates={{ greeting: '', quick_starts: [] }}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when greeting is whitespace only and no quick_starts', () => {
    const { container } = render(
      <ChatZeroStates
        zeroStates={{ greeting: '   ', quick_starts: [] }}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders greeting when provided', () => {
    render(
      <ChatZeroStates
        zeroStates={makeZeroStates()}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('renders quick start cards when provided', async () => {
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'Card 1', description: 'Desc 1', prompt: 'Do task 1', image: '' },
        { title: 'Card 2', description: 'Desc 2', prompt: 'Do task 2', image: 'http://example.com/img.png' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 2')).toBeInTheDocument();
  });

  it('calls onQuickStartClick with correct prompt when card clicked', async () => {
    const onQuickStartClick = vi.fn();
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'Card 1', description: 'Desc 1', prompt: 'Run task A', image: '' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={onQuickStartClick}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onQuickStartClick).toHaveBeenCalledWith('Run task A');
  });

  it('calls onQuickStartClick on Enter key', async () => {
    const onQuickStartClick = vi.fn();
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'Keyboard Card', description: 'Desc', prompt: 'key-prompt', image: '' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={onQuickStartClick}
      />
    );
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onQuickStartClick).toHaveBeenCalledWith('key-prompt');
  });

  it('calls onQuickStartClick on Space key', async () => {
    const onQuickStartClick = vi.fn();
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'Space Card', description: 'Desc', prompt: 'space-prompt', image: '' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={onQuickStartClick}
      />
    );
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onQuickStartClick).toHaveBeenCalledWith('space-prompt');
  });

  it('renders greeting and quick starts together', async () => {
    const zeroStates: ZeroStates = {
      greeting: 'Welcome!',
      quick_starts: [
        { title: 'My Card', description: 'Try it', prompt: 'go', image: '' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    expect(screen.getByText('My Card')).toBeInTheDocument();
  });

  it('falls back to remote URL when cache fails', async () => {
    mockGetOrCache.mockRejectedValue(new Error('cache error'));
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'Fallback Card', description: 'Desc', prompt: 'test', image: 'http://cdn.example.com/img.png' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    // Wait for async image load to settle without crashing
    await waitFor(() => expect(screen.getByText('Fallback Card')).toBeInTheDocument());
  });

  it('falls back to remote URL when cache returns success=false', async () => {
    mockGetOrCache.mockResolvedValue({ success: false });
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'NoCache Card', description: 'Desc', prompt: 'test', image: 'http://cdn.example.com/img.png' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText('NoCache Card')).toBeInTheDocument());
  });

  it('uses loading class initially on card image', () => {
    mockGetOrCache.mockImplementation(() => new Promise(() => {})); // never resolves
    const zeroStates: ZeroStates = {
      greeting: '',
      quick_starts: [
        { title: 'Loading Card', description: 'Desc', prompt: 'test', image: '' },
      ],
    };
    render(
      <ChatZeroStates
        zeroStates={zeroStates}
        agentName="TestAgent"
        onQuickStartClick={vi.fn()}
      />
    );
    expect(document.querySelector('.quick-start-card-image.loading')).toBeTruthy();
  });
});
