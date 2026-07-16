"""
Net Worth Tracker
-----------------
Flask application with SQLite backend, multi-currency support (AUD base),
and detailed portfolio analytics. All data stored in prices.db.
"""

from flask import Flask, render_template, request, jsonify, send_from_directory
import yfinance as yf
import pandas as pd
import json
import os
import sqlite3
import time
from datetime import datetime, date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__, template_folder="templates", static_folder="static")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", BASE_DIR)
FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")
DB_FILE = os.path.join(DATA_DIR, "prices.db")
CSV_FILE = os.path.join(DATA_DIR, "all_trades.csv")
EXCEL_FILE = os.path.join(DATA_DIR, "AllTradesReport.xlsx")
SNAPSHOT_FILE = os.path.join(DATA_DIR, "snapshots.json")

# yfinance suffixes for exchanges
EXCHANGE_SUFFIX = {
    "US": "",
    "NASDAQ": "",
    "NYSE": "",
    "ASX": ".AX",
    "LSE": ".L",
    "TSX": ".TO",
}

def db():
    """Create and return a database connection, initializing tables if they don't exist."""
    conn = sqlite3.connect(DB_FILE, timeout=30)
    # WAL lets readers and writers work concurrently instead of blocking on a
    # single file lock — needed now that sync fetches multiple symbols in parallel.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prices (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            close REAL NOT NULL,
            PRIMARY KEY (symbol, date)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_log (
            symbol TEXT PRIMARY KEY,
            last_synced TEXT NOT NULL,
            cached_from TEXT,
            cached_to TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            date TEXT PRIMARY KEY,
            super REAL NOT NULL,
            cash REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            exchange TEXT NOT NULL,
            ticker TEXT NOT NULL,
            name TEXT NOT NULL,
            action TEXT NOT NULL,
            units REAL NOT NULL,
            price REAL NOT NULL,
            currency TEXT NOT NULL,
            brokerage REAL NOT NULL DEFAULT 0,
            brokerage_currency TEXT NOT NULL DEFAULT 'AUD',
            exch_rate REAL NOT NULL DEFAULT 1.0,
            value REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cash_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            institution TEXT,
            type TEXT,
            name TEXT,
            balance REAL NOT NULL DEFAULT 0,
            country TEXT NOT NULL DEFAULT 'AU'
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS super_holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            class TEXT,
            allocation_pct REAL NOT NULL,
            country TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS country_overrides (
            symbol TEXT PRIMARY KEY,
            country TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS holding_meta (
            symbol TEXT PRIMARY KEY,
            sector TEXT,
            industry TEXT,
            long_name TEXT,
            website TEXT,
            logo_url TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT NOT NULL,
            value REAL,
            type TEXT DEFAULT 'achievement',
            target_value REAL,
            current_value REAL,
            is_achieved INTEGER DEFAULT 0,
            linked_metric TEXT,
            achieved_date TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS records (
            key TEXT PRIMARY KEY,
            value REAL NOT NULL,
            date TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS holding_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            symbols TEXT NOT NULL DEFAULT ''
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dividends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            ticker TEXT NOT NULL,
            exchange TEXT NOT NULL,
            per_share REAL NOT NULL,
            units REAL NOT NULL,
            currency TEXT NOT NULL,
            gross_amount REAL NOT NULL,
            gross_amount_aud REAL NOT NULL,
            franking_pct REAL NOT NULL DEFAULT 0,
            franking_credit_aud REAL NOT NULL DEFAULT 0,
            withholding_tax_pct REAL NOT NULL DEFAULT 0,
            net_amount_aud REAL NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            UNIQUE(symbol, date)
        )
    """)
    # Migrate existing sync_log table — tracks sync health, not just successful ranges
    for col, defn in [
        ("last_error", "TEXT"),      # non-null when the most recent sync attempt failed
        ("last_attempt", "TEXT"),    # timestamp of the most recent attempt, success or not
    ]:
        try:
            conn.execute(f"ALTER TABLE sync_log ADD COLUMN {col} {defn}")
        except:
            pass
    # Migrate existing milestones table
    for col, defn in [
        ("type", "TEXT DEFAULT 'achievement'"),
        ("target_value", "REAL"),
        ("current_value", "REAL"),
        ("is_achieved", "INTEGER DEFAULT 0"),
        ("linked_metric", "TEXT"),
        ("achieved_date", "TEXT"),
        ("linked_metrics", "TEXT"),   # comma-separated list, e.g. "cash,portfolio" — supersedes linked_metric
        ("currency", "TEXT DEFAULT 'AUD'"),  # currency the target/current value is expressed in: AUD or USD
    ]:
        try:
            conn.execute(f"ALTER TABLE milestones ADD COLUMN {col} {defn}")
        except:
            pass
    conn.commit()
    return conn

def yf_symbol(ticker, exchange):
    """Normalize the ticker symbol for yfinance based on exchange."""
    if "=X" in ticker:
        return ticker
    suffix = EXCHANGE_SUFFIX.get((exchange or "").upper(), "")
    return f"{ticker.upper()}{suffix}"

def get_currency_from_exchange(exchange):
    """Determine instrument currency based on exchange."""
    if (exchange or "").upper() in ["NASDAQ", "NYSE", "US"]:
        return "USD"
    return "AUD"  # Default to AUD (ASX)

def get_historical_exchange_rate(conn, date_str):
    """Retrieve AUD/USD exchange rate for a given date. Try cache, then yfinance."""
    # Try database cache
    row = conn.execute(
        "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' AND date = ?", (date_str,)
    ).fetchone()
    if row:
        return float(row[0])
    
    # Try fetching from yfinance for a short window around the date
    try:
        t_date = pd.Timestamp(date_str)
        t = yf.Ticker("AUDUSD=X")
        hist = t.history(start=t_date - timedelta(days=3), end=t_date + timedelta(days=4))
        if not hist.empty:
            # Find the closest date before or equal to target date
            hist.index = hist.index.tz_localize(None)
            available_dates = hist.index[hist.index <= t_date]
            if len(available_dates) > 0:
                closest_date = available_dates[-1]
            else:
                closest_date = hist.index[0]
            rate = float(hist.loc[closest_date, "Close"])
            
            # Cache it
            conn.execute(
                "INSERT OR REPLACE INTO prices (symbol, date, close) VALUES ('AUDUSD=X', ?, ?)",
                (closest_date.strftime("%Y-%m-%d"), rate)
            )
            conn.commit()
            return rate
    except Exception as e:
        print(f"[warning] Failed to fetch exchange rate for {date_str}: {e}")
        
    # Fallback if everything else fails: return latest cached rate, or 0.65
    fallback_row = conn.execute(
        "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' ORDER BY date DESC LIMIT 1"
    ).fetchone()
    if fallback_row:
        return float(fallback_row[0])
    return 0.65

def ingest_excel_to_json():
    """Ingest transactions from AllTradesReport.xlsx Combined sheet to JSON file."""
    if not os.path.exists(EXCEL_FILE):
        return []
    
    import openpyxl
    transactions = []
    conn = sqlite3.connect(DB_FILE)
    
    try:
        wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True)
        if "Combined" not in wb.sheetnames:
            print("[error] 'Combined' sheet not found in AllTradesReport.xlsx")
            return []
            
        ws = wb["Combined"]
        for idx, row in enumerate(ws.iter_rows(values_only=True)):
            if idx < 3:  # Skip metadata and headers (header is on row 3)
                continue
            if not row or row[0] is None:
                continue
                
            code = str(row[0]).strip().upper()
            if code in ['TOTAL', 'CODE', 'ALL TRADES']:
                continue
                
            market = str(row[1]).strip().upper() if row[1] else ''
            name = str(row[2]).strip() if row[2] else ''
            dt = str(row[3])[:10] if row[3] else None
            action_type = str(row[4]).strip().lower() if row[4] else ''
            qty = float(row[5]) if row[5] is not None else 0.0
            price = float(row[6]) if row[6] is not None else 0.0
            currency = str(row[7]).strip().upper() if row[7] else ''
            
            brokerage = float(row[9]) if row[9] is not None else 0.0
            brokerage_currency = str(row[10]).strip().upper() if row[10] else ''
            
            exch_rate = float(row[11]) if row[11] is not None else 1.0
            val = float(row[12]) if row[12] is not None else 0.0
            
            # Double-check multi-currency rate calculation
            if currency == "USD" and exch_rate == 1.0:
                exch_rate = get_historical_exchange_rate(conn, dt)
                
            if val == 0.0:
                sign = 1 if action_type == "buy" else -1
                cost_in_instrument = (sign * abs(qty) * price) + brokerage
                if currency == "USD":
                    val = cost_in_instrument / exch_rate
                else:
                    val = cost_in_instrument

            transactions.append({
                "date": dt,
                "exchange": market,
                "ticker": code,
                "name": name,
                "action": action_type,
                "units": abs(qty),
                "price": price,
                "currency": currency,
                "brokerage": brokerage,
                "brokerage_currency": brokerage_currency,
                "exch_rate": exch_rate,
                "value": val
            })
        
        # Sort chronologically
        transactions.sort(key=lambda x: x["date"])
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(transactions, f, indent=2)
        print(f"[backend] Successfully auto-ingested {len(transactions)} trades from Excel.")
    except Exception as e:
        print(f"[error] Failed to ingest Excel: {e}")
    finally:
        conn.close()
        
    return transactions

def ingest_csv_to_json():
    """Ingest transactions from CSV to JSON file."""
    if not os.path.exists(CSV_FILE):
        return []
    
    import csv
    transactions = []
    conn = sqlite3.connect(DB_FILE)
    
    try:
        with open(CSV_FILE, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for idx, row in enumerate(reader):
                code = row["Code"].strip().upper()
                market = row["Market Code"].strip().upper()
                name = row["Name"].strip()
                dt = row["Date"].strip()
                action_type = row["Type"].strip().lower()
                qty = float(row["Qty"])
                price = float(row["Price"])
                currency = row["Instrument Currency"].strip().upper()
                
                brokerage_str = row.get("Brokerage", "0").strip()
                brokerage = float(brokerage_str) if brokerage_str else 0.0
                brokerage_currency = row.get("Brokerage Currency", currency).strip().upper()
                
                exch_rate_str = row.get("Exch. Rate", "").strip()
                exch_rate = float(exch_rate_str) if exch_rate_str else 1.0
                
                val_str = row.get("Value", "").strip()
                val = float(val_str) if val_str else 0.0
                
                # Double-check multi-currency rate calculation
                if currency == "USD" and exch_rate == 1.0:
                    exch_rate = get_historical_exchange_rate(conn, dt)
                    
                if val == 0.0:
                    sign = 1 if action_type == "buy" else -1
                    cost_in_instrument = (sign * abs(qty) * price) + brokerage
                    if currency == "USD":
                        val = cost_in_instrument / exch_rate
                    else:
                        val = cost_in_instrument

                transactions.append({
                    "date": dt,
                    "exchange": market,
                    "ticker": code,
                    "name": name,
                    "action": action_type,
                    "units": abs(qty),
                    "price": price,
                    "currency": currency,
                    "brokerage": brokerage,
                    "brokerage_currency": brokerage_currency,
                    "exch_rate": exch_rate,
                    "value": val
                })
        
        # Sort chronologically
        transactions.sort(key=lambda x: x["date"])
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(transactions, f, indent=2)
        print(f"[backend] Successfully auto-ingested {len(transactions)} trades from CSV.")
    except Exception as e:
        print(f"[error] Failed to ingest CSV: {e}")
    finally:
        conn.close()
        
    return transactions

def load_transactions():
    """Load transactions from DB. Re-ingests from Excel/CSV if source file is newer than JSON marker."""
    if os.path.exists(EXCEL_FILE):
        if not os.path.exists(DATA_FILE) or os.path.getmtime(EXCEL_FILE) > os.path.getmtime(DATA_FILE):
            txns = ingest_excel_to_json()
            save_transactions(txns)
            return txns

    if os.path.exists(CSV_FILE):
        if not os.path.exists(DATA_FILE) or os.path.getmtime(CSV_FILE) > os.path.getmtime(DATA_FILE):
            txns = ingest_csv_to_json()
            save_transactions(txns)
            return txns

    conn = db()
    rows = conn.execute(
        "SELECT date, exchange, ticker, name, action, units, price, currency, "
        "brokerage, brokerage_currency, exch_rate, value FROM transactions ORDER BY date, id"
    ).fetchall()
    conn.close()
    cols = ["date", "exchange", "ticker", "name", "action", "units", "price",
            "currency", "brokerage", "brokerage_currency", "exch_rate", "value"]
    return [dict(zip(cols, row)) for row in rows]

def save_transactions(txns):
    """Save transactions to DB (full replace, sorted by date)."""
    txns_sorted = sorted(txns, key=lambda x: x.get("date", ""))
    cols = ("date", "exchange", "ticker", "name", "action", "units", "price",
            "currency", "brokerage", "brokerage_currency", "exch_rate", "value")
    conn = db()
    conn.execute("DELETE FROM transactions")
    conn.executemany(
        f"INSERT INTO transactions ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        [[t.get(c, 0 if c in ("units","price","brokerage","exch_rate","value") else "") for c in cols] for t in txns_sorted]
    )
    conn.commit()
    conn.close()

# ─── Cash Accounts, Super Holdings, Country Overrides ───────

def load_cash_accounts():
    conn = db()
    rows = conn.execute(
        "SELECT institution, type, name, balance, country FROM cash_accounts ORDER BY id"
    ).fetchall()
    conn.close()
    return [{"institution": r[0], "type": r[1], "name": r[2], "balance": r[3], "country": r[4]} for r in rows]

def save_cash_accounts(accounts):
    conn = db()
    conn.execute("DELETE FROM cash_accounts")
    conn.executemany(
        "INSERT INTO cash_accounts (institution, type, name, balance, country) VALUES (?,?,?,?,?)",
        [(a.get("institution",""), a.get("type",""), a.get("name",""), a.get("balance",0), a.get("country","AU")) for a in accounts]
    )
    conn.commit()
    conn.close()

def load_super_holdings():
    conn = db()
    rows = conn.execute(
        "SELECT name, class, allocation_pct, country FROM super_holdings ORDER BY id"
    ).fetchall()
    conn.close()
    return [{"name": r[0], "class": r[1], "allocation_pct": r[2], "country": r[3]} for r in rows]

def save_super_holdings(holdings):
    conn = db()
    conn.execute("DELETE FROM super_holdings")
    conn.executemany(
        "INSERT INTO super_holdings (name, class, allocation_pct, country) VALUES (?,?,?,?)",
        [(h.get("name",""), h.get("class",""), h.get("allocation_pct",0), h.get("country","")) for h in holdings]
    )
    conn.commit()
    conn.close()

def load_country_overrides():
    conn = db()
    rows = conn.execute("SELECT symbol, country FROM country_overrides").fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}

def save_country_overrides(overrides):
    conn = db()
    conn.execute("DELETE FROM country_overrides")
    conn.executemany(
        "INSERT INTO country_overrides (symbol, country) VALUES (?,?)",
        list(overrides.items())
    )
    conn.commit()
    conn.close()

def load_holding_meta():
    conn = db()
    rows = conn.execute(
        "SELECT symbol, sector, industry, long_name, website, logo_url FROM holding_meta"
    ).fetchall()
    conn.close()
    return {r[0]: {"sector": r[1], "industry": r[2], "longName": r[3], "website": r[4], "logo_url": r[5]} for r in rows}

def save_holding_meta_one(symbol, entry):
    """Upsert a single symbol's metadata. Safe to call concurrently from multiple
    sync threads — unlike a delete-all-then-reinsert-all pattern, this can't lose
    another thread's in-flight write."""
    conn = db()
    conn.execute(
        "INSERT INTO holding_meta (symbol, sector, industry, long_name, website, logo_url) VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(symbol) DO UPDATE SET sector=excluded.sector, industry=excluded.industry, "
        "long_name=excluded.long_name, website=excluded.website, logo_url=excluded.logo_url",
        (symbol, entry.get("sector", ""), entry.get("industry", ""), entry.get("longName", ""),
         entry.get("website", ""), entry.get("logo_url", "")),
    )
    conn.commit()
    conn.close()

def fetch_holding_meta(ticker, exchange):
    """Fetch sector, industry, logo from yfinance for a ticker. Returns dict or None."""
    ysym = yf_symbol(ticker, exchange)
    conn = db()
    existing = conn.execute(
        "SELECT sector, industry, long_name, website, logo_url FROM holding_meta WHERE symbol = ?", (ysym,)
    ).fetchone()
    conn.close()
    if existing:
        return {"sector": existing[0], "industry": existing[1], "longName": existing[2], "website": existing[3], "logo_url": existing[4]}

    try:
        t = yf.Ticker(ysym)
        info = t.info
        website = info.get("website", "")
        logo_url = ""
        if website:
            # Use Google Favicons service to pull the company's logo
            logo_url = f"https://www.google.com/s2/favicons?domain={website.replace('https://','').replace('http://','').split('/')[0]}&sz=64"

        entry = {
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "longName": info.get("longName", ""),
            "website": website,
            "logo_url": logo_url,
        }
        save_holding_meta_one(ysym, entry)
        return entry
    except Exception as e:
        print(f"[meta] Failed to fetch metadata for {ysym}: {e}")
        return None

def get_holding_country(ticker, exchange, name):
    """Determine country for a holding: override > exchange heuristic > 'Unknown'."""
    sym = yf_symbol(ticker, exchange)
    overrides = load_country_overrides()
    if sym in overrides:
        return overrides[sym]
    # Heuristic: US exchanges → US, ASX → AU, else based on name
    ex_upper = (exchange or "").upper()
    if ex_upper in ("NASDAQ", "NYSE", "US"):
        return "US"
    if ex_upper == "ASX":
        return "AU"
    return "Unknown"

def get_total_cash():
    """Sum all cash account balances."""
    accounts = load_cash_accounts()
    return round(sum(a.get("balance", 0) for a in accounts), 2)

# ─── End Config Helpers ────────────────────────────────────

def seed_historical_snapshots():
    """Seed the snapshots table from snapshots.json on first run (when table is empty)."""
    conn = db()
    count = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
    conn.close()
    if count > 0:
        return

    if not os.path.exists(SNAPSHOT_FILE):
        return

    try:
        with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        conn = db()
        for entry in data:
            conn.execute(
                "INSERT OR REPLACE INTO snapshots (date, super, cash) VALUES (?, ?, ?)",
                (entry["date"], entry["super"], entry["cash"]),
            )
        conn.commit()
        conn.close()
        print(f"[backend] Loaded {len(data)} cash/super snapshots from snapshots.json.")
    except Exception as e:
        print(f"[backend] Failed to seed snapshots: {e}")

def _fetch_with_retry(fn, attempts=2, delay=1.5):
    """Run fn() with a couple of retries for transient network/rate-limit errors."""
    last_exc = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            if i < attempts - 1:
                time.sleep(delay)
    raise last_exc

def sync_symbol(symbol, needed_start, needed_end, force=False):
    """Fetch and cache only missing historical daily close prices for symbol.
    Opens its own DB connection so it's safe to call from a worker thread.
    Returns (ok, message)."""
    conn = db()
    try:
        # 15-minute cooldown check
        row = conn.execute(
            "SELECT cached_from, cached_to, last_synced FROM sync_log WHERE symbol = ?", (symbol,)
        ).fetchone()

        now = pd.Timestamp.now()
        if row is not None and not force:
            cached_to = pd.Timestamp(row[1])
            last_synced = pd.Timestamp(row[2])
            if now - last_synced < timedelta(minutes=15) and needed_end < cached_to:
                return True, "Cached recently"

        # Yahoo doesn't publish a daily candle for a day that hasn't closed yet —
        # asking for "today" via the daily endpoint reliably throws a
        # "possibly delisted; no price data found" error, every symbol, every day,
        # until market close. Today's live price comes from the intraday fetch
        # below instead, so daily requests never go past the last fully elapsed day.
        daily_cap = pd.Timestamp(date.today()) - timedelta(days=1)

        ranges_to_fetch = []
        if row is None:
            ranges_to_fetch.append((needed_start, needed_end))
        else:
            cached_from = pd.Timestamp(row[0])
            cached_to = pd.Timestamp(row[1])
            if needed_start < cached_from:
                ranges_to_fetch.append((needed_start, cached_from - timedelta(days=1)))
            if needed_end > cached_to:
                ranges_to_fetch.append((cached_to + timedelta(days=1), needed_end))

        # Unconditionally (re)fetch the most recently closed trading day, even if
        # cached_to already reaches it — a sync that ran while the market was still
        # open only captures an in-progress intraday snapshot for that date, and
        # that snapshot's own date makes cached_to look "caught up" even though the
        # value isn't final. This guarantees it eventually gets overwritten by the
        # real close, instead of getting permanently stuck (which is what was
        # happening: the gap-fill range above collapses to an empty/inverted range
        # once cached_to already equals daily_cap, so that date was never revisited).
        ranges_to_fetch.append((daily_cap, daily_cap))

        errors = []
        for f_start, f_end in ranges_to_fetch:
            f_end = min(f_end, daily_cap)
            if f_start > f_end:
                continue
            try:
                hist = _fetch_with_retry(
                    lambda: yf.Ticker(symbol).history(start=f_start, end=f_end + timedelta(days=1))
                )
                if hist.empty:
                    continue
                hist.index = hist.index.tz_localize(None)
                rows = [
                    (symbol, d.strftime("%Y-%m-%d"), float(c))
                    for d, c in hist["Close"].items()
                ]
                conn.executemany(
                    "INSERT OR REPLACE INTO prices (symbol, date, close) VALUES (?, ?, ?)",
                    rows,
                )
            except Exception as e:
                msg = str(e)
                # yfinance raises this for any window with zero rows (market holiday,
                # exchange-specific non-trading day, etc.) — genuinely benign, not a
                # sync failure, so don't record it as an error.
                if "possibly delisted" in msg.lower() or "no price data found" in msg.lower():
                    print(f"[sync] No data for {symbol} {f_start.date()} -> {f_end.date()} (holiday/non-trading day, not an error)")
                    continue
                errors.append(msg)
                print(f"[sync] Failed to fetch {symbol} {f_start.date()} -> {f_end.date()}: {e}")

        # Fetch today's intraday price so we have live data even before market close.
        # yfinance daily history() excludes the incomplete current day; intraday 1m
        # data includes it as soon as the first trade prints.
        try:
            intraday = _fetch_with_retry(
                lambda: yf.Ticker(symbol).history(period="1d", interval="1m")
            )
            if not intraday.empty:
                intraday.index = intraday.index.tz_localize(None)
                latest = intraday.iloc[-1]
                latest_date = latest.name.strftime("%Y-%m-%d")
                latest_close = float(latest["Close"])
                # Only insert if this date is not already covered by daily history
                existing = conn.execute(
                    "SELECT 1 FROM prices WHERE symbol = ? AND date = ?",
                    (symbol, latest_date),
                ).fetchone()
                if not existing:
                    conn.execute(
                        "INSERT OR REPLACE INTO prices (symbol, date, close) VALUES (?, ?, ?)",
                        (symbol, latest_date, latest_close),
                    )
        except Exception as e:
            # Intraday is best-effort — a failure here alone shouldn't mark the whole
            # sync as failed as long as daily history above succeeded.
            print(f"[sync] Failed to fetch intraday for {symbol}: {e}")

        # last_attempt/last_error record every attempt, success or not, so the UI can
        # show accurate sync health even when a symbol has been failing for days.
        # last_synced/cached_from/cached_to only advance on a clean, error-free run —
        # using the ACTUAL date range present in the prices table, not the requested
        # range, so cached_to isn't advanced to today when nothing was actually stored.
        if errors:
            conn.execute(
                "INSERT INTO sync_log (symbol, last_synced, cached_from, cached_to, last_error, last_attempt) "
                "VALUES (?, COALESCE((SELECT last_synced FROM sync_log WHERE symbol = ?), ?), "
                "(SELECT cached_from FROM sync_log WHERE symbol = ?), (SELECT cached_to FROM sync_log WHERE symbol = ?), ?, ?) "
                "ON CONFLICT(symbol) DO UPDATE SET last_error = excluded.last_error, last_attempt = excluded.last_attempt",
                (symbol, symbol, now.isoformat(), symbol, symbol, "; ".join(errors), now.isoformat()),
            )
        else:
            actual_range = conn.execute(
                "SELECT MIN(date), MAX(date) FROM prices WHERE symbol = ?", (symbol,)
            ).fetchone()
            if actual_range and actual_range[0] is not None:
                conn.execute(
                    "INSERT INTO sync_log (symbol, last_synced, cached_from, cached_to, last_error, last_attempt) "
                    "VALUES (?, ?, ?, ?, NULL, ?) "
                    "ON CONFLICT(symbol) DO UPDATE SET last_synced = excluded.last_synced, "
                    "cached_from = excluded.cached_from, cached_to = excluded.cached_to, "
                    "last_error = NULL, last_attempt = excluded.last_attempt",
                    (symbol, now.isoformat(), actual_range[0], actual_range[1], now.isoformat()),
                )
        conn.commit()

        if not ranges_to_fetch:
            return True, "Up to date"
        if errors:
            return False, "; ".join(errors)
        return True, "Synced successfully"
    finally:
        conn.close()

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    if path.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    full = os.path.join(FRONTEND_DIST, path)
    if path and os.path.exists(full):
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")

@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    """Retrieve list of transactions enriched with current price and gain/loss."""
    txns = load_transactions()
    if not txns:
        return jsonify([])

    # Get latest prices for all symbols
    conn = db()
    latest_prices = {}
    rows = conn.execute("""
        SELECT symbol, close FROM prices
        WHERE (symbol, date) IN (
            SELECT symbol, MAX(date) FROM prices GROUP BY symbol
        )
    """).fetchall()
    for sym, close in rows:
        latest_prices[sym] = close
    conn.close()

    audusd = latest_prices.get("AUDUSD=X", 0.65)

    meta = load_holding_meta()
    enriched = []
    for t in txns:
        entry = dict(t)
        ysym = yf_symbol(t["ticker"], t["exchange"])
        m = meta.get(ysym, {})
        entry["logo_url"] = m.get("logo_url", "")
        entry["currency_label"] = t.get("currency", "AUD")
        ysym = yf_symbol(t["ticker"], t["exchange"])
        current_price = latest_prices.get(ysym, 0.0)

        if t["action"].lower() == "buy":
            if t.get("currency", "AUD") == "USD":
                current_price_aud = current_price / audusd
            else:
                current_price_aud = current_price
            current_value = current_price_aud * t["units"]
            entry["current_price"] = round(current_price, 4)
            entry["current_value_aud"] = round(current_value, 2)
            entry["gain_aud"] = round(current_value - abs(t["value"]), 2)
            entry["gain_pct"] = round((current_value - abs(t["value"])) / abs(t["value"]) * 100, 2) if t["value"] != 0 else 0.0
        elif t["action"].lower() == "sell":
            # For sells, "gain" is the realized gain — the sell value minus the proportional cost
            # Simplified: show the sell proceeds as the reference
            entry["current_price"] = round(current_price, 4)
            entry["current_value_aud"] = round(t["value"], 2)
            entry["gain_aud"] = 0.0
            entry["gain_pct"] = 0.0
        else:
            entry["current_price"] = 0.0
            entry["current_value_aud"] = 0.0
            entry["gain_aud"] = 0.0
            entry["gain_pct"] = 0.0

        enriched.append(entry)

    return jsonify(enriched)

@app.route("/api/transactions", methods=["POST"])
def add_transaction():
    """Add a new transaction, auto-calculating values and exchange rates."""
    data = request.json
    try:
        date_str = data["date"]
        exchange = data["exchange"].upper().strip()
        ticker = data["ticker"].upper().strip()
        action = data["action"].lower().strip()
        units = float(data["units"])
        price = float(data["price"])
        brokerage = float(data.get("brokerage") or 0.0)
        
        currency = get_currency_from_exchange(exchange)
        
        conn = db()
        if currency == "USD":
            exch_rate = get_historical_exchange_rate(conn, date_str)
        else:
            exch_rate = 1.0
        conn.close()
        
        # Calculate signed AUD value
        if action == "split":
            # Split: units are additional shares, zero cost, zero cash flow
            price = 0.0
            brokerage = 0.0
            aud_value = 0.0
        elif action == "sell":
            # Sell: negative cash flow
            aud_value = (-units * price + brokerage) / exch_rate
        else:
            # Buy: positive cash flow
            aud_value = (units * price + brokerage) / exch_rate
        
        # Determine name if possible, or use ticker
        name = data.get("name", "").strip() or f"{ticker} Stock"
        
        txns = load_transactions()
        txns.append({
            "date": date_str,
            "exchange": exchange,
            "ticker": ticker,
            "name": name,
            "action": action,
            "units": units,
            "price": price,
            "currency": currency,
            "brokerage": brokerage,
            "brokerage_currency": currency,
            "exch_rate": exch_rate,
            "value": round(aud_value, 2)
        })
        
        # Re-sort chronologically
        txns.sort(key=lambda x: x["date"])
        save_transactions(txns)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/transactions/<int:idx>", methods=["DELETE"])
def delete_transaction(idx):
    """Delete a transaction by its position in the date-ordered list."""
    conn = db()
    row = conn.execute(
        "SELECT id FROM transactions ORDER BY date, id LIMIT 1 OFFSET ?", (idx,)
    ).fetchone()
    if row:
        conn.execute("DELETE FROM transactions WHERE id = ?", (row[0],))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    conn.close()
    return jsonify({"ok": False, "error": "Index out of range"}), 404

def _run_sync(force=False):
    """Core sync logic — fetch missing prices and metadata for all holdings.

    Each symbol's sync is I/O-bound (yfinance network calls), so they run
    concurrently in a small thread pool instead of one at a time — this is
    what actually makes "Sync All" fast instead of a serial 15-20 call chain.
    sync_symbol and fetch_holding_meta each open/close their own DB connection
    (WAL mode + busy_timeout handle the concurrent writes), so this is safe.
    """
    txns = load_transactions()
    if not txns:
        return []

    df = pd.DataFrame(txns)
    df["date"] = pd.to_datetime(df["date"])
    df["sym"] = df.apply(lambda r: yf_symbol(r["ticker"], r["exchange"]), axis=1)

    end = pd.Timestamp(date.today())
    # Roll back to Friday if min transaction date falls on a weekend
    min_date = df["date"].min()
    if min_date.weekday() == 5:   # Saturday
        min_date -= timedelta(days=1)
    elif min_date.weekday() == 6: # Sunday
        min_date -= timedelta(days=2)

    def _sync_one(symbol, sym_start):
        if sym_start.weekday() == 5:
            sym_start -= timedelta(days=1)
        elif sym_start.weekday() == 6:
            sym_start -= timedelta(days=2)
        ok, msg = sync_symbol(symbol, sym_start, end, force=force)
        return {"symbol": symbol, "ok": ok, "message": msg}

    jobs = [("AUDUSD=X", min_date)]
    holdings_by_sym = {}
    for sym, grp in df.groupby("sym"):
        jobs.append((sym, grp["date"].min()))
        holdings_by_sym[sym] = grp.iloc[0]

    results = []
    with ThreadPoolExecutor(max_workers=min(6, len(jobs))) as pool:
        futures = {pool.submit(_sync_one, sym, start): sym for sym, start in jobs}
        for fut in as_completed(futures):
            results.append(fut.result())

    # Sort back to a stable order (thread completion order is non-deterministic)
    order = {sym: i for i, (sym, _) in enumerate(jobs)}
    results.sort(key=lambda r: order.get(r["symbol"], 999))

    # Metadata fetches hit yfinance too, so parallelize them the same way.
    with ThreadPoolExecutor(max_workers=min(6, len(holdings_by_sym) or 1)) as pool:
        for sym, row in holdings_by_sym.items():
            pool.submit(fetch_holding_meta, row["ticker"], row["exchange"])

    return results


@app.route("/api/sync", methods=["POST"])
def sync_data():
    """Trigger update of cached price data and exchange rates."""
    force = request.args.get("force", "").lower() == "true"
    results = _run_sync(force=force)
    if not results:
        return jsonify({"results": [], "message": "No transactions to sync"})
    return jsonify({"results": results, "at": datetime.now().isoformat()})

@app.route("/api/sync-status", methods=["GET"])
def get_sync_status():
    """Return full sync status: prices + metadata + health for all cached symbols."""
    conn = db()
    rows = conn.execute("""
        SELECT
            s.symbol,
            s.last_synced,
            s.cached_from,
            s.cached_to,
            s.last_error,
            s.last_attempt,
            (SELECT COUNT(*) FROM prices p WHERE p.symbol = s.symbol) as record_count,
            (SELECT MIN(p.date) FROM prices p WHERE p.symbol = s.symbol) as actual_from,
            (SELECT MAX(p.date) FROM prices p WHERE p.symbol = s.symbol) as actual_to
        FROM sync_log s
        ORDER BY s.symbol
    """).fetchall()
    conn.close()

    # Merge with holding metadata
    meta = load_holding_meta()
    result = []
    for r in rows:
            sym = r[0]
            m = meta.get(sym, {})
            result.append({
                "symbol": sym,
                "last_synced": r[1],
                "cached_from": r[2],
                "cached_to": r[3],
                "last_error": r[4],
                "last_attempt": r[5],
                "record_count": r[6],
                "actual_from": r[7],
                "actual_to": r[8],
                "sector": m.get("sector", ""),
                "industry": m.get("industry", ""),
                "website": m.get("website", ""),
                "logo_url": m.get("logo_url", ""),
                "has_meta": bool(m.get("sector") or m.get("website")),
            })
    return jsonify(result)

AU_FRANKING_TAX_RATE = 0.30  # Australian corporate tax rate used to gross up franked dividends
US_TREATY_WITHHOLDING_PCT = 15.0  # Withholding on US-source dividends under the AU-US tax treaty

def _units_held_on(symbol_txns, as_of):
    """Cumulative units held for a symbol's transactions as of (and including) a date."""
    units = 0.0
    for t in symbol_txns:
        if t["date"] > as_of:
            continue
        if t["action"].lower() == "buy":
            units += t["units"]
        elif t["action"].lower() == "sell":
            units -= t["units"]
        elif t["action"].lower() == "split":
            units += t["units"]
    return units

def _compute_dividend_row(conn, symbol, ticker, exchange, currency, ex_date, per_share, units, source="manual", franking_pct=0.0):
    """Compute the full AUD-converted, franking/withholding-aware dividend record for one payment."""
    gross_amount = per_share * units
    exch_rate = get_historical_exchange_rate(conn, ex_date) if currency == "USD" else 1.0
    gross_amount_aud = gross_amount / exch_rate if currency == "USD" else gross_amount

    withholding_tax_pct = US_TREATY_WITHHOLDING_PCT if currency == "USD" else 0.0
    # Franking credits are a tax offset, not a cash reduction — franked AU dividends
    # are paid in full; withholding is what actually reduces the cash you receive.
    franking_credit_aud = gross_amount_aud * (franking_pct / 100.0) * (AU_FRANKING_TAX_RATE / (1 - AU_FRANKING_TAX_RATE)) if currency != "USD" else 0.0
    net_amount_aud = gross_amount_aud * (1 - withholding_tax_pct / 100.0)

    return {
        "date": ex_date, "symbol": symbol, "ticker": ticker, "exchange": exchange,
        "per_share": per_share, "units": round(units, 4), "currency": currency,
        "gross_amount": round(gross_amount, 2), "gross_amount_aud": round(gross_amount_aud, 2),
        "franking_pct": franking_pct, "franking_credit_aud": round(franking_credit_aud, 2),
        "withholding_tax_pct": withholding_tax_pct, "net_amount_aud": round(net_amount_aud, 2),
        "source": source,
    }

@app.route("/api/dividends", methods=["GET"])
def get_dividends():
    conn = db()
    rows = conn.execute("""
        SELECT id, date, symbol, ticker, exchange, per_share, units, currency,
               gross_amount, gross_amount_aud, franking_pct, franking_credit_aud,
               withholding_tax_pct, net_amount_aud, source
        FROM dividends ORDER BY date DESC
    """).fetchall()
    conn.close()
    cols = ["id", "date", "symbol", "ticker", "exchange", "per_share", "units", "currency",
            "gross_amount", "gross_amount_aud", "franking_pct", "franking_credit_aud",
            "withholding_tax_pct", "net_amount_aud", "source"]
    return jsonify([dict(zip(cols, r)) for r in rows])

@app.route("/api/dividends", methods=["POST"])
def add_dividend():
    """Manually add a dividend payment yfinance didn't catch."""
    data = request.json
    try:
        conn = db()
        row = _compute_dividend_row(
            conn, yf_symbol(data["ticker"], data["exchange"]), data["ticker"], data["exchange"],
            data.get("currency") or get_currency_from_exchange(data["exchange"]),
            data["date"], float(data["per_share"]), float(data["units"]),
            source="manual", franking_pct=float(data.get("franking_pct", 0)),
        )
        conn.execute(
            "INSERT OR REPLACE INTO dividends (date, symbol, ticker, exchange, per_share, units, currency, "
            "gross_amount, gross_amount_aud, franking_pct, franking_credit_aud, withholding_tax_pct, net_amount_aud, source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["date"], row["symbol"], row["ticker"], row["exchange"], row["per_share"], row["units"],
             row["currency"], row["gross_amount"], row["gross_amount_aud"], row["franking_pct"],
             row["franking_credit_aud"], row["withholding_tax_pct"], row["net_amount_aud"], row["source"]),
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/dividends/<int:div_id>", methods=["PUT"])
def update_dividend(div_id):
    """Mainly used to fill in franking_pct on an auto-fetched row — nobody publishes
    franking data programmatically, so this always has to be a manual edit."""
    data = request.json
    try:
        conn = db()
        existing = conn.execute(
            "SELECT symbol, ticker, exchange, per_share, units, currency, date FROM dividends WHERE id = ?", (div_id,)
        ).fetchone()
        if not existing:
            conn.close()
            return jsonify({"ok": False, "error": "Not found"}), 404
        symbol, ticker, exchange, per_share, units, currency, ex_date = existing
        franking_pct = float(data.get("franking_pct", 0))
        row = _compute_dividend_row(conn, symbol, ticker, exchange, currency, ex_date, per_share, units,
                                     source=data.get("source", "manual"), franking_pct=franking_pct)
        conn.execute(
            "UPDATE dividends SET franking_pct=?, franking_credit_aud=?, net_amount_aud=? WHERE id=?",
            (row["franking_pct"], row["franking_credit_aud"], row["net_amount_aud"], div_id),
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/dividends/<int:div_id>", methods=["DELETE"])
def delete_dividend(div_id):
    conn = db()
    conn.execute("DELETE FROM dividends WHERE id = ?", (div_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.route("/api/dividends/sync", methods=["POST"])
def sync_dividends():
    """Pull dividend history from yfinance for every symbol ever held, sized by the
    units actually held on each ex-dividend date. Franking % is never set by this —
    there's no feed for it — existing rows keep whatever franking_pct was already
    entered; only genuinely new payments are inserted (at franking_pct=0, since a
    reasonable default can't be assumed)."""
    txns = load_transactions()
    if not txns:
        return jsonify({"results": [], "message": "No transactions to sync dividends for"})

    by_symbol = {}
    for t in txns:
        sym = yf_symbol(t["ticker"], t["exchange"])
        by_symbol.setdefault(sym, {"ticker": t["ticker"], "exchange": t["exchange"],
                                    "currency": t.get("currency") or get_currency_from_exchange(t["exchange"]),
                                    "txns": []})["txns"].append(t)

    conn = db()
    results = []
    for sym, info in by_symbol.items():
        try:
            divs = _fetch_with_retry(lambda: yf.Ticker(sym).dividends)
            if divs is None or divs.empty:
                results.append({"symbol": sym, "ok": True, "message": "No dividend history"})
                continue
            divs.index = divs.index.tz_localize(None)
            inserted = 0
            for ts, per_share in divs.items():
                ex_date = ts.strftime("%Y-%m-%d")
                units = _units_held_on(info["txns"], ex_date)
                if units <= 1e-5:
                    continue  # wasn't held on this ex-date
                existing = conn.execute(
                    "SELECT franking_pct FROM dividends WHERE symbol = ? AND date = ?", (sym, ex_date)
                ).fetchone()
                franking_pct = existing[0] if existing else 0.0
                row = _compute_dividend_row(conn, sym, info["ticker"], info["exchange"], info["currency"],
                                             ex_date, float(per_share), units,
                                             source="yfinance", franking_pct=franking_pct)
                conn.execute(
                    "INSERT INTO dividends (date, symbol, ticker, exchange, per_share, units, currency, "
                    "gross_amount, gross_amount_aud, franking_pct, franking_credit_aud, withholding_tax_pct, net_amount_aud, source) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(symbol, date) DO UPDATE SET per_share=excluded.per_share, units=excluded.units, "
                    "gross_amount=excluded.gross_amount, gross_amount_aud=excluded.gross_amount_aud, "
                    "net_amount_aud=excluded.net_amount_aud",
                    (row["date"], row["symbol"], row["ticker"], row["exchange"], row["per_share"], row["units"],
                     row["currency"], row["gross_amount"], row["gross_amount_aud"], row["franking_pct"],
                     row["franking_credit_aud"], row["withholding_tax_pct"], row["net_amount_aud"], row["source"]),
                )
                inserted += 1
            conn.commit()
            results.append({"symbol": sym, "ok": True, "message": f"{inserted} payment(s) synced"})
        except Exception as e:
            results.append({"symbol": sym, "ok": False, "message": str(e)})
    conn.close()
    return jsonify({"results": results})


def get_performance():
    """Return historical timeline of portfolio value, principal, and return."""
    txns = load_transactions()
    if not txns:
        return jsonify({"dates": [], "value": [], "principal": [], "return_val": [], "return_pct": []})

    df = pd.DataFrame(txns)
    df["date"] = pd.to_datetime(df["date"])
    df["sym"] = df.apply(lambda r: yf_symbol(r["ticker"], r["exchange"]), axis=1)

    start = df["date"].min()
    end = pd.Timestamp(date.today())
    all_dates = pd.date_range(start, end, freq="D")

    conn = db()
    price_data = {}
    symbols_to_read = list(df["sym"].unique()) + ["AUDUSD=X"]
    
    for sym in symbols_to_read:
        rows = conn.execute(
            "SELECT date, close FROM prices WHERE symbol = ? ORDER BY date", (sym,)
        ).fetchall()
        if rows:
            # Reindex to all calendar days, forward-filling weekends/holidays
            s = pd.Series(
                {pd.Timestamp(d): c for d, c in rows}
            ).reindex(all_dates).ffill().bfill()
            # If still has NaNs, fill with 0 or 1.0 for exchange rate
            s = s.fillna(0.0 if sym != "AUDUSD=X" else 1.0)
        else:
            s = pd.Series(0.0 if sym != "AUDUSD=X" else 1.0, index=all_dates)
        price_data[sym] = s
    conn.close()

    fx_rates = price_data["AUDUSD=X"]
    
    # Track holdings and cash flow daily
    units_changes = pd.DataFrame(0.0, index=all_dates, columns=df["sym"].unique())
    cash_flow_changes = pd.Series(0.0, index=all_dates)
    sym_currency = df.groupby("sym")["currency"].first().to_dict()

    for _, row in df.iterrows():
        sym = row["sym"]
        action = row["action"].lower()
        if action == "buy":
            sign = 1
        elif action == "sell":
            sign = -1
        else:
            sign = 1  # split or other non-cash actions add units without cash flow
        units_changes.loc[row["date"], sym] += sign * row["units"]
        cash_flow_changes.loc[row["date"]] += row["value"]

    units_df = units_changes.cumsum()
    cash_flow = cash_flow_changes.cumsum()

    # Calculate portfolio value over time
    portfolio_value = pd.Series(0.0, index=all_dates)
    for sym in df["sym"].unique():
        prices = price_data[sym]
        if sym_currency[sym] == "USD":
            prices = prices / fx_rates  # Convert USD price to AUD
        portfolio_value += units_df[sym] * prices

    return_val = portfolio_value - cash_flow
    return_pct = pd.Series(0.0, index=all_dates)
    
    # Net return % calculation
    mask = cash_flow > 0.01
    return_pct[mask] = (return_val[mask] / cash_flow[mask]) * 100

    return jsonify({
        "dates": [d.strftime("%Y-%m-%d") for d in all_dates],
        "value": portfolio_value.round(2).tolist(),
        "principal": cash_flow.round(2).tolist(),
        "return_val": return_val.round(2).tolist(),
        "return_pct": return_pct.round(2).tolist(),
    })

def _compute_active_holdings():
    """Core holdings computation shared by /api/portfolio and anything else that
    needs per-holding value/cost/return (e.g. holding groups) — returns a plain
    list of dicts, not a Flask Response, so it's safe to call from other routes."""
    txns = load_transactions()
    if not txns:
        return []

    conn = db()
    latest_prices = {}
    prev_prices = {}
    rows = conn.execute("""
        SELECT symbol, close, date
        FROM prices
        WHERE (symbol, date) IN (
            SELECT symbol, MAX(date)
            FROM prices
            GROUP BY symbol
        )
    """).fetchall()
    for sym, close, dt in rows:
        latest_prices[sym] = close

    # Get previous close for daily change calculation
    prev_rows = conn.execute("""
        SELECT p.symbol, p.close
        FROM prices p
        INNER JOIN (
            SELECT symbol, MAX(date) as max_date
            FROM prices
            GROUP BY symbol
        ) latest ON p.symbol = latest.symbol
        WHERE p.date < latest.max_date
        AND (p.symbol, p.date) IN (
            SELECT symbol, MAX(date)
            FROM prices
            WHERE (symbol, date) NOT IN (
                SELECT symbol, MAX(date) FROM prices GROUP BY symbol
            )
            GROUP BY symbol
        )
    """).fetchall()
    for sym, close in prev_rows:
        prev_prices[sym] = close
    conn.close()

    audusd = latest_prices.get("AUDUSD=X", 0.65)

    # Sort chronologically to compute cost bases properly
    txns_sorted = sorted(txns, key=lambda x: x["date"])

    holdings = {}
    for t in txns_sorted:
        sym = yf_symbol(t["ticker"], t["exchange"])
        if sym not in holdings:
            holdings[sym] = {
                "ticker": t["ticker"],
                "exchange": t["exchange"],
                "name": t.get("name") or f"{t['ticker']} Stock",
                "currency": t.get("currency") or "AUD",
                "units": 0.0,
                "cost_aud": 0.0,
                "cost_local": 0.0,
                "buys_count": 0,
                "sells_count": 0
            }

        h = holdings[sym]
        qty = t["units"]

        if t["action"].lower() == "buy":
            h["units"] += qty
            h["cost_aud"] += t["value"]
            h["cost_local"] += qty * t["price"]
            h["buys_count"] += 1
        elif t["action"].lower() == "split":
            # Stock split: adjust units without changing cost basis
            # split "units" field stores the additional shares from the split
            h["units"] += qty
        elif t["action"].lower() == "sell":
            if h["units"] > 0:
                avg_cost_before = h["cost_aud"] / h["units"]
                avg_cost_local_before = h["cost_local"] / h["units"]
                h["units"] -= qty
                h["cost_aud"] -= qty * avg_cost_before
                h["cost_local"] -= qty * avg_cost_local_before
            else:
                h["units"] = 0
                h["cost_aud"] = 0
                h["cost_local"] = 0
            h["sells_count"] += 1

    active_holdings = []
    total_portfolio_value = 0.0

    for sym, h in holdings.items():
        if h["units"] <= 1e-5:
            continue

        current_price = latest_prices.get(sym, 0.0)
        prev_price = prev_prices.get(sym, current_price)  # fallback to current if no prev
        if h["currency"] == "USD":
            current_price_aud = current_price / audusd
            prev_price_aud = prev_price / audusd
        else:
            current_price_aud = current_price
            prev_price_aud = prev_price

        value_aud = h["units"] * current_price_aud
        total_portfolio_value += value_aud

        # Daily change
        daily_change = (current_price_aud - prev_price_aud) * h["units"]
        daily_change_pct = ((current_price_aud - prev_price_aud) / prev_price_aud * 100) if prev_price_aud > 0 else 0.0

        avg_price_aud = h["cost_aud"] / h["units"] if h["units"] > 0 else 0.0
        avg_price_local = h["cost_local"] / h["units"] if h["units"] > 0 else 0.0

        return_aud = value_aud - h["cost_aud"]
        return_pct = (return_aud / h["cost_aud"] * 100) if h["cost_aud"] > 0 else 0.0

        meta = fetch_holding_meta(h["ticker"], h["exchange"])

        active_holdings.append({
            "symbol": sym,
            "ticker": h["ticker"],
            "exchange": h["exchange"],
            "name": h["name"],
            "sector": meta.get("sector", "") if meta else "",
            "industry": meta.get("industry", "") if meta else "",
            "logo_url": meta.get("logo_url", "") if meta else "",
            "currency": h["currency"],
            "units": round(h["units"], 4),
            "cost_aud": round(h["cost_aud"], 2),
            "avg_price": round(avg_price_local, 4),
            "avg_price_aud": round(avg_price_aud, 4),
            "current_price": round(current_price, 4),
            "current_price_aud": round(current_price_aud, 4),
            "value_aud": round(value_aud, 2),
            "return_aud": round(return_aud, 2),
            "return_pct": round(return_pct, 2),
            "daily_change": round(daily_change, 2),
            "daily_change_pct": round(daily_change_pct, 2),
            "buys_count": h["buys_count"],
            "sells_count": h["sells_count"]
        })

    # Portfolio weightings
    for h in active_holdings:
        h["weight"] = round((h["value_aud"] / total_portfolio_value * 100), 2) if total_portfolio_value > 0 else 0.0

    # Sort holdings by value descending
    active_holdings.sort(key=lambda x: x["value_aud"], reverse=True)
    return active_holdings

@app.route("/api/portfolio", methods=["GET"])
def get_portfolio():
    """Return detailed analytics of current active holdings."""
    return jsonify(_compute_active_holdings())

@app.route("/api/holding-groups", methods=["GET"])
def get_holding_groups():
    """Return every group with computed aggregates — value, capital gain (unrealized),
    income (net dividends received), currency, and blended return % — plus a grand
    total row summing across every grouped holding. Mirrors the aggregates in a
    Sharesight custom-group report."""
    conn = db()
    rows = conn.execute("SELECT id, name, symbols FROM holding_groups ORDER BY id").fetchall()
    conn.close()

    holdings_by_symbol = {h["symbol"]: h for h in _compute_active_holdings()}

    div_conn = db()
    div_rows = div_conn.execute("SELECT symbol, net_amount_aud FROM dividends").fetchall()
    div_conn.close()
    income_by_symbol = {}
    for sym, net in div_rows:
        income_by_symbol[sym] = income_by_symbol.get(sym, 0.0) + net

    def _aggregate(symbols):
        value = capital_gain = cost_basis = income = 0.0
        currencies = set()
        for sym in symbols:
            h = holdings_by_symbol.get(sym)
            if h:
                value += h["value_aud"]
                capital_gain += h["return_aud"]
                cost_basis += h["cost_aud"]
                currencies.add(h["currency"])
            income += income_by_symbol.get(sym, 0.0)
        return_pct = ((capital_gain + income) / cost_basis * 100) if cost_basis > 0 else 0.0
        currency = currencies.pop() if len(currencies) == 1 else ("Mixed" if len(currencies) > 1 else "AUD")
        return {
            "value": round(value, 2), "capital_gain": round(capital_gain, 2),
            "income": round(income, 2), "currency": currency, "return_pct": round(return_pct, 2),
            "cost_basis": round(cost_basis, 2),
        }

    groups = []
    all_grouped_symbols = []
    for gid, name, symbols_str in rows:
        symbols = [s.strip() for s in symbols_str.split(",") if s.strip()]
        all_grouped_symbols.extend(symbols)
        agg = _aggregate(symbols)
        groups.append({"id": gid, "name": name, "symbols": symbols, **agg})

    grand_total = _aggregate(all_grouped_symbols)
    return jsonify({"groups": groups, "grand_total": grand_total})

@app.route("/api/holding-groups", methods=["POST"])
def add_holding_group():
    data = request.json
    try:
        symbols = data.get("symbols", [])
        conn = db()
        conn.execute(
            "INSERT INTO holding_groups (name, symbols) VALUES (?, ?)",
            (data["name"], ",".join(symbols)),
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/holding-groups/<int:group_id>", methods=["PUT"])
def update_holding_group(group_id):
    data = request.json
    try:
        symbols = data.get("symbols", [])
        conn = db()
        conn.execute(
            "UPDATE holding_groups SET name = ?, symbols = ? WHERE id = ?",
            (data["name"], ",".join(symbols), group_id),
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/holding-groups/<int:group_id>", methods=["DELETE"])
def delete_holding_group(group_id):
    conn = db()
    conn.execute("DELETE FROM holding_groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

def _build_daily_portfolio_value_series(conn):
    """Full daily portfolio-value series (same construction as /api/networth), as a
    pandas Series indexed by date. Shared by anything needing day-level portfolio
    value history — currently just the Daily ATH stat."""
    txns = load_transactions()
    if not txns:
        return None
    df = pd.DataFrame(txns)
    df["date"] = pd.to_datetime(df["date"])
    df["sym"] = df.apply(lambda r: yf_symbol(r["ticker"], r["exchange"]), axis=1)
    start = df["date"].min()
    end = pd.Timestamp(date.today())
    all_dates = pd.date_range(start, end, freq="D")

    price_data = {}
    symbols_to_read = list(df["sym"].unique()) + ["AUDUSD=X"]
    for sym in symbols_to_read:
        rows = conn.execute("SELECT date, close FROM prices WHERE symbol = ? ORDER BY date", (sym,)).fetchall()
        if rows:
            s = pd.Series({pd.Timestamp(d): c for d, c in rows}).reindex(all_dates).ffill().bfill()
            s = s.fillna(0.0 if sym != "AUDUSD=X" else 1.0)
        else:
            s = pd.Series(0.0 if sym != "AUDUSD=X" else 1.0, index=all_dates)
        price_data[sym] = s

    fx_rates = price_data["AUDUSD=X"]
    units_changes = pd.DataFrame(0.0, index=all_dates, columns=df["sym"].unique())
    sym_currency = df.groupby("sym")["currency"].first().to_dict()
    for _, row in df.iterrows():
        sign = -1 if row["action"].lower() == "sell" else 1
        units_changes.loc[row["date"], row["sym"]] += sign * row["units"]
    units_df = units_changes.cumsum()

    portfolio_value = pd.Series(0.0, index=all_dates)
    for sym in df["sym"].unique():
        prices = price_data[sym]
        if sym_currency[sym] == "USD":
            prices = prices / fx_rates
        portfolio_value += units_df[sym] * prices
    return portfolio_value

@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Return top level aggregated portfolio statistics."""
    txns = load_transactions()
    if not txns:
        return jsonify({
            "total_value": 0.0,
            "total_principal": 0.0,
            "total_return": 0.0,
            "total_return_pct": 0.0,
            "best_performer": "-",
            "best_performer_pct": 0.0,
            "worst_performer": "-",
            "worst_performer_pct": 0.0,
            "usd_allocation_pct": 0.0,
            "audusd_rate": 0.65,
            "all_time_high": 0.0,
            "all_time_high_date": None,
        })

    # Fetch latest exchange rate and holdings
    conn = db()
    audusd_row = conn.execute(
        "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' ORDER BY date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    audusd = float(audusd_row[0]) if audusd_row else 0.65

    # Retrieve holdings breakdown
    holdings = _compute_active_holdings()
    
    if not holdings:
        return jsonify({
            "total_value": 0.0,
            "total_principal": 0.0,
            "total_return": 0.0,
            "total_return_pct": 0.0,
            "best_performer": "-",
            "best_performer_pct": 0.0,
            "worst_performer": "-",
            "worst_performer_pct": 0.0,
            "usd_allocation_pct": 0.0,
            "audusd_rate": audusd,
            "all_time_high": 0.0,
            "all_time_high_date": None,
        })

    total_value = sum(h["value_aud"] for h in holdings)
    total_cost = sum(h["cost_aud"] for h in holdings)
    total_return = total_value - total_cost
    total_return_pct = (total_return / total_cost * 100) if total_cost > 0 else 0.0
    
    usd_value = sum(h["value_aud"] for h in holdings if h["currency"] == "USD")
    usd_allocation_pct = (usd_value / total_value * 100) if total_value > 0 else 0.0

    # Find best and worst performer by % return
    best_h = max(holdings, key=lambda x: x["return_pct"])
    worst_h = min(holdings, key=lambda x: x["return_pct"])

    # Track all-time portfolio high
    today = date.today().isoformat()
    conn2 = db()
    row = conn2.execute("SELECT value, date FROM records WHERE key = 'portfolio_high'").fetchone()
    if row is None or total_value > row[0]:
        conn2.execute(
            "INSERT OR REPLACE INTO records (key, value, date) VALUES ('portfolio_high', ?, ?)",
            (round(total_value, 2), today)
        )
        conn2.commit()
        ath_value, ath_date = round(total_value, 2), today
    else:
        ath_value, ath_date = round(row[0], 2), row[1]

    # Daily ATH — the single best day-over-day dollar increase in portfolio value ever
    # recorded (market-driven only — deliberately portfolio value, not net worth, so a
    # manually-entered cash/super update never gets misread as a market "gain").
    daily_ath_value, daily_ath_date = 0.0, None
    try:
        pv_series = _build_daily_portfolio_value_series(conn2)
        if pv_series is not None and len(pv_series) > 1:
            daily_diffs = pv_series.diff().dropna()
            if not daily_diffs.empty:
                best_idx = daily_diffs.idxmax()
                daily_ath_value = round(float(daily_diffs.loc[best_idx]), 2)
                daily_ath_date = best_idx.strftime("%Y-%m-%d")
    except Exception as e:
        print(f"[stats] daily_ath calc failed (non-fatal): {e}")
    conn2.close()

    return jsonify({
        "total_value": round(total_value, 2),
        "total_principal": round(total_cost, 2),
        "total_return": round(total_return, 2),
        "total_return_pct": round(total_return_pct, 2),
        "best_performer": f"{best_h['ticker']} ({best_h['return_pct']:+.1f}%)",
        "best_performer_pct": round(best_h["return_pct"], 2),
        "worst_performer": f"{worst_h['ticker']} ({worst_h['return_pct']:+.1f}%)",
        "worst_performer_pct": round(worst_h["return_pct"], 2),
        "usd_allocation_pct": round(usd_allocation_pct, 2),
        "audusd_rate": round(audusd, 4),
        "all_time_high": ath_value,
        "all_time_high_date": ath_date,
        "daily_ath": daily_ath_value,
        "daily_ath_date": daily_ath_date,
    })

def _get_latest_portfolio_value():
    """Helper: return total portfolio value from current holdings."""
    txns = load_transactions()
    if not txns:
        return 0.0, 0.0, 0.0  # value, active_stocks, passive_stocks
    conn = db()
    latest_prices = {}
    rows = conn.execute("""
        SELECT symbol, close FROM prices
        WHERE (symbol, date) IN (
            SELECT symbol, MAX(date) FROM prices GROUP BY symbol
        )
    """).fetchall()
    for sym, close in rows:
        latest_prices[sym] = close
    conn.close()
    audusd = latest_prices.get("AUDUSD=X", 0.65)

    txns_sorted = sorted(txns, key=lambda x: x["date"])
    holdings = {}
    for t in txns_sorted:
        sym = yf_symbol(t["ticker"], t["exchange"])
        if sym not in holdings:
            holdings[sym] = {
                "ticker": t["ticker"], "exchange": t["exchange"],
                "name": t.get("name") or f"{t['ticker']} Stock",
                "currency": t.get("currency") or "AUD",
                "units": 0.0
            }
        h = holdings[sym]
        qty = t["units"]
        if t["action"].lower() == "buy":
            h["units"] += qty
        elif t["action"].lower() == "split":
            h["units"] += qty
        elif t["action"].lower() == "sell":
            h["units"] = max(0, h["units"] - qty)

    total_value = 0.0
    active_value = 0.0
    passive_value = 0.0
    for sym, h in holdings.items():
        if h["units"] <= 1e-5:
            continue
        price = latest_prices.get(sym, 0.0)
        if h["currency"] == "USD":
            price = price / audusd
        val = h["units"] * price
        total_value += val
        # Classification: ETFs contain "Etf" or "Index" in name
        name_lower = h["name"].lower()
        if "etf" in name_lower or "index" in name_lower:
            passive_value += val
        else:
            active_value += val
    return total_value, active_value, passive_value

def _order_parcels_for_disposal(parcels, method):
    """Return parcels ordered by which should be treated as sold first, per method.
    fifo = oldest first (default, what Sharesight uses unless configured otherwise)
    lifo = newest first
    hifo = highest cost-per-unit first (minimizes reported gain — a legitimate,
           commonly-offered specific-identification strategy, not a shortcut)
    """
    live = [p for p in parcels if p["units"] > 1e-9]
    if method == "lifo":
        return sorted(live, key=lambda p: p["date"], reverse=True)
    if method == "hifo":
        return sorted(live, key=lambda p: (p["cost_aud"] / p["units"]) if p["units"] > 0 else 0, reverse=True)
    return sorted(live, key=lambda p: p["date"])  # fifo default

@app.route("/api/cgt", methods=["GET"])
def get_cgt():
    """Calculate Australian CGT for sells within a date range, using real per-parcel
    lot tracking (not blended average cost) so the 12-month discount test applies to
    the specific units actually disposed of — a single sale can legitimately be part
    discount-eligible and part not, if it draws from parcels of different ages."""
    from_date = request.args.get("from", "")
    to_date = request.args.get("to", "")
    method = request.args.get("method", "fifo").lower()
    if method not in ("fifo", "lifo", "hifo"):
        method = "fifo"

    txns = load_transactions()
    if not txns:
        return jsonify({"gains": [], "total_gain": 0, "losses_applied": 0, "cgt_discount": 0, "net_gain": 0, "from": from_date, "to": to_date, "method": method})

    sells = [t for t in txns if t["action"].lower() == "sell"]
    if from_date:
        sells = [t for t in sells if t["date"] >= from_date]
    if to_date:
        sells = [t for t in sells if t["date"] <= to_date]
    if not sells:
        return jsonify({"gains": [], "total_gain": 0, "losses_applied": 0, "cgt_discount": 0, "net_gain": 0, "from": from_date, "to": to_date, "method": method})

    txns_sorted = sorted(txns, key=lambda x: x["date"])
    parcels_by_sym = {}  # sym -> list of {date, units, cost_aud} — one entry per buy lot, consumed over time

    gains = []
    for t in txns_sorted:
        sym = yf_symbol(t["ticker"], t["exchange"])
        parcels = parcels_by_sym.setdefault(sym, [])
        action = t["action"].lower()

        if action == "buy":
            parcels.append({"date": t["date"], "units": t["units"], "cost_aud": t["value"]})

        elif action == "split":
            # Scale every existing parcel's units up proportionally, cost basis unchanged
            total_units = sum(p["units"] for p in parcels)
            if total_units > 1e-9:
                ratio = (total_units + t["units"]) / total_units
                for p in parcels:
                    p["units"] *= ratio

        elif action == "sell":
            units_to_sell = t["units"]
            proceeds_total = abs(t["value"])
            proceeds_per_unit = proceeds_total / units_to_sell if units_to_sell > 0 else 0

            in_range = (not from_date or t["date"] >= from_date) and (not to_date or t["date"] <= to_date)

            ordered = _order_parcels_for_disposal(parcels, method)
            remaining = units_to_sell
            for p in ordered:
                if remaining <= 1e-9:
                    break
                take = min(p["units"], remaining)
                per_unit_cost = p["cost_aud"] / p["units"] if p["units"] > 0 else 0
                slice_cost = take * per_unit_cost
                slice_proceeds = take * proceeds_per_unit
                slice_gain = slice_proceeds - slice_cost

                buy_dt = pd.Timestamp(p["date"])
                sell_dt = pd.Timestamp(t["date"])
                held_12m = (sell_dt - buy_dt).days >= 365

                if in_range:
                    gains.append({
                        "date": t["date"],
                        "acquired_date": p["date"],
                        "ticker": t["ticker"],
                        "name": t.get("name", ""),
                        "units": round(take, 4),
                        "proceeds": round(slice_proceeds, 2),
                        "cost": round(slice_cost, 2),
                        "gain": round(slice_gain, 2),
                        "held_12m": held_12m,
                        "discount_eligible": held_12m and slice_gain > 0,
                    })

                p["units"] -= take
                p["cost_aud"] -= slice_cost
                remaining -= take

    # Calculate CGT summary
    total_gain = sum(g["gain"] for g in gains)
    total_losses = sum(g["gain"] for g in gains if g["gain"] < 0)
    total_discountable = sum(g["gain"] for g in gains if g["discount_eligible"])

    # Apply losses first to non-discounted gains, then to discounted
    losses_remaining = abs(total_losses)
    discounted_after_losses = max(0, total_discountable - losses_remaining)
    losses_remaining = max(0, losses_remaining - total_discountable)
    non_discounted = sum(g["gain"] for g in gains if g["gain"] > 0 and not g["discount_eligible"])
    non_discounted_after_losses = max(0, non_discounted - losses_remaining)

    cgt_discount = round(discounted_after_losses * 0.5, 2)
    net_gain = round(discounted_after_losses * 0.5 + non_discounted_after_losses, 2)
    losses_applied = round(abs(total_losses), 2)

    return jsonify({
        "gains": gains,
        "total_gain": round(total_gain, 2),
        "losses_applied": losses_applied,
        "cgt_discount": cgt_discount,
        "net_gain": net_gain,
        "from": from_date,
        "to": to_date,
        "method": method,
    })
@app.route("/api/snapshots", methods=["GET"])
def get_snapshots():
    """Return all cash + super snapshots sorted by date."""
    conn = db()
    rows = conn.execute("SELECT date, super, cash FROM snapshots ORDER BY date").fetchall()
    conn.close()
    return jsonify([{"date": r[0], "super": r[1], "cash": r[2]} for r in rows])

@app.route("/api/snapshots", methods=["POST"])
def add_snapshot():
    """Add or update a cash + super snapshot. Persists to DB and snapshots.json."""
    data = request.json
    try:
        date_str = data["date"]
        super_val = float(data["super"])
        cash_val = float(data["cash"])
        conn = db()
        conn.execute(
            "INSERT OR REPLACE INTO snapshots (date, super, cash) VALUES (?, ?, ?)",
            (date_str, super_val, cash_val),
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/milestones", methods=["GET"])
def get_milestones():
    """Return all milestones with live current values for linked metrics.

    Goals can track multiple metrics at once (e.g. cash + portfolio), which are
    summed live. Targets can be set in AUD or USD — a USD target is converted to
    its AUD equivalent using the latest cached AUDUSD=X rate on every request, so
    the goal's progress moves with the exchange rate rather than freezing at the
    rate that was in effect when the milestone was created.
    """
    # Get live metrics once
    live = {}
    audusd = 0.65
    try:
        conn2 = db()
        fx_row = conn2.execute(
            "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' ORDER BY date DESC LIMIT 1"
        ).fetchone()
        if fx_row and fx_row[0]:
            audusd = fx_row[0]

        portfolio_val, active_val, passive_val = _get_latest_portfolio_value()
        cash = get_total_cash()
        today = date.today().isoformat()
        row = conn2.execute("SELECT super FROM snapshots WHERE date <= ? ORDER BY date DESC LIMIT 1", (today,)).fetchone()
        conn2.close()
        super_val = row[0] if row else 0.0
        holdings = _compute_active_holdings()
        stats_data = {}
        if holdings:
            total_cost = sum(h.get("cost_aud", 0) for h in holdings)
            total_val = sum(h.get("value_aud", 0) for h in holdings)
            stats_data["return_pct"] = round((total_val - total_cost) / total_cost * 100, 2) if total_cost else 0
            stats_data["return_aud"] = round(total_val - total_cost, 2)
        live = {
            "portfolio": round(portfolio_val, 2),
            "networth": round(portfolio_val + cash + super_val, 2),
            "cash": round(cash, 2),
            "super": round(super_val, 2),
            "return_pct": stats_data.get("return_pct", 0),
            "return_aud": stats_data.get("return_aud", 0),
        }
    except:
        pass

    conn = db()
    rows = conn.execute(
        "SELECT id, date, title, description, category, value, type, target_value, current_value, "
        "is_achieved, linked_metric, achieved_date, linked_metrics, currency FROM milestones ORDER BY date DESC"
    ).fetchall()

    results = []
    for r in rows:
        mtype = r[6] or "achievement"
        linked_legacy = r[10]
        current_val = r[8]
        is_achieved = bool(r[9])
        achieved_date = r[11]
        linked_metrics_raw = r[12]
        currency = r[13] or "AUD"
        target_value = r[7]

        # New multi-metric field wins; fall back to the legacy single-metric field
        metrics = (
            [m.strip() for m in linked_metrics_raw.split(",") if m.strip()]
            if linked_metrics_raw else ([linked_legacy] if linked_legacy else [])
        )

        # A target set in USD is re-converted to its AUD equivalent at the *current*
        # rate every time this endpoint runs, so it fluctuates with the market
        # rather than being fixed at entry time.
        target_value_aud = target_value
        if target_value is not None and currency == "USD" and audusd:
            target_value_aud = target_value / audusd

        if mtype == "goal" and metrics and all(m in live for m in metrics):
            current_val = round(sum(live[m] for m in metrics), 2)
            if target_value_aud is not None and current_val >= target_value_aud and not is_achieved:
                is_achieved = True
                achieved_date = date.today().isoformat()
                conn.execute("UPDATE milestones SET is_achieved=1, achieved_date=?, current_value=? WHERE id=?",
                             (achieved_date, current_val, r[0]))
            elif not is_achieved:
                conn.execute("UPDATE milestones SET current_value=? WHERE id=?", (current_val, r[0]))

        results.append({
            "id": r[0],
            "date": r[1],
            "title": r[2],
            "description": r[3],
            "category": r[4],
            "value": r[5],
            "type": mtype,
            "target_value": target_value,
            "target_value_aud": round(target_value_aud, 2) if target_value_aud is not None else None,
            "current_value": current_val,
            "is_achieved": is_achieved,
            "linked_metric": linked_legacy,
            "linked_metrics": metrics,
            "currency": currency,
            "achieved_date": achieved_date,
        })
    conn.commit()
    conn.close()
    return jsonify(results)

@app.route("/api/milestones", methods=["POST"])
def add_milestone():
    data = request.json
    try:
        conn = db()
        mtype = data.get("type", "achievement")

        # Accept either the new multi-metric list or the legacy single metric
        metrics = data.get("linked_metrics") or ([data["linked_metric"]] if data.get("linked_metric") else [])
        linked_metrics_str = ",".join(metrics) if metrics else None
        linked = metrics[0] if metrics else None  # keep legacy column populated for backward compat

        currency = data.get("currency") or "AUD"
        target_value = data.get("target_value")
        target_value_aud = target_value
        if target_value is not None and currency == "USD":
            fx_row = conn.execute(
                "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' ORDER BY date DESC LIMIT 1"
            ).fetchone()
            audusd = fx_row[0] if fx_row and fx_row[0] else 0.65
            target_value_aud = target_value / audusd

        is_achieved = False
        achieved_date = None
        current_val = data.get("current_value")
        if mtype == "goal" and current_val is not None and target_value_aud is not None:
            if current_val >= target_value_aud:
                is_achieved = True
                achieved_date = date.today().isoformat()
        conn.execute(
            "INSERT INTO milestones (date, title, description, category, value, type, target_value, current_value, "
            "is_achieved, linked_metric, achieved_date, linked_metrics, currency) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (data["date"], data["title"], data.get("description", ""), data["category"],
             data.get("value"), mtype, target_value, current_val,
             int(is_achieved), linked, achieved_date, linked_metrics_str, currency)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/milestones/<int:milestone_id>", methods=["PUT"])
def update_milestone(milestone_id):
    data = request.json
    try:
        conn = db()
        mtype = data.get("type", "achievement")

        metrics = data.get("linked_metrics") or ([data["linked_metric"]] if data.get("linked_metric") else [])
        linked_metrics_str = ",".join(metrics) if metrics else None
        linked = metrics[0] if metrics else None

        currency = data.get("currency") or "AUD"
        target_value = data.get("target_value")
        target_value_aud = target_value
        if target_value is not None and currency == "USD":
            fx_row = conn.execute(
                "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' ORDER BY date DESC LIMIT 1"
            ).fetchone()
            audusd = fx_row[0] if fx_row and fx_row[0] else 0.65
            target_value_aud = target_value / audusd

        is_achieved = data.get("is_achieved", False)
        achieved_date = data.get("achieved_date")
        current_val = data.get("current_value")
        if mtype == "goal" and current_val is not None and target_value_aud is not None:
            if current_val >= target_value_aud and not is_achieved:
                is_achieved = True
                achieved_date = date.today().isoformat()
        conn.execute(
            "UPDATE milestones SET date=?,title=?,description=?,category=?,value=?,type=?,target_value=?,current_value=?,"
            "is_achieved=?,linked_metric=?,achieved_date=?,linked_metrics=?,currency=? WHERE id=?",
            (data["date"], data["title"], data.get("description", ""), data["category"],
             data.get("value"), mtype, target_value, current_val,
             int(is_achieved), linked, achieved_date, linked_metrics_str, currency, milestone_id)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/milestones/<int:milestone_id>", methods=["DELETE"])
def delete_milestone(milestone_id):
    """Delete a milestone by ID."""
    try:
        conn = db()
        conn.execute("DELETE FROM milestones WHERE id = ?", (milestone_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/breakdown", methods=["GET"])
def get_breakdown():
    """Return current asset breakdown: cash (from accounts), super (from snapshot), stocks."""
    conn = db()
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT super FROM snapshots WHERE date <= ? ORDER BY date DESC LIMIT 1", (today,)
    ).fetchone()
    conn.close()
    super_val = row[0] if row else 0.0
    cash = get_total_cash()
    portfolio_val, active_val, passive_val = _get_latest_portfolio_value()
    return jsonify({
        "cash": cash,
        "super": round(super_val, 2),
        "stocks_active": round(active_val, 2),
        "stocks_passive": round(passive_val, 2),
        "portfolio": round(portfolio_val, 2),
        "total": round(cash + super_val + portfolio_val, 2),
    })

@app.route("/api/allocation", methods=["GET"])
def get_allocation():
    """Return dynamic country allocation using overrides, super holdings, and cash accounts."""
    conn = db()
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT super FROM snapshots WHERE date <= ? ORDER BY date DESC LIMIT 1", (today,)
    ).fetchone()
    conn.close()
    super_total = row[0] if row else 0.0

    txns = load_transactions()
    conn = db()
    latest_prices = {}
    rows = conn.execute("""
        SELECT symbol, close FROM prices
        WHERE (symbol, date) IN (
            SELECT symbol, MAX(date) FROM prices GROUP BY symbol
        )
    """).fetchall()
    for sym, close in rows:
        latest_prices[sym] = close
    conn.close()
    audusd = latest_prices.get("AUDUSD=X", 0.65)

    txns_sorted = sorted(txns, key=lambda x: x["date"])
    holdings = {}
    for t in txns_sorted:
        sym = yf_symbol(t["ticker"], t["exchange"])
        if sym not in holdings:
            holdings[sym] = {
                "ticker": t["ticker"], "exchange": t["exchange"],
                "name": t.get("name", ""), "currency": t.get("currency") or "AUD", "units": 0.0
            }
        h = holdings[sym]
        qty = t["units"]
        if t["action"].lower() == "buy":
            h["units"] += qty
        elif t["action"].lower() == "split":
            h["units"] += qty
        elif t["action"].lower() == "sell":
            h["units"] = max(0, h["units"] - qty)

    # Aggregate by dynamic country labels
    countries = {}
    for sym, h in holdings.items():
        if h["units"] <= 1e-5:
            continue
        price = latest_prices.get(sym, 0.0)
        if h["currency"] == "USD":
            price = price / audusd
        val = h["units"] * price
        country = get_holding_country(h["ticker"], h["exchange"], h["name"])
        countries[country] = countries.get(country, 0) + val

    # Super: distribute across countries from super_holdings.json
    super_holdings = load_super_holdings()
    if super_holdings:
        for sh in super_holdings:
            c = sh.get("country", "Unknown")
            pct = sh.get("allocation_pct", 0) / 100.0
            countries[c] = countries.get(c, 0) + (super_total * pct)
    else:
        countries["AU"] = countries.get("AU", 0) + super_total

    # Cash accounts: distribute by country
    cash_accounts = load_cash_accounts()
    for ca in cash_accounts:
        c = ca.get("country", "AU")
        countries[c] = countries.get(c, 0) + ca.get("balance", 0)

    total = sum(countries.values())
    result = {"countries": {}, "total": round(total, 2)}
    for country, value in sorted(countries.items(), key=lambda x: x[1], reverse=True):
        result["countries"][country] = {
            "value": round(value, 2),
            "pct": round(value / total * 100, 2) if total > 0 else 0.0
        }
    return jsonify(result)

# ─── Config CRUD Endpoints ─────────────────────────────────

@app.route("/api/cash-accounts", methods=["GET"])
def get_cash_accounts():
    return jsonify(load_cash_accounts())

@app.route("/api/cash-accounts", methods=["POST"])
def save_cash_accounts_route():
    data = request.json
    try:
        save_cash_accounts(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/super-holdings", methods=["GET"])
def get_super_holdings_route():
    return jsonify(load_super_holdings())

@app.route("/api/super-holdings", methods=["POST"])
def save_super_holdings_route():
    data = request.json
    try:
        save_super_holdings(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/api/country-overrides", methods=["GET"])
def get_country_overrides_route():
    return jsonify(load_country_overrides())

@app.route("/api/country-overrides", methods=["POST"])
def save_country_overrides_route():
    data = request.json
    try:
        save_country_overrides(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

# ─── End Config CRUD ───────────────────────────────────────

@app.route("/api/networth", methods=["GET"])
def get_networth():
    """Return combined net worth timeline: portfolio + cash + super."""
    txns = load_transactions()
    if not txns:
        return jsonify({"dates": [], "portfolio": [], "cash": [], "super": [], "net_worth": []})

    # Build daily portfolio value (same logic as /api/performance)
    df = pd.DataFrame(txns)
    df["date"] = pd.to_datetime(df["date"])
    df["sym"] = df.apply(lambda r: yf_symbol(r["ticker"], r["exchange"]), axis=1)

    start = df["date"].min()
    end = pd.Timestamp(date.today())
    all_dates = pd.date_range(start, end, freq="D")

    conn = db()
    price_data = {}
    symbols_to_read = list(df["sym"].unique()) + ["AUDUSD=X"]
    for sym in symbols_to_read:
        rows = conn.execute(
            "SELECT date, close FROM prices WHERE symbol = ? ORDER BY date", (sym,)
        ).fetchall()
        if rows:
            s = pd.Series({pd.Timestamp(d): c for d, c in rows}).reindex(all_dates).ffill().bfill()
            s = s.fillna(0.0 if sym != "AUDUSD=X" else 1.0)
        else:
            s = pd.Series(0.0 if sym != "AUDUSD=X" else 1.0, index=all_dates)
        price_data[sym] = s

    fx_rates = price_data["AUDUSD=X"]
    units_changes = pd.DataFrame(0.0, index=all_dates, columns=df["sym"].unique())
    sym_currency = df.groupby("sym")["currency"].first().to_dict()

    for _, row in df.iterrows():
        sym = row["sym"]
        action = row["action"].lower()
        if action == "buy":
            sign = 1
        elif action == "sell":
            sign = -1
        else:
            sign = 1  # split
        units_changes.loc[row["date"], sym] += sign * row["units"]

    units_df = units_changes.cumsum()
    portfolio_value = pd.Series(0.0, index=all_dates)
    for sym in df["sym"].unique():
        prices = price_data[sym]
        if sym_currency[sym] == "USD":
            prices = prices / fx_rates
        portfolio_value += units_df[sym] * prices

    # Cumulative cash flow (cost basis) for return calculation
    cash_flow_changes = pd.Series(0.0, index=all_dates)
    for _, row in df.iterrows():
        cash_flow_changes.loc[row["date"]] += row["value"]
    cash_flow = cash_flow_changes.cumsum()
    return_val = portfolio_value - cash_flow

    # Build cash + super timeline (forward-filled from snapshots)
    snapshots = conn.execute("SELECT date, super, cash FROM snapshots ORDER BY date").fetchall()
    conn.close()

    cash_series = pd.Series(0.0, index=all_dates)
    super_series = pd.Series(0.0, index=all_dates)
    for s_date, s_super, s_cash in snapshots:
        ts = pd.Timestamp(s_date)
        if ts in all_dates:
            cash_series.loc[ts:] = s_cash
            super_series.loc[ts:] = s_super
    # Forward-fill from first snapshot back to start
    if snapshots:
        first_ts = pd.Timestamp(snapshots[0][0])
        cash_series.loc[:first_ts] = snapshots[0][2]
        super_series.loc[:first_ts] = snapshots[0][1]

    net_worth = portfolio_value + cash_series + super_series

    return jsonify({
        "dates": [d.strftime("%Y-%m-%d") for d in all_dates],
        "portfolio": portfolio_value.round(2).tolist(),
        "cash": cash_series.round(2).tolist(),
        "super": super_series.round(2).tolist(),
        "net_worth": net_worth.round(2).tolist(),
        "return_val": return_val.round(2).tolist(),
    })

@app.route("/api/monthly-change", methods=["GET"])
def get_monthly_change():
    """Return month-over-month net worth change."""
    txns = load_transactions()
    conn = db()
    snapshots = conn.execute("SELECT date, super, cash FROM snapshots ORDER BY date").fetchall()
    conn.close()

    if not snapshots:
        return jsonify({"months": [], "change": [], "change_pct": []})

    # Build portfolio value at each snapshot date
    df = pd.DataFrame(txns)
    df["date"] = pd.to_datetime(df["date"])
    df["sym"] = df.apply(lambda r: yf_symbol(r["ticker"], r["exchange"]), axis=1)

    conn = db()
    # Get price data
    price_data = {}
    symbols_to_read = list(df["sym"].unique()) + ["AUDUSD=X"]
    for sym in symbols_to_read:
        rows = conn.execute(
            "SELECT date, close FROM prices WHERE symbol = ? ORDER BY date", (sym,)
        ).fetchall()
        if rows:
            price_data[sym] = {pd.Timestamp(d): c for d, c in rows}
        else:
            price_data[sym] = {}
    conn.close()

    audusd_rates = price_data.get("AUDUSD=X", {})
    sym_currency = df.groupby("sym")["currency"].first().to_dict()

    months = []
    changes = []
    changes_pct = []
    prev_nw = None

    for s_date, s_super, s_cash in snapshots:
        s_ts = pd.Timestamp(s_date)
        # Calculate portfolio value at this snapshot date
        portfolio_val = 0.0
        for sym in df["sym"].unique():
            # Get units up to this date
            units = 0.0
            for _, row in df.iterrows():
                if row["date"] > s_ts:
                    break
                if row["sym"] != sym:
                    continue
                action = row["action"].lower()
                if action == "buy":
                    units += row["units"]
                elif action == "split":
                    units += row["units"]
                elif action == "sell":
                    units = max(0, units - row["units"])

            # Find closest price on or before snapshot date
            sym_prices = price_data.get(sym, {})
            available_dates = [d for d in sym_prices if d <= s_ts]
            if available_dates:
                closest = max(available_dates)
                price = sym_prices[closest]
                if sym_currency.get(sym, "AUD") == "USD":
                    aud_dates = [d for d in audusd_rates if d <= s_ts]
                    rate = audusd_rates[max(aud_dates)] if aud_dates else 0.65
                    price = price / rate
                portfolio_val += units * price

        total_nw = portfolio_val + s_cash + s_super
        months.append(s_date)

        if prev_nw is not None and prev_nw > 0:
            change = total_nw - prev_nw
            pct = (change / prev_nw) * 100
            changes.append(round(change, 2))
            changes_pct.append(round(pct, 2))
        else:
            changes.append(0.0)
            changes_pct.append(0.0)

        prev_nw = total_nw

    return jsonify({"months": months, "change": changes, "change_pct": changes_pct})

# On startup: seed snapshots if DB is empty, then start background price sync
try:
    seed_historical_snapshots()
except Exception as e:
    print(f"[backend] seed_historical_snapshots failed (non-fatal, continuing startup): {e}")

# Background price sync — runs automatically after market close (UTC times)
# ASX closes ~06:00 UTC, NYSE/NASDAQ closes ~21:00 UTC
def _scheduled_sync():
    print(f"[scheduler] Auto-sync triggered at {datetime.now().isoformat()}")
    try:
        results = _run_sync()
        ok = sum(1 for r in results if r.get("ok"))
        print(f"[scheduler] Sync complete: {ok}/{len(results)} symbols OK")
    except Exception as e:
        print(f"[scheduler] Sync failed: {e}")

_scheduler = BackgroundScheduler()
_scheduler.add_job(_scheduled_sync, "cron", hour=6, minute=15, id="asx_close")   # after ASX close
_scheduler.add_job(_scheduled_sync, "cron", hour=21, minute=15, id="us_close")   # after NYSE/NASDAQ close
_scheduler.start()
print("[scheduler] Auto-sync scheduled: 06:15 UTC (ASX), 21:15 UTC (NYSE/NASDAQ)")

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5050)