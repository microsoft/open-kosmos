/** @vitest-environment happy-dom */

import React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { useAutoHideScrollbarContainer } from '../useAutoHideScrollbarContainer'

function Library({
  delay,
  show = true,
  withList = true,
}: {
  delay?: number
  show?: boolean
  withList?: boolean
}) {
  const ref = useAutoHideScrollbarContainer<HTMLDivElement>('.server-list', delay)
  if (!show) return <span data-testid="placeholder" />
  return (
    <div data-testid="container" ref={ref}>
      <div data-testid="search">search box</div>
      {withList && (
        <div data-testid="list" className="server-list">
          <div data-testid="card" className="card">
            card
          </div>
        </div>
      )}
    </div>
  )
}

describe('useAutoHideScrollbarContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('reveals the list scrollbar while hovering anywhere over the list', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')
    const card = getByTestId('card')

    expect(list.classList.contains('is-scrolling')).toBe(false)

    // Hovering a card (a child of the list) reveals the scrollbar.
    act(() => {
      fireEvent.mouseOver(card)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    // Leaving the list hides it again.
    act(() => {
      fireEvent.mouseOut(card, { relatedTarget: getByTestId('search') })
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)
  })

  it('keeps the scrollbar revealed when moving between elements inside the list', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')
    const card = getByTestId('card')

    act(() => {
      fireEvent.mouseOver(card)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    // relatedTarget still inside the list -> stays revealed.
    act(() => {
      fireEvent.mouseOut(card, { relatedTarget: list })
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)
  })

  it('ignores hover and mouseout that do not involve the list', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')
    const search = getByTestId('search')

    act(() => {
      fireEvent.mouseOver(search)
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)

    act(() => {
      fireEvent.mouseOut(search, { relatedTarget: getByTestId('container') })
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)
  })

  it('reveals on scroll and hides after the delay when not hovering', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')

    act(() => {
      fireEvent.scroll(list)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)
  })

  it('stays revealed after scroll idle while the pointer is still over the list', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')
    const card = getByTestId('card')

    act(() => {
      fireEvent.mouseOver(card)
      fireEvent.scroll(list)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    // Scroll idle timer fires but hovering keeps it revealed.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)
  })

  it('debounces the scroll hide timer across rapid scrolls', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')

    act(() => {
      fireEvent.scroll(list)
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    act(() => {
      fireEvent.scroll(list)
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)
  })

  it('ignores scroll events from elements other than the list', () => {
    const { getByTestId } = render(<Library delay={500} />)
    const list = getByTestId('list')
    const container = getByTestId('container')

    act(() => {
      fireEvent.scroll(container)
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)
  })

  it('falls back to a 1000ms default hide delay when none is provided', () => {
    const { getByTestId } = render(<Library />)
    const list = getByTestId('list')

    act(() => {
      fireEvent.scroll(list)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(list.classList.contains('is-scrolling')).toBe(false)
  })

  it('does nothing when the list is not present in the container', () => {
    const { getByTestId } = render(<Library delay={500} withList={false} />)
    const container = getByTestId('container')

    expect(() => {
      act(() => {
        fireEvent.mouseOver(container)
        fireEvent.scroll(container)
      })
    }).not.toThrow()
  })

  it('cleans up listeners and the pending timer when the container unmounts mid-scroll', () => {
    const { getByTestId, rerender } = render(<Library delay={500} show={true} />)
    const list = getByTestId('list')

    act(() => {
      fireEvent.scroll(list)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)

    rerender(<Library delay={500} show={false} />)

    // The cleared timer never fires, so the detached node keeps its class.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(list.classList.contains('is-scrolling')).toBe(true)
  })

  it('cleans up without a pending timer when the container unmounts idle', () => {
    const { rerender } = render(<Library delay={500} show={true} />)
    expect(() => {
      rerender(<Library delay={500} show={false} />)
    }).not.toThrow()
  })
})
