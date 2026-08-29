"""Australian CGT: the discount boundary, parcel selection, and entity rates.

These are the figures with an ATO consequence, so they are the ones worth pinning. Each
test states a cost base and a disposal explicitly rather than deriving them, so a failure
points at the calculation and not at the fixture.
"""
import pytest

BUY = {"action": "buy", "ticker": "VAS", "exchange": "ASX"}
SELL = {"action": "sell", "ticker": "VAS", "exchange": "ASX"}


def cgt(client, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    r = client.get(f"/api/cgt?{q}" if q else "/api/cgt")
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


class TestDiscountBoundary:
    """The 12-month rule. A day either side changes the tax by half the gain."""

    def test_held_exactly_one_year_is_not_discounted(self, client, seed):
        # Bought 1 Jan, sold 1 Jan the next year: 365 days, which is 12 months and not
        # a day more, so no discount.
        seed([{**BUY, "date": "2023-01-01", "units": 100, "price": 10.0},
              {**SELL, "date": "2024-01-01", "units": 100, "price": 20.0}])
        g = cgt(client)["gains"][0]
        assert g["gain"] == pytest.approx(1000.0)
        assert g["discount_eligible"] is False

    def test_one_day_past_a_year_is_discounted(self, client, seed):
        seed([{**BUY, "date": "2023-01-01", "units": 100, "price": 10.0},
              {**SELL, "date": "2024-01-02", "units": 100, "price": 20.0}])
        assert cgt(client)["gains"][0]["discount_eligible"] is True

    def test_a_leap_year_does_not_change_the_answer(self, client, seed):
        """Exactly one calendar year apart, but spanning 29 Feb.

        The rule is a duration in months, not in days, so crossing a leap year must not
        flip eligibility. `(sell - buy).days > 365` counts days, which makes this pair
        366 days and eligible while the identical non-leap pair above is 365 and not.
        """
        seed([{**BUY, "date": "2024-01-01", "units": 100, "price": 10.0},
              {**SELL, "date": "2025-01-01", "units": 100, "price": 20.0}])
        assert cgt(client)["gains"][0]["discount_eligible"] is False

    def test_a_loss_is_never_discounted(self, client, seed):
        # The discount applies to gains. Halving a loss would understate the offset
        # available against other gains.
        seed([{**BUY, "date": "2020-01-01", "units": 100, "price": 20.0},
              {**SELL, "date": "2024-01-01", "units": 100, "price": 10.0}])
        g = cgt(client)["gains"][0]
        assert g["gain"] == pytest.approx(-1000.0)
        assert g["discount_eligible"] is False


class TestParcelSelection:
    """Which lot a sale consumes changes the gain and often the discount too."""

    @pytest.fixture
    def three_parcels(self, seed):
        # Cheap-and-old, dear-and-newer, middle-and-newest. One sale of 100 units.
        seed([{**BUY, "date": "2020-01-01", "units": 100, "price": 10.0},
              {**BUY, "date": "2022-01-01", "units": 100, "price": 30.0},
              {**BUY, "date": "2023-06-01", "units": 100, "price": 20.0},
              {**SELL, "date": "2024-06-01", "units": 100, "price": 40.0}])

    def method(self, client, m):
        r = client.post("/api/tax/settings", json={"allocation_method": m})
        assert r.status_code == 200, r.get_data(as_text=True)

    def test_fifo_takes_the_oldest_parcel(self, client, three_parcels):
        self.method(client, "fifo")
        g = cgt(client)["gains"]
        assert len(g) == 1
        assert g[0]["cost"] == pytest.approx(1000.0)   # 100 @ $10
        assert g[0]["gain"] == pytest.approx(3000.0)

    def test_lifo_takes_the_newest_parcel(self, client, three_parcels):
        self.method(client, "lifo")
        g = cgt(client)["gains"][0]
        assert g["cost"] == pytest.approx(2000.0)      # 100 @ $20, bought 2023-06-01
        assert g["gain"] == pytest.approx(2000.0)

    def test_hifo_takes_the_most_expensive_parcel(self, client, three_parcels):
        self.method(client, "hifo")
        g = cgt(client)["gains"][0]
        assert g["cost"] == pytest.approx(3000.0)      # 100 @ $30 — smallest gain
        assert g["gain"] == pytest.approx(1000.0)

    def test_hifo_reports_the_smallest_gain_of_the_three(self, client, three_parcels):
        gains = {}
        for m in ("fifo", "lifo", "hifo"):
            self.method(client, m)
            gains[m] = cgt(client)["total_gain"]
        assert gains["hifo"] == min(gains.values())
        assert gains["fifo"] == max(gains.values())

    def test_a_sale_spanning_two_parcels_splits_into_two_lines(self, client, seed):
        seed([{**BUY, "date": "2020-01-01", "units": 60, "price": 10.0},
              {**BUY, "date": "2023-06-01", "units": 60, "price": 20.0},
              {**SELL, "date": "2024-06-01", "units": 100, "price": 30.0}])
        client.post("/api/tax/settings", json={"allocation_method": "fifo"})
        gains = cgt(client)["gains"]
        assert len(gains) == 2
        # 60 from the old parcel, 40 from the newer one — and only the old one clears
        # 12 months, so the split changes the discount as well as the gain.
        assert sorted(g["units"] for g in gains) == [40, 60]
        assert sum(g["gain"] for g in gains) == pytest.approx(60 * 20 + 40 * 10)


class TestEntityRates:
    """Discount rate follows the entity: 50% individual, 33 1/3% SMSF, none for a company."""

    @pytest.fixture
    def one_discountable_gain(self, seed):
        seed([{**BUY, "date": "2020-01-01", "units": 100, "price": 10.0},
              {**SELL, "date": "2024-01-01", "units": 100, "price": 20.0}])

    @pytest.mark.parametrize("entity,rate,net", [
        ("individual", 0.5, 500.0),
        ("trust", 0.5, 500.0),
        ("smsf", 1.0 / 3.0, 1000.0 * (1 - 1.0 / 3.0)),
        ("company", 0.0, 1000.0),
    ])
    def test_net_gain_follows_the_entity(self, client, one_discountable_gain, entity, rate, net):
        assert client.post("/api/tax/settings", json={"entity_type": entity}).status_code == 200
        res = cgt(client)
        assert res["discount_rate"] == pytest.approx(rate)
        assert res["net_gain"] == pytest.approx(net, abs=0.01)

    def test_an_unknown_entity_is_rejected_not_defaulted(self, client):
        # Silently falling back to 'individual' would apply a 50% discount to an SMSF
        # whose settings failed to save, and nothing on screen would say so.
        assert client.post("/api/tax/settings", json={"entity_type": "partnership"}).status_code == 400


class TestLossesAndTotals:
    def test_losses_offset_gains_before_the_discount_is_applied(self, client, seed):
        # Order matters: discounting first then offsetting would overstate the loss's
        # value. $2,000 discountable gain less a $1,000 loss, then halved, is $500.
        seed([{**BUY, "date": "2020-01-01", "units": 100, "price": 10.0},
              {**SELL, "date": "2024-01-01", "units": 100, "price": 30.0},
              {**BUY, "date": "2020-01-01", "units": 100, "price": 30.0, "ticker": "NDQ"},
              {**SELL, "date": "2024-01-01", "units": 100, "price": 20.0, "ticker": "NDQ"}])
        client.post("/api/tax/settings", json={"entity_type": "individual"})
        res = cgt(client)
        assert res["gross_gains"] == pytest.approx(2000.0)
        # Reported as a positive magnitude, not a negative number.
        assert res["gross_losses"] == pytest.approx(1000.0)
        assert res["net_gain"] == pytest.approx(500.0, abs=0.01)

    def test_gross_gains_and_losses_reconcile_to_total_gain(self, client, seed):
        seed([{**BUY, "date": "2020-01-01", "units": 100, "price": 10.0},
              {**SELL, "date": "2024-01-01", "units": 100, "price": 30.0},
              {**BUY, "date": "2020-01-01", "units": 50, "price": 30.0, "ticker": "NDQ"},
              {**SELL, "date": "2024-01-01", "units": 50, "price": 20.0, "ticker": "NDQ"}])
        res = cgt(client)
        assert res["total_gain"] == pytest.approx(res["gross_gains"] - res["gross_losses"])

    def test_a_year_with_no_disposals_is_zero_not_an_error(self, client, seed):
        seed([{**BUY, "date": "2023-01-01", "units": 100, "price": 10.0}])
        res = cgt(client)
        assert res["gains"] == []
        assert res["net_gain"] == pytest.approx(0.0)


class TestUserScoping:
    def test_another_users_disposals_never_appear(self, client, seed):
        """A missing WHERE user_id is invisible on a single-user database."""
        from conftest import OTHER_USER_ID
        seed([{**BUY, "date": "2020-01-01", "units": 999, "price": 1.0},
              {**SELL, "date": "2024-01-01", "units": 999, "price": 500.0}],
             user_id=OTHER_USER_ID)
        res = cgt(client)
        assert res["gains"] == []
        assert res["net_gain"] == pytest.approx(0.0)
