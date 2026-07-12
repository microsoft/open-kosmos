/**
 * Shared parsing/validation for app-managed Python package specs. Used by both the renderer
 * (RuntimePythonPackagesRow) and the main process (pythonPackages.ts) so the two sides agree
 * on exactly which inputs are valid and how a free-form string splits into specs.
 */

/**
 * Validate a single PEP 508 package spec. Args are passed to uv as an array (no shell), so the
 * only real risk is a leading dash being parsed as a uv flag; whitespace and shell
 * metacharacters are rejected defensively. Accepts forms like `requests`, `mcp[cli]`,
 * `requests[security,socks]`, `httpx>=0.27,<1`, `ruff==0.4.2`.
 */
export function isValidPackageSpec(spec: string): boolean {
  if (!spec || spec.startsWith('-')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\-\[\],<>=!~*+]*$/.test(spec);
}

/**
 * Split a free-form input into trimmed package specs. Splits on whitespace and on top-level
 * commas that separate package names, while keeping commas inside extras (`pkg[a,b]`) and PEP
 * 508 version ranges (`httpx>=0.27,<1`) intact. A top-level comma is a separator only when it is
 * outside brackets and followed by whitespace or a package-name starter; inside `[...]` commas are kept.
 */
export function parsePackageSpecs(input: string): string[] {
  const specs: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '[') { depth++; current += ch; continue; }
    if (ch === ']') { depth = Math.max(0, depth - 1); current += ch; continue; }
    const isSep =
      depth === 0 &&
      (/\s/.test(ch) || (ch === ',' && /[\sA-Za-z0-9]/.test(input[i + 1] ?? '')));
    if (isSep) {
      if (current.trim()) specs.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) specs.push(current.trim());
  return specs;
}
