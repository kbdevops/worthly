import { useState, useCallback } from 'react'

type Updater<T> = T | ((prev: T) => T)

/** State that survives a reload, keyed in localStorage.
 *
 *  Lifted out of Dashboard.tsx, where it was defined but not exported — so every other
 *  screen silently got plain useState and reset on refresh.
 *
 *  Accepts an updater function as well as a value, so it is a genuine drop-in for
 *  useState. Without that, swapping a `useState` for this one type-errors at every
 *  `set(x => !x)` call site, and the tempting fix is to rewrite those to pass a value —
 *  which quietly reintroduces the stale-closure bug the updater form exists to avoid.
 *
 *  Both sides are guarded. The read can throw on malformed JSON left by an older version
 *  of the app; the write can throw on quota, and Safari's private mode exposes a
 *  localStorage that rejects every set, where an unguarded write crashes the component
 *  on a keystroke rather than merely failing to persist.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: Updater<T>) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : initial
    } catch { return initial }
  })

  const set = useCallback((v: Updater<T>) => {
    setVal(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      try {
        // Inside the updater so it sees the value actually being committed. React may
        // run this twice in StrictMode; writing identical JSON twice is harmless.
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Not persisting is a degraded experience; throwing is a broken one.
      }
      return next
    })
  }, [key])

  return [val, set]
}
