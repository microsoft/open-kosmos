/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SkillsHeaderView from './SkillsHeaderView'

describe('SkillsHeaderView', () => {
  it('renders the title and skill count', () => {
    render(<SkillsHeaderView totalSkills={7} onAddClick={vi.fn()} />)
    expect(screen.getByText('Skills')).toBeTruthy()
    expect(screen.getByText('available skills: 7')).toBeTruthy()
  })

  it('invokes onAddClick with the button element when clicked', () => {
    const onAddClick = vi.fn()
    render(<SkillsHeaderView totalSkills={0} onAddClick={onAddClick} />)
    fireEvent.click(screen.getByTitle('Add Skill'))
    expect(onAddClick).toHaveBeenCalledTimes(1)
    expect(onAddClick.mock.calls[0][0]).toBeInstanceOf(HTMLElement)
  })
})
