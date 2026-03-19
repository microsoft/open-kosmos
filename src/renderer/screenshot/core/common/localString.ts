const STRINGS = {
  square: 'Square',
  circle: 'Circle',
  arrow: 'Arrow',
  draw: 'Draw',
  mosaic: 'Mosaic',
  text: 'Text',
  textDetector: 'Text Detector',
  searchImage: 'Search image with Bing',
  searchText: 'Search text with Bing',
  save: 'Save',
  undo: 'Undo',
  redo: 'Redo',
  share: 'Share',
  cancel: 'Cancel',
  copy: 'Copy',
  confirm: 'Done',
  color: 'Colors',
  size: 'Size',
  unfold: 'Unfold',
  fold: 'Fold',

  drag: 'Drag to take screenshots',
  customize: 'Customize',
  shortcut: 'Shortcut',
  copyMessage: 'Add to clipboard',
  webcaptureArea: 'Capture Web Area',
  webcaptureFull: 'Capture Full Page',
  noMoreAsk: 'Don\'t ask me again',
  notNow: 'Not now',
  enableGolbalTip1: 'Enable screenshot shortcut when Edge is in the background',
  enableGolbalTip2: 'Global Shortcut enabled',
  enableGolbalTip3: 'Now you can take screenshots when Edge is in the background',
  enable: 'Enable',
  invalidGestrue: "Invalid gesture",
  shortcutOnlyEdge: 'Use shortcut only in browser',

  'screenshot.upsell.welcome': 'Welcome to Edge Screenshot',
  'screenshot.upsell.desc': 'Capture and edit your screenshots',
  letsStart: 'Let\'s start',
  settings: 'Settings',
  shortcutConflict: 'Shortcut conflict',
  typeShortcut: 'Type a new shortcut',
  coexistAltAndCtrl: 'do not use both Alt and Ctrl',
  needModifier: 'Ctrl, Alt or Command be used',
  needALetter: 'Type a letter',
  recommended: 'Recommended',

  noTextDetected: 'no text detected',
  dragSelectArea: 'Drag to select an area',
  advancedEdit: 'Advanced Editing',
  close: 'close',
  decreaseText: 'Decrease text size',
  increaseText: 'Increase text size',
  textSize: 'Text size',
  undoSuccess: 'Undo success',
  moveCursorLeft: 'move cursor left',
  moveCursorUp: 'move cursor up',
  moveCursorRight: 'move cursor right',
  moveCursorDown: 'move cursor down',
  reachedMinimumTextSize : 'reached minimum text size',
  reachedMaximumTextSize : 'reached maximum text size',
  stamp: 'Stamp',
  numbers: 'Numbers',
  emoji: 'Emoji',
  selectText: 'Select text',
  copyAsImage: 'Copy as image',
};

type Keys = keyof (typeof STRINGS);


export function getString(key: Keys) {
  return STRINGS[key];
}

export function updateString(config: Record<Keys, any>) {
  Object.assign(STRINGS, config);
}
