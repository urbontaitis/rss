import { useCallback, useEffect, useRef, useState } from 'react'
import { dataStore } from './store'

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const { revision } = dataStore.use()
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loaderRef.current()
      .then((value) => {
        if (cancelled) return
        setData(value)
        setError('')
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [...deps, tick, revision])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, error, loading, reload }
}

export function useHotkeys(map: Record<string, (event: KeyboardEvent) => void>, deps: unknown[]) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const action = map[event.key]
      if (action) {
        event.preventDefault()
        action(event)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, deps)
}
