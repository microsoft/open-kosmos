import * as fs from 'fs';

export function selectMostRecentLogFile(files: string[]): string {
  return files
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))[0].file;
}
