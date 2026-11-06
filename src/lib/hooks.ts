import { useCallback, useEffect, useRef, useState } from 'react'
import { dataStore } from './store'

export interface AsyncState<T> {
  data: T | undefined
  error: string
  loading: boolean
  reload: () => void
}

export function useAsync<T>(loader: () => Promise<T>, key: string | number = ''): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const { revision } = dataStore.use()
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })

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
  }, [key, tick, revision])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, error, loading, reload }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
}

export function useHotkeys(map: Record<string, (event: KeyboardEvent) => void>): void {
  const mapRef = useRef(map)

  useEffect(() => {
    mapRef.current = map
  })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      const action = mapRef.current[event.key]
      if (!action) return
      event.preventDefault()
      action(event)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
