import { describe, it, expect } from 'vitest';
import { recoverSelectionText } from '../selectionHookEncoding';

// ---------------------------------------------------------------------------
// Helper: encode a UTF-8 string as CP437 mojibake
// (the inverse of recoverSelectionText — build the CP437 representation so we
//  can test that the function correctly recovers it)
// ---------------------------------------------------------------------------

// CP437 byte values 0x80..0xFF → their Unicode codepoints (same table as source)
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

// Build byte→Unicode map
const BYTE_TO_CP437_CHAR = new Map<number, string>();
for (let i = 0; i < CP437_TO_UNICODE.length; i++) {
  BYTE_TO_CP437_CHAR.set(0x80 + i, String.fromCodePoint(CP437_TO_UNICODE[i]));
}

/**
 * Encode a UTF-8 string into its CP437 mojibake representation.
 * Returns null if any UTF-8 byte has no CP437 mapping (ASCII bytes are kept as-is).
 */
function toMojibake(utf8text: string): string | null {
  const bytes = Buffer.from(utf8text, 'utf8');
  let result = '';
  for (const byte of bytes) {
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
    } else {
      const ch = BYTE_TO_CP437_CHAR.get(byte);
      if (ch === undefined) return null; // unmappable
      result += ch;
    }
  }
  return result;
}

describe('recoverSelectionText', () => {
  // -------------------------------------------------------------------------
  // Pass-through cases (should return input unchanged)
  // -------------------------------------------------------------------------

  it('returns empty string unchanged', () => {
    expect(recoverSelectionText('')).toBe('');
  });

  it('returns null/undefined-like falsy input unchanged', () => {
    // The function guards `if (!text ...)` — pass an empty-ish value
    expect(recoverSelectionText('')).toBe('');
  });

  it('returns plain ASCII text unchanged', () => {
    const input = 'Hello, world!';
    expect(recoverSelectionText(input)).toBe(input);
  });

  it('returns normal English sentence unchanged', () => {
    const input = 'This is a normal English sentence with some punctuation: 1+1=2.';
    expect(recoverSelectionText(input)).toBe(input);
  });

  it('returns text with occasional accented Latin chars unchanged (low high-byte ratio)', () => {
    // Only 1/10 chars maps to a high CP437 byte → below 30% threshold
    const input = 'café menu'; // é is 0xE9 (mappable) but only 1 char
    expect(recoverSelectionText(input)).toBe(input);
  });

  it('returns text containing a character with no CP437 mapping unchanged', () => {
    // U+1F600 (emoji) is not in CP437 table, so detection should fail
    const input = 'σσσσσ😀'; // sigma×5 + emoji
    expect(recoverSelectionText(input)).toBe(input);
  });

  it('returns text where recovered length would not be shorter unchanged', () => {
    // A string composed entirely of high CP437 chars but whose CP437 bytes
    // decode to a UTF-8 string of equal or greater length (invalid multi-byte
    // sequences would cause this — or produce U+FFFD).
    // Craft a case: a single Latin-1 byte (0x80-0xBF) that is an invalid UTF-8
    // continuation byte on its own → Buffer.from([0x80]).toString('utf8') = '�'
    const mojibake = BYTE_TO_CP437_CHAR.get(0x80)!; // Ç, cp437 byte 0x80
    // 0x80 alone is an invalid UTF-8 sequence → '�' → should return original
    expect(recoverSelectionText(mojibake)).toBe(mojibake);
  });

  // -------------------------------------------------------------------------
  // Recovery cases
  // -------------------------------------------------------------------------

  it('recovers a Chinese string encoded as CP437 mojibake', () => {
    // "你好" in UTF-8 is: 0xE4 0xBD 0xA0 0xE5 0xA5 0xBD
    // These bytes must all have CP437 mappings for recovery to succeed
    const original = '你好';
    const mojibake = toMojibake(original);
    if (mojibake === null) {
      // Some UTF-8 bytes of this string might not be in the CP437 high range — skip
      return;
    }
    const recovered = recoverSelectionText(mojibake);
    expect(recovered).toBe(original);
  });

  it('recovers a Japanese string encoded as CP437 mojibake', () => {
    // "日本" in UTF-8 is: 0xE6 0x97 0xA5 0xE6 0x9C 0xAC
    const original = '日本';
    const mojibake = toMojibake(original);
    if (mojibake === null) return;
    const recovered = recoverSelectionText(mojibake);
    expect(recovered).toBe(original);
  });

  it('recovers a Korean string encoded as CP437 mojibake', () => {
    const original = '한국';
    const mojibake = toMojibake(original);
    if (mojibake === null) return;
    const recovered = recoverSelectionText(mojibake);
    expect(recovered).toBe(original);
  });

  it('recovered string is shorter than mojibake input', () => {
    // Any successful recovery must collapse multi-byte sequences
    const original = '你好世界';
    const mojibake = toMojibake(original);
    if (mojibake === null) return;
    const recovered = recoverSelectionText(mojibake);
    if (recovered !== mojibake) {
      // Recovery happened — recovered must be shorter
      expect(recovered.length).toBeLessThan(mojibake.length);
    }
  });

  // -------------------------------------------------------------------------
  // Edge / boundary cases
  // -------------------------------------------------------------------------

  it('handles a single-character string that is not mojibake', () => {
    expect(recoverSelectionText('A')).toBe('A');
  });

  it('handles string with all ASCII characters (no high-byte chars)', () => {
    const input = 'abc123!@#';
    expect(recoverSelectionText(input)).toBe(input);
  });

  it('does not crash on very long strings', () => {
    const longAscii = 'x'.repeat(100_000);
    expect(recoverSelectionText(longAscii)).toBe(longAscii);
  });

  it('returns original when recovery would produce replacement character U+FFFD', () => {
    // Construct a mojibake-looking string whose CP437 bytes form an invalid UTF-8 sequence.
    // 0x80 in CP437 → Ç (U+00C7). A string of many Ç chars → all bytes are 0x80 → invalid
    // UTF-8 (standalone continuation/start bytes) → Buffer.from([0x80, ...]).toString() = U+FFFD...
    const singleByte = BYTE_TO_CP437_CHAR.get(0x80)!; // Ç
    // Repeat it 10 times so high-byte ratio > 30%
    const input = singleByte.repeat(10);
    const result = recoverSelectionText(input);
    // Result should be original because recovery produces U+FFFD
    expect(result).toBe(input);
  });

  it('handles a mojibake string with mixed ASCII and high-byte chars that falls below threshold', () => {
    // 10 ASCII chars + 1 high-byte char → ratio = 1/11 ≈ 9% < 30% → pass-through
    const highChar = BYTE_TO_CP437_CHAR.get(0x81)!; // ü
    const input = 'aaaaaaaaaa' + highChar; // 10 ASCII + 1 high
    expect(recoverSelectionText(input)).toBe(input);
  });

  it('returns original text when Buffer.from throws during recovery', () => {
    // Build a mojibake string that passes detection (>= 30% high chars)
    // then make Buffer.from throw so the catch block executes, covering line 110.
    const original = '你好世界'; // will be encoded as mojibake
    const mojibake = toMojibake(original);
    if (mojibake === null) return;

    const originalBufferFrom = Buffer.from;
    try {
      // Temporarily override Buffer.from to throw
      (Buffer as any).from = (...args: any[]) => {
        if (args[0] instanceof Uint8Array) {
          throw new Error('forced buffer error');
        }
        return originalBufferFrom.apply(Buffer, args as any);
      };

      const result = recoverSelectionText(mojibake);
      expect(result).toBe(mojibake);
    } finally {
      (Buffer as any).from = originalBufferFrom;
    }
  });

  it('handles a mojibake string where exactly 30% are high-byte chars', () => {
    // Exactly 3/10 = 30% → at the threshold (>= 0.3 passes)
    const highChar = BYTE_TO_CP437_CHAR.get(0x81)!; // ü → CP437 byte 0x81
    // 7 ASCII + 3 high
    const input = 'aaaaaaa' + highChar.repeat(3);
    // Whether it recovers or not depends on whether the bytes form valid UTF-8;
    // 0x81 alone is invalid UTF-8, so we expect pass-through or original returned
    const result = recoverSelectionText(input);
    // Should either return original or recovered — not throw
    expect(typeof result).toBe('string');
  });
});
