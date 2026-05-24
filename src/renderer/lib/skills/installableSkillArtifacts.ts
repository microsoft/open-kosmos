export function isInstallableSkillArtifact(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const lowerPath = normalizedPath.toLowerCase();
  const fileName = normalizedPath.split('/').pop()?.toLowerCase() || '';

  return lowerPath.endsWith('.skill')
    || lowerPath.endsWith('.zip')
    || fileName === 'skill.md';
}