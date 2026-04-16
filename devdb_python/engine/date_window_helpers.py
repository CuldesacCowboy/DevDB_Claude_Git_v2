"""
date_window_helpers.py -- Pure calendar arithmetic for delivery window scheduling.

Used by:
  P-0050 placeholder_rebuilder -- delivery date computation

All functions operate on first-of-month dates and frozenset[int] valid_months.
No database access. No side effects.
"""

from datetime import date


def add_months(d: date, n: int) -> date:
    """Add n months to a first-of-month date."""
    month = d.month + n
    year = d.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return d.replace(year=year, month=month, day=1)


def lean_window_date(demand_date: date, valid_months: frozenset,
                     today_first: date) -> date:
    """
    Return the latest first-of-month date that:
    - Falls within valid_months
    - Is <= demand_date
    - Is >= today_first

    If no such date exists (demand already past all window months for its year,
    or demand month not in valid_months), return the next available window month
    >= today_first.
    """
    if demand_date is None:
        return next_window_month_from(today_first, valid_months)

    d = demand_date.replace(day=1)

    # Walk back from demand month looking for latest window month >= today_first
    for _ in range(25):  # up to ~2 years back
        if d.month in valid_months:
            if d >= today_first:
                return d
            else:
                break  # valid window month but in the past — stop looking back
        # Step back one month
        if d.month == 1:
            d = d.replace(year=d.year - 1, month=12)
        else:
            d = d.replace(month=d.month - 1)

    # Demand is past or window doesn't cover demand month — schedule at next
    # available window month from today
    return next_window_month_from(today_first, valid_months)


def next_window_month_from(from_date: date, valid_months: frozenset) -> date:
    """Return the earliest first-of-month >= from_date within valid_months."""
    d = from_date.replace(day=1)
    for _ in range(25):
        if d.month in valid_months:
            return d
        if d.month == 12:
            d = d.replace(year=d.year + 1, month=1)
        else:
            d = d.replace(month=d.month + 1)
    # Fallback — should not reach here for reasonable window values
    return from_date.replace(day=1)


def next_window_month_after(after_date: date, valid_months: frozenset) -> date:
    """Return the earliest first-of-month strictly after after_date in valid_months."""
    d = after_date.replace(day=1)
    if d.month == 12:
        d = d.replace(year=d.year + 1, month=1)
    else:
        d = d.replace(month=d.month + 1)
    return next_window_month_from(d, valid_months)


def first_window_month_in_year(year: int, valid_months: frozenset) -> date:
    """Return the first valid delivery month in the given year."""
    return date(year, min(valid_months), 1)


def snap_to_window(d: date, valid_months: frozenset) -> date:
    """Latest first-of-month in valid_months that is <= d. Walks back up to 24 months."""
    m = d.month
    year = d.year
    for _ in range(24):
        if m in valid_months:
            return date(year, m, 1)
        m -= 1
        if m == 0:
            m = 12
            year -= 1
    return date(d.year, min(valid_months), 1)


def months_between(d1: date, d2: date) -> int:
    """Months from d1 to d2, clamped to 0 if d2 <= d1."""
    return max(0, (d2.year - d1.year) * 12 + (d2.month - d1.month))
