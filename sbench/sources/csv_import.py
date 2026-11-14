"""Import any tabular data (own survey, enbek.kz export, purchased PwC/EY/WTW cuts, internal pay).

Columns (header names, any order; only title + salary are required):
  source, id, title, date (YYYY-MM-DD), category, role, industry, region, employer, experience,
  salary_from, salary_to (or just `salary`), currency (KZT default), gross (1/0, default 1),
  benefits (separated by ';')
"""
from __future__ import annotations

import csv
import hashlib
from datetime import date

from ..db import log_run, upsert
from ..records import make_record


def _num(v):
    v = (v or "").replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return float(v) if v else None
    except ValueError:
        return None


def import_csv(cfg, con, path, source="csv", delimiter=None):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        delim = delimiter or (";" if sample.count(";") > sample.count(",") else ",")
        rows = list(csv.DictReader(fh, delimiter=delim))
    fetched = stored = 0
    for i, r in enumerate(rows):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        fetched += 1
        lo = _num(r.get("salary_from") or r.get("salary") or r.get("min"))
        hi = _num(r.get("salary_to") or r.get("max"))
        title = r.get("title") or r.get("position") or r.get("должность")
        if not title:
            continue
        gross = r.get("gross", "1").lower() not in ("0", "false", "нет", "net")
        sid = r.get("id") or hashlib.md5(f"{path}{i}{title}{lo}{hi}".encode()).hexdigest()[:12]
        ben = [b.strip() for b in r.get("benefits", "").split(";") if b.strip()]
        rec = make_record(
            cfg, source=r.get("source") or source, source_id=sid, title=title, sal_from=lo, sal_to=hi,
            currency=r.get("currency") or "KZT", gross=gross, published_at=r.get("date") or date.today().isoformat(),
            category=r.get("category") or None, role=r.get("role") or None, industry=r.get("industry") or None,
            region=r.get("region") or None, employer=r.get("employer") or None,
            experience=r.get("experience") or None, benefits=ben if ben else None,
            description=(r.get("description") or None))
        if ben:
            rec["has_description"] = 1
        if rec:
            stored += upsert(con, rec)
    con.commit()
    log_run(con, source, date.today().isoformat(), fetched, stored, note=str(path))
    return fetched, stored
