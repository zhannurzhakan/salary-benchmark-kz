import sys, tempfile, unittest
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sbench import config, db
from sbench.normalize import level_of, tag_benefits, title_norm, to_kzt_month, norm_region
from sbench.sources import hh, qsamruk
from sbench.sources.csv_import import import_csv
from sbench.stats import compa_ratio, percentile, summarize

CFG = config.load()


class Stats(unittest.TestCase):
    def test_percentile_matches_excel_inc(self):
        v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        self.assertAlmostEqual(percentile(v, 50), 5.5)
        self.assertAlmostEqual(percentile(v, 25), 3.25)
        self.assertAlmostEqual(percentile(v, 90), 9.1)

    def test_min_sample_flag(self):
        rows = [{"kzt_mid": 100, "kzt_from": 90, "kzt_to": 110}] * 4
        self.assertFalse(summarize(rows, 5)["reliable"])

    def test_cr(self):
        self.assertAlmostEqual(compa_ratio(550, 500), 1.1)


class Normalize(unittest.TestCase):
    def test_net_to_gross_and_fx(self):
        f, t, m, rt = to_kzt_month(400000, 600000, "KZT", True, CFG)
        self.assertEqual((f, t, m, rt), (400000, 600000, 500000, "closed"))
        f, *_ = to_kzt_month(450000, None, "KZT", False, CFG)       # net -> gross, exact tax model
        from sbench import tax
        self.assertAlmostEqual(tax.net_from_gross(f, tax.params(CFG)), 450000, delta=1)
        self.assertTrue(500000 < f < 560000)
        self.assertAlmostEqual(to_kzt_month(1000, 2000, "USD", True, CFG)[2], 1500 * 520)

    def test_out_of_bounds_dropped(self):
        self.assertIsNone(to_kzt_month(5000, 8000, "KZT", True, CFG))         # looks like a daily rate
        self.assertIsNone(to_kzt_month(100, 200, "GBP", True, CFG))            # unknown currency

    def test_titles(self):
        self.assertEqual(title_norm("Senior Python Developer (remote)"), "python developer")
        self.assertEqual(title_norm("Главный бухгалтер"), "главный бухгалтер")
        self.assertEqual(level_of("Ведущий инженер"), "Senior / Ведущий")
        self.assertEqual(level_of("Начальник отдела продаж"), "Руководитель")

    def test_benefits(self):
        b = tag_benefits("<p>Предоставляем ДМС, обучение за счёт компании, ежеквартальные бонусы и питание</p>")
        for x in ("ДМС / медстраховка", "Обучение и развитие", "Бонусы / премии", "Питание"):
            self.assertIn(x, b)

    def test_region(self):
        self.assertEqual(norm_region("г.Уральск"), "Западно-Казахстанская область")


class FakeHH:
    """Imitates api.hh.ru so the collector logic (2000-cap slicing, mapping) is tested offline."""
    def __init__(self, per_day):
        self.per_day = per_day; self.calls = []

    def get_json(self, url, params=None, headers=None):
        if url.endswith("/vacancies"):
            d1, d2 = date.fromisoformat(params["date_from"]), date.fromisoformat(params["date_to"])
            days = (d2 - d1).days + 1
            found = days * self.per_day
            self.calls.append((params["date_from"], params["date_to"], params["page"], found))
            items = []
            if params["page"] * params["per_page"] < min(found, 2000):
                items = [{"id": f"{params['date_from']}-{params['page']}-{i}", "name": "Бухгалтер",
                          "salary": {"from": 300000, "to": 400000, "currency": "KZT", "gross": True},
                          "area": {"id": "160", "name": "Алматы"},
                          "professional_roles": [{"id": "18"}], "employer": {"id": "1", "name": "X"},
                          "published_at": "2026-11-10T10:00:00+0500", "alternate_url": "u"}
                         for i in range(min(params["per_page"], found - params["page"] * params["per_page"]))]
            return {"items": items, "found": found, "pages": min(20, -(-found // params["per_page"])), "page": params["page"]}
        raise AssertionError(url)


class HHTests(unittest.TestCase):
    def test_slices_until_under_cap(self):
        cfg = config.load(); cfg["hh"]["per_page"] = 100
        c = hh.HHClient(cfg, http=FakeHH(per_day=300)); c._token = "t"
        items = list(c.search("18", date(2026, 10, 1), date(2026, 10, 30)))      # 30 days * 300 = 9000 > 2000
        windows = {(a, b) for a, b, p, f in c.http.calls}
        fetched = [(a, b, f) for a, b, p, f in c.http.calls if p > 0]               # windows we paged through
        self.assertTrue(fetched and all(f <= 2000 for a, b, f in fetched))        # every paged window fits the cap
        self.assertGreater(len(windows), 4)                                       # window was split
        self.assertEqual(len(items), len({i["id"] for i in items}))               # no duplicates

    def test_item_mapping(self):
        it = {"id": "9", "name": "Старший бухгалтер", "salary_range": {"from": 600000, "to": None, "currency": "KZT",
              "gross": False, "mode": {"id": "MONTH"}}, "area": {"id": "160", "name": "Алматы"},
              "professional_roles": [{"id": "18"}], "employer": {"name": "X"}, "published_at": "2026-11-10T10:00:00+0500"}
        rec = hh.item_to_record(CFG, it, {"160": "г. Алматы"}, {"18": ("Бухгалтерия", "Бухгалтер")}, "Нефть и газ")
        self.assertEqual(rec["region"], "г. Алматы"); self.assertEqual(rec["category"], "Бухгалтерия")
        self.assertTrue(700000 < rec["kzt_mid"] < 760000); self.assertEqual(rec["range_type"], "from")
        self.assertEqual(rec["published_at"], "2026-11-10")
        it["salary_range"]["mode"] = {"id": "HOUR"}
        self.assertIsNone(hh.item_to_record(CFG, it, {}, {}))                     # hourly pay is skipped


class HHIndustry(unittest.TestCase):
    def test_employer_industry_is_canonical(self):
        class Fake:
            def get_json(self, url, params=None, headers=None):
                return {"name": "ТОО Нефтесервис", "industries": [{"id": "47.1", "name": "Нефтесервис"}]}
        c = hh.HHClient(CFG, http=Fake()); c._token = "t"
        with tempfile.TemporaryDirectory() as d:
            con = db.connect(Path(d) / "t.db")
            ind = c.employer_industry(con, "1", {"47.1": "47"})
            self.assertEqual(ind, "Горнодобывающая промышленность (вкл. нефть и газ)")


class QSamruk(unittest.TestCase):
    def test_salary_parse(self):
        self.assertEqual(qsamruk.parse_salary(" 211 384 - 264 230 "), (211384, 264230))
        self.assertEqual(qsamruk.parse_salary("410 783"), (410783, None))
        self.assertEqual(qsamruk.parse_salary(""), (None, None))


class CsvAndDb(unittest.TestCase):
    def test_import_and_dedupe(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.csv"
            p.write_text("title;salary_from;salary_to;region;industry;benefits;id\n"
                         "Бухгалтер;300 000;400 000;г.Алматы;Нефть и газ;ДМС / медстраховка;a1\n"
                         "Бухгалтер;300 000;400 000;г.Алматы;Нефть и газ;ДМС / медстраховка;a1\n"
                         "Мусор;5;6;;;;a2\n", encoding="utf-8")
            con = db.connect(Path(d) / "t.db")
            f, s = import_csv(CFG, con, p, source="test")
            self.assertEqual((f, s), (3, 1))
            row = con.execute("SELECT * FROM observations").fetchone()
            self.assertEqual(row["region"], "г. Алматы"); self.assertEqual(row["kzt_mid"], 350000)
            self.assertEqual(row["has_description"], 1)



class Tax(unittest.TestCase):
    def test_known_case(self):
        from sbench import tax
        t = tax.params(CFG)
        e = tax.employee(500000, t)
        self.assertAlmostEqual(e["opv"], 50000); self.assertAlmostEqual(e["vosms"], 10000)
        self.assertAlmostEqual(e["ipn"], 0.1 * (500000 - 60000 - 30 * 4325), delta=1)
        r = tax.employer(500000, t)
        self.assertAlmostEqual(r["opvr"], 17500); self.assertAlmostEqual(r["oosms"], 15000)
        self.assertAlmostEqual(r["so"], 0.05 * 450000)              # (500k - ОПВ 50k), below the 7 МЗП cap
        self.assertAlmostEqual(tax.employer(2_000_000, t)["so"], 0.05 * 7 * 85000)   # capped at 7 МЗП = 595 000

    def test_roundtrip_many(self):
        from sbench import tax
        t = tax.params(CFG)
        for g in (90000, 250000, 1_000_000, 4_000_000, 9_000_000):
            self.assertAlmostEqual(tax.gross_from_net(tax.net_from_gross(g, t), t), g, delta=1)


class Mapper(unittest.TestCase):
    def test_mapping(self):
        from sbench import mapper
        self.assertEqual(mapper.map_title("Senior Python Developer")["role"], "Программист, разработчик")
        self.assertEqual(mapper.map_title("Chief accountant")["category"], "Финансы, бухгалтерия")
        self.assertEqual(mapper.map_title("Менеджер по продажам B2B")["category"], "Продажи, обслуживание клиентов")
        self.assertEqual(mapper.map_title("Head of Marketing")["role"], "Руководитель отдела маркетинга и рекламы")
        self.assertEqual(mapper.map_title("zzzz qqqq")["confidence"], "низкая")


class Taxonomy(unittest.TestCase):
    def test_regions_and_astana(self):
        from sbench import taxonomy as tx
        self.assertEqual(len(tx.REGIONS), 20); self.assertIn("г. Астана", tx.REGIONS)
        for raw in ("Астана", "Нур-Султан", "г.Астана"):
            self.assertEqual(tx.norm_region(raw), "г. Астана")
        self.assertEqual(tx.norm_region("Западно-\nКазахстанская"), "Западно-Казахстанская область")
        self.assertEqual(tx.norm_region("Улытауская область"), "область Ұлытау")

    def test_industries(self):
        from sbench import taxonomy as tx
        self.assertEqual(tx.norm_industry("Нефть и газ", hh_id="47"), tx.INDUSTRIES[1])
        self.assertEqual(tx.norm_industry("Информация и связь"), "Информация и связь")


if __name__ == "__main__":
    unittest.main()
