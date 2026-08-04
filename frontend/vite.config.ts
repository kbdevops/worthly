import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev serves at the root (localhost:5173) exactly as before. Only the production
// BUILD gets the /worthly/ prefix, because that bundle is served under a path on a
// shared port 80. Setting base globally moved the dev app to /worthly/ too, which
// broke local development.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : (process.env.VITE_BASE ?? '/worthly/'),
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
    },
  },
}))
