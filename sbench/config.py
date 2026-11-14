from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DEFAULTS = {
    "db_path": "data/salary.db",
    "user_agent": "SalaryBenchmark/0.1",
    "min_sample": 5,
    "sanity_bounds_kzt_month": [70000, 8000000],
    "net_to_gross_factor": 0.83,
    "fx_to_kzt": {"KZT": 1, "USD": 520, "EUR": 600, "RUR": 6.5, "RUB": 6.5},
    "hh": {"area": 40, "days": 30, "per_page": 100, "request_delay_sec": 0.4,
           "fetch_employers": True, "fetch_details": False},
    "qsamruk": {"max_pages": 200, "request_delay_sec": 1.0},
}


def load(path: str | None = None) -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))
    p = Path(path) if path else ROOT / "config.json"
    if p.exists():
        user = json.loads(p.read_text(encoding="utf-8"))
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


def db_path(cfg: dict) -> Path:
    p = Path(cfg["db_path"])
    return p if p.is_absolute() else ROOT / p
