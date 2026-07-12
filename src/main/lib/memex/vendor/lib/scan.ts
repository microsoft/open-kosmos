import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";

/** Recursively scan a directory for .md files, returning slug + path */
export async function scanMarkdownFiles(dir: string): Promise<{ slug: string; path: string }[]> {
  const results: { slug: string; path: string }[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push({ slug: basename(entry.name, ".md"), path: fullPath });
      }
    }
  }
  await walk(dir);
  return results;
}
