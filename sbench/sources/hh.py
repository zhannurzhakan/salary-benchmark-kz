"""hh.kz via the OFFICIAL hh.ru API (api.hh.ru, area 40 = Kazakhstan).

Why the API and not HTML scraping: hh's terms forbid scraping, and since 2025 anonymous calls to
/vacancies return 403. An *application token* is free:
  1. register an app at https://dev.hh.ru/admin  (you get client_id + client_secret)
  2. export HH_CLIENT_ID=... HH_CLIENT_SECRET=...      (or export HH_ACCESS_TOKEN=... directly)
Dictionaries (/areas, /industries, /professional_roles) are public and need no token.

Limits handled here: max 2000 results per search (pages*per_page) -> we slice the date window
recursively (and iterate per professional_role) until every slice fits in 2000.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta

from ..db import log_run, upsert
from ..http import Http
from ..normalize import strip_html
from ..records import make_record
from ..taxonomy import norm_industry

API = "https://api.hh.ru"
MAX_RESULTS = 2000


class HHClient:
    def __init__(self, cfg: dict, http: Http | None = None, token_cache: str | None = None):
        self.cfg = cfg
        self.h = cfg["hh"]
        self.http = http or Http(cfg["user_agent"], delay=self.h.get("request_delay_sec", 0.4))
        self.token_cache = token_cache
        self._token = None

    # ---- auth -------------------------------------------------------------
    def token(self) -> str:
        if self._token:
            return self._token
        t = os.environ.get("HH_ACCESS_TOKEN")
        if not t and self.token_cache and os.path.exists(self.token_cache):
            t = json.load(open(self.token_cache)).get("access_token")
        if not t:
            cid, sec = os.environ.get("HH_CLIENT_ID"), os.environ.get("HH_CLIENT_SECRET")
            if not (cid and sec):
                raise SystemExit(
                    "hh.kz: нужен токен приложения. Зарегистрируйте приложение на https://dev.hh.ru/admin и задайте\n"
                    "  export HH_CLIENT_ID=...  HH_CLIENT_SECRET=...   (или HH_ACCESS_TOKEN=...)")
            r = self.http.post_form(f"{API}/token", {"grant_type": "client_credentials",
                                                      "client_id": cid, "client_secret": sec})
            t = r["access_token"]
            if self.token_cache:
                os.makedirs(os.path.dirname(self.token_cache), exist_ok=True)
                json.dump({"access_token": t}, open(self.token_cache, "w"))
        self._token = t
        return t

    def _auth(self):
        return {"Authorization": f"Bearer {self.token()}"}

    # ---- public dictionaries ----------------------------------------------
    def region_map(self) -> dict:
        """area id -> top-level region name (oblast / city of republican significance)."""
        tree = self.http.get_json(f"{API}/areas/{self.h['area']}")
        out = {}

        def walk(node, region):
            out[str(node["id"])] = region
            for ch in node.get("areas", []):
                walk(ch, region)
        for top in tree.get("areas", []):
            walk(top, top["name"])
        return out

    def role_map(self) -> dict:
        """professional_role id -> (category, role)."""
        d = self.http.get_json(f"{API}/professional_roles")
        return {str(r["id"]): (c["name"], r["name"]) for c in d["categories"] for r in c["roles"]}

    def industry_map(self) -> dict:
        """industry id (any level) -> TOP-level industry id (used to map onto our canonical ОКЭД list)."""
        out = {}
        for top in self.http.get_json(f"{API}/industries"):
            out[str(top["id"])] = str(top["id"])
            for ch in top.get("industries", []):
                out[str(ch["id"])] = str(top["id"])
        return out

    # ---- search with 2000-cap slicing --------------------------------------
    def _page(self, params, page):
        return self.http.get_json(f"{API}/vacancies", {**params, "page": page, "per_page": self.h["per_page"]},
                                  headers=self._auth())

    def search(self, role_id: str, d_from: date, d_to: date):
        params = {"area": self.h["area"], "only_with_salary": "true", "professional_role": role_id,
                  "date_from": d_from.isoformat(), "date_to": d_to.isoformat(), "order_by": "publication_time"}
        first = self._page(params, 0)
        found = first.get("found", 0)
        if found > MAX_RESULTS and d_to > d_from:
            mid = d_from + (d_to - d_from) // 2
            yield from self.search(role_id, d_from, mid)
            yield from self.search(role_id, mid + timedelta(days=1), d_to)
            return
        yield from first.get("items", [])
        for p in range(1, min(first.get("pages", 1), MAX_RESULTS // self.h["per_page"])):
            yield from self._page(params, p).get("items", [])

    def employer_industry(self, con, emp_id, ind_map):
        row = con.execute("SELECT industry FROM employers WHERE source='hh.kz' AND id=?", (emp_id,)).fetchone()
        if row:
            return row["industry"]
        try:
            e = self.http.get_json(f"{API}/employers/{emp_id}", headers=self._auth())
        except Exception:
            return None
        ind = None
        for i in e.get("industries", []):                       # first industry that maps onto the canonical list
            cand = norm_industry(hh_id=ind_map.get(str(i["id"]), str(i["id"])))
            if cand != "Не указано":
                ind = cand
                break
        con.execute("INSERT OR REPLACE INTO employers VALUES ('hh.kz',?,?,?)", (emp_id, e.get("name"), ind))
        return ind

    def description(self, vid):
        try:
            v = self.http.get_json(f"{API}/vacancies/{vid}", headers=self._auth())
            return strip_html(v.get("description", "")) + " " + " ".join(
                s.get("name", "") for s in v.get("key_skills", []))
        except Exception:
            return None


def item_to_record(cfg, it, regions, roles, industry=None, description=None):
    sal = it.get("salary_range") or it.get("salary") or {}
    mode = (sal.get("mode") or {}).get("id")
    if not sal or (mode and mode != "MONTH"):          # hourly / per-shift / fly-in-fly-out: not comparable
        return None
    area = it.get("area") or {}
    role_ids = [str(r["id"]) for r in it.get("professional_roles", [])]
    cat, role = roles.get(role_ids[0], (None, None)) if role_ids else (None, None)
    if not description:
        sn = it.get("snippet") or {}
        description = None  # snippets are too thin to claim a benefits profile
    return make_record(
        cfg, source="hh.kz", source_id=it["id"], title=it.get("name", ""),
        sal_from=sal.get("from"), sal_to=sal.get("to"), currency=sal.get("currency"),
        gross=bool(sal.get("gross")), url=it.get("alternate_url"), published_at=it.get("published_at"),
        category=cat, role=role, industry=industry, region=regions.get(str(area.get("id")), area.get("name")),
        city=area.get("name"), employer=(it.get("employer") or {}).get("name"),
        experience=(it.get("experience") or {}).get("name"), description=description)


def collect(cfg, con, days=None, role_ids=None, client: HHClient | None = None, progress=print):
    from ..config import ROOT
    c = client or HHClient(cfg, token_cache=str(ROOT / "data" / "hh_token.json"))
    days = days or cfg["hh"]["days"]
    started = date.today().isoformat()
    regions, roles, inds = c.region_map(), c.role_map(), c.industry_map()
    ids = role_ids or list(roles)
    d_to = date.today()
    d_from = d_to - timedelta(days=days)
    fetched = stored = 0
    for n, rid in enumerate(ids, 1):
        cnt = 0
        for it in c.search(rid, d_from, d_to):
            fetched += 1
            cnt += 1
            industry = None
            if cfg["hh"].get("fetch_employers") and (it.get("employer") or {}).get("id"):
                industry = c.employer_industry(con, it["employer"]["id"], inds)
            desc = c.description(it["id"]) if cfg["hh"].get("fetch_details") else None
            rec = item_to_record(cfg, it, regions, roles, industry, desc)
            if rec:
                stored += upsert(con, rec)
        con.commit()
        progress(f"[hh] role {rid} ({roles.get(rid, ('', ''))[1]}): {cnt} vacancies  [{n}/{len(ids)}]")
    log_run(con, "hh.kz", started, fetched, stored)
    return fetched, stored
