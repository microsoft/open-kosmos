#!/usr/bin/env node
import path from 'path';
import { COMMAND_NAME } from './constant';
import { colorText, registerWithElevatedPermissions, writeNodePathFile } from './utils';

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log(colorText(`Registering ${COMMAND_NAME} Native Messaging host...`, 'blue'));

  try {
    // Write Node.js path before registration
    writeNodePathFile(path.join(__dirname, '..'));

    await registerWithElevatedPermissions();
    console.log(
      colorText('Registration successful! The Chrome extension can now communicate with the local service via Native Messaging.', 'green'),
    );
  } catch (error: any) {
    console.error(colorText(`Registration failed: ${error.message}`, 'red'));
    process.exit(1);
  }
}

// Run main function
main();
