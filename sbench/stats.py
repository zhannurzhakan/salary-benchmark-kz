"""Statistics. Percentile method = linear interpolation (Excel PERCENTILE.INC / numpy 'linear').
The dashboard's JavaScript uses exactly the same formula."""
from __future__ import annotations

import json
from collections import defaultdict
from statistics import mean


def percentile(sorted_vals, p):
    n = len(sorted_vals)
    if n == 0:
        return None
    k = (n - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, n - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def summarize(rows, min_sample=5):
    """rows: iterable of dicts with kzt_from/kzt_to/kzt_mid. Returns summary dict."""
    mids = sorted(r["kzt_mid"] for r in rows if r.get("kzt_mid"))
    n = len(mids)
    out = {"n": n, "reliable": n >= min_sample}
    if not n:
        return out
    rows = [r for r in rows if r.get("kzt_mid")]
    out.update(
        min=min(r.get("kzt_from") or r["kzt_mid"] for r in rows),
        max=max(r.get("kzt_to") or r["kzt_mid"] for r in rows),
        p10=percentile(mids, 10), p25=percentile(mids, 25), median=percentile(mids, 50),
        p75=percentile(mids, 75), p90=percentile(mids, 90), mean=mean(mids),
    )
    return out


def group_summary(rows, key, min_sample=5):
    g = defaultdict(list)
    for r in rows:
        g[r.get(key) or "—"].append(r)
    res = {k: summarize(v, min_sample) for k, v in g.items()}
    return dict(sorted(res.items(), key=lambda kv: -kv[1]["n"]))


def benefit_prevalence(rows):
    """Share of vacancies (with a parsed description) that mention each benefit."""
    base = [r for r in rows if r.get("has_description")]
    cnt = defaultdict(int)
    for r in base:
        b = r["benefits"] if isinstance(r["benefits"], list) else json.loads(r["benefits"] or "[]")
        for x in b:
            cnt[x] += 1
    n = len(base)
    return {"n": n, "share": {k: v / n for k, v in sorted(cnt.items(), key=lambda kv: -kv[1])} if n else {}}


def compa_ratio(salary, market_median):
    """Compa-ratio = actual pay / market reference (P50). 1.00 = paid at market."""
    return salary / market_median if market_median else None


def range_penetration(salary, p25, p75):
    """Position within the P25..P75 band (0 = P25, 1 = P75); can fall outside 0..1."""
    return (salary - p25) / (p75 - p25) if p75 and p75 != p25 else None
