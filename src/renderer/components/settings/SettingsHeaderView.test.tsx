/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SettingsHeaderView from './SettingsHeaderView'

describe('SettingsHeaderView', () => {
  it('renders the Settings title', () => {
    render(<SettingsHeaderView />)
    expect(screen.getByText('Settings')).toBeTruthy()
  })
})
