/**
 * Jest global test setup
 * This file is referenced by setupFilesAfterEnv in jest.config.js
 */

// Extend Jest timeout (some tests may be slow)
jest.setTimeout(30_000);

// Global mock: prevent accidental Electron API calls in tests
jest.mock(
  'electron',
  () => ({
    app: {
      getPath: jest.fn(() => '/tmp/test'),
      setPath: jest.fn(),
      getName: jest.fn(() => 'openkosmos-test'),
      getVersion: jest.fn(() => '0.0.0-test'),
      isReady: jest.fn(() => true),
      whenReady: jest.fn(() => Promise.resolve()),
    },
    ipcMain: {
      handle: jest.fn(),
      on: jest.fn(),
      removeHandler: jest.fn(),
    },
    ipcRenderer: {
      invoke: jest.fn(),
      on: jest.fn(),
      send: jest.fn(),
    },
    BrowserWindow: jest.fn().mockImplementation(() => ({
      loadURL: jest.fn(),
      loadFile: jest.fn(),
      webContents: {
        send: jest.fn(),
        on: jest.fn(),
      },
      on: jest.fn(),
      show: jest.fn(),
      close: jest.fn(),
    })),
    dialog: {
      showOpenDialog: jest.fn(),
      showSaveDialog: jest.fn(),
      showMessageBox: jest.fn(),
    },
  }),
  { virtual: true },
);
