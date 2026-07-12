/** @vitest-environment happy-dom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import ComputerUseSettingsHeaderView from '../ComputerUseSettingsHeaderView'

describe('ComputerUseSettingsHeaderView', () => {
  it('renders the title', () => {
    render(<ComputerUseSettingsHeaderView />)
    expect(screen.getByText('Computer Use')).toBeTruthy()
  })
})
