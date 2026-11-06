import { useState } from 'react'
import { proxify } from '../lib/mediaProxy'
import { useSettings } from '../lib/settings'

export function FeedIcon({ url }: { url: string }) {
  const settings = useSettings()
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <span className="feed-icon placeholder" aria-hidden="true" />
  return <img className="feed-icon" src={proxify(url, settings)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}
