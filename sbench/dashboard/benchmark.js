/* ===== filters (shared) + module 1: market benchmarking ===== */
const S = {
  mod: 'bench', sub: 'vac', q: '', from: '', to: '', group: 'title', ogroup: 'prof', showLow: false,
  sort: {k: 'n', asc: false}, osort: {k: 'v', asc: false}, split: '', ref: null,
  sel: {ind: new Set(), area: new Set(), role: new Set(), level: new Set(), reg: new Set(), s: new Set(), exp: new Set()}
};
const FACETS = [
  {k: 'ind', l: 'Отрасль', vals: () => [...CAT.industries, 'Не указано'], open: true},
  {k: 'area', l: 'Профессиональная область', vals: () => CAT.areas, open: true},
  {k: 'role', l: 'Профессия (должность в классификаторе)', vals: () => CAT.roles.map(r => r[0])},
  {k: 'level', l: 'Уровень позиции', vals: () => CAT.levels},
  {k: 'reg', l: 'Регион', vals: () => [...CAT.regions, 'Не указано'], open: true},
  {k: 's', l: 'Источник', vals: () => DICT.source},
  {k: 'exp', l: 'Опыт работы', vals: () => DICT.experience},
];
const VK = {ind: 'ind', area: 'area', role: 'role', level: 'level', reg: 'reg', s: 's', exp: 'exp'};
const OFFSETS = {
  ind: new Set([...OI.map(r => r.ind), ...OIQ.map(r => r.ind)]), area: new Set(OP.map(p => p.area)),
  role: new Set(OP.map(p => p.role).filter(Boolean)), reg: new Set([...OR.map(r => r.reg), ...ORQ.map(r => r.reg)]),
};

function matchV(r, skip) {
  if (S.from && r.m < S.from) return false;
  if (S.to && r.m > S.to) return false;
  if (skip !== 'q' && S.q && !(r.title + ' ' + r.role).toLowerCase().includes(S.q)) return false;
  for (const f of FACETS) { if (f.k === skip) continue; const s = S.sel[f.k]; if (s.size && !s.has(r[VK[f.k]])) return false; }
  return true;
}
const vacRows = skip => V.filter(r => matchV(r, skip));
const yearRange = () => [S.from ? +S.from.slice(0, 4) : 0, S.to ? +S.to.slice(0, 4) : 9999];

/* official profession x industry rows that satisfy the filters that exist in that dataset */
function offRows() {
  const [y0, y1] = yearRange(), sel = S.sel;
  return OI.filter(r => {
    if (r.y < y0 || r.y > y1) return false;
    const p = OP[r.p];
    if (sel.ind.size && !sel.ind.has(r.ind)) return false;
    if (S.q && !p.name.toLowerCase().includes(S.q) && !(p.role || '').toLowerCase().includes(S.q)) return false;
    if (sel.area.size && !sel.area.has(p.area)) return false;
    if (sel.role.size && !sel.role.has(p.role)) return false;
    return true;
  });
}
const profFilterActive = () => !!(S.q || S.sel.area.size || S.sel.role.size);

/* official value per year for the current selection: mean over matching (profession x industry) cells */
function offSummary() {
  const rows = offRows().filter(r => profFilterActive() ? OP[r.p].name !== ALL_PROF : OP[r.p].name === ALL_PROF);
  const by = {};
  rows.forEach(r => { (by[r.y] ||= []).push(r.v); });
  const years = Object.keys(by).map(Number).sort();
  const last = years[years.length - 1], prev = years[years.length - 2];
  let delta = null;
  if (last && prev) {                                                  // like-for-like: same profession x industry in both years
    const m = new Map(rows.filter(r => r.y === prev).map(r => [r.p + '|' + r.ind, r.v])), d = [];
    rows.filter(r => r.y === last).forEach(r => { const o = m.get(r.p + '|' + r.ind); if (o) d.push(r.v / o - 1); });
    if (d.length) delta = median(d) * 100;
  }
  return {years, last, avg: last ? median(by[last]) : null, n: last ? by[last].length : 0, delta, byYear: by, allProf: !profFilterActive()};
}

function refPoint() {
  const v = summ(vacRows()), o = offSummary();
  if (v.ok) return {value: v.med, label: `медиана вакансий (n=${v.n})`, kind: 'vac', p25: v.p25, p75: v.p75};
  if (o.avg) return {value: o.avg, label: `официальная медиана ${o.last} (${o.n} знач.)`, kind: 'off'};
  return null;
}
function setRef(r) { S.ref = r; document.dispatchEvent(new Event('refchange')); }

/* ---------- facets UI ---------- */
function buildFacets() {
  $('#sub').textContent = `Вакансии: ${V.length.toLocaleString('ru-RU')} · официальная статистика stat.gov.kz: ${OI.length + OR.length ? 'да' : 'нет'} · обновлено: ${META.built}`;
  if (META.demo) $('#demoBanner').hidden = false;
  const allMonths = [...months];
  for (const id of ['mFrom', 'mTo']) {
    const el = $('#' + id);
    el.innerHTML = `<option value="">${id === 'mFrom' ? 'с начала' : 'по текущий'}</option>` + allMonths.map(m => `<option>${m}</option>`).join('');
    el.onchange = () => { S.from = $('#mFrom').value; S.to = $('#mTo').value; update(); };
  }
  $('#q').oninput = e => { S.q = e.target.value.trim().toLowerCase(); update(); };
  $('#reset').onclick = () => { for (const f of FACETS) S.sel[f.k].clear(); S.q = S.from = S.to = ''; $('#q').value = ''; $('#mFrom').value = $('#mTo').value = ''; syncChecks(); update(); };
  const host = $('#facets');
  for (const f of FACETS) {
    const vals = f.vals();
    if (vals.length < 2) continue;
    const d = document.createElement('details'); d.dataset.k = f.k; d.open = !!f.open;
    d.innerHTML = `<summary>${f.l}<span class="cnt" id="c-${f.k}"></span></summary>` +
      (vals.length > 8 ? `<input type="search" placeholder="найти…" style="margin-top:6px" data-s="${f.k}">` : '') +
      `<div class="opts">${vals.map(v => `<label data-v="${esc(v)}"><input type="checkbox" data-k="${f.k}" value="${esc(v)}"><span class="t">${esc(v)}</span><span class="n"></span></label>`).join('')}</div>`;
    host.appendChild(d);
  }
  host.onchange = e => { const i = e.target; if (!i.dataset.k) return; const s = S.sel[i.dataset.k]; i.checked ? s.add(i.value) : s.delete(i.value); update(); };
  host.oninput = e => { const k = e.target.dataset.s; if (!k) return; const q = e.target.value.toLowerCase();
    host.querySelectorAll(`details[data-k="${k}"] label`).forEach(l => l.style.display = l.dataset.v.toLowerCase().includes(q) ? '' : 'none'); };
}
function syncChecks() { $$('.opts input').forEach(i => i.checked = S.sel[i.dataset.k].has(i.value)); }
function updateFacets() {
  for (const f of FACETS) {
    const d = document.querySelector(`details[data-k="${f.k}"]`); if (!d) continue;
    const cnt = {}; for (const r of vacRows(f.k)) cnt[r[VK[f.k]]] = (cnt[r[VK[f.k]]] || 0) + 1;
    d.querySelectorAll('label').forEach(l => {
      const v = l.dataset.v, c = cnt[v] || 0, has = OFFSETS[f.k]?.has(v);
      l.classList.toggle('zero', !c);
      l.querySelector('.n').innerHTML = `${c}${has ? '<span class="o">◆</span>' : ''}`;
    });
    $('#c-' + f.k).textContent = S.sel[f.k].size ? `выбрано ${S.sel[f.k].size}` : '';
  }
  const ch = $('#chips'); if (!ch) return; ch.innerHTML = '';
  const add = (txt, fn) => { const s = document.createElement('span'); s.className = 'chip'; s.innerHTML = esc(txt) + '<b>×</b>'; s.querySelector('b').onclick = fn; ch.appendChild(s); };
  for (const f of FACETS) for (const v of S.sel[f.k]) add(`${f.l.split(' (')[0]}: ${v}`, () => { S.sel[f.k].delete(v); syncChecks(); update(); });
  if (S.q) add(`Должность: «${S.q}»`, () => { S.q = ''; $('#q').value = ''; update(); });
}

/* ---------- module 1 shell ---------- */
const BSUBS = [['vac', 'Вилки по вакансиям'], ['off', 'Официальная статистика'], ['trend', 'Динамика'], ['dist', 'Распределение'], ['cnb', 'Льготы и компенсации']];
function renderBench() {
  const sec = $('#m-bench');
  if (!sec.dataset.ready) {
    sec.innerHTML = `<div class="chips" id="chips"></div><div class="kpis" id="kpis"></div>
      <div id="refbar"></div>
      <div class="tabs" id="btabs">${BSUBS.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div><div class="card" id="bpane"></div>`;
    $('#btabs').onclick = e => { const t = e.target.dataset.t; if (t) { S.sub = t; renderBench(); } };
    sec.dataset.ready = 1;
  }
  $$('#btabs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.sub));
  updateFacets();
  const vr = vacRows(), v = summ(vr), o = offSummary(), ref = refPoint();
  const box = (l, val, sub, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${sub || ''}</div></div>`;
  $('#kpis').innerHTML =
    box('Вакансий', v.n.toLocaleString('ru-RU'), v.n ? (v.ok ? 'выборка достаточна' : `меньше ${MIN} — ориентир, не оценка`) : 'нет данных по фильтрам') +
    box('Медиана вакансий (P50)', v.ok ? fmt(v.med) + ' ₸' : 'н/д', 'середина вилки, gross/мес', 'm') +
    box('P25 – P75', v.ok ? `${fmtK(v.p25)} – ${fmtK(v.p75)}` : 'н/д', 'межквартильный размах') +
    box(`Официально, апрель ${o.last || ''}`, o.avg ? fmt(o.avg) + ' ₸' : 'н/д', o.avg ? (o.allProf ? `медиана по ${o.n} отраслям (все профессии)` : `медиана по ${o.n} знач. «профессия × отрасль»`) : 'нет в статистике по этим фильтрам', 'o') +
    box('Рост к прошлому году', o.delta != null ? fmtPct(o.delta) : 'н/д', 'официально, те же профессии и отрасли', 'o');
  $('#refbar').innerHTML = ref ? `<div class="ref"><b>Рыночная точка для расчётов:</b> ${fmt(ref.value)} ₸ — ${esc(ref.label)}
      <span style="margin-left:10px"><button id="toRange">→ в калькулятор вилок</button> <button id="toFot">→ в бюджет ФОТ</button></span></div>` : '';
  if (ref) { $('#toRange').onclick = () => { setRef(ref); switchMod('range'); }; $('#toFot').onclick = () => { setRef(ref); switchMod('fot'); }; }
  ({vac: benchVac, off: benchOff, trend: benchTrend, dist: benchDist, cnb: benchCnb})[S.sub](vr, o);
}

/* ---------- sub-tab: vacancy ranges ---------- */
const VGROUPS = [['title', 'Должность'], ['role', 'Профессия'], ['area', 'Профессиональная область'], ['ind', 'Отрасль'], ['reg', 'Регион'], ['level', 'Уровень позиции'], ['s', 'Источник']];
function benchVac(rows) {
  const sec = $('#bpane');
  const g = [...groupBy(rows, r => r[S.group])].map(([k, v]) => ({k, ...summ(v)}));
  const list = (S.showLow ? g : g.filter(x => x.ok));
  const sk = S.sort.k, dir = S.sort.asc ? 1 : -1;
  list.sort((a, b) => sk === 'k' ? dir * a.k.localeCompare(b.k, 'ru') : dir * ((a[sk] ?? -1) - (b[sk] ?? -1)));
  const shown = list.slice(0, 300), okr = shown.filter(x => x.ok);
  const lo = Math.min(...okr.map(x => x.p10)), hi = Math.max(...okr.map(x => x.p90));
  const th = (k, l) => `<th data-s="${k}" class="${sk === k ? 'sorted ' + (S.sort.asc ? 'asc' : '') : ''}">${l}</th>`;
  sec.innerHTML = `<div class="toolbar"><label>Группировать по <select id="grp">${VGROUPS.map(([k, l]) => `<option value="${k}" ${k === S.group ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="low" ${S.showLow ? 'checked' : ''}> показывать n &lt; ${MIN}</label><button id="csv" style="margin-left:auto">Скачать CSV</button></div>
    <div class="legend"><span><i style="background:var(--band2)"></i>P10–P90</span><span><i style="background:var(--band)"></i>P25–P75</span><span><i style="background:var(--med)"></i>медиана</span></div>
    ${list.length ? `<div class="tw"><table><thead><tr>${th('k', 'Группа')}${th('n', 'n')}${th('min', 'Min')}${th('p25', 'P25')}${th('med', 'Медиана')}${th('p75', 'P75')}${th('max', 'Max')}<th style="cursor:default;text-align:left">Распределение</th></tr></thead><tbody>` +
    shown.map(x => `<tr class="${x.ok ? '' : 'low'}" data-g="${esc(x.k)}" style="cursor:pointer" title="Нажмите, чтобы отфильтровать"><td>${esc(x.k)}</td><td>${x.n}</td><td>${fmt(x.min)}</td><td>${x.ok ? fmt(x.p25) : 'н/д'}</td><td class="med">${x.ok ? fmt(x.med) : 'н/д'}</td><td>${x.ok ? fmt(x.p75) : 'н/д'}</td><td>${fmt(x.max)}</td><td class="l">${rangeBar(x, lo, hi)}</td></tr>`).join('') +
    `</tbody></table></div>${list.length > 300 ? `<div class="note">Показаны первые 300 из ${list.length}. Уточните фильтры.</div>` : ''}` :
    `<div class="empty">Нет групп с достаточной выборкой вакансий (n ≥ ${MIN}).<br>Для этой выборки смотрите вкладку «Официальная статистика» или ослабьте фильтры.</div>`}`;
  $('#grp').onchange = e => { S.group = e.target.value; benchVac(rows); };
  $('#low').onchange = e => { S.showLow = e.target.checked; benchVac(rows); };
  sec.querySelectorAll('th[data-s]').forEach(h => h.onclick = () => { const k = h.dataset.s; S.sort = {k, asc: S.sort.k === k ? !S.sort.asc : k === 'k'}; benchVac(rows); });
  sec.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => {
    const v = tr.dataset.g;
    if (S.group === 'title') { S.q = v; $('#q').value = v; } else S.sel[S.group]?.add(v);
    syncChecks(); update();
  });
  $('#csv').onclick = () => download('vacancy_ranges.csv', toCsv([['group', 'n', 'min', 'p25', 'median', 'p75', 'max'], ...list.map(x => [x.k, x.n, x.min, x.ok ? x.p25 : '', x.ok ? x.med : '', x.ok ? x.p75 : '', x.max].map(v => typeof v === 'number' ? Math.round(v) : v))]));
}

/* ---------- sub-tab: official statistics (stat.gov.kz) ---------- */
const OGROUPS = [['prof', 'Профессия (НКЗ)'], ['ind', 'Отрасль'], ['area', 'Профессиональная область'], ['reg', 'Регион (отдельные профессии)']];
function benchOff() {
  const sec = $('#bpane'), g = S.ogroup, years = OFF_YEARS.length ? OFF_YEARS : [];
  if (!years.length) { sec.innerHTML = '<div class="empty">Официальные данные не загружены. Выполните <code>python3 -m sbench collect stat</code>, затем <code>build</code>.</div>'; return; }
  const [y0, y1] = yearRange();
  let cells;                                   // [{key, y, v, extra}]
  const pf = profFilterActive();
  if (g === 'reg') {
    cells = OR.filter(r => r.y >= y0 && r.y <= y1 && (!S.sel.reg.size || S.sel.reg.has(r.reg)) &&
      (!S.q || OP[r.p].name.toLowerCase().includes(S.q)) && (!S.sel.area.size || S.sel.area.has(OP[r.p].area)) && (!S.sel.role.size || S.sel.role.has(OP[r.p].role)))
      .map(r => ({key: r.reg, y: r.y, v: r.v, sub: OP[r.p].name}));
  } else {
    let rows = offRows();
    if (g === 'prof') rows = rows.filter(r => OP[r.p].name !== ALL_PROF);
    else rows = rows.filter(r => pf ? OP[r.p].name !== ALL_PROF : OP[r.p].name === ALL_PROF);
    cells = rows.map(r => ({key: g === 'prof' ? OP[r.p].name : g === 'ind' ? r.ind : OP[r.p].area, y: r.y, v: r.v, ind: r.ind, p: r.p}));
    if (g === 'prof' && !S.sel.ind.size) {      // no industry chosen: use the national figure where the Bureau publishes it
      const tot = new Map(OT.map(t => [OP[t.p].name + '|' + t.y, t.v]));
      cells = cells.filter(c => !tot.has(c.key + '|' + c.y));
      OT.filter(t => t.y >= y0 && t.y <= y1 && (!S.q || OP[t.p].name.toLowerCase().includes(S.q)) && (!S.sel.area.size || S.sel.area.has(OP[t.p].area)) && (!S.sel.role.size || S.sel.role.has(OP[t.p].role)))
        .forEach(t => cells.push({key: OP[t.p].name, y: t.y, v: t.v, national: true, ind: '', p: t.p}));
    }
  }
  const agg = new Map();
  for (const c of cells) {
    if (!agg.has(c.key)) agg.set(c.key, {k: c.key, by: {}, cnt: {}, nat: false, p: c.p});
    const a = agg.get(c.key); (a.by[c.y] ||= []).push(c.v); a.cnt[c.y] = (a.cnt[c.y] || 0) + 1; a.nat ||= !!c.national;
  }
  const list = [...agg.values()].map(a => {
    const o = {k: a.k, p: a.p, nat: a.nat, n: Math.max(...Object.values(a.cnt))};
    years.forEach(y => o['y' + y] = a.by[y] ? mean(a.by[y]) : null);
    const ys = years.filter(y => o['y' + y] != null);
    o.v = ys.length ? o['y' + ys[ys.length - 1]] : null;
    o.d = ys.length > 1 && o['y' + ys[0]] ? (o['y' + ys[ys.length - 1]] / o['y' + ys[0]] - 1) * 100 : null;
    return o;
  }).filter(o => o.v != null);
  const sk = S.osort.k, dir = S.osort.asc ? 1 : -1;
  list.sort((a, b) => sk === 'k' ? dir * a.k.localeCompare(b.k, 'ru') : dir * ((a[sk] ?? -1e18) - (b[sk] ?? -1e18)));
  const shown = list.slice(0, 400), mx = Math.max(...shown.map(x => x.v), 1);
  const th = (k, l) => `<th data-s="${k}" class="${sk === k ? 'sorted ' + (S.osort.asc ? 'asc' : '') : ''}">${l}</th>`;
  const lastY = years[years.length - 1];
  sec.innerHTML = `<div class="toolbar"><label>Группировать по <select id="og">${OGROUPS.map(([k, l]) => `<option value="${k}" ${k === g ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button id="ocsv" style="margin-left:auto">Скачать CSV</button></div>
    <div class="note">Бюро национальной статистики РК: среднемесячная <b>начисленная</b> зарплата работников за апрель каждого года (форма 2-Т): с премиями и доплатами, до налогов. Это факт, а не предложения из вакансий.
    ${g === 'prof' && !S.sel.ind.size ? 'Без выбора отрасли показан национальный показатель по профессии, если Бюро его публикует, иначе среднее по отраслям.' : ''}
    ${g === 'reg' ? 'Региональный разрез опубликован только для небольшого набора профессий.' : ''}
    ${S.sel.reg.size && g !== 'reg' ? '<div class="warn">Регион в профессиональной статистике доступен только в разрезе «Регион (отдельные профессии)»; в остальных группировках фильтр региона не применяется.</div>' : ''}</div>
    ${list.length ? `<div class="tw"><table><thead><tr>${th('k', 'Группа')}${years.map(y => th('y' + y, y)).join('')}${th('d', `Δ ${years[0]}→${lastY}`)}${th('n', g === 'prof' ? 'отраслей' : 'значений')}<th style="cursor:default;text-align:left">${lastY}</th></tr></thead><tbody>` +
    shown.map(x => `<tr data-g="${esc(x.k)}" style="cursor:pointer" title="Нажмите, чтобы отфильтровать"><td>${esc(x.k)}${x.nat ? ' <span class="pill p-ok" title="национальный показатель Бюро">РК</span>' : ''}</td>${years.map(y => `<td class="${y === lastY ? 'med' : ''}">${fmt(x['y' + y])}</td>`).join('')}<td class="${x.d > 0 ? 'up' : x.d < 0 ? 'dn' : ''}">${fmtPct(x.d)}</td><td>${x.n}</td><td class="l"><svg width="160" height="12"><rect x="0" y="2" width="${Math.max(2, x.v / mx * 156)}" height="8" rx="2" fill="var(--c4)"/></svg></td></tr>`).join('') +
    `</tbody></table></div>${list.length > 400 ? `<div class="note">Показаны первые 400 из ${list.length}. Уточните фильтры.</div>` : ''}` : '<div class="empty">В официальной статистике нет данных по этим фильтрам.</div>'}`;
  $('#og').onchange = e => { S.ogroup = e.target.value; S.osort = {k: 'v', asc: false}; benchOff(); };
  sec.querySelectorAll('th[data-s]').forEach(h => h.onclick = () => { const k = h.dataset.s; S.osort = {k, asc: S.osort.k === k ? !S.osort.asc : k === 'k'}; benchOff(); });
  sec.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => {
    const v = tr.dataset.g;
    if (g === 'prof') { S.q = v.toLowerCase(); $('#q').value = v; } else if (g === 'ind') S.sel.ind.add(v); else if (g === 'area') S.sel.area.add(v); else S.sel.reg.add(v);
    syncChecks(); update();
  });
  $('#ocsv').onclick = () => download('official_wages.csv', toCsv([['group', ...years, 'delta_pct', 'n'], ...list.map(x => [x.k, ...years.map(y => x['y' + y] != null ? Math.round(x['y' + y]) : ''), x.d != null ? x.d.toFixed(1) : '', x.n])]));
}

/* ---------- sub-tab: monthly dynamics ---------- */
function benchTrend(rows) {
  const sec = $('#bpane'), key = S.split;
  const groups = key ? [...groupBy(rows, r => r[VK[key] || key])].sort((a, b) => b[1].length - a[1].length).slice(0, 6) : [['Все выбранные', rows]];
  const ms = [...new Set(rows.map(r => r.m))].sort();
  const series = groups.map(([name, rs], i) => { const by = groupBy(rs, r => r.m); return {name, color: PALETTE[i % PALETTE.length], pts: ms.map(m => { const s = summ(by.get(m) || []); return {y: s.ok ? s.med : null, s, tip: s.ok ? `медиана ${fmt(s.med)} ₸\nP25–P75: ${fmt(s.p25)} – ${fmt(s.p75)}\nn = ${s.n}` : ''}; })};
  });
  const band = key ? null : series[0].pts.map(p => ({lo: p.s.ok ? p.s.p25 : null, hi: p.s.ok ? p.s.p75 : null}));
  const sel = `<div class="toolbar"><label>Разбить по <select id="split"><option value="">— без разбивки —</option>${VGROUPS.filter(g => g[0] !== 'title').map(([k, l]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button id="csv2" style="margin-left:auto">Скачать CSV</button></div>`;
  const okAny = series.some(s => s.pts.some(p => p.y != null));
  sec.innerHTML = sel + (okAny ? legend(key ? series : [{name: 'медиана', color: 'var(--c3)'}, {name: 'P25–P75', color: 'var(--band2)'}]) +
    lineChart({series: key ? series : [{...series[0], color: 'var(--c3)'}], xs: ms, band}) +
    (ms.length < 3 ? `<div class="note">Накоплено ${ms.length} мес. вакансий. Динамика вакансий появится по мере регулярных сборов (hh.kz отдаёт только актуальные вакансии). История официальной зарплаты — в модуле «Свежие срезы рынка».</div>` : '') :
    `<div class="empty">Недостаточно вакансий по месяцам (нужно ≥ ${MIN} в месяце). Официальная динамика по кварталам — в модуле «Свежие срезы рынка».</div>`);
  $('#split').onchange = e => { S.split = e.target.value; benchTrend(rows); };
  $('#csv2').onclick = () => download('trend.csv', toCsv([['series', 'month', 'n', 'p25', 'median', 'p75'], ...series.flatMap(s => s.pts.map((p, i) => [s.name, ms[i], p.s.n || 0, p.s.ok ? Math.round(p.s.p25) : '', p.s.ok ? Math.round(p.s.med) : '', p.s.ok ? Math.round(p.s.p75) : '']))]));
}

/* ---------- sub-tab: distribution ---------- */
function benchDist(rows) {
  const sec = $('#bpane'), mids = rows.map(r => r.mid).filter(Boolean).sort((a, b) => a - b);
  if (mids.length < MIN) { sec.innerHTML = '<div class="empty">Мало наблюдений для гистограммы.</div>'; return; }
  const lo = pct(mids, 1), hi = pct(mids, 99), Bn = 24, w = (hi - lo) / Bn, bins = new Array(Bn).fill(0);
  mids.forEach(v => { if (v >= lo && v <= hi) bins[Math.min(Bn - 1, Math.floor((v - lo) / w))]++; });
  const W = 880, H = 300, L = 40, T = 22, Bt = 36, mx = Math.max(...bins), bw = (W - L - 10) / Bn, X = v => L + (v - lo) / (hi - lo) * (W - L - 10);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">`;
  bins.forEach((c, i) => svg += `<rect x="${L + i * bw + 1}" y="${T + (H - T - Bt) * (1 - c / mx)}" width="${bw - 2}" height="${(H - T - Bt) * c / mx}" fill="var(--band)"><title>${fmt(lo + i * w)} – ${fmt(lo + (i + 1) * w)} ₸: ${c}</title></rect>`);
  [[25, 'P25'], [50, 'P50'], [75, 'P75']].forEach(([p, l]) => { const v = pct(mids, p); svg += `<line x1="${X(v)}" x2="${X(v)}" y1="${T - 6}" y2="${H - Bt}" stroke="${p === 50 ? 'var(--med)' : 'var(--accent)'}" stroke-width="${p === 50 ? 3 : 1.5}" ${p === 50 ? '' : 'stroke-dasharray="4 3"'}/><text x="${X(v)}" y="${T - 8}" text-anchor="middle">${l} ${fmtK(v)}</text>`; });
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; svg += `<text x="${X(v)}" y="${H - 14}" text-anchor="middle">${fmtK(v)}</text>`; }
  sec.innerHTML = '<div class="note">Гистограмма середин вилок вакансий (крайние 1% с каждой стороны скрыты для читаемости).</div>' + svg + '</svg>';
}

/* ---------- sub-tab: benefits (C&B) ---------- */
function benchCnb(rows) {
  const sec = $('#bpane'), base = rows.filter(r => r.ben), all = V.filter(r => r.ben);
  if (base.length < MIN) { sec.innerHTML = `<div class="empty">Для оценки льгот нужны вакансии с разобранным описанием (≥ ${MIN} по фильтрам).<br>Для hh.kz включите <code>"fetch_details": true</code> в config.json; для CSV добавьте колонку <code>benefits</code>.</div>`; return; }
  const cnt = a => { const c = {}; a.forEach(r => r.ben.forEach(b => c[b] = (c[b] || 0) + 1)); return c; };
  const c1 = cnt(base), c0 = cnt(all), names = Object.keys(c1).sort((a, b) => c1[b] - c1[a]);
  sec.innerHTML = `<div class="note">Доля вакансий, где упомянута льгота (из ${base.length} с разобранным описанием). Красная отметка — среднее по всей базе (${all.length}).</div>` +
    names.map(n => { const p = c1[n] / base.length, p0 = (c0[n] || 0) / all.length; return `<div class="bar"><span class="nm">${esc(n)}</span><div class="tr"><div class="fl" style="width:${p * 100}%"></div><div class="mk" style="left:${p0 * 100}%"></div></div><span class="pc">${Math.round(p * 100)}%</span></div>`; }).join('') +
    `<div class="note">Упоминание в объявлении ≠ фактическое предоставление; низкие доли отчасти отражают, что работодатели не перечисляют льготы.</div>`;
}
