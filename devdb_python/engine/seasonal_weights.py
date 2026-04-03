"""
seasonal_weights.py -- Shared seasonal weight sets for demand generation.

Used by:
  S-0600 demand_generator     -- per-month slot allocation
  P-0000 placeholder_rebuilder -- effective monthly pace calculation

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
    accounting for per-month rounding.  Divide by 12 to get monthly pace.

    Example:
        annual_starts_target=14, balanced_2yr -> every month rounds to 1 -> 12.0/yr
        annual_starts_target=24, balanced_2yr -> some months round to 2 -> 24.0/yr
    """
    weights = WEIGHT_SETS.get(weight_set_name) or WEIGHT_SETS["balanced_2yr"]
    return float(sum(round(w * annual_starts_target) for w in weights.values()))
