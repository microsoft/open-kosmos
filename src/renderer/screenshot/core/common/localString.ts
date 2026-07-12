import { DEFAULT_UI_LANGUAGE, translate, type TranslationKey, type UiLanguage } from '@/lib/i18n';
import { appDataManager } from '@/lib/userData/appDataManager';

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
  renderRect: 'render rect',
  renderArrow: 'render arrow',
  renderEllipse: 'render ellipse',
};

type Keys = keyof (typeof STRINGS);
let activeLanguage: UiLanguage | null = null;

const STRING_TRANSLATION_KEYS = {
  square: 'screenshot.local.square',
  circle: 'screenshot.local.circle',
  arrow: 'screenshot.local.arrow',
  draw: 'screenshot.local.draw',
  mosaic: 'screenshot.local.mosaic',
  text: 'screenshot.local.text',
  textDetector: 'screenshot.local.textDetector',
  searchImage: 'screenshot.local.searchImage',
  searchText: 'screenshot.local.searchText',
  save: 'screenshot.local.save',
  undo: 'screenshot.local.undo',
  redo: 'screenshot.local.redo',
  share: 'screenshot.local.share',
  cancel: 'screenshot.local.cancel',
  copy: 'screenshot.local.copy',
  confirm: 'screenshot.local.confirm',
  color: 'screenshot.local.color',
  size: 'screenshot.local.size',
  unfold: 'screenshot.local.unfold',
  fold: 'screenshot.local.fold',
  drag: 'screenshot.local.drag',
  customize: 'screenshot.local.customize',
  shortcut: 'screenshot.local.shortcut',
  copyMessage: 'screenshot.local.copyMessage',
  webcaptureArea: 'screenshot.local.webcaptureArea',
  webcaptureFull: 'screenshot.local.webcaptureFull',
  noMoreAsk: 'screenshot.local.noMoreAsk',
  notNow: 'screenshot.local.notNow',
  enableGolbalTip1: 'screenshot.local.enableGlobalTip1',
  enableGolbalTip2: 'screenshot.local.enableGlobalTip2',
  enableGolbalTip3: 'screenshot.local.enableGlobalTip3',
  enable: 'screenshot.local.enable',
  invalidGestrue: 'screenshot.local.invalidGesture',
  shortcutOnlyEdge: 'screenshot.local.shortcutOnlyEdge',
  'screenshot.upsell.welcome': 'screenshot.local.upsellWelcome',
  'screenshot.upsell.desc': 'screenshot.local.upsellDescription',
  letsStart: 'screenshot.local.letsStart',
  settings: 'screenshot.local.settings',
  shortcutConflict: 'screenshot.local.shortcutConflict',
  typeShortcut: 'screenshot.local.typeShortcut',
  coexistAltAndCtrl: 'screenshot.local.coexistAltAndCtrl',
  needModifier: 'screenshot.local.needModifier',
  needALetter: 'screenshot.local.needALetter',
  recommended: 'screenshot.local.recommended',
  noTextDetected: 'screenshot.local.noTextDetected',
  dragSelectArea: 'screenshot.local.dragSelectArea',
  advancedEdit: 'screenshot.local.advancedEdit',
  close: 'screenshot.local.close',
  decreaseText: 'screenshot.local.decreaseText',
  increaseText: 'screenshot.local.increaseText',
  textSize: 'screenshot.local.textSize',
  undoSuccess: 'screenshot.local.undoSuccess',
  moveCursorLeft: 'screenshot.local.moveCursorLeft',
  moveCursorUp: 'screenshot.local.moveCursorUp',
  moveCursorRight: 'screenshot.local.moveCursorRight',
  moveCursorDown: 'screenshot.local.moveCursorDown',
  reachedMinimumTextSize: 'screenshot.local.reachedMinimumTextSize',
  reachedMaximumTextSize: 'screenshot.local.reachedMaximumTextSize',
  stamp: 'screenshot.local.stamp',
  numbers: 'screenshot.local.numbers',
  emoji: 'screenshot.local.emoji',
  selectText: 'screenshot.local.selectText',
  copyAsImage: 'screenshot.local.copyAsImage',
  renderRect: 'screenshot.editor.renderRect',
  renderArrow: 'screenshot.editor.renderArrow',
  renderEllipse: 'screenshot.editor.renderEllipse',
} satisfies Record<Keys, TranslationKey>;

function getCurrentLanguage(): UiLanguage {
  if (activeLanguage) {
    return activeLanguage;
  }

  const language = appDataManager.getConfig().uiLanguage;
  return language === 'en' || language === 'zh-CN' ? language : DEFAULT_UI_LANGUAGE;
}

export function setScreenshotStringLanguage(language: UiLanguage | null) {
  activeLanguage = language;
}

export function getString(key: Keys) {
  /* v8 ignore next -- translate() always returns the catalog value or the truthy key string. */
  return translate(getCurrentLanguage(), STRING_TRANSLATION_KEYS[key]) || STRINGS[key];
}

export function updateString(config: Partial<Record<Keys, string>>) {
  Object.assign(STRINGS, config);
}
