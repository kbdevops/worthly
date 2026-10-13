"""Holdings, closed positions and /api/stats must use the same per-parcel basis as /api/cgt.

Regression: APP, 65 units bought in four lots, 19 units (the 7 Jul lot, highest cost) sold.
Blended average cost put unrealised at -$9,336 / realised at -$3,598; the parcels say
-$6,002 / -$6,932.
"""
import pytest

from conftest import USER_ID

USD = {"exchange": "NASDAQ", "currency": "USD", "ticker": "APP"}


def buy(date, units, price, value):
    return {**USD, "action": "buy", "date": date, "units": units, "price": price, "value": value}


@pytest.fixture
def app_position(seed, prices):
    seed([
        buy("2026-07-07", 19, 531.5, 14575.60),
        buy("2026-07-15", 8, 447.455, 5110.65),
        buy("2026-07-27", 15, 411.79, 8838.65),
        buy("2026-08-26", 23, 309.75, 9933.31),
        {**USD, "action": "sell", "date": "2026-10-12", "units": 19, "price": 280.0,
         "value": -7643.24, "exch_rate": 0.6958942240779401},
    ])
    prices("APP", [("2026-10-12", 280.0), ("2026-10-13", 273.5)])
    prices("AUDUSD=X", [("2026-10-12", 0.6959), ("2026-10-13", 0.6959)])


def test_realised_matches_the_parcel_sold(client, app_position):
    # HIFO is not the default, so FIFO sells the OLDEST lot — which here is the 7 Jul lot too.
    r = client.get("/api/stats").get_json()
    assert r["realised_gain"] == pytest.approx(7643.24 - 14575.60, abs=0.01)


def test_remaining_cost_is_the_open_parcels_only(client, app_position):
    rows = client.get("/api/portfolio").get_json()
    rows = rows if isinstance(rows, list) else rows["holdings"]
    h = {x["ticker"]: x for x in rows}["APP"]
    assert h["units"] == pytest.approx(46)
    assert h["cost_aud"] == pytest.approx(5110.65 + 8838.65 + 9933.31, abs=0.01)


def test_closed_positions_realised_agrees_with_stats(client, app_position):
    stats = client.get("/api/stats").get_json()
    assert stats["realised_gain"] == pytest.approx(7643.24 - 14575.60, abs=0.01)
