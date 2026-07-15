"""
seed_demo_data.py
------------------
Builds demo/fake.db: a Worthly database with the exact same schema as your
real prices.db, but every dollar figure is fabricated. Ticker symbols are
real (AAPL, MSFT, NVDA, VAS.AX, etc.) so that when you point the app at this
file and click Sync, it pulls genuine live prices — the demo looks authentic
on camera without any real portfolio data ever being in it.

This is intentionally standalone and does NOT import app.py — importing it
would also start the real background price-sync scheduler as a side effect,
which you don't want running against a throwaway demo file. The schema below
is a plain copy of what app.py's db() function creates.

Usage:
    python3 demo/seed_demo_data.py
    DATA_DIR=demo python3 app.py     # now the app reads demo/fake.db instead
"""
import sqlite3
import os
from datetime import date, timedelta

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    symbol TEXT NOT NULL, date TEXT NOT NULL, close REAL NOT NULL,
    PRIMARY KEY (symbol, date)
);
CREATE TABLE IF NOT EXISTS sync_log (
    symbol TEXT PRIMARY KEY, last_synced TEXT NOT NULL,
    cached_from TEXT, cached_to TEXT, last_error TEXT, last_attempt TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
    date TEXT PRIMARY KEY, super REAL NOT NULL, cash REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, exchange TEXT NOT NULL,
    ticker TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, units REAL NOT NULL,
    price REAL NOT NULL, currency TEXT NOT NULL, brokerage REAL NOT NULL DEFAULT 0,
    brokerage_currency TEXT NOT NULL DEFAULT 'AUD', exch_rate REAL NOT NULL DEFAULT 1.0,
    value REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, institution TEXT, type TEXT, name TEXT,
    balance REAL NOT NULL DEFAULT 0, country TEXT NOT NULL DEFAULT 'AU'
);
CREATE TABLE IF NOT EXISTS super_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, class TEXT,
    allocation_pct REAL NOT NULL, country TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS country_overrides (
    symbol TEXT PRIMARY KEY, country TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holding_meta (
    symbol TEXT PRIMARY KEY, sector TEXT, industry TEXT, long_name TEXT, website TEXT, logo_url TEXT
);
CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT, category TEXT NOT NULL, value REAL, type TEXT DEFAULT 'achievement',
    target_value REAL, current_value REAL, is_achieved INTEGER DEFAULT 0,
    linked_metric TEXT, achieved_date TEXT, linked_metrics TEXT, currency TEXT DEFAULT 'AUD'
);
CREATE TABLE IF NOT EXISTS records (
    key TEXT PRIMARY KEY, value REAL NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dividends (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, symbol TEXT NOT NULL,
    ticker TEXT NOT NULL, exchange TEXT NOT NULL, per_share REAL NOT NULL, units REAL NOT NULL,
    currency TEXT NOT NULL, gross_amount REAL NOT NULL, gross_amount_aud REAL NOT NULL,
    franking_pct REAL NOT NULL DEFAULT 0, franking_credit_aud REAL NOT NULL DEFAULT 0,
    withholding_tax_pct REAL NOT NULL DEFAULT 0, net_amount_aud REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', UNIQUE(symbol, date)
);
"""

def d(days_ago):
    return (date.today() - timedelta(days=days_ago)).isoformat()

# (date_days_ago, exchange, ticker, name, action, units, price, currency, brokerage)
FAKE_TRANSACTIONS = [
    (540, "NASDAQ", "AAPL",  "Apple Inc",        "buy", 40,  165.00, "USD", 15),
    (500, "NASDAQ", "MSFT",  "Microsoft Corp",   "buy", 15,  340.00, "USD", 15),
    (460, "NASDAQ", "NVDA",  "NVIDIA Corp",      "buy", 60,   45.00, "USD", 15),
    (400, "ASX",    "VAS",   "Vanguard Aus Shares ETF", "buy", 300,  85.00, "AUD", 10),
    (400, "ASX",    "IVV",   "iShares S&P 500 ETF",     "buy", 120, 45.00,  "AUD", 10),
    (300, "NASDAQ", "META",  "Meta Platforms",   "buy", 20,  310.00, "USD", 15),
    (250, "ASX",    "NDQ",   "BetaShares Nasdaq 100 ETF", "buy", 100, 32.00, "AUD", 10),
    (180, "NASDAQ", "NVDA",  "NVIDIA Corp",      "buy", 20,  110.00, "USD", 15),
    (120, "NASDAQ", "AAPL",  "Apple Inc",        "sell", 10, 195.00, "USD", 15),
    (60,  "NASDAQ", "GOOG",  "Alphabet Inc",     "buy", 25,  175.00, "USD", 15),
]

FAKE_CASH_ACCOUNTS = [
    ("UBank", "Savings", "Everyday Saver", 18500.00, "AU"),
    ("ING",   "Savings", "Savings Maximiser", 22750.00, "AU"),
    ("Wise",  "Multi-currency", "USD Holding", 3200.00, "AU"),
]

FAKE_SUPER_HOLDINGS = [
    ("Australian Shares",   "Equity", 25.0, "AU"),
    ("International Shares", "Equity", 45.0, "US"),
    ("Bonds",               "Fixed Income", 20.0, "AU"),
    ("Cash",                "Cash", 10.0, "AU"),
]

FAKE_MILESTONES = [
    (d(400), "First $500K Net Worth", "Crossed half a million in total net worth", "financial",
     500000, "achievement", None, None, 1, None, d(400), None, "AUD"),
    (d(90), "Portfolio hit $600K", "Active portfolio crossed $600K", "financial",
     600000, "achievement", None, None, 1, None, d(90), None, "AUD"),
    (d(0), "Reach $1M Net Worth", "Combined cash + portfolio + super", "financial",
     None, "goal", 1000000, None, 0, None, None, "networth", "AUD"),
]


def main():
    if os.path.exists(OUT_PATH):
        os.remove(OUT_PATH)
    conn = sqlite3.connect(OUT_PATH)
    conn.executescript(SCHEMA)

    for days_ago, exchange, ticker, name, action, units, price, currency, brokerage in FAKE_TRANSACTIONS:
        exch_rate = 0.66 if currency == "USD" else 1.0
        sign = -1 if action == "sell" else 1
        value = sign * (units * price + brokerage) / exch_rate
        conn.execute(
            "INSERT INTO transactions (date, exchange, ticker, name, action, units, price, currency, "
            "brokerage, brokerage_currency, exch_rate, value) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (d(days_ago), exchange, ticker, name, action, units, price, currency, brokerage, "AUD", exch_rate, value),
        )

    for institution, acc_type, name, balance, country in FAKE_CASH_ACCOUNTS:
        conn.execute(
            "INSERT INTO cash_accounts (institution, type, name, balance, country) VALUES (?,?,?,?,?)",
            (institution, acc_type, name, balance, country),
        )

    for name, cls, pct, country in FAKE_SUPER_HOLDINGS:
        conn.execute(
            "INSERT INTO super_holdings (name, class, allocation_pct, country) VALUES (?,?,?,?)",
            (name, cls, pct, country),
        )

    for row in FAKE_MILESTONES:
        conn.execute(
            "INSERT INTO milestones (date, title, description, category, value, type, target_value, "
            "current_value, is_achieved, linked_metric, achieved_date, linked_metrics, currency) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            row,
        )

    conn.commit()
    conn.close()
    print(f"Seeded fake demo data -> {OUT_PATH}")
    print("Run the app against it with:  DATA_DIR=demo python3 app.py")
    print("Then click Sync All / Sync Dividends in the app to pull real live prices for these fake positions.")


if __name__ == "__main__":
    main()