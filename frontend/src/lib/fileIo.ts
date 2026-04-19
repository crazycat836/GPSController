/**
 * Browser-file helpers shared by import / export UI.
 *
 * Both shapes were repeated literally in LibraryDrawer (×5),
 * RoutesPanel (×3), and BookmarksPanel — the same
 * `document.createElement('input'); input.type = 'file'; ...` dance
 * for opening a file picker and the same anchor-click pattern for
 * triggering a download.
 */

/**
 * Open a native file picker and resolve with the first selected file,
 * or ``null`` if the user cancels. The hidden input is discarded after
 * the change event so we don't leak DOM nodes.
 *
 * @param accept MIME type / extension filter passed straight to the
 *               input's ``accept`` attribute (e.g. ``".gpx,application/gpx+xml"``).
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    let settled = false
    const settle = (file: File | null) => {
      if (settled) return
      settled = true
      resolve(file)
    }
    input.onchange = () => settle(input.files?.[0] ?? null)
    // Fires when the dialog is cancelled (Chromium / Firefox only).
    input.oncancel = () => settle(null)
    input.click()
  })
}

/**
 * Trigger a browser download of *url* with the suggested *filename*.
 * Works for both ``blob:`` URLs and same-origin static URLs.
 */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
}
