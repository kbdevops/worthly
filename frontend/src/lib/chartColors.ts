/**
 * The one categorical palette for every chart in the app.
 *
 * Previously this array was duplicated inside Dashboard.tsx while the net worth
 * timeline used a separate theme-derived ramp, so the same dashboard rendered two
 * unrelated colour systems. Everything that assigns a colour per category — the
 * holdings donut, every allocation widget, the timeline's series — now reads from
 * here, so a slice is the same colour wherever it appears.
 *
 * These are deliberately fixed rather than theme-derived: they identify categories,
 * and a category shouldn't change colour because the accent hue moved. Chrome that
 * *should* follow the theme (grids, axes, accents) still uses CSS custom properties.
 */
export const CHART_COLORS = [
  '#6366f1', // indigo
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
] as const

/** Colour for the nth category, cycling once the palette runs out. */
export const chartColor = (i: number): string => CHART_COLORS[i % CHART_COLORS.length]

/**
 * Fixed colours for the named series in the net worth timeline. Drawn from the
 * same palette so the timeline sits in the same visual family as the donuts
 * rather than looking like a chart from a different app.
 */
export const SERIES_COLORS: Record<string, string> = {
  'Net Worth': CHART_COLORS[0], // indigo — the headline
  'Super':     CHART_COLORS[1], // purple
  'Cash':      CHART_COLORS[2], // cyan
  'Portfolio': CHART_COLORS[3], // emerald
  'Return':    CHART_COLORS[4], // amber
}
