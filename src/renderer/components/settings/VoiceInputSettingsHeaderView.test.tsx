/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import VoiceInputSettingsHeaderView from './VoiceInputSettingsHeaderView'

describe('VoiceInputSettingsHeaderView', () => {
  it('renders the Voice Input title with the experiment tag', () => {
    render(<VoiceInputSettingsHeaderView />)
    expect(screen.getByText('Voice Input')).toBeTruthy()
  })
})
