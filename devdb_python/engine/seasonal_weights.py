"""
seasonal_weights.py -- Shared seasonal weight sets for demand generation.

Used by:
  demand_generator demand_generator     -- per-month slot allocation
  placeholder_rebuilder placeholder_rebuilder -- effective monthly pace calculation

Each weight set is a dict mapping month number (1-12) to fractional weight.
Weights within a set must sum to 1.0.

effective_annual_pace(weight_set_name, annual_starts_target) computes the true
expected annual output that S-0600 will produce for a given target — applying
the same round() logic so P-0000's drain estimate always matches reality.
"""

WEIGHT_SETS: dict[str, dict[int, float]] = {
    "balanced_2yr": {
        1: 0.060, 2: 0.065, 3: 0.085, 4: 0.095,
        5: 0.100, 6: 0.095, 7: 0.090, 8: 0.090,
        9: 0.085, 10: 0.080, 11: 0.070, 12: 0.085,
    },
}

SUPPORTED_WEIGHT_SETS = set(WEIGHT_SETS.keys())


def effective_annual_pace(weight_set_name: str, annual_starts_target: float) -> float:
    """
    Return the true annual slot count that S-0600 will generate for this target,
    accounting for Bresenham accumulator rounding.  Divide by 12 to get monthly pace.

    For integer annual_starts_target values, this equals annual_starts_target exactly
    (sum(weights)==1.0 means carry resets to 0 at each year boundary).
    For fractional targets the result may differ by ±1 from the naive expectation.

    Example:
        annual_starts_target=8, balanced_2yr  -> 8.0/yr  (was 11/yr with round())
        annual_starts_target=14, balanced_2yr -> 14.0/yr (was 12/yr with round())
    """
    weights = WEIGHT_SETS.get(weight_set_name) or WEIGHT_SETS["balanced_2yr"]
    carry = 0.0
    total = 0
    for w in weights.values():
        carry += w * annual_starts_target
        s = int(carry)
        total += s
        carry -= s
    return float(total)
