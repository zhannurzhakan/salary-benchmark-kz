"""qsamruk.kz (Самрук-Қазына) — public vacancy list, robots.txt allows crawling (Allow: /).
The listing cards already carry salary, region, date and employer, so no detail fetch is needed."""
from __future__ import annotations

import re
from datetime import datetime

from ..db import log_run, upsert
from ..http import Http
from ..records import make_record
from ..taxonomy import norm_industry

BASE = "https://qsamruk.kz"
CARD = re.compile(r'<a href="/vacancy/(\d+)"[^>]*class="vacancy-item".*?</a>', re.S)


def _txt(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).replace("&nbsp;", " ").strip()


def parse_salary(s: str):
    nums = [int(x.replace(" ", "")) for x in re.findall(r"\d[\d ]*\d|\d", s or "")]
    nums = [n for n in nums if n >= 1000]
    if len(nums) >= 2:
        return nums[0], nums[1]
    if len(nums) == 1:
        return nums[0], None
    return None, None


def parse_listing(html: str, cfg: dict):
    out = []
    for m in CARD.finditer(html):
        card, vid = m.group(0), m.group(1)
        title = _txt((re.search(r'class="title">(.*?)</div>', card, re.S) or [None, ""])[1])
        org_blk = (re.search(r'class="org">(.*?)</span>\s*</span>|class="org">(.*?)</div>', card, re.S))
        org_html = org_blk.group(0) if org_blk else ""
        spans = [_txt(x) for x in re.findall(r'class="type-work">(.*?)</span>', org_html + card, re.S)]
        org = _txt(re.sub(r"<span.*", "", (re.search(r'class="org">(.*?)<i>', card, re.S) or [None, ""])[1]))
        region = next((s for s in spans if "област" in s.lower() or s in ("Астана", "Алматы", "Шымкент")
                       or "г." in s), None)
        dm = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", card)
        published = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}" if dm else None
        sal = _txt((re.search(r'class="salary">(.*?)</div>', card, re.S) or [None, ""])[1])
        lo, hi = parse_salary(sal)
        if lo is None and hi is None:
            continue
        rec = make_record(
            cfg, source="qsamruk.kz", source_id=vid, title=title, sal_from=lo, sal_to=hi,
            currency="KZT", gross=cfg["qsamruk"].get("gross", True), url=f"{BASE}/vacancy/{vid}",
            published_at=published, industry=norm_industry(hint_text=f"{org} {title}"),
            region=region, employer=org)
        if rec:
            out.append(rec)
    return out


def collect(cfg, con, http: Http | None = None):
    c = cfg["qsamruk"]
    http = http or Http(cfg["user_agent"], delay=c.get("request_delay_sec", 1.0))
    started = datetime.now().date().isoformat()
    fetched = stored = 0
    for page in range(1, c.get("max_pages", 30) + 1):
        html = http.get(f"{BASE}/vacancy", params={"page": page})
        cards = CARD.findall(html)
        if not cards:
            break
        recs = parse_listing(html, cfg)
        fetched += len(cards)
        for r in recs:
            stored += upsert(con, r)
        con.commit()
        print(f"[qsamruk] page {page}: {len(cards)} cards, {len(recs)} with salary")
    log_run(con, "qsamruk.kz", started, fetched, stored)
    return fetched, stored
