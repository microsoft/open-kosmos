import { useEffect, useRef } from 'react'

/**
 * Returns a ref to attach to the currently selected option element inside an
 * opened dropdown / list. When the dropdown opens or the selection / list size
 * changes, the referenced element is scrolled into view (`block: 'nearest'`).
 *
 * Usage:
 *   const selectedRef = useScrollSelectedIntoView<HTMLButtonElement>(
 *     isOpen,
 *     selectedId,
 *     options.length,
 *   )
 *   <button ref={option.id === selectedId ? selectedRef : undefined} />
 */
export function useScrollSelectedIntoView<T extends HTMLElement = HTMLElement>(
  isOpen: boolean,
  selectedId: string | null | undefined,
  listLength: number,
) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (isOpen && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isOpen, selectedId, listLength])

  return ref
}
