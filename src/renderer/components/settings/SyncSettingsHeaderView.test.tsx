/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SyncSettingsHeaderView from './SyncSettingsHeaderView'

describe('SyncSettingsHeaderView', () => {
  it('renders the Sync title', () => {
    render(<SyncSettingsHeaderView />)
    expect(screen.getByText('Sync')).toBeTruthy()
  })
})
