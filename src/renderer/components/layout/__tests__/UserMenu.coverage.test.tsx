/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for UserMenu.tsx
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockUserMenuAtomUse,
  mockDoctorAtomUse,
  mockNavigate,
  mockLocation,
  mockSignOut,
  mockCheckForUpdates,
  mockShowUpdateDialog,
} = vi.hoisted(() => ({
  mockUserMenuAtomUse: vi.fn(() => [true, vi.fn()]),
  mockDoctorAtomUse: vi.fn(() => [{ type: 'idle' }, { show: vi.fn() }]),
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/agent' },
  mockSignOut: vi.fn().mockResolvedValue(undefined),
  mockCheckForUpdates: vi.fn().mockResolvedValue(undefined),
  mockShowUpdateDialog: vi.fn(),
}));

vi.mock('@/atom', () => ({
  atom: (defaultValue: any) => ({
    use: mockUserMenuAtomUse,
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('../../autoUpdate/UpdateProvider', () => ({
  useUpdate: () => ({
    checkForUpdates: mockCheckForUpdates,
    showUpdateDialog: mockShowUpdateDialog,
  }),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ signOut: mockSignOut }),
}));

vi.mock('@/lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_CONFIG: { feedbackLink: 'https://example.com/feedback' },
  BRAND_NAME: 'kosmos',
  APP_NAME: 'OpenKosmos',
}));

vi.mock('@/states/doctor.atom', () => ({
  doctorInquiryAtom: { use: mockDoctorAtomUse },
}));

vi.mock('@/lib/featureFlags/useFeatureFlag', () => ({
  useFeatureFlag: (flag: string) => flag === 'kosmosFeatureDoctor',
}));

vi.mock('lucide-react', () => ({
  Settings: (props: any) => <span data-testid="icon-Settings" />,
  LogOut: (props: any) => <span data-testid="icon-LogOut" />,
  RotateCw: (props: any) => <span data-testid="icon-RotateCw" />,
  MessageSquareText: (props: any) => <span data-testid="icon-MessageSquareText" />,
  Hospital: (props: any) => <span data-testid="icon-Hospital" />,
}));

import { UserMenu } from '../UserMenu';

function renderMenu() {
  return render(<UserMenu />);
}

describe('UserMenu - visible=true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserMenuAtomUse.mockReturnValue([true, vi.fn()]);
    mockDoctorAtomUse.mockReturnValue([{ type: 'idle' }, { show: vi.fn() }]);
  });

  it('renders the menu when visible', () => {
    renderMenu();
    expect(screen.getByTitle('Open Settings')).toBeInTheDocument();
    expect(screen.getByTitle('Check for app updates')).toBeInTheDocument();
    expect(screen.getByTitle('Send feedback')).toBeInTheDocument();
  });

  it('renders Logout button', () => {
    renderMenu();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('renders ReportBug when doctor enabled and state=idle', () => {
    renderMenu();
    expect(screen.getByTitle('Report a bug')).toBeInTheDocument();
  });

  it('navigates to /settings on Settings click', () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    renderMenu();
    fireEvent.click(screen.getByTitle('Open Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(setVisible).toHaveBeenCalledWith(false);
  });

  it('calls checkForUpdates and showUpdateDialog on Check Updates click', async () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    renderMenu();
    fireEvent.click(screen.getByTitle('Check for app updates'));
    await waitFor(() => {
      expect(mockCheckForUpdates).toHaveBeenCalled();
      expect(mockShowUpdateDialog).toHaveBeenCalled();
    });
  });

  it('calls signOut on Logout click', async () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    renderMenu();
    fireEvent.click(screen.getByText('Logout'));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it('opens feedback link on Send Feedback click', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderMenu();
    fireEvent.click(screen.getByTitle('Send feedback'));
    expect(openSpy).toHaveBeenCalledWith('https://example.com/feedback', '_blank');
    openSpy.mockRestore();
  });

  it('closes menu when clicking outside', () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    renderMenu();
    fireEvent.mouseDown(document.body);
    expect(setVisible).toHaveBeenCalledWith(false);
  });
});

describe('UserMenu - visible=false', () => {
  it('renders nothing when not visible', () => {
    mockUserMenuAtomUse.mockReturnValue([false, vi.fn()]);
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UserMenu - ReportBug conditional', () => {
  it('does not render ReportBug when doctor state is not idle', () => {
    mockUserMenuAtomUse.mockReturnValue([true, vi.fn()]);
    mockDoctorAtomUse.mockReturnValue([{ type: 'showing' }, { show: vi.fn() }]);
    renderMenu();
    expect(screen.queryByTitle('Report a bug')).not.toBeInTheDocument();
  });
});
