"""Monthly boundaries: the snapshot the whole Monthly Change widget is built on.

A missed boundary does not error. The chart keeps drawing, one bar quietly spans five
weeks instead of four, and the numbers stay plausible — which is why this needs a test
rather than a watchful eye.
"""
from datetime import date, datetime
from unittest.mock import patch

import pytest

import app as worthly
from conftest import USER_ID


def monthly(client):
    r = client.get("/api/monthly-change")
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def snapshot_dates():
    conn = worthly.db()
    rows = [r[0] for r in conn.execute(
        "SELECT date FROM snapshots WHERE user_id=? ORDER BY date", (USER_ID,)).fetchall()]
    conn.close()
    return rows


class TestScheduledBoundaryDate:
    """The cron fires on Melbourne's 1st; the row it writes must carry Melbourne's date."""

    @pytest.mark.parametrize("server_tz,label", [
        ("Australia/Melbourne", "at home"),
        ("America/Chicago", "travelling west"),
        ("Europe/London", "travelling to London"),
        ("Pacific/Auckland", "travelling east"),
    ])
    def test_the_boundary_lands_on_the_first_wherever_the_server_is(self, client, server_tz, label):
        """Scheduled for 1 Sep 13:00 Melbourne, which is 31 Aug 22:00 in US Central.

        The old code stamped date.today() — the SERVER's date — so a server in Chicago
        recorded the boundary as 31 August, September got no 1st, and the August bar
        never closed. Stamping in the zone the trigger uses makes the server's location
        irrelevant, which is what these four cases assert.

        datetime.now cannot be patched directly (immutable C type), so the module's
        `datetime` and `date` names are swapped for subclasses instead.
        """
        from zoneinfo import ZoneInfo
        fire_utc = datetime(2026, 9, 1, 3, 0, tzinfo=ZoneInfo("UTC"))  # 1 Sep 13:00 AEST
        server_zone = ZoneInfo(server_tz)

        class FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fire_utc.astimezone(tz or server_zone)

        class FrozenDate(date):
            @classmethod
            def today(cls):
                return fire_utc.astimezone(server_zone).date()

        with patch.object(worthly, "datetime", FrozenDatetime), \
             patch.object(worthly, "date", FrozenDate):
            worthly._scheduled_monthly_snapshot()

        got = snapshot_dates()
        assert "2026-09-01" in got, (
            f"{label} ({server_tz}): boundary landed on {got} instead of 2026-09-01")


class TestBoundaryEffectOnTheWidget:
    @pytest.fixture
    def two_months(self, seed, prices):
        seed([{"date": "2026-07-01", "ticker": "VAS", "exchange": "ASX", "action": "buy",
               "units": 100, "price": 10.0}])
        prices("VAS.AX", [("2026-07-01", 10.0), ("2026-08-01", 11.0),
                          ("2026-09-01", 12.0), ("2026-09-02", 12.0)])
        conn = worthly.db()
        for d, cash in (("2026-07-01", 1000.0), ("2026-08-01", 1000.0)):
            conn.execute("INSERT INTO snapshots (date, super, cash, user_id, source) "
                         "VALUES (?,0,?,?,'auto')", (d, cash, USER_ID))
        conn.commit()
        conn.close()

    def test_a_missing_first_leaves_one_bar_spanning_five_weeks(self, client, two_months):
        """Documents the failure mode, so its absence is a deliberate state.

        With no 1 Sep snapshot the last bar opens 1 Aug and closes at today. It is not
        wrong arithmetic — the span really is what it says — but the bar is a month and
        a bit, labelled as a month.
        """
        res = monthly(client)
        assert res["months"], "no bars at all"
        assert res["period_end"][-1] >= res["months"][-1]
        last_open = res["months"][-1]
        assert res["is_mtd"][-1] is True
        # August is the opening month, and nothing closed it.
        assert last_open == "2026-08-01"

    def test_a_present_first_closes_the_month_and_starts_a_new_mtd(self, client, two_months):
        conn = worthly.db()
        conn.execute("INSERT INTO snapshots (date, super, cash, user_id, source) "
                     "VALUES ('2026-09-01',0,1000.0,?,'auto')", (USER_ID,))
        conn.commit()
        conn.close()
        res = monthly(client)
        opens = res["months"]
        # August now closes at 1 Sep, and the in-progress bar opens 1 Sep.
        assert "2026-08-01" in opens
        aug = opens.index("2026-08-01")
        assert res["period_end"][aug] == "2026-09-01"
        assert res["is_mtd"][aug] is False
        assert opens[-1] == "2026-09-01"
        assert res["is_mtd"][-1] is True

    def test_only_the_final_bar_is_ever_month_to_date(self, client, two_months):
        res = monthly(client)
        assert res["is_mtd"].count(True) <= 1
        if True in res["is_mtd"]:
            assert res["is_mtd"][-1] is True

    def test_every_bar_is_labelled_by_the_month_it_opens(self, client, two_months):
        # The label and the span have to agree: a bar opening 1 Aug is August's change,
        # whatever date closes it.
        res = monthly(client)
        for open_d, end_d in zip(res["months"], res["period_end"]):
            assert open_d < end_d
            assert open_d.endswith("-01"), f"boundary {open_d} is not the 1st of a month"
