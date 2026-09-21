import clsx from 'clsx'
import { useToasts } from '../store/toast'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            'pointer-events-auto rounded-ctl px-4 py-3 text-left text-sm shadow-lg',
            t.kind === 'success' ? 'bg-ink text-white' : 'bg-brick-600 text-white',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}
