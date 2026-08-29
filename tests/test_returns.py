"""Daily change, cost basis, and the two return bases.

Every assertion here corresponds to a bug this code has actually had. A percentage that
is quietly wrong looks exactly like one that is right, so these pin the arithmetic rather
than the plumbing.
"""
import pytest

from conftest import OTHER_USER_ID

USD = {"exchange": "NASDAQ", "currency": "USD"}
AUD = {"exchange": "ASX", "currency": "AUD"}


def holdings(client):
    r = client.get("/api/portfolio")
    assert r.status_code == 200, r.get_data(as_text=True)
    rows = r.get_json()
    return {h["ticker"]: h for h in (rows if isinstance(rows, list) else rows["holdings"])}


def stats(client):
    r = client.get("/api/stats")
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


class TestDailyChangeSplitsPriceFromCurrency:
    """The FX leg used to cancel out entirely: both sides were converted at today's rate."""

    @pytest.fixture
    def usd_holding(self, seed, prices):
        seed([{**USD, "action": "buy", "ticker": "AAPL", "date": "2024-01-01",
               "units": 100, "price": 100.0, "exch_rate": 0.70}])
        prices("AAPL", [("2024-06-01", 100.0), ("2024-06-02", 110.0)])
        # The dollar moves too, so a price-only calculation cannot accidentally be right.
        prices("AUDUSD=X", [("2024-06-01", 0.70), ("2024-06-02", 0.65)])

    def test_the_two_legs_sum_to_the_total(self, client, usd_holding):
        h = holdings(client)["AAPL"]
        assert h["daily_change"] == pytest.approx(
            h["daily_change_price"] + h["daily_change_fx"], abs=0.02)

    def test_the_currency_leg_is_not_zero_when_the_dollar_moves(self, client, usd_holding):
        # This is the whole bug: converting both legs at today's rate makes fx exactly 0
        # and reports about half the real AUD move.
        h = holdings(client)["AAPL"]
        assert h["daily_change_fx"] != 0.0

    def test_daily_change_is_the_true_aud_move(self, client, usd_holding):
        # 100 units: yesterday 100 USD @ 0.70 = 14,285.71 AUD; today 110 @ 0.65 = 16,923.08.
        h = holdings(client)["AAPL"]
        expected = 100 * 110.0 / 0.65 - 100 * 100.0 / 0.70
        assert h["daily_change"] == pytest.approx(expected, abs=0.05)

    def test_an_aud_holding_has_exactly_no_currency_leg(self, client, seed, prices):
        seed([{**AUD, "action": "buy", "ticker": "VAS", "date": "2024-01-01",
               "units": 100, "price": 80.0}])
        prices("VAS.AX", [("2024-06-01", 80.0), ("2024-06-02", 90.0)])
        prices("AUDUSD=X", [("2024-06-01", 0.70), ("2024-06-02", 0.65)])
        h = holdings(client)["VAS"]
        assert h["daily_change_fx"] == 0.0
        assert h["daily_change"] == pytest.approx(1000.0)

    def test_portfolio_day_pl_legs_also_reconcile(self, client, usd_holding):
        s = stats(client)
        assert s["day_pl"] == pytest.approx(s["day_pl_price"] + s["day_pl_fx"], abs=0.02)


class TestCostBasis:
    def test_a_sell_reduces_cost_proportionally(self, client, seed, prices):
        seed([{**AUD, "action": "buy", "ticker": "VAS", "date": "2024-01-01",
               "units": 100, "price": 10.0},
              {**AUD, "action": "sell", "ticker": "VAS", "date": "2024-02-01",
               "units": 40, "price": 20.0}])
        prices("VAS.AX", [("2024-06-01", 20.0)])
        h = holdings(client)["VAS"]
        assert h["units"] == pytest.approx(60)
        assert h["cost_aud"] == pytest.approx(600.0)   # 60 of the original 100 @ $10

    def test_a_split_adds_units_without_changing_cost(self, client, seed, prices):
        seed([{**AUD, "action": "buy", "ticker": "VAS", "date": "2024-01-01",
               "units": 100, "price": 10.0},
              {**AUD, "action": "split", "ticker": "VAS", "date": "2024-02-01",
               "units": 100, "price": 0.0, "value": 0.0}])
        prices("VAS.AX", [("2024-06-01", 5.0)])
        h = holdings(client)["VAS"]
        assert h["units"] == pytest.approx(200)
        assert h["cost_aud"] == pytest.approx(1000.0)

    def test_a_fully_sold_position_leaves_the_active_list(self, client, seed, prices):
        seed([{**AUD, "action": "buy", "ticker": "VAS", "date": "2024-01-01",
               "units": 100, "price": 10.0},
              {**AUD, "action": "sell", "ticker": "VAS", "date": "2024-02-01",
               "units": 100, "price": 20.0}])
        prices("VAS.AX", [("2024-06-01", 20.0)])
        assert "VAS" not in holdings(client)


class TestReturnBases:
    """MWR answers 'how did my money do'; TWR answers 'how did the investments do'."""

    @pytest.fixture
    def small_base_then_large_deposit(self, seed, prices):
        # The shape that produced a fabricated loss: a tiny opening position, then a
        # deposit many times its size. Brokerage matters — it makes the cash that left
        # the account slightly larger than the stock it bought, and it is that small
        # mismatch that the end-of-day convention amplifies by the size of the base.
        # Without it the flow exactly equals the value added and both conventions agree,
        # so the test would pass against the bug.
        seed([{**AUD, "action": "buy", "ticker": "VAS", "date": "2024-01-02",
               "units": 25, "price": 10.0},
              {**AUD, "action": "buy", "ticker": "VAS", "date": "2024-01-03",
               "units": 475, "price": 10.0, "brokerage": 10.0}])
        prices("VAS.AX", [("2024-01-02", 10.0), ("2024-01-03", 10.0),
                          ("2024-01-04", 10.0), ("2024-06-01", 10.0)])

    def test_a_large_deposit_onto_a_small_base_is_not_a_loss(self, client, small_base_then_large_deposit):
        """Prices never moved, so every honest return measure is ~0.

        (value - flow) / prev credits the deposit with none of the day's return while
        counting the units it bought in `value`, which on a small base fabricates a
        double-digit loss out of nothing.
        """
        import app as worthly
        conn = worthly.db()
        series = worthly._build_twr_series(conn, 1)
        conn.close()
        assert series is not None
        assert abs(float(series.iloc[-1])) < 1.0, f"TWR drifted to {series.iloc[-1]:.2f}% on flat prices"

    def test_both_bases_are_reported(self, client, small_base_then_large_deposit):
        s = stats(client)
        assert "mwr_pct" in s and "twr_pct" in s

    def test_a_sub_year_return_is_not_annualised(self, client, seed, prices):
        # Annualising a short period is arithmetically true and meaningless; the flag
        # exists so the label can say so.
        seed([{**AUD, "action": "buy", "ticker": "VAS", "date": "2024-06-01",
               "units": 100, "price": 10.0}])
        prices("VAS.AX", [("2024-06-01", 10.0), ("2024-07-01", 11.0)])
        s = stats(client)
        if s.get("mwr_years", 0) <= 1:
            assert s["mwr_annualised"] is False
            assert s["twr_annualised"] is False


class TestUserScoping:
    def test_another_users_holdings_never_appear(self, client, seed, prices):
        seed([{**AUD, "action": "buy", "ticker": "NDQ", "date": "2024-01-01",
               "units": 999, "price": 50.0}], user_id=OTHER_USER_ID)
        prices("NDQ.AX", [("2024-06-01", 60.0)])
        assert holdings(client) == {}
