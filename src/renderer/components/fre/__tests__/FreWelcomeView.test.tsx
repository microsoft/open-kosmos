/** @vitest-environment happy-dom */

/**
 * FreWelcomeView unit tests
 *
 * Covers:
 * - Fetches agent_lib.json from CDN on mount
 * - Filters agents with needs_fre_promotion === true
 * - Loading / error / empty / agents states
 * - Agent card click → onSelectAgent
 * - Skip button → onSkip
 * - Retry on error
 */

vi.mock('@shared/constants/branding', async () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_CONFIG: { windowTitle: 'OpenKosmos AI Studio', shortcutName: 'OpenKosmos' },
}));

vi.mock('@renderer/lib/userData', async () => ({
  profileDataManager: {
    getCurrentUserAlias: vi.fn(() => 'alice'),
    getProfile: vi.fn(() => null),
  },
}));

const { mockCdnConfigured } = vi.hoisted(() => ({ mockCdnConfigured: { value: true } }));
vi.mock('@shared/utils/cdn', async () => ({
  isCdnConfigured: () => mockCdnConfigured.value,
  getCdnBaseUrl: () => (mockCdnConfigured.value ? 'https://cdn.test.example.com' : ''),
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
import FreWelcomeView from '../FreWelcomeView';
import { profileDataManager } from '@renderer/lib/userData';

describe('FreWelcomeView', () => {
  const mockOnSelectAgent = vi.fn();
  const mockOnSkip = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCdnConfigured.value = true;
    (profileDataManager.getCurrentUserAlias as any).mockReturnValue('alice');
    (profileDataManager.getProfile as any).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show loading state initially', () => {
    // Never resolve fetch
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('should render agent cards after successful fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Research Agent', version: '1.0.0', description: 'PM', needs_fre_promotion: true, configuration: { name: 'Research Agent' } },
          { name: 'Other Agent', version: '1.0.0', description: 'Other', needs_fre_promotion: false },
        ],
      }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText('Research Agent')).toBeInTheDocument();
    });

    // 'Other Agent' should NOT be shown (needs_fre_promotion: false)
    expect(screen.queryByText('Other Agent')).not.toBeInTheDocument();
  });

  it('should call onSelectAgent when agent card is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Research Agent', version: '1.0.0', description: 'PM', needs_fre_promotion: true, configuration: { name: 'Research Agent' } },
        ],
      }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText('Research Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Research Agent'));
    expect(mockOnSelectAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Research Agent' }));
  });

  it('should show error and Retry button on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Retry/i)).toBeInTheDocument();
  });

  it('should retry fetch on Retry button click', async () => {
    const mockFetch = vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agents: [{ name: 'Agent', version: '1.0.0', description: 'A', needs_fre_promotion: true, configuration: { name: 'Agent' } }] }),
      } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Retry/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Retry/i));

    await waitFor(() => {
      expect(screen.getByText('Agent')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should call onSkip when Skip button is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Research Agent', version: '1.0.0', description: 'PM', needs_fre_promotion: true, configuration: { name: 'Research Agent' } },
        ],
      }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Skip for now/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Skip for now/i));
    expect(mockOnSkip).toHaveBeenCalled();
  });

  it('should auto-skip when fetch returns zero promoted agents', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    // onSkip drives the parent to unmount the overlay; here we only assert the
    // callback fires so the user never has to manually dismiss an empty screen.
    await waitFor(() => {
      expect(mockOnSkip).toHaveBeenCalled();
    });
  });

  it('should auto-skip when CDN is not configured (no fetch)', async () => {
    mockCdnConfigured.value = false;
    const fetchSpy = vi.spyOn(global, 'fetch');

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(mockOnSkip).toHaveBeenCalled();
    });

    // No remote fetch should occur when CDN is unconfigured
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should NOT auto-skip when fetch fails (error state is shown instead)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });

    expect(mockOnSkip).not.toHaveBeenCalled();
  });

  it('should render emoji fallback when agent has no avatar', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Emoji Agent', version: '1.0.0', description: 'E', needs_fre_promotion: true, team: 'Acme', configuration: { name: 'Emoji Agent', emoji: '🦄' } },
        ],
      }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText('🦄')).toBeInTheDocument();
    });
    expect(screen.getByText(/A Acme production/)).toBeInTheDocument();
  });

  it('should render the avatar image when provided', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Logo Agent', version: '1.0.0', description: 'L', needs_fre_promotion: true, configuration: { name: 'Logo Agent', avatar: 'https://cdn.test.example.com/logo.png' } },
        ],
      }),
    } as Response);

    const { container } = render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText('Logo Agent')).toBeInTheDocument();
    });
    const img = container.querySelector('img[alt="Logo Agent"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toContain('logo.png');
  });

  it('should toggle hover styles on mouse enter/leave', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Hover Agent', version: '1.0.0', description: 'H', needs_fre_promotion: true, configuration: { name: 'Hover Agent', emoji: '🤖' } },
        ],
      }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText('Hover Agent')).toBeInTheDocument();
    });

    const card = screen.getByText('Hover Agent').closest('div[style]') as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    // No throw + card still present means hover handlers executed
    expect(screen.getByText('Hover Agent')).toBeInTheDocument();
  });

  it('should toggle hover styles on the Skip button', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Hover Skip Agent', version: '1.0.0', description: 'H', needs_fre_promotion: true, configuration: { name: 'Hover Skip Agent', emoji: '🤖' } },
        ],
      }),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Skip for now/i)).toBeInTheDocument();
    });

    const skipButton = screen.getByText(/Skip for now/i).closest('button') as HTMLButtonElement;
    fireEvent.mouseEnter(skipButton);
    expect(skipButton.style.transform).toBe('translateY(-1px)');
    fireEvent.mouseLeave(skipButton);
    expect(skipButton.style.transform).toBe('translateY(0)');
  });

  it('should offset content for Windows title bar', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={true} />
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.top).toBe('40px');
  });

  it('should fall back to profile.alias when getCurrentUserAlias is empty', async () => {
    (profileDataManager.getCurrentUserAlias as any).mockReturnValue('');
    (profileDataManager.getProfile as any).mockReturnValue({ alias: 'bob' });
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    expect(screen.getByText(/Hi bob/)).toBeInTheDocument();
  });

  it('should fall back to "there" when alias lookup throws', async () => {
    (profileDataManager.getCurrentUserAlias as any).mockImplementation(() => { throw new Error('no profile'); });
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    expect(screen.getByText(/Hi there/)).toBeInTheDocument();
  });

  it('should fall back to "there" when no alias and no profile alias', async () => {
    (profileDataManager.getCurrentUserAlias as any).mockReturnValue('');
    (profileDataManager.getProfile as any).mockReturnValue({});
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    expect(screen.getByText(/Hi there/)).toBeInTheDocument();
  });

  it('should handle missing agents array in response (treated as empty)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(mockOnSkip).toHaveBeenCalled();
    });
  });

  it('should show HTTP error on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
  });

  it('should stringify non-Error throws into the error state', async () => {
    // Reject with a non-Error value to exercise the String(err) branch
    vi.spyOn(global, 'fetch').mockRejectedValue('plain string failure');

    render(<FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />);

    await waitFor(() => {
      expect(screen.getByText(/plain string failure/)).toBeInTheDocument();
    });
    expect(mockOnSkip).not.toHaveBeenCalled();
  });

  it('should render defaults when an agent has no configuration object', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'Bare Agent', version: '1.0.0', description: 'B', needs_fre_promotion: true },
        ],
      }),
    } as Response);

    const { container } = render(
      <FreWelcomeView onSelectAgent={mockOnSelectAgent} onSkip={mockOnSkip} isWindows={false} />
    );

    await waitFor(() => {
      // Falls back to agent.name when configuration?.name is absent
      expect(screen.getByText('Bare Agent')).toBeInTheDocument();
    });
    // No avatar → default emoji rendered, no <img>
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('🤖')).toBeInTheDocument();
  });
});
