/**
 * YAML Front Matter parsing utility
 * Supports key: value, key: "value", and multi-line > (folded) and | (literal) syntax
 */

export interface FrontMatter {
  [key: string]: string
}

export interface ParsedMarkdown {
  frontMatter: FrontMatter | null
  content: string
}

/**
 * Parse YAML front matter from a Markdown file
 * Supports:
 * - Single-line key: value
 * - Quoted key: "value" or key: 'value'
 * - Folded multi-line key: > (newlines become spaces)
 * - Literal multi-line key: | (newlines preserved)
 * - >- and |- variants
 */
export const parseFrontMatter = (content: string): ParsedMarkdown => {
  const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/
  const match = content.match(frontMatterRegex)

  if (!match) {
    return { frontMatter: null, content }
  }

  const yamlContent = match[1]
  const remainingContent = content.slice(match[0].length)

  const frontMatter: FrontMatter = {}
  const lines = yamlContent.split('\n')

  let currentKey: string | null = null
  let multiLineMode: '>' | '|' | null = null
  let multiLineLines: string[] = []

  const flushMultiLine = () => {
    if (currentKey && multiLineMode && multiLineLines.length > 0) {
      if (multiLineMode === '>') {
        // Folded block scalar: newlines become spaces
        frontMatter[currentKey] = multiLineLines.join(' ').trim()
      } else {
        // Literal block scalar: preserve newlines
        frontMatter[currentKey] = multiLineLines.join('\n').trim()
      }
    }
    currentKey = null
    multiLineMode = null
    multiLineLines = []
  }

  for (const line of lines) {
    // Check if this is a continuation line (starts with whitespace) for multi-line values
    if (multiLineMode && (line.startsWith('  ') || line.startsWith('\t'))) {
      multiLineLines.push(line.trim())
      continue
    }

    // If we were collecting multi-line content, flush it
    if (multiLineMode) {
      flushMultiLine()
    }

    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue

    const colonIndex = trimmedLine.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmedLine.slice(0, colonIndex).trim()
    let value = trimmedLine.slice(colonIndex + 1).trim()

    if (!key) continue

    // Check for multi-line indicators
    if (value === '>' || value === '>-') {
      currentKey = key
      multiLineMode = '>'
      multiLineLines = []
      continue
    }
    if (value === '|' || value === '|-') {
      currentKey = key
      multiLineMode = '|'
      multiLineLines = []
      continue
    }

    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    frontMatter[key] = value
  }

  // Flush any remaining multi-line content
  flushMultiLine()

  return { frontMatter, content: remainingContent }
}
