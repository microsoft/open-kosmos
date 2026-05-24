interface AdjustScrollForExpandedContentOptions {
  anchorElement: HTMLElement;
  targetElement: HTMLElement;
  anchorTopBeforeToggle: number;
}

export function adjustScrollForExpandedContent({
  anchorElement,
  targetElement,
  anchorTopBeforeToggle,
}: AdjustScrollForExpandedContentOptions): void {
  const scrollContainer = anchorElement.closest('.chat-container-reverse');
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  const anchorTopAfterToggle = anchorElement.getBoundingClientRect().top;
  const anchorDiff = anchorTopAfterToggle - anchorTopBeforeToggle;

  if (Math.abs(anchorDiff) > 1) {
    scrollContainer.scrollTop += anchorDiff;
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();

  if (targetRect.bottom > containerRect.bottom) {
    scrollContainer.scrollTop += targetRect.bottom - containerRect.bottom;
  } else if (targetRect.top < containerRect.top) {
    scrollContainer.scrollTop -= containerRect.top - targetRect.top;
  }
}