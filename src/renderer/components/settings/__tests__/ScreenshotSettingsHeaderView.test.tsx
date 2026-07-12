// @vitest-environment happy-dom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScreenshotSettingsHeaderView from '../ScreenshotSettingsHeaderView';

vi.mock('lucide-react', () => ({
  Camera: () => <span data-testid="camera-icon" />,
}));

describe('ScreenshotSettingsHeaderView', () => {
  it('renders the translated title and header chrome', () => {
    const { container } = render(<ScreenshotSettingsHeaderView />);

    expect(screen.getByText('Screenshot')).toBeTruthy();
    expect(screen.getByTestId('camera-icon')).toBeTruthy();
    expect(container.querySelector('.unified-header')).toBeTruthy();
  });
});
