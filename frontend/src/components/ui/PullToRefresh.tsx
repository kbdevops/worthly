import { useState, useRef, useEffect, useCallback } from 'react'
import { RefreshCw, Check } from 'lucide-react'

/**
 * Pull down at the top of the page to force a price refresh.
 *
 * Handles both input types, because they arrive as completely different events:
 * a phone swipe fires touchstart/move/end, while a trackpad two-finger scroll or
 * a mouse wheel fires only `wheel`. Listening for touch alone meant the gesture
 * silently did nothing on a desktop — no indicator, no refresh.
 *
 * The two differ in how they commit. Touch has a real release, so it waits for the
 * finger to lift past the threshold. A wheel has no release and no end event, so it
 * fires the moment the threshold is crossed and then ignores the momentum tail.
 *
 * Only arms when the scroll container is genuinely at the top, so it can never
 * swallow a normal upward scroll. The indicator tracks the gesture with a damped
 * offset and reaches full opacity at the trigger threshold, so it's clear when
 * releasing will actually do something.
 */
const THRESHOLD = 70      // px of pull needed to trigger
const MAX_PULL = 110      // px the indicator will travel
const DAMPING = 0.5       // finger travel -> indicator travel
const WHEEL_DAMPING = 0.32 // wheel deltas are coarser than finger pixels
const WHEEL_IDLE_MS = 220  // no wheel events for this long = gesture abandoned

export default function PullToRefresh({
  onRefresh,
  children,
}: {
  /** Return a short string to confirm what happened; it shows for a couple of seconds. */
  onRefresh: () => Promise<string | void>
  children: React.ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  // Without this the indicator collapses the instant the request lands and you get no
  // confirmation at all — which reads as "nothing happened", especially outside market
  // hours when no number on the page actually moves.
  const [done, setDone] = useState<string | null>(null)
  const startY = useRef<number | null>(null)
  const armed = useRef(false)

  // The page doesn't scroll the window — <main> carries overflow-auto — so checking
  // document.scrollingElement would always read 0 and arm the gesture even mid-page.
  // Walk up from whatever was touched to the nearest actually-scrollable ancestor.
  const scroller = useRef<HTMLElement | null>(null)

  const findScroller = (start: EventTarget | null): HTMLElement | null => {
    let el = start instanceof Element ? (start as HTMLElement) : null
    while (el) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el
      el = el.parentElement
    }
    return (document.scrollingElement as HTMLElement) || document.documentElement
  }

  const atTop = () => (scroller.current?.scrollTop ?? 0) <= 0

  // Held in a ref so the wheel handler can fire it without being re-created on every
  // pull change, which would detach and reattach the listener mid-gesture.
  const trigger = useRef<() => void>(() => {})

  const runRefresh = useCallback(async () => {
    setBusy(true)
    setPull(THRESHOLD)
    setDone(null)
    try {
      const msg = await onRefresh()
      setDone(typeof msg === 'string' ? msg : 'Prices updated')
    } catch {
      // The mutation surfaces its own error state; a rejected promise here must not
      // leave the spinner stuck, so still report something.
      setDone("Couldn't reach the price feed")
    } finally {
      setBusy(false)
      setPull(0)
      window.setTimeout(() => setDone(null), 2600)
    }
  }, [onRefresh])

  useEffect(() => { trigger.current = () => { if (!busy) void runRefresh() } }, [busy, runRefresh])

  const onTouchStart = useCallback((e: TouchEvent) => {
    scroller.current = findScroller(e.target)
    if (busy || !atTop()) { armed.current = false; return }
    armed.current = true
    startY.current = e.touches[0].clientY
  }, [busy])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!armed.current || startY.current == null || busy) return
    const dy = e.touches[0].clientY - startY.current
    if (dy <= 0) { setPull(0); return }
    // Scrolled away from the top mid-gesture — hand control back to the browser.
    if (!atTop()) { armed.current = false; setPull(0); return }
    setPull(Math.min(MAX_PULL, dy * DAMPING))
  }, [busy])

  const onTouchEnd = useCallback(() => {
    if (!armed.current) return
    armed.current = false
    startY.current = null
    if (pull < THRESHOLD || busy) { setPull(0); return }
    void runRefresh()
  }, [pull, busy, runRefresh])

  // --- Trackpad / mouse wheel ---------------------------------------------------
  // A wheel gesture has no start or end, so accumulate deltas while the container is
  // pinned at the top, fire as soon as the threshold is crossed, and let an idle timer
  // unwind the indicator if the user stops short.
  const wheelPull = useRef(0)
  const wheelIdle = useRef<number | undefined>(undefined)
  const wheelSpent = useRef(false)

  const onWheel = useCallback((e: WheelEvent) => {
    scroller.current = findScroller(e.target)
    if (busy) return

    // Scrolling down, or not at the top: cancel any accumulation and stay out of the way.
    if (e.deltaY >= 0 || !atTop()) {
      wheelPull.current = 0
      wheelSpent.current = false
      if (pull !== 0) setPull(0)
      return
    }

    // Momentum tail after a fire — ignore until the user actually stops scrolling.
    if (wheelSpent.current) return

    wheelPull.current = Math.min(MAX_PULL, wheelPull.current + -e.deltaY * WHEEL_DAMPING)
    setPull(wheelPull.current)

    window.clearTimeout(wheelIdle.current)
    wheelIdle.current = window.setTimeout(() => {
      wheelPull.current = 0
      wheelSpent.current = false
      setPull(0)
    }, WHEEL_IDLE_MS)

    if (wheelPull.current >= THRESHOLD) {
      wheelSpent.current = true
      wheelPull.current = 0
      window.clearTimeout(wheelIdle.current)
      trigger.current()
    }
  }, [busy, pull])

  useEffect(() => {
    // passive:false on touchmove so preventDefault is available if ever needed;
    // we deliberately don't call it, letting the browser keep native scrolling.
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('wheel', onWheel)
    }
  }, [onTouchStart, onTouchMove, onTouchEnd, onWheel])

  useEffect(() => () => window.clearTimeout(wheelIdle.current), [])

  const ready = pull >= THRESHOLD
  const visible = pull > 4 || busy || done !== null

  return (
    <div>
      <div
        aria-hidden={!visible}
        className="flex items-center justify-center gap-2 overflow-hidden transition-[height] duration-150"
        style={{
          height: visible ? Math.max(pull, busy || done ? THRESHOLD : 0) : 0,
          opacity: busy || done ? 1 : Math.min(1, pull / THRESHOLD),
        }}
      >
        {done ? (
          <Check size={16} style={{ color: 'var(--accent)' }} />
        ) : (
          <RefreshCw
            size={16}
            className={busy ? 'animate-spin' : ''}
            style={{
              color: ready || busy ? 'var(--accent)' : 'var(--text-muted)',
              transform: busy ? undefined : `rotate(${(pull / THRESHOLD) * 180}deg)`,
            }}
          />
        )}
        <span className="text-xs" style={{ color: ready || busy || done ? 'var(--accent)' : 'var(--text-muted)' }}>
          {done ?? (busy ? 'Refreshing prices…' : ready ? 'Release to refresh' : 'Pull down to refresh prices')}
        </span>
      </div>
      {children}
    </div>
  )
}
