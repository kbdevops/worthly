"""IBKR candidate classification and the Flex parser.

The classifier decides what a badge says, and the badge decides what people tick. Getting
it wrong is worse than an error: a duplicate labelled "New" is imported on purpose by
someone who has read the screen and been told the right thing to do.
"""
import pytest

import app as worthly
from conftest import USER_ID, OTHER_USER_ID


def candidate(**kw):
    base = {"date": "2026-05-20", "exchange": "NASDAQ", "ticker": "AMZN", "name": "Amazon",
            "action": "buy", "units": 47.73, "price": 260.199847, "currency": "USD",
            "brokerage": 1.0, "exch_rate": 0.710682, "external_id": "ibkr:test:1"}
    base.update(kw)
    return base


def classify(trade):
    conn = worthly.db()
    try:
        return worthly._classify_ibkr_trade(conn, USER_ID, trade)
    finally:
        conn.close()


class TestClassification:
    def test_nothing_similar_is_new(self, client):
        status, match = classify(candidate())
        assert status == "new"
        assert match is None

    def test_same_date_and_size_is_a_manual_duplicate(self, client, seed):
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"}])
        status, match = classify(candidate())
        assert status == "manual_duplicate"
        assert match is not None

    def test_a_one_day_offset_is_a_near_duplicate_not_new(self, client, seed):
        """The one that mattered.

        IBKR reports the US execution date; a hand-typed row often carries the Australian
        one, because a fill on Friday afternoon in New York is already Saturday in Sydney.
        Matching on date equality alone labelled 11 of 25 real duplicates "New" — $150k
        of trades one click from being double-counted, under a reassuring green badge.
        """
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"}])
        status, _ = classify(candidate(date="2026-05-19"))
        assert status == "near_duplicate"

    @pytest.mark.parametrize("offset_days", [1, 2, 3, 4, 5])
    def test_the_window_covers_settlement_across_a_weekend(self, client, seed, offset_days):
        from datetime import date, timedelta
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"}])
        d = (date(2026, 5, 20) - timedelta(days=offset_days)).isoformat()
        assert classify(candidate(date=d))[0] == "near_duplicate"

    def test_beyond_the_window_is_new_again(self, client, seed):
        # Without an upper bound, an unrelated purchase of the same size months later
        # would be silently treated as the same trade.
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"}])
        assert classify(candidate(date="2026-05-10"))[0] == "new"

    def test_an_exact_date_match_beats_a_nearby_one(self, client, seed):
        seed([{"date": "2026-05-19", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"},
              {"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"}])
        status, match = classify(candidate(date="2026-05-20"))
        assert status == "manual_duplicate"
        conn = worthly.db()
        row = conn.execute("SELECT date FROM transactions WHERE id=?", (match,)).fetchone()
        conn.close()
        assert row[0] == "2026-05-20"

    def test_a_different_side_is_not_a_duplicate(self, client, seed):
        # Same day, same size, same price, opposite direction: a real pair of trades.
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "sell",
               "units": 47.73, "price": 260.199847, "currency": "USD"}])
        assert classify(candidate(action="buy"))[0] == "new"

    def test_a_different_size_is_not_a_duplicate(self, client, seed):
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 10.0, "price": 260.199847, "currency": "USD"}])
        assert classify(candidate())[0] == "new"

    def test_an_already_imported_fill_outranks_a_date_match(self, client, seed):
        # The same external_id is the more specific fact: re-importing is an update.
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD", "source": "manual"}])
        conn = worthly.db()
        conn.execute(
            "INSERT INTO transactions (date, exchange, ticker, name, action, units, price, "
            "currency, brokerage, brokerage_currency, exch_rate, value, user_id, source, external_id) "
            "VALUES ('2026-05-20','NASDAQ','AMZN','Amazon','buy',47.73,260.199847,'USD',1,'USD',"
            "0.710682,17475.25,?,'ibkr','ibkr:test:1')", (USER_ID,))
        conn.commit()
        conn.close()
        assert classify(candidate())[0] == "already_imported"

    def test_another_users_row_is_never_matched(self, client, seed):
        seed([{"date": "2026-05-20", "ticker": "AMZN", "exchange": "NASDAQ", "action": "buy",
               "units": 47.73, "price": 260.199847, "currency": "USD"}],
             user_id=OTHER_USER_ID)
        assert classify(candidate())[0] == "new"


class TestFlexParser:
    HEADER = ("TradeDate,Symbol,Buy/Sell,Quantity,TradePrice,IBCommission,"
              "CurrencyPrimary,FXRateToBase,AssetClass,ListingExchange,TradeTime")

    def parse(self, *rows):
        return worthly.parse_and_aggregate_ibkr_trades("\n".join([self.HEADER, *rows]))

    def test_partial_fills_in_the_same_minute_merge(self, client):
        trades, _ = self.parse(
            "20260520,AMZN,BUY,20,260.20,-0.50,USD,0.710682,STK,NASDAQ,103000",
            "20260520,AMZN,BUY,27.73,260.20,-0.50,USD,0.710682,STK,NASDAQ,103000")
        assert len(trades) == 1
        assert trades[0]["units"] == pytest.approx(47.73)

    def test_the_external_id_is_deterministic(self, client):
        # Re-running an import must update in place, which only works if the id for a
        # given fill is stable.
        row = "20260520,AMZN,BUY,20,260.20,-0.50,USD,0.710682,STK,NASDAQ,103000"
        assert self.parse(row)[0][0]["external_id"] == self.parse(row)[0][0]["external_id"]

    def test_options_are_skipped_and_counted(self, client):
        trades, stats = self.parse(
            "20260520,AMZN,BUY,1,5.00,-0.50,USD,0.710682,OPT,NASDAQ,103000")
        assert trades == []
        assert stats["skipped_options"] == 1

    def test_an_unsupported_currency_is_skipped_and_counted(self, client):
        trades, stats = self.parse(
            "20260520,VOD,BUY,10,100.00,-0.50,GBP,1.9,STK,LSE,103000")
        assert trades == []
        assert stats["skipped_currency"].get("GBP") == 1

    def test_the_date_is_normalised_to_iso(self, client):
        trades, _ = self.parse(
            "20260520,AMZN,BUY,20,260.20,-0.50,USD,0.710682,STK,NASDAQ,103000")
        assert trades[0]["date"] == "2026-05-20"

    def test_an_aud_fill_is_forced_to_a_rate_of_one(self, client):
        # IBKR sometimes reports an FXRateToBase for the base currency itself; taking it
        # at face value would convert AUD into AUD at a rate that is not 1.
        trades, _ = self.parse(
            "20260520,VAS,BUY,100,90.00,-3.00,AUD,0.98,STK,ASX,103000")
        assert trades and trades[0]["exch_rate"] == pytest.approx(1.0)
