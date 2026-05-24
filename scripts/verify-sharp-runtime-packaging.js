#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
};

function getArchName(arch) {
  if (typeof arch === 'string') {
    return arch;
  }

  return ARCH_NAMES[arch] || String(arch);
}

function assertExists(filePath, missingPaths) {
  if (!fs.existsSync(filePath)) {
    missingPaths.push(filePath);
  }
}

exports.default = async function verifySharpRuntimePackaging(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const archName = getArchName(context.arch);
  if (!['x64', 'arm64'].includes(archName)) {
    return;
  }

  console.log(`[afterPack] Verifying sharp runtime packaging for win32-${archName} (raw arch: ${String(context.arch)})`);

  const unpackedNodeModulesDir = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules'
  );

  const sharpLoaderPackage = path.join(unpackedNodeModulesDir, 'sharp', 'package.json');
  const sharpRuntimeDir = path.join(unpackedNodeModulesDir, '@img', `sharp-win32-${archName}`);
  const sharpLibDir = path.join(sharpRuntimeDir, 'lib');
  const sharpBinary = path.join(sharpLibDir, `sharp-win32-${archName}.node`);
  const sharpLibvipsDll = path.join(sharpLibDir, 'libvips-42.dll');
  const sharpCppDll = path.join(sharpLibDir, 'libvips-cpp-8.17.3.dll');

  const missingPaths = [];
  assertExists(sharpLoaderPackage, missingPaths);
  assertExists(sharpRuntimeDir, missingPaths);
  assertExists(sharpBinary, missingPaths);
  assertExists(sharpLibvipsDll, missingPaths);
  assertExists(sharpCppDll, missingPaths);

  if (missingPaths.length > 0) {
    throw new Error(
      [
        `[afterPack] sharp runtime packaging is incomplete for win32-${archName}.`,
        'The packaged app is missing one or more unpacked sharp runtime files:',
        ...missingPaths.map(filePath => `- ${filePath}`),
        '',
        `Expected runtime package: @img/sharp-win32-${archName}`,
        'Ensure the target-specific sharp optional dependency is installed before building.',
      ].join('\n')
    );
  }
};