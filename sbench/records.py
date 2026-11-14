from __future__ import annotations

from . import mapper
from .normalize import classify_category, level_of, tag_benefits, title_norm, to_kzt_month
from .taxonomy import norm_industry, norm_region


def make_record(cfg, *, source, source_id, title, sal_from, sal_to, currency="KZT", gross=True,
                url=None, published_at=None, category=None, role=None, industry=None, region=None,
                city=None, employer=None, experience=None, description=None, benefits=None):
    """Build a DB-ready observation, or None when salary is unusable/out of sane bounds."""
    conv = to_kzt_month(sal_from, sal_to, currency, gross, cfg)
    if conv is None:
        return None
    kf, kt, km, rtype = conv
    if benefits is None:
        benefits = tag_benefits(description) if description else []
    if not category or not role:
        m = mapper.map_title(title, 1)
        if m["score"] >= mapper.MED:
            category, role = category or m["category"], role or m["role"]
        else:
            category = category or classify_category(title)
    return {
        "source": source, "source_id": str(source_id), "url": url,
        "published_at": (published_at or "")[:10] or None,
        "title": title, "title_norm": title_norm(title), "level": level_of(title),
        "category": category, "role": role or "Не определена", "industry": industry or "Не указано",
        "region": norm_region(region), "city": city, "employer": employer,
        "experience": experience, "currency": (currency or "KZT").upper(),
        "sal_from": sal_from, "sal_to": sal_to, "gross": 1 if gross else 0,
        "kzt_from": kf, "kzt_to": kt, "kzt_mid": km, "range_type": rtype,
        "benefits": benefits, "has_description": 1 if description else 0,
    }


def renormalize(con, cfg) -> int:
    """Re-apply the current taxonomy/mapper to rows already in the DB (safe to run repeatedly).
    hh.kz rows keep their native role/category; everything else is re-mapped from the title."""
    from .taxonomy import INDUSTRIES
    n = 0
    for r in con.execute("SELECT id, source, title, employer, category, role, industry, region FROM observations").fetchall():
        cat, role, ind = r["category"], r["role"], r["industry"]
        if not r["source"].startswith("hh"):
            m = mapper.map_title(r["title"] or "", 1)
            if m["score"] >= mapper.MED:
                cat, role = m["category"], m["role"]
            else:
                cat, role = classify_category(r["title"] or ""), "Не определена"
        if ind not in INDUSTRIES:
            ind = norm_industry(ind, hint_text=f"{r['employer'] or ''} {r['title'] or ''}")
        reg = norm_region(r["region"])
        if (cat, role, ind, reg) != (r["category"], r["role"], r["industry"], r["region"]):
            con.execute("UPDATE observations SET category=?, role=?, industry=?, region=? WHERE id=?",
                        (cat, role, ind, reg, r["id"]))
            n += 1
    con.commit()
    return n
