# CLAUDE.md — NetWorth (Worthly)

Personal portfolio & net worth tracking dashboard. Flask backend, vanilla JS frontend, SQLite price cache, multi-currency (AUD base, USD converted). Fetches historical prices from Yahoo Finance.

## Quick Start

```bash
# Setup
pip install -r requirements.txt

# Create data files from templates (first time only)
cp transactions.example.json transactions.json
cp cash_accounts.example.json cash_accounts.json
cp super_holdings.example.json super_holdings.json
cp snapshots.example.json snapshots.json
cp country_overrides.example.json country_overrides.json

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

### Dockerfile (create alongside app.py)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5050
CMD ["python", "app.py"]
```

### Build and run

```bash
docker build -t worthly:latest .
docker run -d -p 5050:5050 \
  -v $(pwd)/transactions.json:/app/transactions.json \
  -v $(pwd)/cash_accounts.json:/app/cash_accounts.json \
  -v $(pwd)/super_holdings.json:/app/super_holdings.json \
  -v $(pwd)/snapshots.json:/app/snapshots.json \
  -v $(pwd)/country_overrides.json:/app/country_overrides.json \
  -v $(pwd)/prices.db:/app/prices.db \
  -v $(pwd)/holding_meta.json:/app/holding_meta.json \
  --name worthly \
  worthly:latest
```

### k3s Deployment

For k3s, mount the data files as a PersistentVolume or ConfigMap (for small JSONs) and use a PVC for `prices.db`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worthly
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worthly
  template:
    metadata:
      labels:
        app: worthly
    spec:
      containers:
        - name: worthly
          image: worthly:latest
          ports:
            - containerPort: 5050
          volumeMounts:
            - name: data
              mountPath: /app/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: worthly-data
```

### First deploy

On first deploy, copy the `.example.json` files to the mounted volume to use as starting templates. The app will create `prices.db` and `holding_meta.json` automatically. Click "Sync All" on the Data Sync tab to populate prices and metadata from Yahoo Finance.

### Ingress (optional)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: worthly
spec:
  rules:
    - host: worthly.home
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: worthly
                port:
                  number: 5050
```

## Port & Debug

- Default port: `5050`
- Debug mode: `True` (disable in production by editing `app.run(debug=False, host='0.0.0.0', port=5050)`)