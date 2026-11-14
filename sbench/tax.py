"""Kazakhstan payroll tax model (defaults = rules in force from 1 Jan 2026, new Tax Code).
ALL parameters live in config.json -> "tax" and are editable in the dashboard; verify with your accountant.

Employee side (gross -> net):   ОПВ 10% (cap 50 МЗП), ВОСМС 2% (cap 20 МЗП),
                                ИПН 10% of (gross - ОПВ - ВОСМС - 30 МРП); 15% on the part of annual income above 8 500 МРП.
Employer side (on top of gross): ОПВР 3.5% (cap 50 МЗП), СО 5% of (gross - ОПВ) within 1..7 МЗП,
                                ООСМС 3% (cap 20 МЗП), СН 6% of (gross - ОПВ - ВОСМС).
"""
from __future__ import annotations

DEFAULT = {
    "year": 2026, "mrp": 4325, "mzp": 85000,
    "opv": 0.10, "opv_cap_mzp": 50, "vosms": 0.02, "vosms_cap_mzp": 20,
    "ipn": 0.10, "ipn_high": 0.15, "ipn_high_threshold_mrp_year": 8500, "deduction_mrp": 30,
    "opvr": 0.035, "so": 0.05, "so_min_mzp": 1, "so_max_mzp": 7,
    "oosms": 0.03, "oosms_cap_mzp": 20, "sn": 0.06,
}


def params(cfg=None):
    p = dict(DEFAULT)
    p.update((cfg or {}).get("tax", {}))
    return p


def employee(gross: float, t: dict) -> dict:
    opv = t["opv"] * min(gross, t["opv_cap_mzp"] * t["mzp"])
    vosms = t["vosms"] * min(gross, t["vosms_cap_mzp"] * t["mzp"])
    base = max(0.0, gross - opv - vosms - t["deduction_mrp"] * t["mrp"])
    thr = t["ipn_high_threshold_mrp_year"] * t["mrp"] / 12
    ipn = t["ipn"] * base if base <= thr else t["ipn"] * thr + t["ipn_high"] * (base - thr)
    return {"opv": opv, "vosms": vosms, "ipn": ipn, "net": gross - opv - vosms - ipn}


def employer(gross: float, t: dict) -> dict:
    opv = t["opv"] * min(gross, t["opv_cap_mzp"] * t["mzp"])
    vosms = t["vosms"] * min(gross, t["vosms_cap_mzp"] * t["mzp"])
    opvr = t["opvr"] * min(gross, t["opv_cap_mzp"] * t["mzp"])
    so = t["so"] * min(max(gross - opv, t["so_min_mzp"] * t["mzp"]), t["so_max_mzp"] * t["mzp"])
    oosms = t["oosms"] * min(gross, t["oosms_cap_mzp"] * t["mzp"])
    sn = t["sn"] * max(0.0, gross - opv - vosms)
    return {"opvr": opvr, "so": so, "oosms": oosms, "sn": sn, "total": opvr + so + oosms + sn}


def net_from_gross(gross: float, t: dict) -> float:
    return employee(gross, t)["net"]


def gross_from_net(net: float, t: dict) -> float:
    """Invert net_from_gross by bisection (monotonic)."""
    lo, hi = net, net * 2.0
    while net_from_gross(hi, t) < net:
        hi *= 2
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if net_from_gross(mid, t) < net else (lo, mid)
    return (lo + hi) / 2
