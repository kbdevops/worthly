# Worthly

**Self-hosted net worth & portfolio dashboard** - multi-currency (AUD/USD), live Yahoo Finance prices, Australian CGT calculations, and dividend/franking tracking. Your data, your server, no third party ever sees it.

<!--
  Badge row - the build badge only works once this repo has run at least one
  GitHub Actions workflow on `main`. Swap kbdevops/worthly if the repo moves.
-->
[![Build](https://github.com/kbdevops/worthly/actions/workflows/build.yaml/badge.svg)](https://github.com/kbdevops/worthly/actions)
![Python](https://img.shields.io/badge/python-3.11+-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![License](https://img.shields.io/badge/license-MIT-green)

<!-- TODO: hero screenshot/GIF of the Dashboard tab goes here once available -->

## Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Docker](#docker)
- [Configuration](#configuration)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

## Features

### Dashboard
Customisable, drag-to-reorder widgets - net worth timeline, allocation breakdown, holding performance, monthly change - with 5 color themes and configurable stat cards.


https://github.com/user-attachments/assets/20a55c36-7ff1-4dfc-9372-7152c5b91541


### Holdings
Every position with full transaction history. Click into any holding for per-lot gain/loss, add or delete trades, sector/industry metadata pulled automatically.


https://github.com/user-attachments/assets/4f616609-4616-4ae5-aed5-ec00434e08ca


### Tax (Australian CGT)
CGT calculations with the 50% long-term discount applied automatically, per-parcel breakdown, optimal sell-date suggestions.


https://github.com/user-attachments/assets/853394db-8440-473b-99b4-e870e13940a2


### Dividends
Full dividend history auto-fetched from Yahoo Finance, sized by the units you actually held on each ex-dividend date. Tracks Australian franking credits (manually entered - no feed publishes these) and US treaty withholding tax automatically, with net and grossed-up totals.

### Milestones
Goals that track live app data - pick one metric or combine several (e.g. Cash + Portfolio), set a target in AUD or USD (USD targets convert to their live AUD equivalent every time you open the app, so progress moves with the exchange rate). Plus an achievements log for past milestones.


https://github.com/user-attachments/assets/60ecbf40-c88f-4a89-9565-d526a927afcb



### Compounder
Long-run growth view: monthly net worth history, Australian FY annual snapshots (Jul-Jun) with per-year growth, and a CAGR calculator you can point at any two months or jump to a financial year with one click.

Returns under a year are reported as plain cumulative growth rather than annualised - annualising a short period produces numbers that are arithmetically true and completely meaningless (a 3% move over two days annualises to roughly 25,000%).

### Data Sync
Background sync runs automatically twice a day (after ASX and NYSE/NASDAQ close). The Sync tab surfaces real health - per-symbol errors, staleness warnings, last-run results - instead of a black box.

#### How prices stay current

Three layers, deliberately arranged so there's no yfinance traffic when nobody's using the app:

| Layer | When | What it does |
|---|---|---|
| **Full sync** | 06:15 UTC (after ASX close) and 21:15 UTC (after US close) | Fetches full daily history, holding metadata, dividends |
| **Scheduled intraday** | Every 5 min, extended hours only (`INTRADAY_REFRESH_MINUTES`) | Overwrites today's price so the cache never goes cold |
| **On-demand refresh** | Whenever `/api/portfolio` is read and prices are stale (`LIVE_REFRESH_SECONDS`, default 60s) | Kicks a background refresh; this is what actually makes the app feel live |

The on-demand layer is the important one. A scheduler can only ever be as fresh as its
interval, so opening the app used to show prices up to 15 minutes old. Now the frontend's
60-second poll of `/api/portfolio` triggers a refresh when the cache is stale, so simply
having the page open keeps it current. It's fire-and-forget: a refresh of ~11 symbols takes
about a second, but the request returns immediately with what's in the database and the next
poll picks up the newer numbers. Requests are never blocked on a network fetch.

**Trading windows** (UTC, weekdays only - approximate, and holidays aren't modelled; on a
non-trading day yfinance simply returns nothing and the refresh is a no-op):

- **ASX** 21:00-06:10 - pre-open auction through close
- **US** 08:00-00:00 - pre-market from 04:00 ET through after-hours to 20:00 ET

Refreshing gates on *extended* hours, not just the regular session. Gating on regular
sessions alone meant US pre-market and after-hours moves never reached the database until
the next full sync, even though the Pre/After Market card reads those quotes live.

To force a refresh regardless of staleness or market hours:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:5050/api/prices/refresh
```

**On genuinely live streaming:** this is polling, not a stream. Sub-second updates would
need a WebSocket feed pushed to the browser over SSE, which is a real piece of work in a
single-worker Flask app (persistent connections, reconnect handling). Polling gets you to
"a few seconds stale when you look at it", which is the right trade for a portfolio tracker.

### Brokerage import (Interactive Brokers)
Connect an IBKR **Flex Web Service** token and query ID once, then pull trade executions straight in. Partial fills within the same minute are merged into a single trade, AUD conversion uses IBKR's own reported FX rate, and newly-imported tickers trigger a price sync automatically.

Imports are idempotent - each trade carries a deterministic external id, so re-syncing updates in place instead of duplicating. Trades that look like ones you'd already entered by hand are flagged as **duplicate warnings** for you to review; nothing is ever auto-deleted. The Flex token is write-only: no API route ever returns it.


https://github.com/user-attachments/assets/13b2fe3e-f030-4dd5-9aa8-e191eaeb1847


---

## Quick Start

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py   # runs on port 5050
```

```bash
# Frontend (separate terminal, dev mode with hot reload)
cd frontend
npm install
npm run dev     # runs on port 5173, proxies /api → 5050
```

Open **http://localhost:5173** in dev mode (or **http://localhost:5050** if you've built the frontend for production - see below).

On first run, go to the **Data Sync** tab and click **Sync All** to populate prices and metadata for your holdings.

### Production build

```bash
cd frontend && npm run build   # outputs to frontend/dist/
cd .. && python app.py         # serves the built frontend directly
```

## Docker

```bash
docker build -t worthly -f deploy/Dockerfile .
docker run -d -p 5050:5050 \
  -v worthly-data:/app/data \
  -e DATA_DIR=/app/data \
  --name worthly worthly
```

Mount a volume at `DATA_DIR` (defaults to the app directory if unset) - this is where `prices.db`, your transaction history, and everything else lives. Without a persistent volume, all data is lost when the container is recreated.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DATA_DIR` | app directory | Where `prices.db` and CSV/Excel imports live |
| `JWT_SECRET_KEY` | `dev-only-insecure-change-me` | Signs session tokens. **Set this to a random value in any real deployment.** |
| `ALLOWED_HOSTS` | _(unset - any host)_ | Comma-separated hostnames this instance will answer to. Anything else gets a bare 404. See below. |
| `LIVE_REFRESH_SECONDS` | `60` | Minimum gap between demand-driven price refreshes. Lower = fresher and more yfinance calls; `0` refreshes on every poll. |
| `INTRADAY_REFRESH_MINUTES` | `5` | Scheduled intraday interval during extended hours. This is only a floor - freshness comes from the on-demand refresh. |

If `DATA_DIR` is unset the app falls back to the repo directory and will happily create an empty `prices.db` there - if the UI shows no holdings after a restart, check you're pointing at the right directory.

### Restricting which hostnames are served

By default the app answers to *any* `Host` header. That is what local dev and LAN access rely
on, since both arrive by bare IP - but on an internet-facing deployment it means the app is
served at your raw public IP as well as at whatever DNS name you put in front of it. Pointing
a name (DuckDNS or otherwise) at the box does not replace the IP URL, it just adds an alias;
the IP keeps working until something checks the hostname.

`ALLOWED_HOSTS` is that check:

```bash
ALLOWED_HOSTS=worthly.example.duckdns.org
```

Requests for any other hostname - including the bare public IP - get `404 {"error": "not found"}`,
which reveals nothing about what is running. `localhost` and `127.0.0.1` are always allowed so
container health checks keep working.

Two things to watch:

- **It matches hostnames, not ports.** `name` covers `name:80` and `name:5050`.
- **Bare-IP access on the LAN breaks too.** If you also reach the app at `http://192.168.1.50:30080`,
  add that IP to the list: `ALLOWED_HOSTS=worthly.example.duckdns.org,192.168.1.50`.

This is enforced in the app, so it holds regardless of what the ingress in front of it does.
Restricting the Traefik router with a `Host(...)` rule as well is worth doing - see
[CLAUDE.md](CLAUDE.md) - but an app-level check survives an ingress that gets bypassed or
misconfigured.

### Authentication

Worthly ships with email/password login (JWT-based); every API route requires a valid token, and all data is scoped per user. Passwords are stored hashed.

That said, the threat model is still "runs somewhere you already trust" - a home network, a VPN, or behind your own reverse proxy. If you expose it to the public internet, set `JWT_SECRET_KEY`, terminate TLS in front of it, and consider an additional auth layer (Traefik, Tailscale, OAuth2 Proxy).

## Tech Stack

- **Backend**: Flask, SQLite, `yfinance`, APScheduler (for the twice-daily background price sync), `flask-jwt-extended`, `requests` (IBKR Flex Web Service)
- **Frontend**: React 19 + TypeScript + Vite, Tailwind, Recharts, `@dnd-kit` (drag-to-reorder widgets)
- **Data**: everything lives in a single `prices.db` SQLite file - no external database to run
- **Theming**: OKLCH colour tokens driven by four CSS seed variables, so a whole palette swaps by changing hue/chroma rather than restyling components

## Project Structure

```
worthly/
├── app.py                   # Flask app - all API routes, sync logic, CGT calc
├── requirements.txt
├── docs/
│   └── media/               # Video assets for documentation (Dashboard, Holdings, etc.)
├── frontend/
│   └── src/
│       ├── components/tabs/ # Dashboard, Holdings, Tax, Dividends, Milestones, Sync
│       ├── hooks/useApi.ts  # React Query hooks - one per API endpoint
│       └── types/           # Shared TypeScript types matching the API responses
├── deploy/
│   ├── Dockerfile
│   └── entrypoint.sh
└── CLAUDE.md                # Full API reference and data schemas
```

See [CLAUDE.md](CLAUDE.md) for the complete API reference, database schema, and architectural notes.

## Contributing

Issues and PRs welcome. This started as a personal project, so some assumptions (single user, AUD base currency, Australian tax rules) are baked in fairly deep - if you want to use it differently, open an issue to discuss before a large PR.
