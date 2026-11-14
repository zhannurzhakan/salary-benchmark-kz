/* ===== core: data, helpers, statistics, charts, title mapper ===== */
const DATA = /*__DATA__*/null;
const META = DATA.meta, CAT = DATA.cat, DICT = DATA.dict, OFF = DATA.off, MIN = META.min_sample;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nbsp = s => s.replace(/ /g, ' ');
const fmt = n => n == null || isNaN(n) ? '—' : nbsp(Math.round(n).toLocaleString('ru-RU'));
const fmtK = n => n == null || isNaN(n) ? '—' : (Math.abs(n) >= 1e6 ? (n/1e6).toFixed(2).replace('.', ',') + ' млн' : nbsp(Math.round(n/1000).toLocaleString('ru-RU')) + ' тыс');
const fmtPct = (v, d = 1) => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d).replace('.', ',') + '%';
const num = v => { const x = parseFloat(String(v ?? '').replace(/[\s ]/g, '').replace(',', '.')); return isNaN(x) ? null : x; };
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const qLabel = p => { const y = Math.floor(p/10), q = p % 10; return q ? `${['','I','II','III','IV'][q]} кв. ${y}` : `${y}`; };

/* ---------- vacancies, expanded from the dictionary-coded payload ---------- */
const V = DATA.vac.map(r => ({
  m: DICT.month[r[0]], s: DICT.source[r[1]], area: DICT.area[r[2]], role: DICT.role[r[3]], title: DICT.title[r[4]],
  level: DICT.level[r[5]] || null, ind: DICT.industry[r[6]] || 'Не указано', reg: DICT.region[r[7]] || 'Не указано',
  exp: DICT.experience[r[8]] || null, lo: r[9], hi: r[10], mid: r[11], ben: r[12] == null ? null : r[12].map(i => DICT.benefit[i])
}));
const months = [...new Set(V.map(r => r.m))].sort();

/* ---------- official statistics (stat.gov.kz) ---------- */
const OP = OFF.prof.map(p => ({name: p[0], area: DICT.area[p[1]], role: p[2] >= 0 ? DICT.role[p[2]] : null}));
const OI = OFF.ind.map(r => ({p: r[0], ind: DICT.industry[r[1]], y: r[2], v: r[3]}));
const OT = OFF.tot.map(r => ({p: r[0], y: r[1], v: r[2]}));
const OR = OFF.reg.map(r => ({p: r[0], reg: DICT.region[r[1]], y: r[2], v: r[3]}));
const OIQ = OFF.indQ.map(r => ({ind: DICT.industry[r[0]], per: r[1], v: r[2]}));
const ORQ = OFF.regQ.map(r => ({reg: DICT.region[r[0]], per: r[1], v: r[2]}));
const ONAT = OFF.nat.map(r => ({per: r[0], avg: r[1], med: r[2]}));
const OFF_YEARS = META.occupation_years || [];
const ALL_PROF = 'Все профессии (в среднем)';

/* ---------- statistics (same formula as sbench/stats.py: linear interpolation) ---------- */
function pct(sorted, p) {
  const n = sorted.length; if (!n) return null;
  const k = (n - 1) * p / 100, f = Math.floor(k), c = Math.min(f + 1, n - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}
function summ(rows) {
  const mids = rows.map(r => r.mid).filter(Boolean).sort((a, b) => a - b), n = mids.length;
  if (!n) return {n: 0, ok: false};
  let mn = Infinity, mx = -Infinity;
  for (const r of rows) { mn = Math.min(mn, r.lo || r.mid); mx = Math.max(mx, r.hi || r.mid); }
  return {n, ok: n >= MIN, min: mn, max: mx, p10: pct(mids, 10), p25: pct(mids, 25), med: pct(mids, 50), p75: pct(mids, 75), p90: pct(mids, 90),
          mean: mids.reduce((a, b) => a + b, 0) / n};
}
function groupBy(rows, keyFn) { const g = new Map(); for (const r of rows) { const k = keyFn(r) || '—'; if (!g.has(k)) g.set(k, []); g.get(k).push(r); } return g; }
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return pct(s, 50); };
const mean = a => { const s = a.filter(x => x != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };

/* ---------- download / csv ---------- */
function toCsv(rows) { return '﻿' + rows.map(r => r.map(v => { v = String(v ?? ''); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';')).join('\n'); }
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim()); if (!lines.length) return {head: [], rows: []};
  const d = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length && lines[0].includes(';') ? ';' : (lines[0].includes('\t') ? '\t' : ',');
  const split = l => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o.map(x => x.trim()); };
  return {head: split(lines[0]).map(x => x.toLowerCase()), rows: lines.slice(1).map(split), delim: d};
}

/* ---------- SVG charts ---------- */
function lineChart({series, xs, W = 880, H = 330, yFmt = fmtK, band = null, ymin = null}) {
  const L = 64, R = 18, T = 14, B = 42;
  const ys = series.flatMap(s => s.pts.filter(p => p.y != null).map(p => p.y)).concat(band ? band.flatMap(b => [b.lo, b.hi]) : []);
  if (!ys.length) return '<div class="empty">Нет данных для графика</div>';
  let lo = ymin ?? Math.min(...ys) * .96, hi = Math.max(...ys) * 1.04; if (hi === lo) hi = lo + 1;
  const X = i => L + (xs.length > 1 ? i * (W - L - R) / (xs.length - 1) : (W - L - R) / 2), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">`;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`; }
  const step = Math.ceil(xs.length / 12);
  xs.forEach((x, i) => { if (i % step === 0 || i === xs.length - 1) svg += `<text x="${X(i)}" y="${H - 18}" text-anchor="middle">${esc(x)}</text>`; });
  if (band && band.length > 1) {
    const ok = band.map((b, i) => ({...b, i})).filter(b => b.lo != null);
    if (ok.length > 1) svg += `<path d="M${ok.map(b => `${X(b.i)},${Y(b.hi)}`).join('L')}L${[...ok].reverse().map(b => `${X(b.i)},${Y(b.lo)}`).join('L')}Z" fill="var(--band2)"/>`;
  }
  series.forEach((s, si) => {
    const col = s.color || PALETTE[si % PALETTE.length], pts = s.pts.map((p, i) => ({...p, i})).filter(p => p.y != null);
    if (!pts.length) return;
    svg += `<path d="M${pts.map(p => `${X(p.i)},${Y(p.y)}`).join('L')}" fill="none" stroke="${col}" stroke-width="2.4" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
    svg += pts.map(p => `<circle cx="${X(p.i)}" cy="${Y(p.y)}" r="3.6" fill="${col}"><title>${esc(s.name)} · ${esc(xs[p.i])}\n${esc(p.tip || yFmt(p.y))}</title></circle>`).join('');
  });
  return svg + '</svg>';
}
function legend(items) { return `<div class="legend">${items.map((s, i) => `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>`; }
function rangeBar(x, lo, hi, W = 220) { // P10-P90 line, P25-P75 box, median tick, on a shared [lo,hi] scale
  if (!x.ok) return '';
  const X = v => (v - lo) / (hi - lo || 1) * (W - 8) + 4;
  return `<svg width="${W}" height="18"><line x1="${X(x.p10)}" x2="${X(x.p90)}" y1="9" y2="9" stroke="var(--band2)" stroke-width="6" stroke-linecap="round"/><rect x="${X(x.p25)}" y="4" width="${Math.max(2, X(x.p75) - X(x.p25))}" height="10" fill="var(--band)" rx="2"/><rect x="${X(x.med) - 1.5}" y="1" width="3" height="16" fill="var(--med)"/></svg>`;
}

/* ================= title mapper (JS twin of sbench/mapper.py; same data & algorithm) ================= */
const MAPPER = (() => {
  const SYN = DATA.map, B = '(?<![а-яёa-z0-9])', E = '(?![а-яёa-z0-9])', W = '[а-яёa-z0-9_]';
  const RULES = SYN.rules.map(([p, r]) => [new RegExp(p.split('<B>').join(B).split('<E>').join(E).split('\\w').join(W), 'g'), r.replace(/ё/g, 'е')]);
  const STOP = new Set(SYN.stop), LEVELW = new Set(SYN.level);
  const TAIL = new RegExp('\\s(?:филиал' + W + '*|ао|тоо|ст\\.|станци' + W + '*|депо|оао|гу|кгп|рго)(?![а-яёa-z0-9])|[«"]');
  const HIGH = .80, MEDV = .55;
  function expand(title) {
    let t = String(title || '').toLowerCase().replace(/ё/g, 'е').replace(/[\(\[\{].*?[\)\]\}]/g, ' ');
    t = t.split(TAIL)[0];
    for (const [rx, rep] of RULES) { rx.lastIndex = 0; t = t.replace(rx, rep); }
    return t;
  }
  const words = title => (expand(title).match(/[а-яa-z0-9#+]+/g) || []).filter(t => !STOP.has(t) && !LEVELW.has(t) && t.length > 1 && !/^\d+$/.test(t)).map(t => t.slice(0, 6));
  function feats(title) {
    const ws = words(title), f = new Map();
    for (const w of ws) f.set('w:' + w, (f.get('w:' + w) || 0) + 1);
    const s = ' ' + ws.join(' ') + ' ';
    for (let i = 0; i < s.length - 2; i++) { const k = 'g:' + s.slice(i, i + 3); f.set(k, (f.get(k) || 0) + .4); }
    return f;
  }
  class Index {
    constructor(entries) {
      this.entries = entries;
      const docs = entries.map(e => feats(e.name)), n = docs.length, df = new Map();
      this.words = docs.map(d => new Set([...d.keys()].filter(k => k[0] === 'w')));
      docs.forEach(d => d.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)));
      this.idf = new Map([...df].map(([k, c]) => [k, Math.log((1 + n) / (1 + c)) + 1]));
      this.inv = new Map();
      docs.forEach((d, i) => {
        const vec = [...d].map(([k, v]) => [k, v * this.idf.get(k)]), norm = Math.sqrt(vec.reduce((a, [, v]) => a + v * v, 0)) || 1;
        vec.forEach(([k, v]) => { if (!this.inv.has(k)) this.inv.set(k, []); this.inv.get(k).push([i, v / norm]); });
      });
    }
    query(title, k = 3) {
      const q = feats(title), vec = [];
      q.forEach((v, f) => { if (this.idf.has(f)) vec.push([f, v * this.idf.get(f)]); });
      if (!vec.length) return [];
      const norm = Math.sqrt(vec.reduce((a, [, v]) => a + v * v, 0)) || 1, score = new Map();
      for (const [f, v] of vec) for (const [i, w] of this.inv.get(f)) score.set(i, (score.get(i) || 0) + (v / norm) * w);
      const qw = [...q.keys()].filter(f => f[0] === 'w');
      const top = [...score].sort((a, b) => b[1] - a[1]).slice(0, Math.max(k * 4, 12));
      return top.map(([i, sc]) => {
        const cov = qw.length ? qw.filter(f => this.words[i].has(f)).length / qw.length : 0;
        return [this.entries[i], Math.round(Math.min(sc, 1) * (.55 + .45 * cov) * 1000) / 1000];
      }).sort((a, b) => b[1] - a[1]).slice(0, k);
    }
  }
  const LV = [['Стажёр / Junior', /стаж[её]р|intern|практикант|junior|джун|младший|помощник|ассистент/i],
              ['Руководитель', /начальник|руководитель|директор|заведующ|head of|(?<![a-z])head(?![a-z])|chief|управляющий|заместитель|(?<![a-z])(ceo|cfo|cto)(?![a-z])/i],
              ['Senior / Ведущий', /senior|сеньор|старший|ведущий|главный|lead(?![a-z])|тимлид|team ?lead|principal/i]];
  const levelOf = t => { for (const [n, rx] of LV) if (rx.test(t || '')) return n; return 'Middle / Специалист'; };
  const conf = s => s >= HIGH ? 'высокая' : s >= MEDV ? 'средняя' : 'низкая';
  const roleIdx = new Index(CAT.roles.map(([r, a]) => ({name: r, role: r, area: CAT.areas[a]})));
  const profIdx = new Index(OP.map((p, i) => ({name: p.name, i})));
  function map(title, k = 3) {
    const res = roleIdx.query(title, k), level = levelOf(title);
    const prof = profIdx.query(title, 3).filter(([, s]) => s >= .6).map(([e, s]) => ({name: e.name, i: e.i, score: s}));
    if (!res.length) return {title, role: null, area: 'Другое', level, score: 0, conf: 'низкая', alts: [], prof};
    const [top, sc] = res[0];
    return {title, role: top.role, area: top.area, level, score: sc, conf: conf(sc), alts: res.slice(1).map(([e, s]) => ({role: e.role, area: e.area, score: s})), prof};
  }
  return {map, expand, words, levelOf, conf, HIGH, MEDV};
})();
