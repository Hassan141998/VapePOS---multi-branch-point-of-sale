import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner } from '../components/ui'
import { useSettings } from '../hooks/queries'
import { api, API_URL, errorMessage } from '../lib/api'
import { formatMoney } from '../lib/format'
import type { BusinessSettings } from '../lib/types'
import { useAuth } from '../store/auth'
import { useLive } from '../store/live'
import { toast } from '../store/toast'

const CURRENCIES: [string, string][] = [
  ['PKR', 'Pakistani Rupee'], ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'], ['INR', 'Indian Rupee'],
  ['AED', 'UAE Dirham'], ['SAR', 'Saudi Riyal'], ['CAD', 'Canadian Dollar'], ['AUD', 'Australian Dollar'], ['JPY', 'Japanese Yen'],
  ['CNY', 'Chinese Yuan'], ['TRY', 'Turkish Lira'], ['EGP', 'Egyptian Pound'], ['NGN', 'Nigerian Naira'], ['ZAR', 'South African Rand'],
  ['BRL', 'Brazilian Real'], ['MXN', 'Mexican Peso'], ['BDT', 'Bangladeshi Taka'], ['LKR', 'Sri Lankan Rupee'], ['MYR', 'Malaysian Ringgit'],
  ['SGD', 'Singapore Dollar'], ['KES', 'Kenyan Shilling'],
]

export default function SystemSettings() {
  const qc = useQueryClient()
  const me = useAuth((s) => s.user)!
  const live = useLive((s) => s.status)
  const { business, timezone, isLoading } = useSettings()
  const [draft, setDraft] = useState<BusinessSettings | null>(null)
  const [otherCode, setOtherCode] = useState(false)
  const [error, setError] = useState('')

  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get<{ status: string }>('/health')).data,
    retry: 0,
  })

  const d = draft ?? business
  const set = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => setDraft({ ...d, [k]: v })
  const known = CURRENCIES.some(([c]) => c === d.currency)
  const custom = otherCode || !known

  const save = useMutation({
    mutationFn: async () => (await api.put<BusinessSettings>('/settings/business', {
      business_name: d.business_name.trim(), email: d.email?.trim() || null, website: d.website?.trim() || null,
      currency: d.currency.trim().toUpperCase(), currency_symbol: d.currency_symbol?.trim() || null,
    })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setDraft(null); setError(''); toast.success('Settings saved') },
    onError: (e) => setError(errorMessage(e)),
  })

  if (isLoading) return <Spinner />

  return (
    <>
      <PageHeader title="System Settings" subtitle="Your shop's profile and currency." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5">
          <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
            {error && <ErrorNote>{error}</ErrorNote>}
            <h2 className="text-base font-semibold">Business</h2>
            <Field label="Business name"><Input required maxLength={100} value={d.business_name} onChange={(e) => set('business_name', e.target.value)} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email (optional)"><Input type="email" maxLength={120} value={d.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label="Website (optional)"><Input maxLength={200} value={d.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="www.mystore.com" /></Field>
            </div>

            <h2 className="pt-2 text-base font-semibold">Currency</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Currency">
                <Select
                  value={custom ? 'OTHER' : d.currency}
                  onChange={(e) => { if (e.target.value === 'OTHER') setOtherCode(true); else { setOtherCode(false); setDraft({ ...d, currency: e.target.value, currency_symbol: null }) } }}  // a new currency starts with its own symbol
                >
                  {CURRENCIES.map(([c, name]) => <option key={c} value={c}>{c} - {name}</option>)}
                  <option value="OTHER">Other...</option>
                </Select>
              </Field>
              {custom && (
                <Field label="Currency code" hint="Three letters, e.g. QAR.">
                  <Input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" value={d.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
                </Field>
              )}
              <Field label="Symbol (optional)" hint="Leave empty to use the standard symbol (Rs for rupees).">
                <Input maxLength={5} value={d.currency_symbol ?? ''} onChange={(e) => set('currency_symbol', e.target.value)} />
              </Field>
            </div>
            <p className="rounded-ctl bg-paper px-3 py-2 text-sm">Example: <strong>{formatMoney(1234.5, d.currency, d.currency_symbol)}</strong></p>

            <div className="flex justify-end">
              <Button type="submit" disabled={!draft || save.isPending}><Save size={15} /> {save.isPending ? 'Saving...' : 'Save settings'}</Button>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-base font-semibold">System</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['API', health.isLoading ? 'Checking...' : health.data?.status === 'ok' ? 'Online' : 'Not reachable'],
              ['API address', API_URL || 'Same address as this website'],
              ['Updates', live === 'live' ? 'Live' : live === 'polling' ? 'Refresh every 10 seconds' : 'Connecting'],
              ['Business timezone', timezone || '-'],
              ['Signed in as', `${me.full_name || me.username} (${me.role})`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
                <dt className="text-ink-muted">{k}</dt><dd className="break-all text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-ink-muted">
            The business timezone decides what counts as &ldquo;today&rdquo; in reports and end-of-day. It is set on the server (BUSINESS_TIMEZONE).
          </p>
        </Card>
      </div>
    </>
  )
}
