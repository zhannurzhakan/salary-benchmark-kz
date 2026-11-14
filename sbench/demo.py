"""SYNTHETIC demo vacancies — only to try the dashboard. They live in data/demo.db and carry the source label
'… (демо)'. The official-statistics layer, if present, is a copy of the REAL stat.gov.kz data."""
from __future__ import annotations

import math
import random
import sqlite3
from datetime import date

from . import config, mapper, taxonomy
from .db import upsert
from .normalize import BENEFITS
from .records import make_record

SOURCES = ["hh.kz (демо)", "qsamruk.kz (демо)", "enbek.kz (демо)", "Обзор (демо)"]
CAT_BASE = {   # illustrative gross KZT/month by professional area
    "Информационные технологии": 780000, "Высший и средний менеджмент": 1100000, "Финансы, бухгалтерия": 520000,
    "Юристы": 520000, "Продажи, обслуживание клиентов": 400000, "Маркетинг, реклама, PR": 470000,
    "Управление персоналом, тренинги": 450000, "Закупки": 450000, "Транспорт, логистика, перевозки": 360000,
    "Строительство, недвижимость": 480000, "Производство, сервисное обслуживание": 470000, "Рабочий персонал": 310000,
    "Добыча сырья": 600000, "Сельское хозяйство": 340000, "Медицина, фармацевтика": 400000, "Наука, образование": 300000,
    "Безопасность": 280000, "Административный персонал": 300000, "Розничная торговля": 290000,
    "Туризм, гостиницы, рестораны": 260000, "Искусство, развлечения, массмедиа": 380000, "Страхование": 430000,
    "Стратегия, инвестиции, консалтинг": 750000, "Автомобильный бизнес": 360000,
    "Спортивные клубы, фитнес, салоны красоты": 270000, "Домашний, обслуживающий персонал": 220000, "Другое": 300000,
}
IND_MULT = dict(zip(taxonomy.INDUSTRIES, [.82, 1.45, .98, 1.0, .85, 1.0, .9, .98, .8, 1.3, 1.25, .95, 1.15, .85, .95, .75, .85, .8, .8]))
REG_MULT = {"г. Астана": 1.10, "г. Алматы": 1.08, "г. Шымкент": .86, "Абайская область": .84, "Акмолинская область": .86,
            "Актюбинская область": .93, "Алматинская область": .87, "Атырауская область": 1.28, "Восточно-Казахстанская область": .88,
            "Жамбылская область": .78, "область Жетісу": .80, "Западно-Казахстанская область": .95, "Карагандинская область": .94,
            "Костанайская область": .86, "Кызылординская область": .84, "Мангистауская область": 1.26, "Павлодарская область": .92,
            "Северо-Казахстанская область": .80, "Туркестанская область": .76, "область Ұлытау": .90}
REG_W = {r: (3 if r in ("г. Астана", "г. Алматы") else 1.5 if r in ("г. Шымкент", "Карагандинская область", "Атырауская область", "Мангистауская область") else 1) for r in taxonomy.REGIONS}
LEVELS = [("", "Middle / Специалист", 1.0, .52), ("Младший ", "Стажёр / Junior", .72, .14), ("Старший ", "Senior / Ведущий", 1.3, .2), ("Ведущий ", "Senior / Ведущий", 1.5, .08), ("Руководитель ", "Руководитель", 1.9, .06)]
EXP = ["Нет опыта", "От 1 года до 3 лет", "От 3 до 6 лет", "Более 6 лет"]


def months_since(start=(2025, 1)):
    t = date.today()
    y, m, out = start[0], start[1], []
    while (y, m) <= (t.year, t.month):
        out.append((y, m))
        y, m = (y + (m == 12), 1 if m == 12 else m + 1)
    return out


def generate(cfg, con, n=12000, seed=7):
    rnd = random.Random(seed)
    home = mapper.role_home()
    roles = list(home.items())
    rfac = {r: 0.78 + random.Random(r).random() * 0.55 for r, _ in roles}
    months = months_since()
    ind_names, ind_w = list(IND_MULT), [3, 2, 4, 1, 1, 3, 4, 3, 2, 3, 3, 1.5, 2, 2, 2.5, 2.5, 2.5, 1, 1.5]
    reg_names, reg_w = list(REG_W), list(REG_W.values())
    lv_w = [x[3] for x in LEVELS]
    for i in range(n):
        role, cat = rnd.choice(roles)
        ind = rnd.choices(ind_names, ind_w)[0]
        reg = rnd.choices(reg_names, reg_w)[0]
        y, m = rnd.choice(months)
        idx = months.index((y, m))
        trend = 1 + 0.0085 * idx                          # ~0.85%/month wage growth over the window
        pref, level, lm, _ = rnd.choices(LEVELS, lv_w)[0]
        mid = CAT_BASE.get(cat, 300000) * rfac[role] * IND_MULT[ind] * REG_MULT[reg] * lm * trend * math.exp(rnd.gauss(0, .15))
        spread = rnd.uniform(.08, .3)
        lo, hi = round(mid * (1 - spread), -3), round(mid * (1 + spread), -3)
        exp = EXP[min(3, int((lm - .7) / .35))] if rnd.random() < .85 else None
        ben = [b for b in BENEFITS if rnd.random() < (.5 if b in ("Бонусы / премии", "Официальное оформление") else .22) * (1.4 if lm > 1.2 else 1)]
        title = f"{pref}{role.split(',')[0]}".strip()
        rec = make_record(cfg, source=rnd.choice(SOURCES), source_id=f"demo{i}", title=title,
                          sal_from=None if rnd.random() < .08 else lo, sal_to=hi, currency="KZT", gross=True,
                          published_at=date(y, m, rnd.randint(1, 28)).isoformat(), category=cat, role=role,
                          industry=ind, region=reg, employer="Демо", benefits=ben, experience=exp)
        if rec is None:
            continue
        rec["level"] = level
        rec["has_description"] = 1
        upsert(con, rec)
    con.commit()


def copy_official(con, real_db_path) -> int:
    """Copy the REAL official-statistics tables into the demo DB (if the real DB has them)."""
    if not real_db_path.exists():
        return 0
    con.execute("ATTACH DATABASE ? AS real", (str(real_db_path),))
    try:
        con.execute("INSERT OR IGNORE INTO official_wages (source,dataset,year,quarter,profession,category,role,industry,region,metric,value,released,url) "
                    "SELECT source,dataset,year,quarter,profession,category,role,industry,region,metric,value,released,url FROM real.official_wages")
        con.commit()
        return con.execute("SELECT count(*) FROM official_wages").fetchone()[0]
    except sqlite3.OperationalError:
        return 0
    finally:
        con.execute("DETACH DATABASE real")
