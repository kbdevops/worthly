# Worthly

**Self-hosted net worth & portfolio dashboard** — multi-currency (AUD/USD), live Yahoo Finance prices, Australian CGT calculations, and dividend/franking tracking. Your data, your server, no third party ever sees it.

<!--
  Badge row — the build badge only works once this repo has run at least one
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

<video src="docs/media/Dashboard.mp4" autoplay loop muted playsinline width="100%"></video>

### Holdings
Every position with full transaction history. Click into any holding for per-lot gain/loss, add or delete trades, sector/industry metadata pulled automatically.

<video src="docs/media/Holdings.mp4" autoplay loop muted playsinline width="100%"></video>

### Tax (Australian CGT)
CGT calculations with the 50% long-term discount applied automatically, per-parcel breakdown, optimal sell-date suggestions.

<video src="docs/media/Tax.mp4" autoplay loop muted playsinline width="100%"></video>

### Dividends
Full dividend history auto-fetched from Yahoo Finance, sized by the units you actually held on each ex-dividend date. Tracks Australian franking credits (manually entered - no feed publishes these) and US treaty withholding tax automatically, with net and grossed-up totals.

### Milestones
Goals that track live app data - pick one metric or combine several (e.g. Cash + Portfolio), set a target in AUD or USD (USD targets convert to their live AUD equivalent every time you open the app, so progress moves with the exchange rate). Plus an achievements log for past milestones.

<video src="docs/media/Milestones.mp4" autoplay loop muted playsinline width="100%"></video>

### Data Sync
Background sync runs automatically twice a day (after ASX and NYSE/NASDAQ close). The Sync tab surfaces real health - per-symbol errors, staleness warnings, last-run results - instead of a black box.

<video src="docs/media/DataSync.mp4" autoplay loop muted playsinline width="100%"></video>

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

Open **http://localhost:5173** in dev mode (or **http://localhost:5050** if you've built the frontend for production — see below).

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

Mount a volume at `DATA_DIR` (defaults to the app directory if unset) — this is where `prices.db`, your transaction history, and everything else lives. Without a persistent volume, all data is lost when the container is recreated.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DATA_DIR` | app directory | Where `prices.db` and CSV/Excel imports live |

There's no built-in authentication — Worthly assumes it's running somewhere you already trust (a home network, a VPN, behind your own reverse-auth proxy). If you're exposing it beyond that, put an auth layer in front of it (Traefik BasicAuth middleware, Tailscale, OAuth2 Proxy, etc.) before you do.

## Tech Stack

- **Backend**: Flask, SQLite, `yfinance`, APScheduler (for the twice-daily background price sync)
- **Frontend**: React 19 + TypeScript + Vite, Tailwind, Recharts, `@dnd-kit` (drag-to-reorder widgets)
- **Data**: everything lives in a single `prices.db` SQLite file — no external database to run

## Project Structure

```
worthly/
├── app.py                   # Flask app — all API routes, sync logic, CGT calc
├── requirements.txt
├── frontend/
│   └── src/
│       ├── components/tabs/ # Dashboard, Holdings, Tax, Dividends, Milestones, Sync
│       ├── hooks/useApi.ts  # React Query hooks — one per API endpoint
│       └── types/           # Shared TypeScript types matching the API responses
├── deploy/
│   ├── Dockerfile
│   └── entrypoint.sh
└── CLAUDE.md                 # Full API reference and data schemas
```

See [CLAUDE.md](CLAUDE.md) for the complete API reference, database schema, and architectural notes.

## Contributing

Issues and PRs welcome. This started as a personal project, so some assumptions (single user, AUD base currency, Australian tax rules) are baked in fairly deep — if you want to use it differently, open an issue to discuss before a large PR.