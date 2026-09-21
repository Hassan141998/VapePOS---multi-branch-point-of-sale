import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_URL } from '../lib/api'
import { useAuth } from '../store/auth'
import { useLive } from '../store/live'

/** Which cached queries are stale when the server announces a change. */
const INVALIDATE: Record<string, string[]> = {
  'sale.created': ['dashboard', 'sales', 'zreport', 'reports'],
  'inventory.changed': ['inventory', 'dashboard'],
  'transfer.updated': ['transfers'],
  'product.updated': ['products', 'inventory', 'categories'],
  'branch.updated': ['branches'],
  'zreport.closed': ['zreport'],
  'category.updated': ['categories', 'products', 'inventory', 'discounts'],
  'discount.updated': ['discounts'],
  'settings.updated': ['settings'],
}

/** VITE_REALTIME=poll: no WebSocket, just refresh what is on screen every 10 seconds (for hosts without WebSockets). */
const POLL = import.meta.env.VITE_REALTIME === 'poll'

/**
 * Keeps one WebSocket open while signed in. When another till sells something or a
 * transfer changes state, the matching queries are refetched, so every screen stays current.
 */
export function useRealtime() {
  const token = useAuth((s) => s.token)
  const qc = useQueryClient()
  const setStatus = useLive((s) => s.set)

  useEffect(() => {
    if (!token) return

    if (POLL) {
      setStatus('polling')
      const timer = setInterval(() => {
        if (document.visibilityState === 'visible') qc.invalidateQueries() // refetches only what is on screen
      }, 10000)
      return () => { clearInterval(timer); setStatus('offline') }
    }

    let socket: WebSocket | null = null
    let retry = 0
    let stopped = false
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const base = API_URL ? API_URL.replace(/^http/, 'ws') : `${proto}://${location.host}`
      socket = new WebSocket(`${base}/api/v1/ws?token=${encodeURIComponent(token)}`)
      socket.onopen = () => {
        retry = 0
        setStatus('live')
        pingTimer = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25000)
      }
      socket.onmessage = (msg) => {
        if (msg.data === 'pong') return
        try {
          const event = JSON.parse(msg.data) as { type: string }
          for (const key of INVALIDATE[event.type] ?? []) qc.invalidateQueries({ queryKey: [key] })
        } catch {
          /* ignore malformed frames */
        }
      }
      socket.onclose = () => {
        clearInterval(pingTimer)
        setStatus('offline')
        if (stopped) return
        // Reconnect with backoff (1s, 2s, 4s ... max 15s), then refresh everything we missed.
        retryTimer = setTimeout(() => {
          retry += 1
          connect()
          qc.invalidateQueries()
        }, Math.min(15000, 1000 * 2 ** retry))
      }
    }
    connect()
    return () => {
      stopped = true
      clearInterval(pingTimer)
      clearTimeout(retryTimer)
      socket?.close()
      setStatus('offline')
    }
  }, [token, qc, setStatus])
}
