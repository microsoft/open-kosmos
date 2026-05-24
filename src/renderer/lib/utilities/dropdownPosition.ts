export interface AnchoredDropdownPosition {
  top: number;
  left: number;
  triggerTop: number;
  triggerBottom?: number;
  triggerRight: number;
}

export interface ContextMenuPosition {
  top: number;
  left: number;
}

export interface DropdownSizeEstimate {
  estimatedWidth: number;
  estimatedHeight: number;
}

interface AnchoredDropdownOptions {
  estimatedWidth?: number;
  estimatedHeight?: number;
  offset?: number;
  padding?: number;
}

interface ContextMenuOptions {
  estimatedWidth?: number;
  estimatedHeight?: number;
  padding?: number;
}

export const ANCHORED_DROPDOWN_SIZE_PRESETS = {
  agentMenu: { estimatedWidth: 240, estimatedHeight: 220 },
  workspaceMenu: { estimatedWidth: 220, estimatedHeight: 188 },
  editAgentMenu: { estimatedWidth: 240, estimatedHeight: 152 },
  attachMenu: { estimatedWidth: 220, estimatedHeight: 96 },
  chatSessionMenu: { estimatedWidth: 180, estimatedHeight: 152 },
  scheduledChatSessionMenu: { estimatedWidth: 180, estimatedHeight: 80 },
  mcpServerMenu: { estimatedWidth: 220, estimatedHeight: 220 },
  mcpAddMenu: { estimatedWidth: 220, estimatedHeight: 120 },
  skillsAddMenu: { estimatedWidth: 220, estimatedHeight: 80 },
  skillMenu: { estimatedWidth: 220, estimatedHeight: 80 },
  subAgentsAddMenu: { estimatedWidth: 220, estimatedHeight: 80 },
  subAgentMenu: { estimatedWidth: 240, estimatedHeight: 120 },
  tagFilterMenu: { estimatedWidth: 180, estimatedHeight: 240 },
} satisfies Record<string, DropdownSizeEstimate>;

export const CONTEXT_MENU_SIZE_PRESETS = {
  imageGalleryMenu: { estimatedWidth: 180, estimatedHeight: 120 },
  fileTreeNodeMenu: { estimatedWidth: 220, estimatedHeight: 240 },
} satisfies Record<string, DropdownSizeEstimate>;

export function getAnchoredDropdownPosition(
  buttonElement: HTMLElement,
  options: AnchoredDropdownOptions = {},
): AnchoredDropdownPosition {
  const {
    estimatedWidth = 200,
    estimatedHeight = 120,
    offset = 4,
    padding = 8,
  } = options;

  const rect = buttonElement.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let left = rect.right - estimatedWidth;
  left = Math.min(left, windowWidth - estimatedWidth - padding);
  left = Math.max(padding, left);

  let top = rect.bottom + offset;
  if (top + estimatedHeight > windowHeight - padding) {
    top = rect.top - estimatedHeight - offset;
  }
  top = Math.max(padding, top);

  return {
    top,
    left,
    triggerTop: rect.top,
    triggerBottom: rect.bottom,
    triggerRight: rect.right,
  };
}

export function getContextMenuPosition(
  clientX: number,
  clientY: number,
  options: ContextMenuOptions = {},
): ContextMenuPosition {
  const {
    estimatedWidth = 200,
    estimatedHeight = 120,
    padding = 8,
  } = options;

  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let left = clientX;
  let top = clientY;

  if (left + estimatedWidth > windowWidth - padding) {
    left = windowWidth - estimatedWidth - padding;
  }

  if (top + estimatedHeight > windowHeight - padding) {
    top = windowHeight - estimatedHeight - padding;
  }

  left = Math.max(padding, left);
  top = Math.max(padding, top);

  return { top, left };
}

export function adjustAnchoredDropdownToViewport(
  element: HTMLElement,
  position: AnchoredDropdownPosition,
  padding = 10,
  offset = 4,
): void {
  const rect = element.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const triggerBottom = position.triggerBottom ?? position.triggerTop;

  const nextLeft = Math.min(
    Math.max(padding, position.triggerRight - rect.width),
    Math.max(padding, windowWidth - rect.width - padding),
  );
  element.style.left = `${nextLeft}px`;

  const fitsBelow = triggerBottom + offset + rect.height <= windowHeight - padding;
  const fitsAbove = position.triggerTop - offset - rect.height >= padding;
  const isCurrentlyAbove = position.top < position.triggerTop;

  let nextTop = position.top;

  if (isCurrentlyAbove && fitsBelow) {
    nextTop = triggerBottom + offset;
  } else if (!isCurrentlyAbove && !fitsBelow && fitsAbove) {
    nextTop = position.triggerTop - rect.height - offset;
  } else if (rect.bottom > windowHeight - padding) {
    nextTop = Math.max(padding, windowHeight - rect.height - padding);
  }

  if (rect.top < padding) {
    nextTop = padding;
  }

  element.style.top = `${Math.max(padding, nextTop)}px`;
}

export function clampMenuToViewport(
  element: HTMLElement,
  padding = 10,
): void {
  const rect = element.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  if (rect.right > windowWidth - padding) {
    const nextLeft = windowWidth - rect.width - padding;
    element.style.left = `${Math.max(padding, nextLeft)}px`;
  }

  if (rect.bottom > windowHeight - padding) {
    const nextTop = windowHeight - rect.height - padding;
    element.style.top = `${Math.max(padding, nextTop)}px`;
  }

  if (rect.left < padding) {
    element.style.left = `${padding}px`;
  }

  if (rect.top < padding) {
    element.style.top = `${padding}px`;
  }
}