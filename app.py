"""
Net Worth Tracker - Production Ready
------------------------------------
Flask application with SQLite caching, multi-currency support (AUD to USD),
and detailed portfolio analytics.

Ingests transaction data from all_trades.csv on startup if transactions.json is missing.
Caches historical closing prices and exchange rates from Yahoo Finance.
"""

from flask import Flask, render_template, request, jsonify
import yfinance as yf
import pandas as pd
import json
import os
import sqlite3
from datetime import datetime, date, timedelta

app = Flask(__name__, template_folder="templates", static_folder="static")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "transactions.json")
SNAPSHOT_FILE = os.path.join(BASE_DIR, "snapshots.json")
CASH_ACCOUNTS_FILE = os.path.join(BASE_DIR, "cash_accounts.json")
SUPER_HOLDINGS_FILE = os.path.join(BASE_DIR, "super_holdings.json")
COUNTRY_OVERRIDES_FILE = os.path.join(BASE_DIR, "country_overrides.json")
HOLDING_META_FILE = os.path.join(BASE_DIR, "holding_meta.json")
DB_FILE = os.path.join(BASE_DIR, "prices.db")
CSV_FILE = os.path.join(BASE_DIR, "all_trades.csv")
EXCEL_FILE = os.path.join(BASE_DIR, "AllTradesReport.xlsx")

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
    conn = sqlite3.connect(DB_FILE)
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
    """Load transactions. Prioritizes Excel, then CSV, then existing JSON."""
    if os.path.exists(EXCEL_FILE):
        if not os.path.exists(DATA_FILE) or os.path.getmtime(EXCEL_FILE) > os.path.getmtime(DATA_FILE):
            return ingest_excel_to_json()
            
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE) as f:
                txns = json.load(f)
                if txns:
                    return txns
        except Exception:
            pass
            
    if os.path.exists(CSV_FILE):
        if not os.path.exists(DATA_FILE) or os.path.getmtime(CSV_FILE) > os.path.getmtime(DATA_FILE):
            return ingest_csv_to_json()
            
    return []

def save_transactions(txns):
    """Save transactions to transactions.json."""
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(txns, f, indent=2)

# ─── Cash Accounts, Super Holdings, Country Overrides ───────

def load_cash_accounts():
    if not os.path.exists(CASH_ACCOUNTS_FILE):
        return []
    with open(CASH_ACCOUNTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_cash_accounts(accounts):
    with open(CASH_ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2)

def load_super_holdings():
    if not os.path.exists(SUPER_HOLDINGS_FILE):
        return []
    with open(SUPER_HOLDINGS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_super_holdings(holdings):
    with open(SUPER_HOLDINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(holdings, f, indent=2)

def load_country_overrides():
    if not os.path.exists(COUNTRY_OVERRIDES_FILE):
        return {}
    with open(COUNTRY_OVERRIDES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_country_overrides(overrides):
    with open(COUNTRY_OVERRIDES_FILE, "w", encoding="utf-8") as f:
        json.dump(overrides, f, indent=2)

def load_holding_meta():
    if not os.path.exists(HOLDING_META_FILE):
        return {}
    with open(HOLDING_META_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_holding_meta(meta):
    with open(HOLDING_META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

def fetch_holding_meta(ticker, exchange):
    """Fetch sector, industry, logo from yfinance for a ticker. Returns dict or None."""
    meta = load_holding_meta()
    ysym = yf_symbol(ticker, exchange)
    if ysym in meta:
        return meta[ysym]

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
        meta[ysym] = entry
        save_holding_meta(meta)
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

def save_snapshots_to_json():
    """Export all snapshots from DB to snapshots.json."""
    conn = db()
    rows = conn.execute("SELECT date, super, cash FROM snapshots ORDER BY date").fetchall()
    conn.close()
    data = [{"date": r[0], "super": r[1], "cash": r[2]} for r in rows]
    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def seed_historical_snapshots():
    """Seed the snapshots table from snapshots.json (git-tracked source of truth)."""
    if not os.path.exists(SNAPSHOT_FILE):
        # Generate initial snapshots.json from hardcoded historical data
        _create_initial_snapshots_json()

    with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    conn = db()
    conn.execute("DELETE FROM snapshots")  # Replace with JSON source of truth
    for entry in data:
        conn.execute(
            "INSERT OR REPLACE INTO snapshots (date, super, cash) VALUES (?, ?, ?)",
            (entry["date"], entry["super"], entry["cash"]),
        )
    conn.commit()
    conn.close()
    print(f"[backend] Loaded {len(data)} cash/super snapshots from snapshots.json.")

def _create_initial_snapshots_json():
    """One-time: create snapshots.json from example data (placeholder values only)."""
    data = [
        ("2024-01-01", 100000, 50000),
        ("2024-02-01", 102000, 52000),
        ("2024-03-01", 104000, 54000),
    ]
    json_data = [{"date": d, "super": s, "cash": c} for d, s, c in data]
    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=2)
    print(f"[backend] Created snapshots.json with {len(json_data)} sample entries.")

def sync_symbol(conn, symbol, needed_start, needed_end, force=False):
    """Fetch and cache only missing historical daily close prices for symbol.
    Returns (ok, message)."""
    # 15-minute cooldown check
    row = conn.execute(
        "SELECT cached_from, cached_to, last_synced FROM sync_log WHERE symbol = ?", (symbol,)
    ).fetchone()

    now = pd.Timestamp.now()
    if row is not None and not force:
        cached_from = pd.Timestamp(row[0])
        cached_to = pd.Timestamp(row[1])
        last_synced = pd.Timestamp(row[2])
        if now - last_synced < timedelta(minutes=15) and needed_end <= cached_to:
            return True, "Cached recently"

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

    any_rows_fetched = False
    errors = []
    for f_start, f_end in ranges_to_fetch:
        if f_start > f_end:
            continue
        try:
            hist = yf.Ticker(symbol).history(
                start=f_start, end=f_end + timedelta(days=1)
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
            any_rows_fetched = True
        except Exception as e:
            errors.append(str(e))
            print(f"[sync] Failed to fetch {symbol} {f_start.date()} -> {f_end.date()}: {e}")

    # Mark range as cached if no error occurred
    if not errors and (any_rows_fetched or row is not None or ranges_to_fetch):
        all_from = min([r[0] for r in ranges_to_fetch] + ([pd.Timestamp(row[0])] if row else []))
        all_to = max([r[1] for r in ranges_to_fetch] + ([pd.Timestamp(row[1])] if row else []))
        conn.execute(
            "INSERT OR REPLACE INTO sync_log (symbol, last_synced, cached_from, cached_to) "
            "VALUES (?, ?, ?, ?)",
            (symbol, now.isoformat(), all_from.strftime("%Y-%m-%d"), all_to.strftime("%Y-%m-%d")),
        )
    conn.commit()

    if not ranges_to_fetch:
        return True, "Up to date"
    if errors:
        return False, "; ".join(errors)
    return True, "Synced successfully"

@app.route("/")
def index():
    """Render dashboard shell."""
    return render_template("index.html")

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
    """Delete a transaction by index."""
    txns = load_transactions()
    if 0 <= idx < len(txns):
        txns.pop(idx)
        save_transactions(txns)
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Index out of range"}), 404

@app.route("/api/sync", methods=["POST"])
def sync_data():
    """Trigger update of cached price data and exchange rates."""
    txns = load_transactions()
    if not txns:
        return jsonify({"results": [], "message": "No transactions to sync"})

    force = request.args.get("force", "").lower() == "true"
    
    df = pd.DataFrame(txns)
    df["date"] = pd.to_datetime(df["date"])
    df["sym"] = df.apply(lambda r: yf_symbol(r["ticker"], r["exchange"]), axis=1)
    
    # We want data up to today
    end = pd.Timestamp(date.today())
    min_date = df["date"].min()
    
    conn = db()
    results = []
    
    # Sync exchange rates
    ok_fx, msg_fx = sync_symbol(conn, "AUDUSD=X", min_date, end, force=force)
    results.append({"symbol": "AUDUSD=X", "ok": ok_fx, "message": msg_fx})
    
    # Sync stock symbols and fetch metadata
    for sym, grp in df.groupby("sym"):
        ok, msg = sync_symbol(conn, sym, grp["date"].min(), end, force=force)
        results.append({"symbol": sym, "ok": ok, "message": msg})
        # Fetch holding metadata (logo, sector, industry) — non-blocking, best-effort
        ticker = grp.iloc[0]["ticker"]
        exchange = grp.iloc[0]["exchange"]
        fetch_holding_meta(ticker, exchange)

    conn.close()
    return jsonify({"results": results, "at": datetime.now().isoformat()})

@app.route("/api/sync-status", methods=["GET"])
def get_sync_status():
    """Return full sync status: prices + metadata for all cached symbols."""
    conn = db()
    rows = conn.execute("""
        SELECT
            s.symbol,
            s.last_synced,
            s.cached_from,
            s.cached_to,
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
                "record_count": r[4],
                "actual_from": r[5],
                "actual_to": r[6],
                "sector": m.get("sector", ""),
                "industry": m.get("industry", ""),
                "website": m.get("website", ""),
                "logo_url": m.get("logo_url", ""),
                "has_meta": bool(m.get("sector") or m.get("website")),
            })
    return jsonify(result)

@app.route("/api/performance", methods=["GET"])
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

@app.route("/api/portfolio", methods=["GET"])
def get_portfolio():
    """Return detailed analytics of current active holdings."""
    txns = load_transactions()
    if not txns:
        return jsonify([])

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
    return jsonify(active_holdings)

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
            "audusd_rate": 0.65
        })

    # Fetch latest exchange rate and holdings
    conn = db()
    audusd_row = conn.execute(
        "SELECT close FROM prices WHERE symbol = 'AUDUSD=X' ORDER BY date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    audusd = float(audusd_row[0]) if audusd_row else 0.65

    # Retrieve holdings breakdown
    import json
    holdings_resp = get_portfolio()
    holdings = json.loads(holdings_resp.get_data(as_text=True))
    
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
            "audusd_rate": audusd
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
        "audusd_rate": round(audusd, 4)
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

@app.route("/api/cgt", methods=["GET"])
def get_cgt():
    """Calculate Australian CGT for sells within a date range."""
    from_date = request.args.get("from", "")
    to_date = request.args.get("to", "")

    txns = load_transactions()
    if not txns:
        return jsonify({"gains": [], "total_gain": 0, "losses_applied": 0, "cgt_discount": 0, "net_gain": 0, "from": from_date, "to": to_date})

    # Filter sells in the selected period
    sells = [t for t in txns if t["action"].lower() == "sell"]
    if from_date:
        sells = [t for t in sells if t["date"] >= from_date]
    if to_date:
        sells = [t for t in sells if t["date"] <= to_date]

    if not sells:
        return jsonify({"gains": [], "total_gain": 0, "losses_applied": 0, "cgt_discount": 0, "net_gain": 0, "from": from_date, "to": to_date})

    # Walk chronologically to compute average cost basis at time of each sell
    txns_sorted = sorted(txns, key=lambda x: x["date"])
    holdings = {}  # sym -> {units, cost_aud, first_buy_date}

    gains = []
    for t in txns_sorted:
        sym = yf_symbol(t["ticker"], t["exchange"])
        if sym not in holdings:
            holdings[sym] = {"units": 0.0, "cost_aud": 0.0, "first_buy_date": None}

        h = holdings[sym]

        if t["action"].lower() == "buy":
            h["units"] += t["units"]
            h["cost_aud"] += t["value"]
            if h["first_buy_date"] is None:
                h["first_buy_date"] = t["date"]
        elif t["action"].lower() == "split":
            h["units"] += t["units"]
        elif t["action"].lower() == "sell":
            if h["units"] <= 0:
                continue

            avg_cost = h["cost_aud"] / h["units"] if h["units"] > 0 else 0
            cost_of_sold = avg_cost * t["units"]
            proceeds = abs(t["value"])
            gain = proceeds - cost_of_sold

            # Check if holding was >12 months at sale time
            held_12m = False
            if h["first_buy_date"]:
                buy_dt = pd.Timestamp(h["first_buy_date"])
                sell_dt = pd.Timestamp(t["date"])
                held_12m = (sell_dt - buy_dt).days >= 365

            # Only include this sell if it's in the selected date range
            in_range = True
            if from_date and t["date"] < from_date:
                in_range = False
            if to_date and t["date"] > to_date:
                in_range = False

            if in_range:
                gains.append({
                    "date": t["date"],
                    "ticker": t["ticker"],
                    "name": t.get("name", ""),
                    "units": t["units"],
                    "proceeds": round(proceeds, 2),
                    "cost_base": round(cost_of_sold, 2),
                    "gain": round(gain, 2),
                    "held_12m": held_12m,
                    "discount_eligible": held_12m and gain > 0,
                })

            # Update holding after sale
            h["units"] -= t["units"]
            h["cost_aud"] -= cost_of_sold

    # Calculate CGT summary
    total_gain = sum(g["gain"] for g in gains)
    total_losses = sum(g["gain"] for g in gains if g["gain"] < 0)
    total_discountable = sum(g["gain"] for g in gains if g["discount_eligible"])

    # Apply losses first to non-discounted gains, then to discounted
    losses_remaining = abs(total_losses)
    # Losses applied to gains eligible for discount
    discounted_after_losses = max(0, total_discountable - losses_remaining)
    losses_remaining = max(0, losses_remaining - total_discountable)
    # Remaining non-discounted gains absorb any leftover losses
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
        save_snapshots_to_json()
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

# Ingest CSV automatically on backend startup
load_transactions()
seed_historical_snapshots()

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5050)
