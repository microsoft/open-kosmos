// Matches an existing URL scheme such as "file://", "http://", "https://", "data:".
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
// Matches a Windows absolute path with a drive letter, e.g. "C:\foo" or "C:/foo".
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;

/**
 * Convert a local filesystem path into a `file://` URL suitable for use as an
 * `<img src>` / `<iframe src>` in the renderer.
 *
 * Renderers run on an http(s) origin, so a bare path like `/foo/bar.png` would
 * resolve against that origin and 404. Image viewers that only clear their
 * loading state on `onLoad` then hang forever. Always go through this helper.
 *
 * Cross-platform rules:
 * - POSIX absolute paths (`/Users/x/a.png`) → `file:///Users/x/a.png` (the path
 *   already starts with `/`, so the host is empty and we get three slashes).
 * - Windows drive paths (`C:\x\a.png`) → backslashes become forward slashes and
 *   the URL needs an empty host: `file:///C:/x/a.png` (three slashes). A two-slash
 *   `file://C:/...` would treat the drive letter as a hostname and fail to load.
 * - Inputs that already carry a URL scheme (`file://`, `http(s)://`, `data:`) are
 *   returned unchanged so we never double-prefix.
 *
 * @param filePath A bare filesystem path or an already-scheme'd URL.
 * @returns A loadable URL.
 */
export function buildLocalFileUrl(filePath: string): string {
  // Check the Windows drive pattern FIRST: a drive letter like "C:" also matches
  // the generic URL-scheme regex, so scheme detection must not run before this.
  if (WINDOWS_DRIVE_RE.test(filePath)) {
    // Normalize backslashes and add an empty host (three slashes total).
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }

  if (URL_SCHEME_RE.test(filePath)) {
    return filePath;
  }

  // POSIX absolute path already starts with "/", yielding three slashes.
  return `file://${filePath}`;
}
