import { ElectronAPI } from '../../preload/main';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    updateProviderInitialized?: boolean;
  }
}

export {};