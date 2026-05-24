/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BuddyContextMenu } from '../BuddyContextMenu';

describe('BuddyContextMenu', () => {
  const defaultProps = {
    position: { x: 100, y: 100 },
    muted: false,
    onPet: vi.fn(),
    onStats: vi.fn(),
    onOpenBackpack: vi.fn(),
    onToggleMute: vi.fn(),
    onHide: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all menu items', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    expect(screen.getByText(/Pet/)).toBeTruthy();
    expect(screen.getByText(/Stats/)).toBeTruthy();
    expect(screen.getByText(/Open Backpack/)).toBeTruthy();
    expect(screen.getByText(/Mute/)).toBeTruthy();
    expect(screen.getByText(/Hide/)).toBeTruthy();
  });

  it('shows Mute when not muted', () => {
    render(<BuddyContextMenu {...defaultProps} muted={false} />);
    expect(screen.getByText(/Mute/)).toBeTruthy();
  });

  it('shows Unmute when muted', () => {
    render(<BuddyContextMenu {...defaultProps} muted={true} />);
    expect(screen.getByText(/Unmute/)).toBeTruthy();
  });

  it('calls onPet when Pet is clicked', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByText(/Pet/));
    expect(defaultProps.onPet).toHaveBeenCalled();
  });

  it('calls onStats when Stats is clicked', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByText(/Stats/));
    expect(defaultProps.onStats).toHaveBeenCalled();
  });

  it('calls onOpenBackpack when Open Backpack is clicked', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByText(/Open Backpack/));
    expect(defaultProps.onOpenBackpack).toHaveBeenCalled();
  });

  it('calls onToggleMute when Mute is clicked', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByText(/Mute/));
    expect(defaultProps.onToggleMute).toHaveBeenCalled();
  });

  it('calls onHide when Hide is clicked', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByText(/Hide/));
    expect(defaultProps.onHide).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking outside', () => {
    render(<BuddyContextMenu {...defaultProps} />);
    fireEvent.mouseDown(document.body);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('adjusts position to avoid overflow when near right/bottom edge', () => {
    // Position near the viewport edge
    const { container } = render(
      <BuddyContextMenu {...defaultProps} position={{ x: 1900, y: 1000 }} />
    );
    const menu = container.firstChild as HTMLElement;
    // Should have been adjusted left and up
    const left = parseInt(menu.style.left);
    const top = parseInt(menu.style.top);
    expect(left).toBeLessThan(1900);
    expect(top).toBeLessThan(1000);
  });

  it('positions menu at given coords when within bounds', () => {
    const { container } = render(
      <BuddyContextMenu {...defaultProps} position={{ x: 50, y: 50 }} />
    );
    const menu = container.firstChild as HTMLElement;
    expect(parseInt(menu.style.left)).toBe(50);
    expect(parseInt(menu.style.top)).toBe(50);
  });
});
