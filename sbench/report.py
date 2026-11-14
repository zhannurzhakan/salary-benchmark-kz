"""Builds one self-contained HTML dashboard (no server, no CDN) from the SQLite DB.

Payload layout (dictionary-coded to keep the file small):
  cat   canonical lists (regions, industries, areas, roles, levels)      -> filters never "lose" values
  dict  string dictionaries used by vacancy rows
  vac   [month,source,area,role,title,level,industry,region,experience,from,to,mid,[benefit idx]] (indexes; -1 = n/a)
  off   official stat.gov.kz data: professions, profession x industry, national, profession x region, quarterly series
  map   synonyms used by the title mapper (same file the Python mapper uses)
  meta  build date, demo flag, tax parameters, source freshness
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from . import mapper, tax, taxonomy
from .normalize import BENEFITS

DASH = Path(__file__).with_name("dashboard")
JS_ORDER = ["core.js", "benchmark.js", "mapping.js", "snapshots.js", "calc.js", "fot.js", "app.js"]


class Dict:
    def __init__(self, seed=()):
        self.items, self.idx = [], {}
        for s in seed:
            self.add(s)

    def add(self, s):
        if s is None or s == "":
            return -1
        if s not in self.idx:
            self.idx[s] = len(self.items)
            self.items.append(s)
        return self.idx[s]


def _round(v):
    return None if v is None else round(v)


def build_payload(cfg, con, demo=False):
    cats = taxonomy.categories()
    D = {k: Dict() for k in ("source", "month", "title", "level", "experience", "benefit")}
    D["area"], D["role"] = Dict(cats), Dict()
    D["industry"], D["region"] = Dict(taxonomy.INDUSTRIES), Dict(taxonomy.REGIONS)
    D["level"] = Dict(taxonomy.LEVELS)
    D["benefit"] = Dict(BENEFITS.keys())
    home = mapper.role_home()
    for role in sorted(home):
        D["role"].add(role)
    D["role"].add("Не определена")

    # ---- vacancies --------------------------------------------------------
    vac = []
    for r in con.execute("SELECT * FROM observations WHERE kzt_mid IS NOT NULL ORDER BY published_at"):
        month = (r["published_at"] or r["first_seen"] or date.today().isoformat())[:7]
        ben = json.loads(r["benefits"] or "[]")
        vac.append([
            D["month"].add(month), D["source"].add(r["source"]), D["area"].add(r["category"] or "Другое"),
            D["role"].add(r["role"] or "Не определена"), D["title"].add(r["title_norm"] or r["title"]),
            D["level"].add(r["level"]), D["industry"].add(r["industry"]), D["region"].add(r["region"]),
            D["experience"].add(r["experience"]), _round(r["kzt_from"]), _round(r["kzt_to"]), _round(r["kzt_mid"]),
            [D["benefit"].add(b) for b in ben] if r["has_description"] else None])

    # ---- official statistics ---------------------------------------------
    prof_idx, profs = {}, []

    def P(name, cat, role):
        key = (name, cat, role)
        if key not in prof_idx:
            prof_idx[key] = len(profs)
            profs.append([name, D["area"].add(cat or "Другое"), D["role"].add(role) if role else -1])
        return prof_idx[key]

    off = {"prof": profs, "ind": [], "tot": [], "reg": [], "indQ": [], "regQ": [], "nat": []}
    nat = {}
    rows = con.execute("SELECT * FROM official_wages").fetchall()
    for r in rows:
        ds, per = r["dataset"], r["year"] * 10 + r["quarter"]
        if ds == "occupation_industry":
            off["ind"].append([P(r["profession"], r["category"], r["role"]), D["industry"].add(r["industry"]), r["year"], _round(r["value"])])
        elif ds == "occupation_total":
            off["tot"].append([P(r["profession"], r["category"], r["role"]), r["year"], _round(r["value"])])
        elif ds == "occupation_region":
            off["reg"].append([P(r["profession"], r["category"], r["role"]), D["region"].add(r["region"]), r["year"], _round(r["value"])])
        elif ds == "industry_period":
            off["indQ"].append([D["industry"].add(r["industry"]), per, _round(r["value"])])
        elif ds == "region_period":
            off["regQ"].append([D["region"].add(r["region"]), per, _round(r["value"])])
        elif ds == "national_period":
            nat.setdefault(per, {})[r["metric"]] = _round(r["value"])
    off["nat"] = [[p, v.get("avg"), v.get("median")] for p, v in sorted(nat.items())]

    # ---- freshness ----------------------------------------------------------
    fresh = [{"source": r[0], "n": r[1], "last": r[2]} for r in con.execute(
        "SELECT source, count(*), max(last_seen) FROM observations GROUP BY source")]
    pers = sorted({r["year"] * 10 + r["quarter"] for r in rows if r["dataset"] == "industry_period" and r["quarter"]})
    meta = {
        "built": date.today().isoformat(), "demo": demo, "min_sample": cfg["min_sample"],
        "tax": tax.params(cfg), "fresh": fresh,
        "stat_latest": pers[-1] if pers else None,
        "occupation_years": sorted({r["year"] for r in rows if r["dataset"].startswith("occupation")}),
    }
    catalog = {
        "regions": taxonomy.REGIONS, "industries": taxonomy.INDUSTRIES, "areas": cats, "levels": taxonomy.LEVELS,
        "roles": [[r, D["area"].add(home.get(r, "Другое"))] for r in sorted(home)],
    }
    syn = json.loads((Path(__file__).with_name("data") / "synonyms.json").read_text(encoding="utf-8"))
    return {"meta": meta, "cat": catalog, "dict": {k: v.items for k, v in D.items()}, "vac": vac, "off": off, "map": syn}


def build(cfg, con, out, demo=False):
    from .records import renormalize
    if not demo:
        renormalize(con, cfg)
    payload = build_payload(cfg, con, demo)
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    js = "\n".join((DASH / f).read_text(encoding="utf-8") for f in JS_ORDER).replace("/*__DATA__*/null", data)
    html = (DASH / "index.html").read_text(encoding="utf-8").replace("/*__JS__*/", js)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out
