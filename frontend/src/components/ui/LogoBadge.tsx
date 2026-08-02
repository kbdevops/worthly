import { useState } from 'react'

function tickerColor(ticker: string): string {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6']
  let h = 0
  for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
}

export function LogoBadge({
  logoUrl,
  ticker,
  size = 28,
  color,
  solid = false,
}: {
  logoUrl: string
  ticker: string
  size?: number
  color?: string
  solid?: boolean
}) {
  const [showFallback, setShowFallback] = useState(!logoUrl)
  const c = color ?? tickerColor(ticker)
  const label = ticker.replace('.AX', '').slice(0, 3)

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: solid ? 'rgba(255,255,255,0.92)' : `${c}22`,
        border: solid ? 'none' : `1.5px solid ${c}55`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {showFallback ? (
        <span style={{ fontSize: size * 0.32, fontWeight: 700, color: solid ? c : c, letterSpacing: '-0.02em' }}>
          {label}
        </span>
      ) : (
        <img
          src={logoUrl}
          alt=""
          style={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain', borderRadius: '50%' }}
          onLoad={e => { if (e.currentTarget.naturalWidth <= 16) setShowFallback(true) }}
          onError={() => setShowFallback(true)}
        />
      )}
    </div>
  )
}
