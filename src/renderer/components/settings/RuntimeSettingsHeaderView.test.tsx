/**
 * @vitest-environment happy-dom
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RuntimeSettingsHeaderView from './RuntimeSettingsHeaderView'

describe('RuntimeSettingsHeaderView', () => {
  it('renders installed badges and calls onRefresh when the button is clicked (default not refreshing)', () => {
    const onRefresh = vi.fn()
    render(
      <RuntimeSettingsHeaderView
        mode="system"
        bunInstalled={true}
        uvInstalled={true}
        onRefresh={onRefresh}
      />
    )
    expect(screen.getByText('Runtime')).toBeTruthy()
    expect(screen.getByText('mode: system')).toBeTruthy()
    expect(screen.getByText('bun: Installed')).toBeTruthy()
    expect(screen.getByText('uv: Installed')).toBeTruthy()
    const btn = screen.getByTitle('Refresh runtime status') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('renders not-installed badges and disables the button while refreshing', () => {
    render(
      <RuntimeSettingsHeaderView
        mode="internal"
        bunInstalled={false}
        uvInstalled={false}
        onRefresh={vi.fn()}
        isRefreshing={true}
      />
    )
    expect(screen.getByText('mode: internal')).toBeTruthy()
    expect(screen.getByText('bun: Not installed')).toBeTruthy()
    expect(screen.getByText('uv: Not installed')).toBeTruthy()
    const btn = screen.getByTitle('Refresh runtime status') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('omits the refresh button when no onRefresh handler is provided', () => {
    render(
      <RuntimeSettingsHeaderView
        mode="system"
        bunInstalled={true}
        uvInstalled={false}
      />
    )
    expect(screen.queryByTitle('Refresh runtime status')).toBeNull()
  })
})
