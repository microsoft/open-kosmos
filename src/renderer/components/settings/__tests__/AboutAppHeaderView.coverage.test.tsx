// @vitest-environment happy-dom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AboutAppHeaderView from '../AboutAppHeaderView';

describe('AboutAppHeaderView', () => {
  it('renders the localized product title and header icon', () => {
    const { container } = render(<AboutAppHeaderView />);

    expect(screen.getByText(/About/)).toBeTruthy();
    expect(container.querySelector('.unified-header')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
