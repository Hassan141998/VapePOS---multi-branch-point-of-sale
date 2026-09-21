import clsx from 'clsx'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Input } from './ui'

/** On/off switch. */
export function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <div className="text-sm font-medium text-ink-soft">{label}</div>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      </div>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-currant-600' : 'bg-ink-muted/40')}
      >
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  )
}

/** Slider with its current value shown on the right. */
export function RangeField({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-sm font-medium text-ink-soft">
        {label}<span className="text-xs font-normal text-ink-muted">{value}{unit}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#46307E]"
      />
    </label>
  )
}

/** Segmented tabs. */
export function Tabs<T extends string>({ value, onChange, tabs, className }: {
  value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[]; className?: string
}) {
  return (
    <div role="tablist" className={clsx('inline-flex w-full rounded-ctl border border-line bg-paper p-0.5', className)}>
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" type="button" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={clsx('flex-1 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors', value === t.id ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <span className="flex items-center gap-2 rounded-ctl border border-line bg-white px-2 py-1.5">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="text-sm text-ink-muted">{value.toUpperCase()}</span>
      </span>
    </label>
  )
}

/**
 * Whole-number box that can be emptied while typing (so "clear, then type 3" gives 3, not 13),
 * keeps the value inside min..max, and snaps back to the last valid number when you leave it.
 */
export function NumberInput({ value, min, max, onValue, ...rest }: {
  value: number; min: number; max: number; onValue: (n: number) => void
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'min' | 'max' | 'type'>) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(value))) }, [value])
  return (
    <Input
      {...rest} type="number" inputMode="numeric" min={min} max={max} value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Math.round(Number(e.target.value))
        if (e.target.value !== '' && Number.isFinite(n)) onValue(Math.min(max, Math.max(min, n)))
      }}
      onBlur={() => setText(String(value))}
    />
  )
}
