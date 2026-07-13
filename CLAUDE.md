# CLAUDE.md — Worthly

Personal portfolio & net worth tracking dashboard. Flask backend, React + TypeScript + Vite frontend, single SQLite database (`prices.db`). Multi-currency (AUD base, USD converted). Fetches historical prices from Yahoo Finance.

## Quick Start

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py  # port 5050, debug mode

# Frontend dev server (separate terminal)
cd frontend && npm install && npm run dev  # port 5173, proxies /api → 5050

# Production build
cd frontend && npm run build  # outputs to frontend/dist/, served by Flask
```

## Architecture

### Database (`prices.db`, auto-created, gitignored)

Single SQLite file — all app data lives here. Tables:

| Table | Purpose |
|---|---|
| `transactions` | All buy/sell/split trades |
| `cash_accounts` | Cash account balances |
| `super_holdings` | Superannuation fund allocations |
| `country_overrides` | Manual symbol → country code mappings |
| `holding_meta` | Cached company metadata (sector, industry, logo) |
| `prices` | Daily close prices per symbol |
| `sync_log` | Last sync time and date range per symbol |
| `snapshots` | Monthly cash + super net worth snapshots |

### Transaction schema

```json
{
  "date": "YYYY-MM-DD",
  "exchange": "ASX|NASDAQ|NYSE|US|LSE|TSX",
  "ticker": "AAPL",
  "name": "Company or ETF name",
  "action": "buy|sell|split",
  "units": 10.0,
  "price": 150.0,
  "currency": "AUD|USD",
  "brokerage": 9.95,
  "brokerage_currency": "AUD|USD",
  "exch_rate": 0.65,
  "value": 2000.0
}
```

`value` is always in AUD. USD trades are converted using the historical exchange rate. For splits, `units` = additional shares received, `price` = 0, `value` = 0.

### Backend (`app.py`)

Flask app. Serves the React SPA from `frontend/dist/` in production.

**Key constants:**
- `DB_FILE` — `$DATA_DIR/prices.db`
- `DATA_DIR` — env var, defaults to app directory
- `FRONTEND_DIST` — `frontend/dist/`
- `CSV_FILE` / `EXCEL_FILE` — optional import sources for bulk transaction ingestion

**On startup:** `seed_historical_snapshots()` runs if snapshots table is empty. APScheduler starts background price sync jobs.

**Key endpoints:**

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves React SPA (`frontend/dist/index.html`) |
| `/api/transactions` | GET | All transactions enriched with current prices, gain/loss |
| `/api/transactions` | POST | Add transaction (auto-calculates FX rate, AUD value) |
| `/api/transactions/<idx>` | DELETE | Delete transaction by array index |
| `/api/portfolio` | GET | Current holdings with cost basis, value, P&L, daily change, metadata |
| `/api/performance` | GET | Daily time series of portfolio value, principal, return |
| `/api/stats` | GET | Aggregate stats (total value, return, best/worst performer) |
| `/api/networth` | GET | Daily net worth = portfolio + cash + super |
| `/api/breakdown` | GET | Current cash/super/stocks_active/stocks_passive breakdown |
| `/api/allocation` | GET | Country allocation across all asset types |
| `/api/sync` | POST | Fetch/cache missing prices + metadata from yfinance. `?force=true` to bypass cooldown |
| `/api/sync-status` | GET | Cached symbols with record counts, date ranges, metadata status |
| `/api/snapshots` | GET/POST | Cash+super monthly snapshots |
| `/api/cash-accounts` | GET/POST | CRUD for cash accounts |
| `/api/super-holdings` | GET/POST | CRUD for super holdings |
| `/api/cgt` | GET | Australian CGT calculation. Params: `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `/api/monthly-change` | GET | Month-over-month net worth change |

**yfinance symbol mapping:** ASX → `.AX`, LSE → `.L`, TSX → `.TO`, US/NASDAQ/NYSE → no suffix.

**FX handling:** AUD is base currency. `AUDUSD=X` cached as a price series. USD stock prices divided by AUD/USD rate. Fallback rate = 0.65.

**Portfolio cost basis:** Average cost accounting. Sells reduce cost proportionally. Splits add units without changing cost basis.

**Background sync (APScheduler):** Auto-syncs after market close — 06:15 UTC (ASX) and 21:15 UTC (NYSE/NASDAQ). 15-minute cooldown per symbol for manual syncs.

### Frontend (`frontend/`)

React 19 + TypeScript + Vite 8. TanStack Query v5 for server state. Recharts for all charts. Tailwind CSS v3 (dark theme). Lucide React icons. @dnd-kit for drag-to-reorder.

**Key files:**
- `src/components/tabs/Dashboard.tsx` — customisable dashboard (time range, show/hide, drag-reorder, stat card picker)
- `src/components/tabs/Holdings.tsx` — position cards
- `src/components/tabs/Transactions.tsx` — trade ledger
- `src/components/tabs/Tax.tsx` — CGT calculator
- `src/components/tabs/Sync.tsx` — price cache status
- `src/hooks/useApi.ts` — TanStack Query hooks for all endpoints
- `src/types/index.ts` — TypeScript interfaces matching API responses
- `src/lib/utils.ts` — `fmtCurrency`, `fmtPct`, `fmtCurrencySigned`

**Vite dev proxy:** `/api` → `http://localhost:5050`

**Dashboard customisation** (persisted in localStorage):
- Time range picker: 1M / 3M / 6M / 1Y / All on the net worth chart
- Line toggles: show/hide Net Worth / Portfolio / Cash / Super lines individually
- Widget visibility: show/hide any of the 5 chart widgets
- Widget order: drag to reorder via @dnd-kit
- Stat cards: pick up to 4 from 8 available metrics

**Active tab** persisted in `localStorage`.

**TypeScript notes:**
- Tooltip formatters must use `(v) => fn(v as number)` pattern (Recharts `ValueType`)
- Type-only imports use `import type { Foo }` syntax (`verbatimModuleSyntax` enabled)
- `best_performer` / `worst_performer` in Stats type are `{ ticker, gain_pct } | null`, not strings

## Docker / k3s Deployment

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | app directory | Path where `prices.db` is stored |

### Build and run

```bash
docker build -t worthly:latest -f deploy/Dockerfile .
docker run -d -p 5050:5050 \
  -v $(pwd)/prices.db:/app/prices.db \
  -e DATA_DIR=/app \
  --name worthly worthly:latest
```

Mount `prices.db` to persist all data across container restarts.

### k3s Deployment

See `deploy/k3s/k3s-deploy.yaml` — PVC, Deployment (Recreate strategy), Service, Traefik Ingress.

- `strategy: Recreate` — avoids two pods writing to the same SQLite file
- Mount volume at `/app/data`, set `DATA_DIR=/app/data`

## Port & Debug

- Default port: `5050`
- Debug mode: `True` — set `app.run(debug=False)` for production
