/** Small helpers for downloading and printing from the browser. */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Text that a spreadsheet could run as a formula gets a leading quote so it stays plain text. */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return ''
    const t = typeof v === 'number' ? String(v) : safe(v)
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')  // BOM: Excel reads UTF-8 correctly
}

export const downloadCsv = (rows: (string | number | null | undefined)[][], filename: string) =>
  downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename)

/** Print an HTML document in a hidden frame, so the app's own screen and print styles are not involved. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(html)
  doc.close()
  const go = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  // let images (logos) finish loading first
  if (doc.readyState === 'complete') setTimeout(go, 150)
  else frame.onload = () => setTimeout(go, 150)
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
