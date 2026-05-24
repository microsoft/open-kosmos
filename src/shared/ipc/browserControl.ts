import { connectRenderToMain } from './base';

export type BrowserType = 'chrome' | 'edge';
export type BrowserControlResult<T = void> = { success: true; data?: T } | { success: false; error: string };

export interface InstallState {
  isInstalling: boolean;
  phase: string;
  progress: number;
  error: string;
}

export interface UpdateState {
  isUpdating: boolean;
  phase: string;
  progress: number;
  error: string;
  localVersion: string;
  remoteVersion: string;
}

export type BrowserControlMode = 'extension' | 'cdp';

type RenderToMain = {
  getSettings: {
    call: [];
    return: BrowserControlResult<{ browser: BrowserType; mode?: BrowserControlMode }>;
  };
  updateSettings: {
    call: [settings: { browser?: BrowserType; mode?: BrowserControlMode }];
    return: BrowserControlResult;
  };
  enable: {
    call: [];
    return: BrowserControlResult;
  };
  disable: {
    call: [];
    return: BrowserControlResult;
  };
  getStatus: {
    call: [];
    return: BrowserControlResult<{ enabled: boolean }>;
  };
  getInstallStatus: {
    call: [];
    return: { success: true; data: InstallState };
  };
  getUpdateStatus: {
    call: [];
    return: { success: true; data: UpdateState };
  };
  launchWithSnap: {
    call: [];
    return: BrowserControlResult;
  };
  respondBrowserInstallConfirm: {
    call: [requestId: string, confirmed: boolean];
    return: void;
  };
  respondNativeServerDownloadConfirm: {
    call: [requestId: string, confirmed: boolean];
    return: void;
  };
  respondBrowserRestartConfirm: {
    call: [requestId: string, confirmed: boolean];
    return: void;
  };
  checkNativeServerUpdate: {
    call: [];
    return: BrowserControlResult<{ localVersion: string; remoteVersion: string | null; needsUpdate: boolean }>;
  };
  updateNativeServer: {
    call: [];
    return: BrowserControlResult;
  };
  reinstallExtension: {
    call: [];
    return: BrowserControlResult;
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('browserControl');
