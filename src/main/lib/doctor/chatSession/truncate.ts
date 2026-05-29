/**
 * Shared truncator: keep the first 60% and last 40% of long strings, with a marker in between.
 * The marker's own length is included in the budget so the returned length is strictly ≤ maxChars.
 */

export function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;

  const omitted = text.length - maxChars;
  const marker = `…[truncated ${omitted} chars]…`;

  if (marker.length >= maxChars) return marker.slice(0, maxChars);

  const budget = maxChars - marker.length;
  const headLen = Math.floor(budget * 0.6);
  const tailLen = budget - headLen;
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : '';
  return `${head}${marker}${tail}`;
}
