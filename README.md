# Worthly — Net Worth & Portfolio Dashboard

A personal net worth and portfolio tracking dashboard with multi-currency support (AUD/USD), real-time Yahoo Finance prices, and Australian CGT calculations.

Built with Flask + vanilla JS + Chart.js. Deployable on k3s.

**Key features:**
- **Holistic net worth** — portfolio + cash + super + country allocation in one dashboard
- Multi-currency (AUD base, USD holdings auto-converted at historical FX rates)
- **5 tabs:** Dashboard, Holdings (rich cards with logos & industry), Transactions (ledger with per-trade P&L), Tax (Australian CGT calculator), Data Sync
- Transaction ingestion from Excel, CSV, or manual entry
- Yahoo Finance price cache with 15-min cooldown
- Per-holding daily change, company metadata (sector/industry/logos)

## Quick Start

```bash
pip install -r requirements.txt
cp transactions.example.json transactions.json
cp cash_accounts.example.json cash_accounts.json
cp super_holdings.example.json super_holdings.json
cp snapshots.example.json snapshots.json
cp country_overrides.example.json country_overrides.json
python app.py
```

Open `http://localhost:5050` — click "Sync All" on the Data Sync tab to populate prices and metadata.

## Docker / k3s

```bash
docker build -t worthly .
docker run -d -p 5050:5050 \
  -v $(pwd)/transactions.json:/app/transactions.json \
  -v $(pwd)/prices.db:/app/prices.db \
  --name worthly worthly
```

Or `kubectl apply -f k3s-deploy.yaml` with a PersistentVolumeClaim for data persistence.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Full architecture, API reference, data schemas, deployment guide (for humans and AI agents)
