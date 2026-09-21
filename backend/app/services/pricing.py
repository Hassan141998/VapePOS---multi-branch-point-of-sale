"""
Cart pricing: discounts and tax.

Everything is integer CENTS with round-half-up, so the server and the browser
(frontend/src/lib/pricing.ts, which mirrors this file) always agree to the cent.

    net      = items total - discount
    tax      = round(net * tax_rate)
    total    = net + tax

A discount applies to the "eligible" lines only (all lines, one category, or one product).
Percent discounts are taken per line. Fixed discounts are capped at the eligible total and
shared out across the eligible lines in proportion to their value.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


class DiscountError(ValueError):
    """The discount cannot be used on this cart (message is safe to show to the cashier)."""


@dataclass(frozen=True)
class Line:
    product_id: int
    category: str | None
    unit_cents: int
    qty: int

    @property
    def total(self) -> int:
        return self.unit_cents * self.qty


@dataclass(frozen=True)
class Rule:
    type: str  # "percent" | "fixed"
    value_cents: int  # for percent: basis points (12.5% -> 1250); for fixed: cents
    applies_to: str  # "all" | "category" | "product"
    category: str | None = None
    product_id: int | None = None
    min_purchase_cents: int = 0
    label: str = "Discount"


@dataclass(frozen=True)
class Priced:
    items_total: int  # before discount
    line_discounts: list[int]  # same order as the input lines
    discount: int
    net: int  # items_total - discount (this is what gets stored as sales.subtotal)
    tax: int
    total: int


def cents(value: Decimal | int | float | str) -> int:
    """Decimal money -> integer cents (exact for 2-decimal inputs)."""
    return int((Decimal(str(value)) * 100).to_integral_value())


def to_money(c: int) -> Decimal:
    return (Decimal(c) / 100).quantize(Decimal("0.01"))


def half_up(numerator: int, denominator: int) -> int:
    """round-half-up(numerator / denominator) for non-negative integers."""
    return (2 * numerator + denominator) // (2 * denominator)


def rule_from_discount(d) -> Rule:
    """Build a Rule from a `Discount` row."""
    if d.type == "percent":
        value = int((Decimal(d.value) * 100).to_integral_value())  # basis points
    else:
        value = cents(d.value)
    return Rule(
        type=d.type, value_cents=value, applies_to=d.applies_to, category=d.category,
        product_id=d.product_id, min_purchase_cents=cents(d.min_purchase), label=d.name,
    )


def _eligible(rule: Rule, line: Line) -> bool:
    if rule.applies_to == "all":
        return True
    if rule.applies_to == "category":
        return line.category is not None and line.category == rule.category
    if rule.applies_to == "product":
        return line.product_id == rule.product_id
    return False


def allocate_discount(lines: list[Line], rule: Rule) -> list[int]:
    """Discount per line (cents). Raises DiscountError when the rule does not fit the cart."""
    eligible_idx = [i for i, ln in enumerate(lines) if _eligible(rule, ln)]
    eligible_total = sum(lines[i].total for i in eligible_idx)
    if not eligible_idx or eligible_total <= 0:
        raise DiscountError(f"'{rule.label}' does not apply to anything in this cart.")
    if eligible_total < rule.min_purchase_cents:
        need = to_money(rule.min_purchase_cents)
        raise DiscountError(f"'{rule.label}' needs at least {need} of eligible items in the cart.")

    out = [0] * len(lines)
    if rule.type == "percent":
        for i in eligible_idx:
            out[i] = half_up(lines[i].total * rule.value_cents, 10000)
    else:
        target = min(rule.value_cents, eligible_total)
        given = 0
        for i in eligible_idx[:-1]:
            share = half_up(target * lines[i].total, eligible_total)
            out[i] = min(share, lines[i].total)
            given += out[i]
        last = eligible_idx[-1]
        out[last] = max(0, min(target - given, lines[last].total))
    return out


def price_cart(lines: list[Line], tax_rate: Decimal | float | str, rule: Rule | None = None) -> Priced:
    items_total = sum(ln.total for ln in lines)
    line_discounts = allocate_discount(lines, rule) if rule else [0] * len(lines)
    discount = sum(line_discounts)
    net = items_total - discount
    rate_bp = int((Decimal(str(tax_rate)) * 100).to_integral_value())
    tax = half_up(net * rate_bp, 10000)
    return Priced(items_total, line_discounts, discount, net, tax, net + tax)
