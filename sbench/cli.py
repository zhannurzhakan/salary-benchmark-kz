from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

from . import config, db, report
from .stats import group_summary


def _con(cfg, demo=False):
    p = config.ROOT / "data" / "demo.db" if demo else config.db_path(cfg)
    return db.connect(p)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="sbench", description="Бенчмарк заработных плат и C&B (Казахстан)")
    ap.add_argument("--config", help="путь к config.json")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", help="собрать вакансии из источника")
    c.add_argument("source", choices=["hh", "qsamruk", "stat", "all"])
    c.add_argument("--days", type=int, help="hh: глубина в днях (по умолчанию из config)")
    c.add_argument("--roles", help="hh: список id профролей через запятую (по умолчанию все)")

    i = sub.add_parser("import-csv", help="импорт CSV (enbek.kz-выгрузка, обзоры PwC/EY/WTW, свои данные)")
    i.add_argument("file")
    i.add_argument("--source", default="csv")

    b = sub.add_parser("build", help="собрать HTML-дашборд")
    b.add_argument("-o", "--out", default=str(config.ROOT / "output" / "dashboard.html"))
    sub.add_parser("demo", help="сгенерировать СИНТЕТИЧЕСКИЕ демо-данные и демо-дашборд")
    sub.add_parser("stats", help="краткая сводка по базе")
    e = sub.add_parser("export", help="выгрузить сводку по профессиям в CSV")
    e.add_argument("-o", "--out", default=str(config.ROOT / "output" / "summary.csv"))

    a = ap.parse_args(argv)
    cfg = config.load(a.config)

    if a.cmd == "collect":
        con = _con(cfg)
        f = s = 0
        if a.source in ("stat", "all"):
            from .sources import stat_gov
            n = stat_gov.collect(cfg, con, min_year=cfg.get("stat", {}).get("min_year", 2022))
            f, s = f + n, s + n
        if a.source in ("qsamruk", "all"):
            from .sources import qsamruk
            x, y = qsamruk.collect(cfg, con)
            f, s = f + x, s + y
        if a.source == "hh" or (a.source == "all" and (os.environ.get("HH_ACCESS_TOKEN") or os.environ.get("HH_CLIENT_ID"))):
            from .sources import hh
            x, y = hh.collect(cfg, con, days=a.days, role_ids=a.roles.split(",") if a.roles else None)
            f, s = f + x, s + y
        print(f"Готово: получено {f}, новых записей {s}")
    elif a.cmd == "import-csv":
        from .sources.csv_import import import_csv
        f, s = import_csv(cfg, _con(cfg), a.file, source=a.source)
        print(f"Готово: строк {f}, новых записей {s}")
    elif a.cmd == "build":
        out = report.build(cfg, _con(cfg), a.out)
        print(f"Дашборд: {out}")
    elif a.cmd == "demo":
        from . import demo
        p = config.ROOT / "data" / "demo.db"
        if p.exists():
            p.unlink()
        con = db.connect(p)
        demo.generate(cfg, con)
        k = demo.copy_official(con, config.db_path(cfg))
        print(f"Официальная статистика (реальная) скопирована в демо: {k} значений" if k else "Официальных данных нет — сначала: python3 -m sbench collect stat")
        out = report.build(cfg, con, str(config.ROOT / "output" / "dashboard_demo.html"), demo=True)
        print(f"Демо-дашборд (синтетические данные!): {out}")
    elif a.cmd == "stats":
        con = _con(cfg)
        rows = [dict(r) for r in con.execute("SELECT * FROM observations")]
        print(f"Наблюдений: {len(rows)}")
        for k in ("source", "category", "region"):
            print(f"\nпо {k}:")
            for name, s in list(group_summary(rows, k, cfg["min_sample"]).items())[:12]:
                med = f"{s['median']:,.0f}".replace(",", " ") if s.get("median") else "—"
                print(f"  {name:45s} n={s['n']:5d}  медиана={med}")
    elif a.cmd == "export":
        con = _con(cfg)
        rows = [dict(r) for r in con.execute("SELECT * FROM observations")]
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        with open(a.out, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["category", "n", "min", "p10", "p25", "median", "p75", "p90", "max"])
            for k, s in group_summary(rows, "category", cfg["min_sample"]).items():
                if s["n"]:
                    w.writerow([k, s["n"]] + [round(s.get(x) or 0) for x in
                                              ("min", "p10", "p25", "median", "p75", "p90", "max")])
        print(f"Выгружено: {a.out}")


if __name__ == "__main__":
    main()
