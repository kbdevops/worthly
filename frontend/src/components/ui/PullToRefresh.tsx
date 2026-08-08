import { useState, useRef, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Pull down at the top of the page to force a price refresh.
 *
 * Touch-only by design. On a desktop the browser's own scroll and the native
 * overscroll bounce make a drag gesture ambiguous, and there's a keyboard/mouse
 * refresh control anyway; on a phone this is the gesture people already expect.
 *
 * Only arms when the scroll container is genuinely at the top, so it can never
 * swallow a normal upward scroll. The indicator tracks the finger with a damped
 * offset and reaches full opacity at the trigger threshold, so it's clear when
 * releasing will actually do something.
 */
const THRESHOLD = 70      // px of pull needed to trigger
const MAX_PULL = 110      // px the indicator will travel
const DAMPING = 0.5       // finger travel -> indicator travel

export default function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>
  children: React.ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
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

  const onTouchEnd = useCallback(async () => {
    if (!armed.current) return
    armed.current = false
    startY.current = null
    if (pull < THRESHOLD || busy) { setPull(0); return }
    setBusy(true)
    setPull(THRESHOLD)
    try {
      await onRefresh()
    } catch {
      // Swallowed on purpose: the mutation surfaces its own error state, and a
      // rejected promise here would leave the spinner stuck.
    } finally {
      setBusy(false)
      setPull(0)
    }
  }, [pull, busy, onRefresh])

  useEffect(() => {
    // passive:false on touchmove so preventDefault is available if ever needed;
    // we deliberately don't call it, letting the browser keep native scrolling.
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [onTouchStart, onTouchMove, onTouchEnd])

  const ready = pull >= THRESHOLD
  const visible = pull > 4 || busy

  return (
    <div>
      <div
        aria-hidden={!visible}
        className="flex items-center justify-center gap-2 overflow-hidden transition-[height] duration-150"
        style={{
          height: visible ? Math.max(pull, busy ? THRESHOLD : 0) : 0,
          opacity: busy ? 1 : Math.min(1, pull / THRESHOLD),
        }}
      >
        <RefreshCw
          size={16}
          className={busy ? 'animate-spin' : ''}
          style={{
            color: ready || busy ? 'var(--accent)' : 'var(--text-muted)',
            transform: busy ? undefined : `rotate(${(pull / THRESHOLD) * 180}deg)`,
          }}
        />
        <span className="text-xs" style={{ color: ready || busy ? 'var(--accent)' : 'var(--text-muted)' }}>
          {busy ? 'Refreshing prices…' : ready ? 'Release to refresh' : 'Pull to refresh'}
        </span>
      </div>
      {children}
    </div>
  )
}
