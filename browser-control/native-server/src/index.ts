#!/usr/bin/env node
import serverInstance from './server';
import nativeMessagingHostInstance from './native-messaging-host';
import { browserConfig } from './config/browser-config';
import { notifyServerDown } from './kosmos-notifier';

console.error('[NativeServer] Starting Native Server...');

// Load browser configuration at startup
console.error('[NativeServer] Loading browser configuration...');
browserConfig.load();
console.error(`[NativeServer] Current browser config: ${browserConfig.getBrowser()}`);

try {
  console.error('[NativeServer] Setting up server and native host...');
  serverInstance.setNativeHost(nativeMessagingHostInstance); // Server needs setNativeHost method
  nativeMessagingHostInstance.setServer(serverInstance); // NativeHost needs setServer method
  console.error('[NativeServer] Starting native messaging host listener...');
  nativeMessagingHostInstance.start();
  console.error('[NativeServer] Native Server ready, waiting for messages...');
} catch (error) {
  console.error('[NativeServer] Failed to start:', error);
  process.exit(1);
}

process.on('error', (error) => {
  process.exit(1);
});

// Handle process signals and uncaught exceptions
process.on('SIGINT', () => {
  notifyServerDown('signal').finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  notifyServerDown('signal').finally(() => process.exit(0));
});

process.on('exit', (code) => {
});

process.on('uncaughtException', (error) => {
  notifyServerDown('error').finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  // Don't exit immediately, let the program continue running
});
