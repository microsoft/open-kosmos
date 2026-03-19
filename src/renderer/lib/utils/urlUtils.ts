/**
 * URL utilities for CDN requests
 * Adds cache-busting timestamp to ensure fresh data from CDN
 */

/**
 * Appends a timestamp query parameter to a URL to bypass CDN caching
 * @param url - The original URL
 * @returns URL with timestamp parameter appended
 */
export function appendCacheBustingTimestamp(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}timestamp=${Date.now()}`;
}
