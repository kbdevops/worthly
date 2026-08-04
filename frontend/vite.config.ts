import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served under a path prefix on a shared port 80 (http://<host>/worthly), so asset URLs
// in index.html must be absolute under that prefix. Overridable for a root deployment:
//   VITE_BASE=/ npm run build
const base = process.env.VITE_BASE ?? '/worthly/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // Dev server runs at the root, and the API helper prefixes requests with BASE_URL,
    // so the proxy has to accept the prefixed path too.
    proxy: {
      '/api': 'http://localhost:5050',
      '/worthly/api': {
        target: 'http://localhost:5050',
        rewrite: p => p.replace(/^\/worthly/, ''),
      },
    },
  },
})
