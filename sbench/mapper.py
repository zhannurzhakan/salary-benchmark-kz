"""Automatic job-title mapping ("AI mapping").

Maps any free-text job title (RU/EN, messy) to the standard catalogue:
  title -> role (hh classifier, 304 roles) -> professional area (27) + seniority level
        -> closest official stat.gov.kz profession (for official wage lookup).

Method (offline, deterministic, no API calls): synonym/transliteration rules -> crude stemming ->
TF-IDF over word stems + character trigrams -> cosine similarity via an inverted index.
The same algorithm and the same data (data/synonyms.json) run in the dashboard (JS), so results match.
Confidence: >=0.80 high, 0.55-0.80 medium (check), below that low (manual review)."""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

from . import taxonomy

_SYN = json.loads((Path(__file__).with_name("data") / "synonyms.json").read_text(encoding="utf-8"))
_B, _E = r"(?<![а-яёa-z0-9])", r"(?![а-яёa-z0-9])"
_RULES = [(re.compile(p.replace("<B>", _B).replace("<E>", _E)), r) for p, r in _SYN["rules"]]
_STOP = set(_SYN["stop"])
_LEVEL = set(_SYN["level"])
HIGH, MED = 0.80, 0.55


_TAIL = re.compile(r"\s(?:филиал\w*|ао|тоо|ст\.|станци\w*|депо|оао|гу|кгп|рго)(?![а-яёa-z0-9])|[«\"]")


def expand(title: str) -> str:
    t = (title or "").lower().replace("ё", "е")
    t = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", t)
    t = _TAIL.split(t)[0]                       # drop employer / place tails: "... ТОО «КТЖ-Грузовые перевозки»"
    out = t
    for rx, rep in _RULES:
        out = rx.sub(rep.replace("ё", "е"), out)
    return out


def stem(w: str) -> str:
    return w[:6]


def words(title: str) -> list[str]:
    toks = re.findall(r"[а-яa-z0-9#+]+", expand(title))
    return [stem(t) for t in toks if t not in _STOP and t not in _LEVEL and len(t) > 1 and not t.isdigit()]


def feats(title: str) -> Counter:
    ws = words(title)
    f = Counter()
    for w in ws:
        f["w:" + w] += 1.0
    s = " " + " ".join(ws) + " "
    for i in range(len(s) - 2):
        f["g:" + s[i:i + 3]] += 0.4
    return f


class Index:
    def __init__(self, entries: list[dict]):
        self.entries = entries
        docs = [feats(e["name"]) for e in entries]
        self.words = [{f for f in d if f.startswith("w:")} for d in docs]
        n = len(docs)
        df = Counter(k for d in docs for k in d)
        self.idf = {k: math.log((1 + n) / (1 + c)) + 1 for k, c in df.items()}
        self.inv = defaultdict(list)
        for i, d in enumerate(docs):
            vec = {k: v * self.idf[k] for k, v in d.items()}
            norm = math.sqrt(sum(x * x for x in vec.values())) or 1.0
            for k, v in vec.items():
                self.inv[k].append((i, v / norm))

    def query(self, title: str, k: int = 3) -> list[tuple[dict, float]]:
        q = feats(title)
        vec = {f: v * self.idf[f] for f, v in q.items() if f in self.idf}
        if not vec:
            return []
        norm = math.sqrt(sum(x * x for x in vec.values())) or 1.0
        score = defaultdict(float)
        for f, v in vec.items():
            for i, w in self.inv[f]:
                score[i] += (v / norm) * w
        qw = {f for f in q if f.startswith("w:")}
        out = []
        for i, sc in sorted(score.items(), key=lambda kv: -kv[1])[:max(k * 4, 12)]:
            # coverage: share of the title's own words found in the candidate (long unmatched titles score lower)
            cov = len(qw & self.words[i]) / len(qw) if qw else 0.0
            out.append((self.entries[i], round(min(sc, 1.0) * (0.55 + 0.45 * cov), 3)))
        out.sort(key=lambda x: -x[1])
        return out[:k]


# A role can be listed under several areas in hh's classifier. Pick one home: the largest area,
# except where that is clearly wrong (explicit overrides).
_HOME = {
    "Администратор": "Административный персонал", "Водитель, экспедитор": "Транспорт, логистика, перевозки",
    "Машинист": "Транспорт, логистика, перевозки", "Охранник": "Безопасность",
    "Лаборант": "Производство, сервисное обслуживание", "Дизайнер, художник": "Искусство, развлечения, массмедиа",
    "Арт-директор, креативный директор": "Искусство, развлечения, массмедиа", "Аналитик": "Информационные технологии",
    "Научный специалист, исследователь": "Наука, образование", "Брокер": "Финансы, бухгалтерия",
    "Руководитель отдела аналитики": "Высший и средний менеджмент", "Методолог": "Финансы, бухгалтерия",
    "Санитарка/санитар": "Медицина, фармацевтика", "Мойщик посуды, Помощник повара": "Туризм, гостиницы, рестораны",
    "Менеджер по продажам, менеджер по работе с клиентами": "Продажи, обслуживание клиентов",
    "Копирайтер, редактор, корректор": "Маркетинг, реклама, PR",
}


@lru_cache(maxsize=1)
def role_home() -> dict:
    size = {c["name"]: len(c["roles"]) for c in taxonomy.hh_catalog()}
    home = {}
    for cat, role in taxonomy.roles():
        if role == "Другое":
            continue
        if role in _HOME:
            home[role] = _HOME[role]
        elif role not in home or size[cat] > size[home[role]]:
            home[role] = cat
    return home


@lru_cache(maxsize=1)
def role_index() -> Index:
    entries = [{"name": r, "role": r, "category": c} for r, c in role_home().items()]
    return Index(entries)


def confidence(score: float) -> str:
    return "высокая" if score >= HIGH else "средняя" if score >= MED else "низкая"


def map_title(title: str, k: int = 3) -> dict:
    """-> {role, category, level, score, confidence, alternatives:[{role,category,score}]}"""
    from .normalize import level_of
    res = role_index().query(title, k)
    level = level_of(title)
    if not res:
        return {"title": title, "role": None, "category": "Другое", "level": level, "score": 0.0,
                "confidence": "низкая", "alternatives": []}
    top, sc = res[0]
    # a role listed under several categories: prefer the category whose other roles also fit the title
    return {"title": title, "role": top["role"], "category": top["category"], "level": level, "score": sc,
            "confidence": confidence(sc),
            "alternatives": [{"role": e["role"], "category": e["category"], "score": s} for e, s in res[1:]]}
