/**
 * Prefix an absolute API path with the app's serving base.
 *
 * The bundle is built with base=/worthly/, so the page can be served under that prefix
 * behind a shared reverse proxy. Asset URLs get rewritten by Vite automatically, but
 * fetch() calls do not — a bare '/api/x' would resolve against the ORIGIN root and miss
 * the prefix entirely, landing on whatever else owns that port. This keeps them together.
 *
 * import.meta.env.BASE_URL always has a trailing slash ('/worthly/' or '/').
 */
export function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`)
}
