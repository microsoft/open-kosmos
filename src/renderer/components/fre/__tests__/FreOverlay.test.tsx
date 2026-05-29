/** @vitest-environment happy-dom */

/**
 * FreOverlay unit tests
 *
 * Covers view coordination logic:
 * - Initial view selection per brand
 * - Agent selection → setup view transition
 * - Skip welcome → basic setup transition
 * - Setup complete (OpenKosmos)
 * - Tutorial view buttons
 */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  useNavigate: () => mockNavigate,
}));

const { mockBrandName } = vi.hoisted(() => ({ mockBrandName: { value: 'kosmos' } }));
vi.mock('@shared/constants/branding', async () => ({
  get BRAND_NAME() { return mockBrandName.value; },
}));

const { mockCdnConfigured } = vi.hoisted(() => ({ mockCdnConfigured: { value: true } }));
vi.mock('@shared/utils/cdn', async () => ({
  isCdnConfigured: () => mockCdnConfigured.value,
  getCdnBaseUrl: () => (mockCdnConfigured.value ? 'https://cdn.test.example.com' : ''),
}));

vi.mock('@renderer/lib/userData', async () => ({
  profileDataManager: {
    getCurrentUserAlias: vi.fn(() => 'test-user'),
    getProfile: vi.fn(() => null),
  },
}));

vi.mock('../../lib/utilities/logger', async () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock child components as stubs that expose their props via callbacks
vi.mock('../FreWelcomeView', async () => ({
  default: (props: any) => (
    <div data-testid="fre-welcome-view">
      <button data-testid="select-agent" onClick={() => props.onSelectAgent({ name: 'Research Agent', version: '1.0.0', description: 'Test' })}>Select</button>
      <button data-testid="select-design-agent" onClick={() => props.onSelectAgent({ name: 'Design Agent', version: '1.0.0', description: 'Test' })}>Select Design</button>
      <button data-testid="select-basic-agent" onClick={() => props.onSelectAgent({ name: 'Basic Agent', version: '1.0.0', description: 'Test' })}>Select Basic</button>
      <button data-testid="skip-welcome" onClick={props.onSkip}>Skip</button>
    </div>
  ),
}));

vi.mock('../FreSettingUpView', async () => ({
  default: (props: any) => (
    <div data-testid="fre-setting-up-view" data-flow-type={props.setupFlowType}>
      <button data-testid="setup-complete" onClick={props.onSetupComplete}>Complete</button>
    </div>
  ),
}));

vi.mock('../FreFirstAgentTutorialView', async () => ({
  default: (props: any) => (
    <div data-testid="fre-tutorial-view">
      <button data-testid="create-agent" onClick={props.onCreateAgent}>Create</button>
      <button data-testid="explore-own" onClick={props.onExploreOnOwn}>Explore</button>
    </div>
  ),
}));

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FreOverlay from '../FreOverlay';

describe('FreOverlay', () => {
  const mockOnSkip = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrandName.value = 'kosmos';
    mockCdnConfigured.value = true;
    // Mock electronAPI
    (window as any).electronAPI = {
      platform: 'darwin',
      getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'darwin' }),
      profile: {
        updateFreDone: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  describe('OpenKosmos brand', () => {
    it('should render FreWelcomeView initially', () => {
      render(<FreOverlay onSkip={mockOnSkip} />);
      expect(screen.getByTestId('fre-welcome-view')).toBeInTheDocument();
    });

    it('should transition to setup view on agent selection', () => {
      render(<FreOverlay onSkip={mockOnSkip} />);
      fireEvent.click(screen.getByTestId('select-agent'));

      expect(screen.getByTestId('fre-setting-up-view')).toBeInTheDocument();
    });

    it('should transition to setup view with basic flow on skip', () => {
      render(<FreOverlay onSkip={mockOnSkip} />);
      fireEvent.click(screen.getByTestId('skip-welcome'));

      expect(screen.getByTestId('fre-setting-up-view')).toBeInTheDocument();
      expect(screen.getByTestId('fre-setting-up-view')).toHaveAttribute('data-flow-type', 'basic');
    });

    it('should call onSkip when setup completes', () => {
      render(<FreOverlay onSkip={mockOnSkip} />);
      fireEvent.click(screen.getByTestId('skip-welcome'));
      fireEvent.click(screen.getByTestId('setup-complete'));

      expect(mockOnSkip).toHaveBeenCalled();
    });

    it('should set basic flow type when selecting a design agent', () => {
      render(<FreOverlay onSkip={mockOnSkip} />);
      fireEvent.click(screen.getByTestId('select-design-agent'));

      expect(screen.getByTestId('fre-setting-up-view')).toHaveAttribute('data-flow-type', 'basic');
    });

    it('should set basic flow type when selecting a "basic" agent', () => {
      render(<FreOverlay onSkip={mockOnSkip} />);
      fireEvent.click(screen.getByTestId('select-basic-agent'));

      expect(screen.getByTestId('fre-setting-up-view')).toHaveAttribute('data-flow-type', 'basic');
    });
  });

  describe('CDN not configured', () => {
    it('should skip Welcome View and render setup view directly', () => {
      mockCdnConfigured.value = false;
      render(<FreOverlay onSkip={mockOnSkip} />);

      // Welcome View must never be mounted (no empty-state flash)
      expect(screen.queryByTestId('fre-welcome-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('fre-setting-up-view')).toBeInTheDocument();
      expect(screen.getByTestId('fre-setting-up-view')).toHaveAttribute('data-flow-type', 'basic');
    });
  });

  describe('platform detection', () => {
    it('should detect Windows via electronAPI.platform synchronously', async () => {
      (window as any).electronAPI.platform = 'win32';
      render(<FreOverlay onSkip={mockOnSkip} />);
      // No assertion on title bar; this exercises the synchronous win32 branch
      await waitFor(() => {
        expect(screen.getByTestId('fre-welcome-view')).toBeInTheDocument();
      });
    });

    it('should detect Windows via getPlatformInfo fallback', async () => {
      (window as any).electronAPI.platform = undefined;
      (window as any).electronAPI.getPlatformInfo = vi.fn().mockResolvedValue({ platform: 'win32' });
      render(<FreOverlay onSkip={mockOnSkip} />);

      await waitFor(() => {
        expect((window as any).electronAPI.getPlatformInfo).toHaveBeenCalled();
      });
    });

    it('should ignore getPlatformInfo errors and assume non-Windows', async () => {
      (window as any).electronAPI.platform = undefined;
      (window as any).electronAPI.getPlatformInfo = vi.fn().mockRejectedValue(new Error('boom'));
      render(<FreOverlay onSkip={mockOnSkip} />);

      await waitFor(() => {
        expect((window as any).electronAPI.getPlatformInfo).toHaveBeenCalled();
      });
      // Still renders the welcome view without throwing
      expect(screen.getByTestId('fre-welcome-view')).toBeInTheDocument();
    });
  });

});
