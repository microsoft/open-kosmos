import { useCallback, useRef } from 'react'

/**
 * Reveals an auto-hiding scrollbar while the pointer is over a scrollable element
 * OR while the user is actively scrolling it.
 *
 * Attach the returned callback ref to the scrollable element. The hook toggles
 * the `is-scrolling` reveal class: it is added on hover (pointer enters) and on
 * each scroll, and removed once the pointer has left AND scrolling has been idle
 * for `hideDelayMs`.
 *
 * Why hover is handled in JS rather than pure CSS `:hover`: a custom
 * (`::-webkit-scrollbar`) scrollbar in Chromium / Electron does not reliably
 * repaint when the scroll element's `:hover` state flips while the pointer is
 * over child content, so `.list:hover::-webkit-scrollbar-thumb` only takes effect
 * when the pointer is directly over the thin scrollbar strip. Toggling the class
 * from JS forces the repaint, so the scrollbar reveals anywhere over the list.
 *
 * A callback ref (rather than `useRef` + `useEffect`) is used so the listeners
 * attach correctly even when the scrollable element is mounted after an initial
 * loading / empty state, and are cleaned up when it unmounts.
 *
 * Usage:
 *   const scrollRef = useAutoHideScrollbar<HTMLDivElement>()
 *   <div className="my-list" ref={scrollRef} />
 */
export function useAutoHideScrollbar<T extends HTMLElement = HTMLElement>(
  hideDelayMs = 1000,
) {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback(
    (element: T | null) => {
      // Detach from any previously bound element first.
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      if (!element) return

      let hideTimer: ReturnType<typeof setTimeout> | undefined
      let hovering = false
      let scrolling = false

      const maybeHide = () => {
        if (hovering || scrolling) return
        element.classList.remove('is-scrolling')
      }

      const handleScroll = () => {
        scrolling = true
        element.classList.add('is-scrolling')
        if (hideTimer) clearTimeout(hideTimer)
        hideTimer = setTimeout(() => {
          scrolling = false
          maybeHide()
        }, hideDelayMs)
      }

      const handleEnter = () => {
        hovering = true
        element.classList.add('is-scrolling')
      }

      const handleLeave = () => {
        hovering = false
        maybeHide()
      }

      element.addEventListener('scroll', handleScroll, { passive: true })
      element.addEventListener('mouseenter', handleEnter)
      element.addEventListener('mouseleave', handleLeave)

      cleanupRef.current = () => {
        element.removeEventListener('scroll', handleScroll)
        element.removeEventListener('mouseenter', handleEnter)
        element.removeEventListener('mouseleave', handleLeave)
        if (hideTimer) clearTimeout(hideTimer)
      }
    },
    [hideDelayMs],
  )
}
