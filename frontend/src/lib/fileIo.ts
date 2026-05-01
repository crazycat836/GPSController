/**
 * Browser-file helper for the import / export UI.
 *
 * The file-picker dance (`document.createElement('input'); input.type =
 * 'file'; ...`) was repeated literally in LibraryDrawer, RoutesPanel,
 * and BookmarksPanel — this module collapses it to a single utility.
 *
 * Downloads used to live here too, but every consumer now hits an
 * authenticated endpoint via `api.downloadGpx` /
 * `api.downloadBookmarksExport` / `api.downloadAllRoutes`, which build
 * their own anchor-click — see `services/api.ts:downloadAuthed`.
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
