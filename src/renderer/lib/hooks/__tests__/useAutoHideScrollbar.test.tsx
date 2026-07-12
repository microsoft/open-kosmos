/** @vitest-environment happy-dom */

import React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { useAutoHideScrollbar } from '../useAutoHideScrollbar'

function Scrollable({ delay, show = true }: { delay?: number; show?: boolean }) {
  const scrollRef = useAutoHideScrollbar<HTMLDivElement>(delay)
  return show ? (
    <div data-testid="scrollable" ref={scrollRef}>
      content
    </div>
  ) : (
    <span data-testid="placeholder" />
  )
}

describe('useAutoHideScrollbar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('adds the is-scrolling class on scroll and removes it after the hide delay', () => {
    const { getByTestId } = render(<Scrollable delay={500} />)
    const el = getByTestId('scrollable')

    expect(el.classList.contains('is-scrolling')).toBe(false)

    act(() => {
      fireEvent.scroll(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(el.classList.contains('is-scrolling')).toBe(false)
  })

  it('debounces the hide timer across rapid scrolls', () => {
    const { getByTestId } = render(<Scrollable delay={500} />)
    const el = getByTestId('scrollable')

    act(() => {
      fireEvent.scroll(el)
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    // Second scroll resets the pending hide timer (clearTimeout branch).
    act(() => {
      fireEvent.scroll(el)
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(el.classList.contains('is-scrolling')).toBe(false)
  })

  it('reveals on hover and hides again when the pointer leaves', () => {
    const { getByTestId } = render(<Scrollable delay={500} />)
    const el = getByTestId('scrollable')

    act(() => {
      fireEvent.mouseEnter(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      fireEvent.mouseLeave(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(false)
  })

  it('stays revealed after scroll idle while the pointer is still over the list', () => {
    const { getByTestId } = render(<Scrollable delay={500} />)
    const el = getByTestId('scrollable')

    act(() => {
      fireEvent.mouseEnter(el)
      fireEvent.scroll(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    // Scroll idle timer fires but hovering keeps it revealed.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    // Leaving now hides it.
    act(() => {
      fireEvent.mouseLeave(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(false)
  })

  it('stays revealed on mouseleave while still actively scrolling', () => {
    const { getByTestId } = render(<Scrollable delay={500} />)
    const el = getByTestId('scrollable')

    act(() => {
      fireEvent.mouseEnter(el)
      fireEvent.scroll(el)
    })
    // Pointer leaves but a scroll is still in flight -> stays revealed.
    act(() => {
      fireEvent.mouseLeave(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(el.classList.contains('is-scrolling')).toBe(false)
  })

  it('falls back to a 1000ms default hide delay when none is provided', () => {
    const { getByTestId } = render(<Scrollable />)
    const el = getByTestId('scrollable')

    act(() => {
      fireEvent.scroll(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(el.classList.contains('is-scrolling')).toBe(false)
  })

  it('cleans up the pending hide timer when the element unmounts mid-scroll', () => {
    const { getByTestId, rerender } = render(<Scrollable delay={500} show={true} />)
    const el = getByTestId('scrollable')

    act(() => {
      fireEvent.scroll(el)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)

    // Unmounting the element runs the callback-ref cleanup with a live timer,
    // exercising removeEventListener + clearTimeout(hideTimer).
    rerender(<Scrollable delay={500} show={false} />)

    // The cleared timer never fires, so the detached node keeps its class.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(el.classList.contains('is-scrolling')).toBe(true)
  })

  it('cleans up without a pending timer when the element unmounts without scrolling', () => {
    const { rerender } = render(<Scrollable delay={500} show={true} />)
    expect(() => {
      rerender(<Scrollable delay={500} show={false} />)
    }).not.toThrow()
  })

  it('does not throw when scrolling after the element has been detached', () => {
    const { getByTestId, rerender } = render(<Scrollable delay={500} show={true} />)
    const el = getByTestId('scrollable')
    rerender(<Scrollable delay={500} show={false} />)
    expect(() => {
      fireEvent.scroll(el)
    }).not.toThrow()
  })
})
