import { useState, useCallback } from 'react'

/** State that survives a reload, keyed in localStorage.
 *
 *  Lifted out of Dashboard.tsx, where it was defined but not exported — so every other
 *  screen silently got plain useState and reset on refresh. That is exactly what a
 *  what-if calculator must not do: you set up a scenario, reload, and it is gone.
 *
 *  Both sides are guarded. The read can throw on malformed JSON left by an older
 *  version of the app; the write can throw on quota, and in Safari's private mode
 *  localStorage exists but rejects every set — an unguarded write there would crash the
 *  component on a keystroke rather than merely failing to persist.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : initial
    } catch { return initial }
  })

  const set = useCallback((v: T) => {
    setVal(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // Not persisting is a degraded experience; throwing is a broken one.
    }
  }, [key])

  return [val, set]
}
