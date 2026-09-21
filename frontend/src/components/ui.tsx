import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react'
import { statusLabel } from '../lib/format'

/* ---------- Buttons ---------- */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-currant-600 text-white hover:bg-currant-700 disabled:bg-ink-muted/40',
  secondary: 'bg-white text-ink border border-line hover:bg-paper disabled:text-ink-muted/60',
  danger: 'bg-brick-600 text-white hover:bg-brick-600/90 disabled:bg-ink-muted/40',
  ghost: 'text-ink-soft hover:bg-ink/5 disabled:text-ink-muted/50',
}
export function Button({
  variant = 'primary', size = 'md', className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-ctl font-medium transition-colors',
        size === 'sm' && 'px-2.5 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-3 text-base',
        variants[variant],
        className,
      )}
    />
  )
}

/* ---------- Form controls ---------- */
const control =
  'w-full rounded-ctl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 focus:border-currant-500 disabled:bg-paper disabled:text-ink-muted'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={clsx(control, className)} />
}
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={clsx(control, 'pr-8', className)}>{children}</select>
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={clsx(control, 'min-h-[72px]', className)} />
}
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}

/* ---------- Layout pieces ---------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('rounded-panel border border-line bg-white', className)}>{children}</section>
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-lg font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">{children}</p>}
    </div>
  )
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-sm text-ink-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-currant-500 border-t-transparent" />
      {label}
    </div>
  )
}
export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-ctl border border-brick-600/30 bg-brick-100 px-3 py-2 text-sm text-brick-600">{children}</div>
}

/* ---------- Badges ---------- */
export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'amber' | 'red' | 'green' | 'purple'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-ink/5 text-ink-soft',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-brick-100 text-brick-600',
    green: 'bg-moss-100 text-moss-700',
    purple: 'bg-currant-50 text-currant-700',
  }
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
}
export function StatusPill({ status }: { status: string }) {
  const tone = status === 'received' ? 'green' : status === 'in_transit' ? 'purple' : status === 'cancelled' ? 'red' : 'amber'
  return <Pill tone={tone}>{statusLabel[status] ?? status}</Pill>
}

/* ---------- Modal ---------- */
export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-panel bg-white shadow-xl sm:rounded-panel', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-ctl p-1.5 text-ink-muted hover:bg-paper"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/* ---------- Table helpers ---------- */
export const th = 'px-4 py-2.5 text-left text-sm font-medium text-ink-muted whitespace-nowrap'
export const td = 'px-4 py-3 text-sm align-middle'
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full border-collapse">{children}</table></div>
}
