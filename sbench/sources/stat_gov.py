"""Official wage statistics — Бюро национальной статистики (stat.gov.kz). Public data, free, no login.

Two layers are collected:
  1. QUARTERLY / ANNUAL macro series (publication "Численность и заработная плата работников в РК"):
       average monthly nominal wage by industry (ОКЭД section) and by region, plus national average/median.
  2. ANNUAL OCCUPATIONAL SURVEY (April, form 2-Т; "Распределение заработной платы по основным профессиям
       и должностям"): average monthly nominal wage per profession × industry, profession × region,
       and profession national average. Available for 2025 and 2026.
Values are *actual accrued gross pay* (incl. bonuses/allowances, before taxes) — not vacancy offers.
"""
from __future__ import annotations

import html as htmllib
import re
import urllib.parse
from datetime import date
from pathlib import Path

from .. import mapper
from ..config import ROOT
from ..db import log_run, upsert_official
from ..http import Http
from ..normalize import classify_category
from ..taxonomy import INDUSTRIES, norm_industry, norm_region
from ..xlsx import read_xlsx

BASE = "https://stat.gov.kz"
PUB_LIST = BASE + "/ru/industries/labor-and-income/stat-wags/publications/"
SHEETS_PAGE = BASE + "/ru/industries/labor-and-income/stat-wags/spreadsheets/?name={}"
OCCUPATION_PAGES = ["352980"]          # "по основным профессиям и должностям" — new yearly releases appear here
CACHE = ROOT / "data" / "cache" / "stat"
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4}
MAX_BYTES = 40_000_000


# ----------------------------------------------------------------- helpers ---
def _text(s):
    return htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _download(http: Http, url: str, name: str) -> Path:
    if not url.startswith(BASE + "/"):
        raise ValueError("only stat.gov.kz files are downloaded: " + url)
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / re.sub(r"[^\w.\-]+", "_", name)
    if path.exists() and path.stat().st_size > 0:
        return path
    import urllib.request
    http._wait()
    req = urllib.request.Request(url, headers={"User-Agent": http.ua})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("file too large: " + url)
    path.write_bytes(data)
    return path


def _compact(r):
    """Drop empty cells so a label is always r[0] and the first number r[1] (layouts differ between files)."""
    return [c for c in (r or []) if c not in (None, "")]


def num(v):
    return v if isinstance(v, float) and v > 0 else None


def parse_period(title: str):
    """'(II квартал 2026г.)' -> (2026, 2); '(2025г.)' / 'за 2025 год' -> (2025, 0)."""
    m = re.search(r"\b(I{1,3}|IV)\s+квартал\w*\s+(20\d\d)", title)
    if m:
        return int(m.group(2)), ROMAN[m.group(1)]
    m = re.search(r"\(?\b(20\d\d)\s*(?:г\b|год)", title)
    return (int(m.group(1)), 0) if m else (None, None)


# -------------------------------------------- 1. quarterly/annual macro series ---
def list_publications(http: Http):
    """[(id, title, year, quarter)] of wage publications, newest first (server-rendered list)."""
    h = http.get(PUB_LIST)
    out = []
    for m in re.finditer(r'<a href="(\d+)/"\s+class="release-title">(.*?)</a>', h, re.S):
        title = _text(m.group(2))
        if "заработная плата" not in title.lower() and "заработной платы" not in title.lower():
            continue
        y, q = parse_period(title)
        if y:
            out.append((m.group(1), title, y, q))
    return out


def xlsx_links(page_html: str):
    return sorted(set(re.findall(r'href="(/upload/[^"]+\.xlsx)"', page_html)))


def classify_table(rows):
    """Structural detection: which table is this? -> ('industry'|'region'|'national'|None)."""
    ind = reg = 0
    for r in map(_compact, rows):
        if r and isinstance(r[0], str) and len(r) > 1 and num(r[1] if len(r) > 1 else None):
            ind += norm_industry(r[0]) != "Не указано"
            reg += norm_region(r[0]) != "Не указано"
    if ind >= 8 and ind >= reg:
        return "industry"
    if reg >= 8:
        return "region"
    return None


def parse_macro_workbook(rows, kind, year, quarter, url, released=None, src="stat.gov.kz"):
    out = []
    for r in map(_compact, rows):
        if not r or not isinstance(r[0], str) or len(r) < 2:
            continue
        v = num(r[1])
        if not v:
            continue
        label = r[0].strip()
        if kind == "industry":
            if label.lower().startswith("по всем видам"):
                out.append(dict(dataset="national_period", metric="avg", value=v))
                continue
            ind = norm_industry(label)
            if ind != "Не указано":
                out.append(dict(dataset="industry_period", industry=ind, metric="avg", value=v))
        elif kind == "region":
            reg = norm_region(label)
            if reg != "Не указано":
                out.append(dict(dataset="region_period", region=reg, metric="avg", value=v))
    for o in out:
        o.update(source=src, year=year, quarter=quarter, url=url, released=released)
    return out


def parse_national_series(rows, url):
    """Table 'Заработная плата в РК': year rows then quarter rows with average (col1) and median (last col)."""
    out, year = [], None
    for r in rows:
        if not r:
            continue
        first = r[0]
        if isinstance(first, float) and 2000 < first < 2100 and len([x for x in r if x is not None]) == 1:
            year = int(first)
        elif isinstance(first, str) and year:
            m = re.match(r"\s*(I{1,3}|IV)\s+квартал", first)
            if m and num(r[1]):
                q = ROMAN[m.group(1)]
                out.append(dict(source="stat.gov.kz", dataset="national_period", year=year, quarter=q,
                                metric="avg", value=r[1], url=url))
                med = next((x for x in reversed(r) if num(x)), None)
                if med and med != r[1] and len(r) >= 6:
                    out.append(dict(source="stat.gov.kz", dataset="national_period", year=year, quarter=q,
                                    metric="median", value=med, url=url))
    return out


def collect_macro(cfg, con, http, min_year=2022, progress=print):
    n = 0
    pubs = [p for p in list_publications(http) if p[2] >= min_year]
    known = {p[0] for p in pubs}
    for pid, y, q in cfg.get("stat", {}).get("extra_publications", []):   # e.g. annual release not tagged "заработная плата"
        if pid not in known:
            pubs.append((pid, f"публикация {pid} ({y})", y, q))
    progress(f"[stat] publications since {min_year}: {len(pubs)}")
    series_done = False
    for pid, title, year, quarter in pubs:
        url = f"{BASE}/ru/industries/labor-and-income/stat-wags/publications/{pid}/"
        try:
            page = http.get(url)
        except Exception as e:                                   # one broken page must not stop the run
            progress(f"[stat]   {title}: page error {e}")
            continue
        found = 0
        for link in xlsx_links(page):
            try:
                path = _download(http, BASE + urllib.parse.quote(link), f"{pid}_{Path(link).name}")
                wb = read_xlsx(path)
            except Exception as e:
                progress(f"[stat]   skip {Path(link).name}: {e}")
                continue
            for rows in wb.values():
                kind = classify_table(rows)
                recs = parse_macro_workbook(rows, kind, year, quarter, url) if kind else []
                if not recs and not series_done and any(isinstance(r[0], str) and r[0].strip().startswith("Заработная плата в") for r in rows[:2] if r):
                    recs = parse_national_series(rows, url)
                    series_done = bool(recs)
                for r in recs:
                    upsert_official(con, r)
                    found += 1
        con.commit()
        n += found
        progress(f"[stat]   {title}: {found} values")
    return n


# ----------------------------------------------- 2. occupational survey (April) ---
def discover_occupation_files(http: Http):
    """[(element_id, year)] of 'по основным профессиям и должностям' workbooks."""
    out = []
    for pg in OCCUPATION_PAGES:
        h = http.get(SHEETS_PAGE.format(pg))
        for m in re.finditer(r"/api/iblock/element/(\d+)/file/ru/", h):
            before = _text(h[max(0, m.start() - 700):m.start()])
            ys = re.findall(r"\((?:[^)]*?)(20\d\d)[^)]*\)", before)
            if ys:
                out.append((m.group(1), int(ys[-1])))
    return sorted(set(out), key=lambda x: -x[1])


# Row names that open a sub-industry block inside an industry sheet (ОКЭД activity names, never professions)
_BLOCK_HEADER = re.compile(
    r"^(производство|добыча|деятельность|торговля|строительство|разработка|обработка|переработка|ремонт|"
    r"предоставление|хранение|издательск|лесоводство|лесозаготовк|рыболовство|рыбоводство|выращивание|разведение|печать|"
    r"монтаж|установка|подготовка|оптовая|розничная|растениеводство|сбор|складское|почтовая|телекоммуникации|"
    r"страхование|аренда|образование|здравоохранение|научные|архитектура|прочая|прочие|спортивная|организация|"
    r"ветеринарная|юридическая|бухгалтерский|реклам|исследование|консультирование|управление|социальное|операции|"
    r"финансовое|вспомогательная|лизинг|водоотведение|распределение|передача|сухопутный|водный|воздушный|"
    r"трубопроводный|консервирование|убой|литье|ковка|обслуживание|общее|специальное|санитарная|очистка|"
    r"операционная|охота|подготовительные|завершающие|электромонтажные)\b", re.I)


def _industry_of_sheet(title: str):
    m = re.search(r"должностям\s+в\s+(.*)$", title)
    return norm_industry(m.group(1)) if m else "Не указано"


def _classify_profession(name: str):
    m = mapper.map_title(name, 1)
    if m["score"] >= mapper.MED:
        return m["category"], m["role"]
    return classify_category(name), ""


def _title(rows):
    for r in rows[:3]:
        for c in r or []:
            if isinstance(c, str) and len(c) > 25:
                return re.sub(r"\s+", " ", c).strip()
    return ""


def parse_occupation_workbook(wb: dict, year: int, url: str, released=None):
    """Yield official_wages records from one yearly workbook. Sheets are recognised by their TITLE
    (layouts differ between years): profession x industry, profession x industry matrix, profession x region."""
    cache = {}

    def cls(name):
        if name not in cache:
            cache[name] = _classify_profession(name)
        return cache[name]

    base = dict(source="stat.gov.kz", year=year, quarter=0, url=url, released=released, metric="avg")
    sheets = {n: (_title(r), r) for n, r in wb.items() if r}
    matrix = [(t, r) for t, r in sheets.values() if "и видам экономической деятельности" in t and "среднемесячная" in t.lower()]
    # names of all industries/sub-industries (sheet "profession x industry", column A): block headers in the industry sheets
    headers = set()
    for t, rows in matrix:
        for r in rows[3:]:
            if r and isinstance(r[0], str):
                headers.add(re.sub(r"\s+", " ", r[0]).strip())

    for t, rows in sheets.values():
        tl = t.lower()
        if "среднемесячная" not in tl:
            continue
        if re.search(r"по основным профессиям и должностям в ", tl):
            ind = _industry_of_sheet(t)
            if ind == "Не указано":
                continue
            data = [(i, re.sub(r"\s+", " ", r[0]).strip(), r[1]) for i, r in enumerate(rows)
                    if r and isinstance(r[0], str) and len(r) > 1 and num(r[1])]
            if not data:
                continue
            first_prof = data[1][1] if len(data) > 1 else None        # first profession of the first block
            yield dict(base, dataset="occupation_industry", profession="Все профессии (в среднем)",
                       category="", role="", industry=ind, value=data[0][2])
            for pos in range(1, len(data)):
                i, name, val = data[pos]
                nxt = data[pos + 1] if pos + 1 < len(data) else None
                # a new sub-industry block starts when the order of professions restarts, or at a known header row
                if pos > 1 and (name in headers or _BLOCK_HEADER.match(name) or name == first_prof
                                or (nxt and nxt[0] == i + 1 and nxt[1] == first_prof)):
                    break
                cat, role = cls(name)
                yield dict(base, dataset="occupation_industry", profession=name, category=cat, role=role,
                           industry=ind, value=val)
        elif "в разрезе регионов" in tl:                             # selected professions x regions
            hdr = next((r for r in rows[:6] if r and sum(isinstance(c, str) and len(c) > 3 for c in r[1:]) >= 3), [])
            for r in rows:
                if not r or not isinstance(r[0], str) or r is hdr:
                    continue
                reg = "" if r[0].strip().startswith("Республика") else norm_region(r[0])
                if reg == "Не указано":
                    continue
                for c, name in enumerate(hdr):
                    if c and isinstance(name, str) and name.strip() and c < len(r) and num(r[c]):
                        name = re.sub(r"\s+", " ", name.strip())
                        cat, role = cls(name)
                        yield dict(base, dataset="occupation_region", profession=name, category=cat, role=role,
                                   region=reg, value=r[c])
    for t, rows in matrix:                                           # national average per profession ("Всего" row)
        hdr = next((r for r in rows[:6] if r and sum(isinstance(c, str) and len(c) > 3 for c in r[1:]) >= 3), [])
        tot = next((r for r in rows[:12] if r and isinstance(r[0], str) and r[0].strip().lower() == "всего"), None)
        if tot:
            for c, name in enumerate(hdr):
                if c and isinstance(name, str) and name.strip() and c < len(tot) and num(tot[c]):
                    name = re.sub(r"\s+", " ", name.strip())
                    cat, role = cls(name)
                    yield dict(base, dataset="occupation_total", profession=name, category=cat, role=role, value=tot[c])


def collect_occupations(cfg, con, http, progress=print):
    n = 0
    for eid, year in discover_occupation_files(http):
        url = f"{BASE}/api/iblock/element/{eid}/file/ru/"
        try:
            path = _download(http, url, f"occupations_{year}_{eid}.xlsx")
            wb = read_xlsx(path)
        except Exception as e:
            progress(f"[stat] occupations {year}: {e}")
            continue
        cnt = 0
        for rec in parse_occupation_workbook(wb, year, url):
            upsert_official(con, rec)
            cnt += 1
        con.commit()
        n += cnt
        progress(f"[stat] occupational survey {year}: {cnt} values")
    return n


def collect(cfg, con, http: Http | None = None, min_year=2022, progress=print):
    http = http or Http(cfg["user_agent"], delay=cfg.get("stat", {}).get("request_delay_sec", 1.0))
    started = date.today().isoformat()
    a = collect_macro(cfg, con, http, min_year, progress)
    b = collect_occupations(cfg, con, http, progress)
    log_run(con, "stat.gov.kz", started, a + b, a + b)
    return a + b
