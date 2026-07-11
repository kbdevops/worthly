# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

NetWorth is a personal portfolio tracking dashboard — a Flask web app with a vanilla JS frontend and SQLite-backed price caching. It tracks multi-currency holdings (AUD/USD), ingests trade data from Excel or CSV, and fetches historical prices and exchange rates from Yahoo Finance.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run the app (port 5050, debug mode)
python app.py

# Or with flask CLI
flask run --port 5050 --debug
```

No linting, testing, or build tooling is configured yet.

## Architecture

### Data Ingestion Pipeline

On startup, `load_transactions()` determines the authoritative data source:

1. **Excel** (`AllTradesReport.xlsx`, "Combined" sheet) — highest priority. If newer than `transactions.json`, it's ingested.
2. **JSON** (`transactions.json`) — the canonical runtime store. Used if it exists and is current.
3. **CSV** (`all_trades.csv`) — fallback if JSON is missing or stale.

All ingestion paths normalize to the same JSON schema (date, exchange, ticker, name, action, units, price, currency, brokerage, brokerage_currency, exch_rate, value). The `value` field is always in AUD — USD trades are converted using the historical exchange rate at the trade date.

### SQLite Cache (`prices.db`)

Two tables:
- **`prices`** — `(symbol TEXT, date TEXT, close REAL)` with a composite primary key. Stores historical closing prices for every ticker plus `AUDUSD=X` exchange rates.
- **`sync_log`** — `(symbol TEXT PRIMARY KEY, last_synced TEXT, cached_from TEXT, cached_to TEXT)`. Tracks the date range cached for each symbol and enforces a 15-minute cooldown between syncs (unless `force=true`).

### Exchange Rate Handling

The system treats AUD as the base currency. All portfolio values are in AUD. For USD-denominated holdings:
- Historical exchange rates are fetched from `AUDUSD=X` via yfinance and cached in the prices table.
- Current prices for USD stocks are divided by the latest AUD/USD rate to convert to AUD.
- The fallback rate is 0.65 if no data is available.

### yfinance Symbol Mapping

`yf_symbol(ticker, exchange)` applies exchange suffixes:
- ASX → `.AX` (e.g., `VAS` → `VAS.AX`)
- LSE → `.L`
- TSX → `.TO`
- US/NASDAQ/NYSE → no suffix

### Backend API Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serves the SPA shell |
| `/api/transactions` | GET | Returns all transactions |
| `/api/transactions` | POST | Adds a transaction (auto-calculates currency, exchange rate, AUD value) |
| `/api/transactions/<idx>` | DELETE | Deletes a transaction by index |
| `/api/sync` | POST | Fetches/caches missing price data from yfinance; `?force=true` bypasses cooldown |
| `/api/performance` | GET | Returns daily timeline of portfolio value, principal, return ($ and %) |
| `/api/portfolio` | GET | Returns current holdings with cost basis, current value, P&L per holding |
| `/api/stats` | GET | Returns aggregate stats (total value, return, best/worst performer, FX rate) |

### Performance Calculation (`/api/performance`)

Builds a daily time series from the earliest transaction date to today. Price data is forward-filled (`.ffill().bfill()`) to cover weekends and holidays. Portfolio value = sum of (cumulative units × price) for each symbol, with USD prices converted to AUD. Return is calculated as `portfolio_value - cumulative_cash_flow`.

### Portfolio Cost Basis (`/api/portfolio`)

Uses average cost accounting for sells: when shares are sold, the cost basis is reduced proportionally using the average cost per share at the time of sale. Holdings with zero or near-zero units are excluded from the active list.

### Frontend

A single-page app in `templates/index.html` with three tabs:
- **Dashboard** — stat cards, net worth timeline (Chart.js line), allocation doughnut, performance bar chart
- **Holdings** — table of active positions with cost basis, market value, return, and portfolio weight
- **Transactions** — ledger with client-side filtering by ticker, action type, and market

`static/js/app.js` manages all state: it fetches from all four API endpoints, renders Chart.js instances, and handles the add-transaction modal and delete flow. `static/css/style.css` implements a dark-theme design system with CSS custom properties.