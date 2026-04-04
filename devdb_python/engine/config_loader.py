# engine/config_loader.py
# Loads merged delivery config for a simulation run.
# Community settings override global where non-null; global overrides hardcoded defaults.
#
# Call load_delivery_config(conn, ent_group_id) from P-0000, P-0400, and coordinator.

import logging

import pandas as pd

logger = logging.getLogger("devdb.engine")

# Hardcoded last-resort defaults (same as pre-global-settings behaviour)
_DEFAULTS = {
    "auto_schedule_enabled":    False,
    "max_deliveries_per_year":  1,
    "min_gap_months":           0,
    "delivery_months":          None,
    "min_d_count":              0,
    "min_u_count":              0,
    "min_uc_count":             0,
    "min_c_count":              0,
    "default_cmp_lag_days":     270,
    "default_cls_lag_days":     45,
}


def load_delivery_config(conn, ent_group_id: int) -> dict:
    """
    Return a fully-resolved delivery config dict for ent_group_id.
    Resolution order: community row → global row → hardcoded defaults.
    """
    global_df = conn.read_df("SELECT * FROM sim_global_settings WHERE id = 1")

    community_df = conn.read_df(
        """
        SELECT auto_schedule_enabled, max_deliveries_per_year, min_gap_months,
               delivery_months,
               COALESCE(min_d_count, min_unstarted_inventory) AS min_d_count,
               min_u_count, min_uc_count, min_c_count,
               default_cmp_lag_days, default_cls_lag_days
        FROM sim_entitlement_delivery_config
        WHERE ent_group_id = %s
        """,
        (ent_group_id,),
    )

    def _val(df, key):
        """Return the value for key from the first row of df, or None if missing/null."""
        if df.empty or key not in df.columns:
            return None
        v = df.iloc[0][key]
        if v is None:
            return None
        try:
            if pd.isnull(v):
                return None
        except (TypeError, ValueError):
            pass
        return v

    def merge(key):
        v = _val(community_df, key)
        if v is not None:
            return v
        v = _val(global_df, key)
        if v is not None:
            return v
        return _DEFAULTS.get(key)

    return {
        "auto_schedule_enabled":   bool(merge("auto_schedule_enabled")),
        "max_deliveries_per_year": int(merge("max_deliveries_per_year")),
        "min_gap_months":          int(merge("min_gap_months")),
        "delivery_months":         merge("delivery_months"),   # may be None → no valid months
        "min_d_count":             int(merge("min_d_count")),
        "min_u_count":             int(merge("min_u_count")),
        "min_uc_count":            int(merge("min_uc_count")),
        "min_c_count":             int(merge("min_c_count")),
        "default_cmp_lag_days":    int(merge("default_cmp_lag_days")),
        "default_cls_lag_days":    int(merge("default_cls_lag_days")),
    }
