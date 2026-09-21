import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { CheckCircle2, Download, FileArchive, FileJson, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, Card, ErrorNote, PageHeader } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { downloadBlob } from '../lib/files'
import type { ImportResult } from '../lib/types'
import { toast } from '../store/toast'

/** Errors from a blob download arrive as a Blob; read the JSON message out of it. */
async function blobMessage(e: unknown): Promise<string> {
  if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
    try { const j = JSON.parse(await e.response.data.text()); if (typeof j.detail === 'string') return j.detail } catch { /* fall through */ }
  }
  return errorMessage(e)
}

export default function DataExport() {
  const qc = useQueryClient()
  const [includeSales, setIncludeSales] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const exportData = useMutation({
    mutationFn: async (format: 'zip' | 'json') => {
      const res = await api.get<Blob>('/data/export', { params: { format, include_sales: includeSales }, responseType: 'blob' })
      downloadBlob(res.data, `vapepos-export-${new Date().toISOString().slice(0, 10)}.${format}`)
    },
    onSuccess: () => toast.success('Export downloaded'),
    onError: async (e) => toast.error(await blobMessage(e)),
  })

  const importData = useMutation({
    mutationFn: async () => {
      const body = new FormData()
      body.append('file', file!)
      return (await api.post<ImportResult>('/data/import', body)).data
    },
    onSuccess: (r) => {
      setResult(r); setImportError(''); setFile(null); setConfirmed(false)
      if (fileRef.current) fileRef.current.value = ''
      qc.invalidateQueries()  // every screen may have changed
      toast.success('Import finished')
    },
    onError: (e) => { setResult(null); setImportError(errorMessage(e)) },
  })

  const count = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${v} ${k}`).join(', ')

  return (
    <>
      <PageHeader title="Data Export & Import" subtitle="Export or import your POS data for backup or migration." />
      <Card className="mb-5 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-mint-600" size={20} />
          <div>
            <h2 className="text-base font-semibold">Data portability</h2>
            <p className="mt-1 text-sm text-ink-soft">Your export contains:</p>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
              <li className="flex items-center gap-2"><FileSpreadsheet size={15} className="text-currant-600" /> Products, categories, discounts, branches and stock levels</li>
              <li className="flex items-center gap-2"><FileSpreadsheet size={15} className="text-mint-600" /> Sales history and staff list (for your records)</li>
              <li className="flex items-center gap-2"><FileJson size={15} className="text-amber-700" /> Business settings and receipt design</li>
            </ul>
            <p className="mt-2 text-xs text-ink-muted">Passwords are never exported. Sales history and staff are not re-imported.</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Download size={17} /> Export data</h2>
          <p className="mt-1 text-sm text-ink-muted">Download a ZIP with one file per table (open the .csv files in Excel) plus a complete data.json.</p>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[#46307E]" checked={includeSales} onChange={(e) => setIncludeSales(e.target.checked)} />
            Include sales history
          </label>
          <p className="mt-1 text-xs text-ink-muted">Untick this if the export is very large. Files over 4 MB cannot be imported again.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => exportData.mutate('zip')} disabled={exportData.isPending}><FileArchive size={16} /> {exportData.isPending ? 'Preparing...' : 'Export Data (ZIP)'}</Button>
            <Button variant="secondary" onClick={() => exportData.mutate('json')} disabled={exportData.isPending}><FileJson size={16} /> JSON only</Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Upload size={17} /> Import data</h2>
          <p className="mt-1 text-sm text-ink-muted">Choose a file made by &ldquo;Export data&rdquo; (ZIP or JSON). It is <strong>merged</strong> into your current data. Nothing is deleted.</p>
          <input
            ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" aria-label="Choose export file"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setImportError('') }}
            className="mt-4 block w-full text-sm file:mr-3 file:rounded-ctl file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-paper"
          />
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#46307E]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>Existing products, branches, discounts and stock counts with the same barcode or code will be <strong>updated</strong> to match the file. Export your current data first if you want to keep it.</span>
          </label>
          <div className="mt-4">
            <Button onClick={() => importData.mutate()} disabled={!file || !confirmed || importData.isPending}><Upload size={16} /> {importData.isPending ? 'Importing...' : 'Import Data'}</Button>
          </div>
          {importError && <div className="mt-4"><ErrorNote>{importError}</ErrorNote></div>}
          {result && (
            <div className="mt-4 space-y-2 rounded-ctl border border-moss-700/20 bg-moss-100 p-3 text-sm" role="status">
              <p className="flex items-center gap-2 font-medium text-moss-700"><CheckCircle2 size={16} /> Import complete</p>
              {Object.keys(result.created).length > 0 && <p>Added: {count(result.created)}</p>}
              {Object.keys(result.updated).length > 0 && <p>Updated: {count(result.updated)}</p>}
              {Object.keys(result.created).length + Object.keys(result.updated).length === 0 && <p>The file had nothing to import.</p>}
              {result.skipped.length > 0 && (
                <details className="text-amber-700"><summary className="cursor-pointer">{result.skipped.length} row(s) skipped</summary>
                  <ul className="mt-1 list-disc pl-5">{result.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
