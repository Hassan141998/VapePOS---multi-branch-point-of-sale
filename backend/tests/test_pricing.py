"""Pure maths of discounts and tax (no database). The browser mirrors this in frontend/src/lib/pricing.ts."""
from decimal import Decimal

import pytest

from app.services.pricing import DiscountError, Line, Rule, half_up, price_cart

L1 = Line(product_id=1, category="e-liquid", unit_cents=1000, qty=2)   # 20.00
L2 = Line(product_id=2, category="device", unit_cents=2550, qty=1)     # 25.50


def test_half_up_rounds_ties_up():
    assert [half_up(n, 2) for n in (1, 3, 5)] == [1, 2, 3]
    assert half_up(49, 100) == 0 and half_up(50, 100) == 1 and half_up(0, 7) == 0


def test_no_discount_matches_plain_tax_maths():
    p = price_cart([L1, L2], Decimal("10"))
    assert (p.items_total, p.discount, p.net, p.tax, p.total) == (4550, 0, 4550, 455, 5005)


def test_percent_all_items():
    p = price_cart([L1, L2], Decimal("10"), Rule("percent", 1000, "all"))  # 10%
    assert p.line_discounts == [200, 255] and p.discount == 455
    assert p.net == 4095 and p.tax == 410 and p.total == 4505   # 409.5 -> 410 (half up)


def test_percent_only_on_one_category():
    p = price_cart([L1, L2], Decimal("0"), Rule("percent", 5000, "category", category="device"))
    assert p.line_discounts == [0, 1275] and p.total == 4550 - 1275


def test_product_scope_and_fixed_is_capped_at_the_eligible_total():
    p = price_cart([L1, L2], Decimal("0"), Rule("fixed", 99900, "product", product_id=2))
    assert p.line_discounts == [0, 2550] and p.total == 2000            # cannot go below zero


def test_fixed_discount_is_shared_in_proportion_and_adds_up():
    lines = [Line(1, None, 333, 1), Line(2, None, 333, 1), Line(3, None, 334, 1)]
    p = price_cart(lines, Decimal("0"), Rule("fixed", 100, "all"))
    assert sum(p.line_discounts) == p.discount == 100
    assert all(0 <= d <= ln.total for d, ln in zip(p.line_discounts, lines))


def test_minimum_purchase_and_nothing_eligible_are_rejected():
    with pytest.raises(DiscountError, match="at least"):
        price_cart([L1], Decimal("0"), Rule("percent", 1000, "all", min_purchase_cents=5000, label="Big spender"))
    with pytest.raises(DiscountError, match="does not apply"):
        price_cart([L1], Decimal("0"), Rule("percent", 1000, "category", category="device", label="Devices"))


def test_hundred_percent_discount_is_free_and_tax_free():
    p = price_cart([L1, L2], Decimal("10"), Rule("percent", 10000, "all"))
    assert p.net == 0 and p.tax == 0 and p.total == 0
