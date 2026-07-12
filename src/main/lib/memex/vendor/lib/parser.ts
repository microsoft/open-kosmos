// VENDOR PATCH: upstream imports `gray-matter`; replaced with `js-yaml`
// (already a OpenKosmos dependency) to avoid adding a new npm dependency.
// See vendor/PATCHES.md.
// @ts-ignore - js-yaml types may not be available (matches skillManager.ts)
import * as yaml from "js-yaml";

export interface ParsedCard {
  data: Record<string, unknown>;
  content: string;
}

// Matches a leading YAML frontmatter block: `---\n<yaml>\n---` followed by the body.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): ParsedCard {
  try {
    const match = raw.match(FRONTMATTER_RE);
    if (!match) {
      // No frontmatter block — entire input is content.
      return { data: {}, content: raw };
    }
    const parsed = yaml.load(match[1]);
    const data =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { data, content: match[2] };
  } catch {
    // Frontmatter parse failed (e.g. YAML special chars like # in values).
    // Fall back: treat entire file as content with empty metadata.
    const stripped = raw.replace(/^---[\s\S]*?---\n?/, "");
    return { data: {}, content: stripped || raw };
  }
}

export function stringifyFrontmatter(
  content: string,
  data: Record<string, unknown>
): string {
  // Build YAML manually to avoid gray-matter/js-yaml block scalars (>-)
  // which break simple frontmatter parsers
  const yamlLines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const str = String(value).replace(/\n/g, " ").trim();
    if (str === "" || /[:#{}[\],&*?|>!%@`']/.test(str)) {
      yamlLines.push(`${key}: '${str.replace(/'/g, "''")}'`);
    } else {
      yamlLines.push(`${key}: ${str}`);
    }
  }
  return `---\n${yamlLines.join("\n")}\n---\n${content}`;
}

export function extractLinks(body: string): string[] {
  // Strip fenced code blocks and inline code to avoid false positives
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]+`/g, "");

  const re = /\[\[([^\]]+)\]\]/g;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    // Support Obsidian-style pipe aliases: [[target|display text]] → target
    const target = match[1].split("|")[0].trim();
    if (target) {
      links.add(target);
    }
  }
  return [...links];
}
