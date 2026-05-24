import { describe, it, expect } from 'vitest';
import { BROWSER_CONFIG, COMBINED_SCRIPTS } from '../browserConfig';
import type { BrowserType } from '../browserConfig';

describe('BROWSER_CONFIG', () => {
  it('has chrome and edge entries', () => {
    expect(BROWSER_CONFIG).toHaveProperty('chrome');
    expect(BROWSER_CONFIG).toHaveProperty('edge');
  });

  describe('chrome config', () => {
    const chrome = BROWSER_CONFIG.chrome;

    it('has correct exe name', () => {
      expect(chrome.exe).toBe('chrome.exe');
    });

    it('has correct display name', () => {
      expect(chrome.displayName).toBe('Google Chrome');
    });

    it('has a download URL', () => {
      expect(chrome.downloadUrl).toMatch(/^https:\/\//);
    });

    it('has native host registry path', () => {
      expect(chrome.nativeHostRegPath).toContain('NativeMessagingHosts');
    });

    it('has policy registry path', () => {
      expect(chrome.policyRegPath).toContain('ExtensionSettings');
    });

    it('has macOS bundle ID', () => {
      expect(chrome.macBundleId).toBe('com.google.Chrome');
    });

    it('has macOS app name', () => {
      expect(chrome.macAppName).toBe('Google Chrome');
    });

    it('has macOS process name', () => {
      expect(chrome.macProcessName).toBe('Google Chrome');
    });

    it('has register and unregister scripts', () => {
      expect(chrome.registerScript).toBeTruthy();
      expect(chrome.unregisterScript).toBeTruthy();
    });

    it('has native server scripts', () => {
      expect(chrome.registerNativeServerScript).toBeTruthy();
      expect(chrome.unregisterNativeServerScript).toBeTruthy();
    });

    it('has snap right script', () => {
      expect(chrome.snapRightScript).toBeTruthy();
    });

    it('has move browser to display script', () => {
      expect(chrome.moveBrowserToDisplayScript).toBeTruthy();
    });
  });

  describe('edge config', () => {
    const edge = BROWSER_CONFIG.edge;

    it('has correct exe name', () => {
      expect(edge.exe).toBe('msedge.exe');
    });

    it('has correct display name', () => {
      expect(edge.displayName).toBe('Microsoft Edge');
    });

    it('has a download URL', () => {
      expect(edge.downloadUrl).toBeTruthy();
    });

    it('has native host registry path', () => {
      expect(edge.nativeHostRegPath).toContain('NativeMessagingHosts');
    });

    it('has policy registry path', () => {
      expect(edge.policyRegPath).toContain('ExtensionSettings');
    });

    it('has macOS bundle ID', () => {
      expect(edge.macBundleId).toBe('com.microsoft.edgemac');
    });

    it('has macOS app name', () => {
      expect(edge.macAppName).toBe('Microsoft Edge');
    });

    it('has macOS process name', () => {
      expect(edge.macProcessName).toBe('Microsoft Edge');
    });
  });

  describe('BrowserType', () => {
    it('keys are chrome and edge', () => {
      const keys = Object.keys(BROWSER_CONFIG) as BrowserType[];
      expect(keys).toContain('chrome');
      expect(keys).toContain('edge');
      expect(keys.length).toBe(2);
    });
  });
});

describe('COMBINED_SCRIPTS', () => {
  it('has registerAll script', () => {
    expect(COMBINED_SCRIPTS.registerAll).toBeTruthy();
    expect(COMBINED_SCRIPTS.registerAll).toContain('register');
  });

  it('has unregisterAll script', () => {
    expect(COMBINED_SCRIPTS.unregisterAll).toBeTruthy();
    expect(COMBINED_SCRIPTS.unregisterAll).toContain('unregister');
  });

  it('has registerNativeServerAll script', () => {
    expect(COMBINED_SCRIPTS.registerNativeServerAll).toBeTruthy();
  });

  it('has unregisterNativeServerAll script', () => {
    expect(COMBINED_SCRIPTS.unregisterNativeServerAll).toBeTruthy();
  });

  it('has macOS register-all script', () => {
    expect(COMBINED_SCRIPTS.registerAllMac).toMatch(/\.sh$/);
  });

  it('has macOS unregister-all script', () => {
    expect(COMBINED_SCRIPTS.unregisterAllMac).toMatch(/\.sh$/);
  });
});
