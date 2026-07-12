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
  mockNavigate,
  mockLocation,
  mockSignOut,
  mockBrandConfig,
} = vi.hoisted(() => ({
  mockUserMenuAtomUse: vi.fn(() => [true, vi.fn()]),
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/agent' },
  mockSignOut: vi.fn().mockResolvedValue(undefined),
  mockBrandConfig: { feedbackLink: 'https://example.com/feedback' },
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
  BRAND_CONFIG: mockBrandConfig,
  BRAND_NAME: 'openkosmos',
  APP_NAME: 'OpenKosmos',
}));

vi.mock('lucide-react', () => ({
  Settings: (props: any) => <span data-testid="icon-Settings" />,
  LogOut: (props: any) => <span data-testid="icon-LogOut" />,
  MessageSquareText: (props: any) => <span data-testid="icon-MessageSquareText" />,
}));

import { UserMenu } from '../UserMenu';

function renderMenu() {
  return render(<UserMenu />);
}

describe('UserMenu - visible=true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrandConfig.feedbackLink = 'https://example.com/feedback';
    mockUserMenuAtomUse.mockReturnValue([true, vi.fn()]);
  });

  it('renders the menu when visible', () => {
    renderMenu();
    expect(screen.getByTitle('Open Settings')).toBeInTheDocument();
    expect(screen.getByTitle('Send feedback')).toBeInTheDocument();
  });

  it('renders Logout button', () => {
    renderMenu();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('navigates to /settings on Settings click', () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    renderMenu();
    fireEvent.click(screen.getByTitle('Open Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(setVisible).toHaveBeenCalledWith(false);
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

  it('does not open feedback when no feedback link is configured', () => {
    mockBrandConfig.feedbackLink = '';
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderMenu();
    fireEvent.click(screen.getByTitle('Send feedback'));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('closes menu when clicking outside', () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    renderMenu();
    fireEvent.mouseDown(document.body);
    expect(setVisible).toHaveBeenCalledWith(false);
  });

  it('stays open when clicking inside the menu', () => {
    const setVisible = vi.fn();
    mockUserMenuAtomUse.mockReturnValue([true, setVisible]);
    const { container } = renderMenu();
    fireEvent.mouseDown(container.querySelector('.user-dropdown-menu')!);
    expect(setVisible).not.toHaveBeenCalled();
  });
});

describe('UserMenu - visible=false', () => {
  it('renders nothing when not visible', () => {
    mockUserMenuAtomUse.mockReturnValue([false, vi.fn()]);
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });
});
