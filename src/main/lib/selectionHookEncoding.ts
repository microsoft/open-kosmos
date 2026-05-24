/**
 * Recovers CJK text from CP437 mojibake.
 *
 * On Windows with a non-UTF-8 system locale, the selection-hook native addon
 * may return valid UTF-8 bytes that have been reinterpreted as CP437/OEM code
 * page characters. This produces strings with characteristic high-Unicode
 * codepoints (Greek letters, box-drawing characters, etc.) that are actually
 * CP437 graphic characters.
 *
 * Recovery: map each Unicode character back to its CP437 byte value using a
 * reverse lookup table, then re-decode those bytes as UTF-8.
 *
 * The previous approach using Buffer.from(text, 'binary') failed for CP437
 * characters above U+00FF (e.g. sigma=U+03C3, box-drawing U+2551) because
 * 'binary' encoding truncates to the low byte.
 */

// CP437 byte values 0x80-0xFF mapped to their Unicode codepoints
const CP437_TO_UNICODE: number[] = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
  0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba,
  0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
  0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b,
  0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
  0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229,
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248,
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
];

// Build reverse map at module load: Unicode codepoint -> CP437 byte value
const UNICODE_TO_CP437 = new Map<number, number>();
for (let i = 0; i < CP437_TO_UNICODE.length; i++) {
  UNICODE_TO_CP437.set(CP437_TO_UNICODE[i], 0x80 + i);
}

/**
 * Convert a Unicode character to its CP437 byte value.
 * Returns -1 if the character has no CP437 mapping.
 */
function charToCp437Byte(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x80) return cp; // ASCII range maps directly
  const byte = UNICODE_TO_CP437.get(cp);
  return byte !== undefined ? byte : -1;
}

/**
 * Detect whether a string looks like UTF-8 bytes misread as CP437.
 *
 * Every character must be mappable to a CP437 byte, and at least 30% of
 * characters must be in the high range (0x80-0xFF). The "all chars must map"
 * requirement avoids false positives on normal Western text that may contain
 * a few accented characters.
 */
function looksLikeCp437Mojibake(text: string): boolean {
  if (text.length === 0) return false;

  let highCount = 0;
  for (let i = 0; i < text.length; i++) {
    const byte = charToCp437Byte(text[i]);
    if (byte === -1) return false; // unmappable character — not mojibake
    if (byte >= 0x80) highCount++;
  }

  return highCount / text.length >= 0.3;
}

/**
 * Attempt to recover a UTF-8 string from CP437 mojibake.
 *
 * Returns the recovered string if recovery produces valid output,
 * otherwise returns the original text unchanged.
 */
export function recoverSelectionText(text: string): string {
  if (!text || !looksLikeCp437Mojibake(text)) {
    return text;
  }

  try {
    // Convert each character to its CP437 byte value
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const byte = charToCp437Byte(text[i]);
      if (byte === -1) return text; // safety: should not happen after detection
      bytes[i] = byte;
    }

    // Decode the raw bytes as UTF-8
    const recovered = Buffer.from(bytes).toString('utf8');

    // Validation: recovered string should not contain replacement characters
    // (U+FFFD) and should be shorter than the input (multi-byte sequences
    // collapse into single characters).
    if (recovered.includes('\uFFFD')) return text;
    if (recovered.length >= text.length) return text;

    return recovered;
  } catch {
    // Recovery failed — return original
  }

  return text;
}
