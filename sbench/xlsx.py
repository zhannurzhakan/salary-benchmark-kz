"""Minimal read-only .xlsx reader (stdlib only): returns {sheet_name: [[cell, ...], ...]}."""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path) -> dict:
    out = {}
    with zipfile.ZipFile(path) as z:
        sst = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                sst.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        for sh in wb.find("m:sheets", NS):
            target = rels[sh.get("{%s}id" % NS["r"])].lstrip("/")
            target = target if target.startswith("xl/") else "xl/" + target
            rows = []
            for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
                cells = []
                for c in row.findall("m:c", NS):
                    i = _col(c.get("r"))
                    while len(cells) <= i:
                        cells.append(None)
                    v = c.find("m:v", NS)
                    if c.get("t") == "s" and v is not None:
                        cells[i] = sst[int(v.text)]
                    elif c.get("t") == "inlineStr":
                        cells[i] = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
                    elif v is not None and v.text is not None:
                        try:
                            cells[i] = float(v.text)
                        except ValueError:
                            cells[i] = v.text
                rows.append(cells)
            out[sh.get("name")] = rows
    return out
