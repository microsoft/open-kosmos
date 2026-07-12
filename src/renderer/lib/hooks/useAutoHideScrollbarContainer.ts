import { useCallback, useRef } from 'react'

/**
 * Reveals an auto-hiding scrollbar on a descendant scroll list while the pointer
 * is over the list OR the list is actively being scrolled.
 *
 * Attach the returned callback ref to a container element that contains the
 * scroll list (matched by `selector`, default `.server-list`). The hook listens
 * on the container via event delegation, so the scroll list can mount after an
 * initial loading / empty state and still be handled.
 *
 * Why JS instead of pure CSS `:hover`: a custom (`::-webkit-scrollbar`) scrollbar
 * in Chromium / Electron does not reliably repaint when the scroll container's
 * `:hover` state flips while the pointer is over child content (e.g. cards), so
 * `.list:hover::-webkit-scrollbar-thumb` only takes effect when the pointer is
 * directly over the thin scrollbar strip. Toggling the `is-scrolling` reveal
 * class from JS forces the repaint, so hover-reveal works anywhere over the list.
 *
 * The same `is-scrolling` class is reused for both hover and scroll so the CSS
 * only needs a single reveal selector.
 */
export function useAutoHideScrollbarContainer<T extends HTMLElement = HTMLElement>(
  selector = '.server-list',
  hideDelayMs = 1000,
) {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback(
    (container: T | null) => {
      // Detach from any previously bound container first.
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      if (!container) return

      let hideTimer: ReturnType<typeof setTimeout> | undefined
      let hovering = false
      let scrolling = false

      const list = () => container.querySelector<HTMLElement>(selector)

      const reveal = () => {
        const el = list()
        if (el) el.classList.add('is-scrolling')
      }

      const maybeHide = () => {
        if (hovering || scrolling) return
        const el = list()
        if (el) el.classList.remove('is-scrolling')
      }

      // scroll does not bubble, so listen in the capture phase to receive
      // scroll events targeted at the descendant list.
      const handleScroll = (event: Event) => {
        const target = event.target
        if (!(target instanceof Element) || !target.matches(selector)) return
        scrolling = true
        reveal()
        if (hideTimer) clearTimeout(hideTimer)
        hideTimer = setTimeout(() => {
          scrolling = false
          maybeHide()
        }, hideDelayMs)
      }

      const handleOver = (event: Event) => {
        const target = event.target
        if (!(target instanceof Element) || !target.closest(selector)) return
        hovering = true
        reveal()
      }

      const handleOut = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const fromList = target.closest(selector)
        if (!fromList) return
        const related = event.relatedTarget
        // Ignore moves that stay inside the same list.
        if (related instanceof Node && fromList.contains(related)) return
        hovering = false
        maybeHide()
      }

      container.addEventListener('scroll', handleScroll, { capture: true, passive: true })
      container.addEventListener('mouseover', handleOver)
      container.addEventListener('mouseout', handleOut as EventListener)

      cleanupRef.current = () => {
        container.removeEventListener('scroll', handleScroll, { capture: true } as EventListenerOptions)
        container.removeEventListener('mouseover', handleOver)
        container.removeEventListener('mouseout', handleOut as EventListener)
        if (hideTimer) clearTimeout(hideTimer)
      }
    },
    [selector, hideDelayMs],
  )
}
