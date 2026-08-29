"""Test harness: a throwaway database per session, and a client authenticated against it.

DATA_DIR is set BEFORE app is imported, because app.py resolves DB_FILE at import time —
importing first would bind the tests to the real prices.db and the first seeded trade
would land in the user's actual portfolio.

The background scheduler is shut down immediately for the same class of reason: it fires
price syncs against yfinance, which makes tests slow, non-deterministic and dependent on
a network. Anything reaching for a price should be given one explicitly.
"""
import os
import sqlite3
import tempfile

import pytest

TEST_DIR = tempfile.mkdtemp(prefix="worthly-tests-")
os.environ["DATA_DIR"] = TEST_DIR
os.environ["JWT_SECRET_KEY"] = "test-secret-key-long-enough-for-hs256"
os.environ.pop("ALLOWED_HOSTS", None)

import app as worthly  # noqa: E402  — must follow the env vars above

try:
    worthly._scheduler.shutdown(wait=False)
except Exception:
    pass

USER_ID = 1
OTHER_USER_ID = 2


@pytest.fixture
def db_path():
    return os.path.join(TEST_DIR, "prices.db")


@pytest.fixture(autouse=True)
def clean_db(db_path):
    """Empty every per-user table between tests.

    Truncating rather than recreating the file: app.py holds DB_FILE from import, so a
    new path would be ignored, and re-running db() per test would re-apply migrations
    for no benefit. Two users always exist so that scoping can be asserted — a query
    missing its WHERE user_id would otherwise pass every test on a single-user database.
    """
    conn = worthly.db()
    for table in ("transactions", "cash_accounts", "super_holdings", "snapshots",
                  "dividends", "holding_groups", "milestones", "prices", "sync_log",
                  "ibkr_staged", "ibkr_credentials", "records", "tax_settings"):
        try:
            conn.execute(f"DELETE FROM {table}")
        except sqlite3.OperationalError:
            pass  # table introduced later than this checkout, or renamed
    conn.execute("DELETE FROM users")
    for uid, email in ((USER_ID, "test@worthly.local"), (OTHER_USER_ID, "other@worthly.local")):
        conn.execute("INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)",
                     (uid, email, "x", "2020-01-01"))
    conn.commit()
    conn.close()
    yield


@pytest.fixture
def client():
    """Flask test client with a bearer token for USER_ID already attached."""
    from flask_jwt_extended import create_access_token
    with worthly.app.app_context():
        token = create_access_token(identity=str(USER_ID))
    c = worthly.app.test_client()
    c.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return c


@pytest.fixture
def seed():
    """Insert transactions directly.

    Deliberately not POST /api/transactions: that endpoint derives the FX rate and the
    AUD value itself, so a test could not state an exact cost base and assert against it.
    Tests that care about that derivation should call the endpoint on purpose.
    """
    def _seed(rows, user_id=USER_ID):
        conn = worthly.db()
        for r in rows:
            units = r["units"]
            price = r["price"]
            fx = r.get("exch_rate", 1.0)
            brokerage = r.get("brokerage", 0.0)
            signed = -units if r["action"] == "sell" else units
            value = r.get("value", round((signed * price + brokerage) / fx, 2))
            conn.execute(
                "INSERT INTO transactions (date, exchange, ticker, name, action, units, price, "
                "currency, brokerage, brokerage_currency, exch_rate, value, user_id, source) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (r["date"], r.get("exchange", "ASX"), r["ticker"], r.get("name", r["ticker"]),
                 r["action"], units, price, r.get("currency", "AUD"), brokerage,
                 r.get("currency", "AUD"), fx, value, user_id, r.get("source", "manual")),
            )
        conn.commit()
        conn.close()
    return _seed


@pytest.fixture
def prices():
    """Insert closing prices, so valuation tests don't depend on a live feed."""
    def _prices(symbol, rows):
        conn = worthly.db()
        for d, close in rows:
            conn.execute("INSERT OR REPLACE INTO prices (symbol, date, close) VALUES (?,?,?)",
                         (symbol, d, close))
        conn.commit()
        conn.close()
    return _prices
