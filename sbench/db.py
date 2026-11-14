from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT,
  first_seen TEXT,
  last_seen TEXT,
  published_at TEXT,
  title TEXT,
  title_norm TEXT,
  level TEXT,
  category TEXT,
  role TEXT,
  industry TEXT,
  region TEXT,
  city TEXT,
  employer TEXT,
  experience TEXT,
  currency TEXT,
  sal_from REAL,
  sal_to REAL,
  gross INTEGER,
  kzt_from REAL,
  kzt_to REAL,
  kzt_mid REAL,
  range_type TEXT,
  benefits TEXT DEFAULT '[]',
  has_description INTEGER DEFAULT 0,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS ix_obs_pub ON observations(published_at);
CREATE TABLE IF NOT EXISTS employers (
  source TEXT, id TEXT, name TEXT, industry TEXT,
  PRIMARY KEY (source, id)
);
CREATE TABLE IF NOT EXISTS official_wages (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  dataset TEXT NOT NULL,      -- occupation_industry | occupation_total | occupation_region | industry_period | region_period | national_period
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL DEFAULT 0,   -- 0 = annual / April survey
  profession TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL DEFAULT 'avg',   -- avg | median
  value REAL NOT NULL,
  released TEXT,
  url TEXT,
  UNIQUE (dataset, year, quarter, profession, industry, region, metric)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  source TEXT, started_at TEXT, finished_at TEXT,
  fetched INTEGER, stored INTEGER, note TEXT
);
"""

COLS = ["source", "source_id", "url", "first_seen", "last_seen", "published_at", "title",
        "title_norm", "level", "category", "role", "industry", "region", "city", "employer",
        "experience", "currency", "sal_from", "sal_to", "gross", "kzt_from", "kzt_to",
        "kzt_mid", "range_type", "benefits", "has_description"]


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def upsert(con: sqlite3.Connection, rec: dict) -> bool:
    """Insert a new observation or refresh last_seen. Returns True if it was new."""
    today = date.today().isoformat()
    rec = dict(rec)
    rec.setdefault("first_seen", today)
    rec["last_seen"] = today
    if isinstance(rec.get("benefits"), (list, tuple)):
        rec["benefits"] = json.dumps(rec["benefits"], ensure_ascii=False)
    rec.setdefault("benefits", "[]")
    row = {c: rec.get(c) for c in COLS}
    cur = con.execute("SELECT id, benefits, has_description FROM observations WHERE source=? AND source_id=?",
                      (row["source"], row["source_id"]))
    ex = cur.fetchone()
    if ex:
        # keep richer data if the earlier record had benefits parsed from a full description
        if ex["has_description"] and not row["has_description"]:
            row["benefits"], row["has_description"] = ex["benefits"], 1
        sets = ", ".join(f"{c}=?" for c in COLS if c not in ("first_seen",))
        vals = [row[c] for c in COLS if c not in ("first_seen",)]
        con.execute(f"UPDATE observations SET {sets} WHERE id=?", vals + [ex["id"]])
        return False
    con.execute(f"INSERT INTO observations ({','.join(COLS)}) VALUES ({','.join('?' * len(COLS))})",
                [row[c] for c in COLS])
    return True


def log_run(con, source, started, fetched, stored, note=""):
    con.execute("INSERT INTO runs(source,started_at,finished_at,fetched,stored,note) VALUES (?,?,?,?,?,?)",
                (source, started, date.today().isoformat(), fetched, stored, note))
    con.commit()


def upsert_official(con, rec: dict):
    cols = ["source", "dataset", "year", "quarter", "profession", "category", "role", "industry", "region",
            "metric", "value", "released", "url"]
    d = {c: rec.get(c, "" if c not in ("year", "quarter", "value") else 0) for c in cols}
    con.execute(
        f"INSERT INTO official_wages ({','.join(cols)}) VALUES ({','.join('?' * len(cols))}) "
        "ON CONFLICT(dataset, year, quarter, profession, industry, region, metric) DO UPDATE SET "
        "value=excluded.value, released=excluded.released, url=excluded.url, category=excluded.category, role=excluded.role",
        [d[c] for c in cols])
