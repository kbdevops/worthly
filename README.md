# Worthly — Net Worth & Portfolio Dashboard

Personal net worth and portfolio tracking dashboard with multi-currency support (AUD/USD), real-time Yahoo Finance prices, and Australian CGT calculations.

Built with Flask + React (Vite + TypeScript) + SQLite. All data stored in a single `prices.db` file.

**Key features:**
- Holistic net worth — portfolio + cash + super + country allocation
- Multi-currency (AUD base, USD holdings auto-converted at historical FX rates)
- 5 tabs: Dashboard, Holdings, Tax (Australian CGT), Milestones, Data Sync
- Customisable dashboard — time range, show/hide widgets, drag-to-reorder, configurable stat cards, 5 themes
- Transactions live inside Holdings — click any holding for full trade history, per-lot gain/loss, add/delete
- Milestones tab — goals with live metric tracking (portfolio, net worth, cash, super, return) and achievements log
- All-time portfolio high tracked automatically, available as a dashboard stat card
- Yahoo Finance price cache with background auto-sync after market close
- Per-holding daily change, company metadata (sector/industry/logo)

## Quick Start

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py  # runs on port 5050
```

```bash
# Frontend (dev)
cd frontend && npm install && npm run dev  # runs on port 5173, proxies /api → 5050
```

Open `http://localhost:5173` in dev mode, or `http://localhost:5050` for the production build.

Click **Sync Prices** on the Data Sync tab to populate prices and metadata on first run.

## Production build

```bash
cd frontend && npm run build
python app.py  # serves built React from frontend/dist/
```

Open `http://localhost:5050`.

## Docker

```bash
docker build -t worthly -f deploy/Dockerfile .
docker run -d -p 5050:5050 \
  -v $(pwd)/prices.db:/app/prices.db \
  -e DATA_DIR=/app \
  --name worthly worthly
```

Mount `prices.db` to persist all data across container restarts.

## Architecture

See [CLAUDE.md](CLAUDE.md) for full API reference, data schemas, and deployment details.

