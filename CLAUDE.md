# CLAUDE.md — NetWorth (Worthly)

Personal portfolio & net worth tracking dashboard. Flask backend, vanilla JS frontend, SQLite price cache, multi-currency (AUD base, USD converted). Fetches historical prices from Yahoo Finance.

## Quick Start

```bash
# Setup
pip install -r requirements.txt

# Create data files from templates (first time only)
cp data/transactions.example.json transactions.json
cp data/cash_accounts.example.json cash_accounts.json
cp data/super_holdings.example.json super_holdings.json
cp data/snapshots.example.json snapshots.json
cp data/country_overrides.example.json country_overrides.json

# Run the app
python app.py  # port 5050, debug mode
```

## Architecture

### Data files (created from .example.json templates)

| File | Purpose |
|---|---|
| `transactions.json` | Array of trade objects (buy/sell/split). Created from `.example.json` template. |
| `cash_accounts.json` | Array of cash account objects with current balances. |
| `super_holdings.json` | Array of superannuation fund allocation buckets. |
| `snapshots.json` | Monthly cash+super snapshots for net worth timeline. |
| `country_overrides.json` | Dict mapping yfinance symbols to country codes. |
| `prices.db` | SQLite cache auto-created at runtime (in `.gitignore`). |
| `holding_meta.json` | Auto-cached company metadata from yfinance — sector, industry, website. Deleted and regenerated on sync. |

### Transaction schema

```json
{
  "date": "YYYY-MM-DD",
  "exchange": "ASX|NASDAQ|NYSE|US|LSE|TSX",
  "ticker": "AAPL",
  "name": "Company or ETF name",
  "action": "buy|sell|split",
  "units": float,
  "price": float,
  "currency": "AUD|USD",
  "brokerage": float,
  "brokerage_currency": "AUD|USD",
  "exch_rate": float,
  "value": float
}
```

`value` is always in AUD. USD trades are converted using the historical exchange rate. For splits, `units` = additional shares received, `price` = 0, `value` = 0.

### Backend (`app.py`)

**Static file serving:** Put files in `static/` — served automatically by Flask.

**Key endpoints:**

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves SPA shell (`templates/index.html`) |
| `/api/transactions` | GET | All transactions enriched with current prices, gain/loss |
| `/api/transactions` | POST | Add transaction (auto-calculates currency, FX rate, AUD value) |
| `/api/transactions/<idx>` | DELETE | Delete transaction by array index |
| `/api/portfolio` | GET | Current holdings with cost basis, value, P&L, daily change, metadata |
| `/api/performance` | GET | Daily time series of portfolio value, principal, return |
| `/api/stats` | GET | Aggregate stats (total value, return, best/worst performer) |
| `/api/networth` | GET | Daily net worth = portfolio + cash + super + return |
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

**FX handling:** AUD is base currency. `AUDUSD=X` is cached as a price series. USD stock prices are divided by the AUD/USD rate. Fallback rate = 0.65.

**Portfolio cost basis:** Average cost accounting. Sells reduce cost proportionally. Splits add units without changing cost basis.

**On startup:** `load_transactions()` checks Excel → JSON → CSV priority. `seed_historical_snapshots()` loads from `snapshots.json`.

### Frontend

Single-page app with 5 tabs:
- **Dashboard** — Net worth timeline (Chart.js line), asset allocation (doughnut), monthly change (bar), per-holding performance (bar), country allocation (doughnut)
- **Holdings** — Rich cards showing each position (price, daily change, value, cost, return, weight, industry). Cash + super cards with inline-edit accounts.
- **Transactions** — Full ledger with filters (ticker, action, market). Per-transaction gain/loss. Add transaction modal.
- **Tax** — Australian CGT calculator. Select financial year, see gains/losses, 50% discount for holdings >12 months, net capital gain.
- **Data Sync** — Price cache status per symbol (Yahoo Finance + Google source indicators). Sync All button.

Active tab is persisted in `localStorage` across refreshes.

### Prices database (`prices.db`, auto-created, gitignored)

Three tables:
- `prices(symbol TEXT, date TEXT, close REAL, PRIMARY KEY(symbol, date))`
- `sync_log(symbol TEXT PRIMARY KEY, last_synced TEXT, cached_from TEXT, cached_to TEXT)`
- `snapshots(date TEXT PRIMARY KEY, super REAL, cash REAL)`

## Docker / k3s Deployment

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | (app directory) | Path where JSON data files + SQLite DB are stored |

Set `DATA_DIR` to a mounted volume to persist financial data outside the container.

### Build and run

```bash
docker build -t worthly:latest -f deploy/Dockerfile .
docker run -d -p 5050:5050 \
  -v $(pwd)/data:/app/data \
  -e DATA_DIR=/app/data \
  --name worthly \
  worthly:latest
```

On first run, the entrypoint copies `.example.json` templates into `$DATA_DIR` if the real files don't exist.

### k3s Deployment

See `deploy/k3s/k3s-deploy.yaml` for a reference manifest with PVC, Deployment (Recreate strategy), Service, and Traefik Ingress.

Key points:
- `strategy: Recreate` — avoids two pods hitting the same SQLite file
- Mount volume at `/app/data` (not `/app` — that hides the image)
- Set `DATA_DIR=/app/data` so the app reads/writes from the volume

## Port & Debug

- Default port: `5050`
- Debug mode: `True` (disable in production by editing `app.run(debug=False, host='0.0.0.0', port=5050)`)