/** Wording shared by the header Sync button and the pull-to-refresh gesture, so the
 *  same action never reports itself two different ways. */
export interface RefreshResult {
  ok: boolean
  symbols_refreshed: number
  symbols_total: number
  market_active: boolean
}

export const refreshMessage = (r: RefreshResult): string =>
  r.market_active
    ? `Prices updated · ${r.symbols_refreshed}/${r.symbols_total} symbols`
    // Worth saying explicitly: outside a session the refresh genuinely worked, there
    // just isn't a newer price to show. Silence here reads as a failure.
    : `Market closed · showing last close (${r.symbols_refreshed}/${r.symbols_total})`

/** "just now" / "4m ago" / "3h ago" / "12 Aug" — how stale the prices on screen are. */
export function relativeAge(iso: string | null | undefined): string | null {
  if (!iso) return null
  // Server timestamps are naive UTC; without the Z, browsers read them as local time
  // and a fresh sync shows as hours old (or negative).
  const t = Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(t)) return null
  const mins = Math.floor((Date.now() - t) / 60_000)
  if (mins < 0) return 'just now'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
