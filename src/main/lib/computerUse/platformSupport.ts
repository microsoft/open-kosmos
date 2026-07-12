export interface ComputerUsePlatformSupport {
  platform: NodeJS.Platform;
  arch: string;
  platformSupported: boolean;
  unsupportedReason?: string;
}

const WINDOWS_ARM64_UNSUPPORTED_REASON =
  'Computer Use is unavailable on Windows ARM64 because the current native input driver does not ship a Windows ARM64 addon.';

export function getComputerUseUnsupportedReason(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === 'win32' && arch === 'arm64') {
    return WINDOWS_ARM64_UNSUPPORTED_REASON;
  }
  return null;
}

export function isComputerUsePlatformSupported(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  return getComputerUseUnsupportedReason(platform, arch) === null;
}

export function getComputerUsePlatformSupport(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ComputerUsePlatformSupport {
  const unsupportedReason = getComputerUseUnsupportedReason(platform, arch);
  return {
    platform,
    arch,
    platformSupported: unsupportedReason === null,
    ...(unsupportedReason ? { unsupportedReason } : {}),
  };
}
