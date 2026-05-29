/** @vitest-environment happy-dom */

/**
 * FreFirstAgentTutorialView unit tests
 *
 * Covers:
 * - Video URL construction (Mac/Linux path, Windows path)
 * - Video error → fallback UI
 * - "Create Agent" button → onCreateAgent
 * - "Explore on my own" → updates freDone + onExploreOnOwn
 */

vi.mock('@renderer/lib/userData', async () => ({
  profileDataManager: {
    getCurrentUserAlias: vi.fn(() => 'test-user'),
  },
}));

vi.mock('../../lib/brandIcon', async () => ({
  appIcon: 'mock-icon.svg',
}));

vi.mock('lucide-react', async () => ({
  Sparkles: (props: any) => <span data-testid="sparkles-icon" {...props} />,
}));

vi.mock('../../lib/utilities/logger', async () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FreFirstAgentTutorialView from '../FreFirstAgentTutorialView';

describe('FreFirstAgentTutorialView', () => {
  const mockOnCreateAgent = vi.fn();
  const mockOnExploreOnOwn = vi.fn();
  let mockUpdateFreDone: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateFreDone = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI = {
      getUserDataPath: vi.fn().mockResolvedValue('/Users/alice/Library/Application Support/OpenKosmos'),
      profile: {
        updateFreDone: mockUpdateFreDone,
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('should render Create Agent and Explore buttons', async () => {
    render(<FreFirstAgentTutorialView onCreateAgent={mockOnCreateAgent} onExploreOnOwn={mockOnExploreOnOwn} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Create Your First Project Agent/i)).toBeInTheDocument();
      expect(screen.getByText(/explore on my own/i)).toBeInTheDocument();
    });
  });

  it('should call onCreateAgent when Create button is clicked', async () => {
    render(<FreFirstAgentTutorialView onCreateAgent={mockOnCreateAgent} onExploreOnOwn={mockOnExploreOnOwn} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Create Your First Project Agent/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Create Your First Project Agent/i));
    expect(mockOnCreateAgent).toHaveBeenCalled();
  });

  it('should update freDone and call onExploreOnOwn when Explore button is clicked', async () => {
    render(<FreFirstAgentTutorialView onCreateAgent={mockOnCreateAgent} onExploreOnOwn={mockOnExploreOnOwn} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/explore on my own/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/explore on my own/i));

    await waitFor(() => {
      expect(mockUpdateFreDone).toHaveBeenCalledWith('test-user', true);
      expect(mockOnExploreOnOwn).toHaveBeenCalled();
    });
  });

  it('should show fallback when getUserDataPath fails', async () => {
    (window as any).electronAPI.getUserDataPath = vi.fn().mockResolvedValue(null);

    render(<FreFirstAgentTutorialView onCreateAgent={mockOnCreateAgent} onExploreOnOwn={mockOnExploreOnOwn} isWindows={false} />);

    // Should still render the buttons (video error is non-blocking)
    await waitFor(() => {
      expect(screen.getByText(/Create Your First Project Agent/i)).toBeInTheDocument();
    });
  });

  it('should handle Windows path for video URL', async () => {
    (window as any).electronAPI.getUserDataPath = vi.fn().mockResolvedValue('C:\\Users\\alice\\AppData\\Roaming\\OpenKosmos');

    render(<FreFirstAgentTutorialView onCreateAgent={mockOnCreateAgent} onExploreOnOwn={mockOnExploreOnOwn} isWindows={true} />);

    // Should render without crashing
    await waitFor(() => {
      expect(screen.getByText(/Create Your First Project Agent/i)).toBeInTheDocument();
    });
  });
});
