/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentChatCreationHeaderView from './AgentChatCreationHeaderView'

describe('AgentChatCreationHeaderView', () => {
  it('renders the New Agent title', () => {
    render(<AgentChatCreationHeaderView />)
    expect(screen.getByText('New Agent')).toBeTruthy()
  })
})
