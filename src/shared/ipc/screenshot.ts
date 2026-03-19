import { connectRenderToMain } from './base';

/** Selection rectangle */
export interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
}

/** Screenshot settings */
export interface ScreenshotSettings {
  enabled: boolean;
  shortcut: string;
  /** Whether shortcut is enabled */
  shortcutEnabled: boolean;
  /** Empty string means use system desktop path */
  savePath: string;
  /** Whether user has rejected the FRE shortcut tutorial prompt */
  freRejected: boolean;
}

/** Window frame info (used for window detection highlighting) */
export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  id: number;
}

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  frames: WindowFrame[];
}

export type CaptureResult = {
  type: 'success';
  data: Buffer;
} | {
  type: 'fail';
  reason: string;
} | {
  type: 'cancel' | 'copied' | 'saved' | 'success-without-data';
};

export type SaveToFileResult =
  | { type: 'success'; filePath: string }
  | { type: 'fail'; error: string }
  | { type: 'cancel' };

type RenderToMain = {
  capture: {
    call: [callback?: boolean];
    return: CaptureResult;
  };
  selectionStart: {
    call: [displayId: number];
    return: void;
  };
  saveToFile: {
    call: [displayId: number, rect: SelectionRect, imageData?: Buffer];
    return: SaveToFileResult;
  };
  copyToClipboard: {
    call: [displayId: number, rect: SelectionRect];
    return: { success: boolean; error?: string };
  };
  sendToMain: {
    call: [displayId: number, rect: SelectionRect, imageData?: Buffer];
    return: void;
  };
  close: { call: []; return: void };
  getInitData: {
    call: [displayId: number];
    return: DisplayInfo;
  };
  getSettings: {
    call: [];
    return: { success: boolean; data?: ScreenshotSettings; error?: string };
  };
  updateSettings: {
    call: [settings: Partial<ScreenshotSettings>];
    return: { success: boolean; error?: string };
  };
  selectSavePath: {
    call: [];
    return: { success: boolean; data?: string | null; error?: string };
  };
  rejectFre: {
    call: [];
    return: { success: boolean; error?: string };
  };
  navigateToSettings: {
    call: [];
    return: { success: boolean; error?: string };
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('screenshot');
