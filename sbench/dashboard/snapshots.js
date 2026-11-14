/* ===== module 3: fresh market snapshots ===== */
const SNAP = {per: null, pick: new Set(), pickInit: false, dim: 'ind'};
const quarters = [...new Set([...OIQ, ...ORQ].map(r => r.per).filter(p => p % 10 > 0))].sort();
const prevQ = p => (p % 10 === 1 ? (Math.floor(p / 10) - 1) * 10 + 4 : p - 1);
const yoyQ = p => p - 10;

function seriesFor(rows, key, k) { const m = new Map(); rows.filter(r => r[key] === k).forEach(r => m.set(r.per, r.v)); return m; }

function snapTable(rows, key, label, selSet, per) {
  const keys = [...new Set(rows.map(r => r[key]))];
  const at = (k, p) => rows.find(r => r[key] === k && r.per === p)?.v;
  const nat = ONAT.find(n => n.per === per)?.avg;
  let list = keys.map(k => {
    const v = at(k, per), a = at(k, prevQ(per)), y = at(k, yoyQ(per));
    return {k, v, qoq: v && a ? (v / a - 1) * 100 : null, yoy: v && y ? (v / y - 1) * 100 : null, vs: v && nat ? v / nat : null,
            ser: quarters.map(q => at(k, q) ?? null)};
  }).filter(x => x.v != null);
  if (selSet.size) list = list.filter(x => selSet.has(x.k));
  list.sort((a, b) => b.v - a.v);
  return {list, nat};
}
function spark(vals, W = 90, H = 20) {
  const pts = vals.map((v, i) => ({v, i})).filter(p => p.v != null);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)), X = i => 2 + i * (W - 4) / (vals.length - 1), Y = v => H - 3 - (H - 6) * (v - lo) / (hi - lo || 1);
  return `<svg width="${W}" height="${H}"><path d="M${pts.map(p => `${X(p.i)},${Y(p.v)}`).join('L')}" fill="none" stroke="var(--c3)" stroke-width="1.6"/><circle cx="${X(pts[pts.length - 1].i)}" cy="${Y(pts[pts.length - 1].v)}" r="2.4" fill="var(--c3)"/></svg>`;
}
const chg = v => v == null ? '<td>—</td>' : `<td class="${v > 0 ? 'up' : v < 0 ? 'dn' : ''}">${fmtPct(v)}</td>`;

function renderSnap() {
  const sec = $('#m-snap');
  if (!quarters.length) { sec.innerHTML = '<div class="card empty">Официальные квартальные данные не загружены. Выполните <code>python3 -m sbench collect stat</code> и пересоберите дашборд.</div>'; return; }
  if (!SNAP.per) SNAP.per = quarters[quarters.length - 1];
  const per = SNAP.per, isInd = SNAP.dim === 'ind';
  const rows = isInd ? OIQ : ORQ, key = isInd ? 'ind' : 'reg', sel = isInd ? S.sel.ind : S.sel.reg;
  const {list, nat} = snapTable(rows, key, isInd ? 'Отрасль' : 'Регион', sel, per);
  if (!SNAP.pickInit && list.length) { list.slice(0, 3).forEach(x => SNAP.pick.add(x.k)); SNAP.pickInit = true; }
  const natRow = ONAT.find(n => n.per === per), natPrev = ONAT.find(n => n.per === prevQ(per)), natYoy = ONAT.find(n => n.per === yoyQ(per));
  const card = (l, v, s, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
  const kpis = card(`Средняя зарплата по РК, ${qLabel(per)}`, natRow?.avg ? fmt(natRow.avg) + ' ₸' : 'н/д', 'Бюро национальной статистики', 'm') +
    card('Медианная (оценка)', natRow?.med ? fmt(natRow.med) + ' ₸' : 'н/д', 'половина работников получает меньше', 'm') +
    card('К пред. кварталу', natRow?.avg && natPrev?.avg ? fmtPct((natRow.avg / natPrev.avg - 1) * 100) : 'н/д', 'сезонность: IV кв. — премии') +
    card('К тому же кварталу год назад', natRow?.avg && natYoy?.avg ? fmtPct((natRow.avg / natYoy.avg - 1) * 100) : 'н/д', 'номинальный рост') +
    card('Последние данные', qLabel(quarters[quarters.length - 1]), (META.occupation_years || []).length ? `по профессиям: апрель ${META.occupation_years.join(', ')}` : '');
  const chartSeries = [];
  const nsAvg = quarters.map(q => ONAT.find(n => n.per === q)?.avg ?? null), nsMed = quarters.map(q => ONAT.find(n => n.per === q)?.med ?? null);
  chartSeries.push({name: 'Средняя по РК', color: 'var(--ink)', pts: nsAvg.map(y => ({y}))});
  if (nsMed.some(v => v)) chartSeries.push({name: 'Медианная по РК', color: 'var(--mute)', dash: true, pts: nsMed.map(y => ({y}))});
  [...SNAP.pick].slice(0, 5).forEach((k, i) => { const m = seriesFor(rows, key, k); chartSeries.push({name: k, color: PALETTE[(i + 1) % PALETTE.length], pts: quarters.map(q => ({y: m.get(q) ?? null}))}); });
  const fresh = (META.fresh || []).map(f => `<tr><td>${esc(f.source)}</td><td>${f.n}</td><td>${esc(f.last || '')}</td></tr>`).join('');
  sec.innerHTML = `<div class="card"><h2>Свежие срезы рынка</h2>
      <div class="note">Квартальная официальная статистика Бюро национальной статистики РК (stat.gov.kz): средняя номинальная зарплата одного работника, тенге/мес. Новые кварталы подтягиваются командой <code>collect stat</code> по мере публикации.</div>
      <div class="kpis">${kpis}</div></div>
    <div class="card"><div class="toolbar"><label>Период <select id="sp">${[...quarters].reverse().map(p => `<option value="${p}" ${p === per ? 'selected' : ''}>${qLabel(p)}</option>`).join('')}</select></label>
      <label>Разрез <select id="sd"><option value="ind" ${isInd ? 'selected' : ''}>по отраслям</option><option value="reg" ${!isInd ? 'selected' : ''}>по регионам</option></select></label>
      <span class="note" style="margin:0">Фильтры слева (отрасль / регион) применяются к таблице. Нажмите на строку — добавить на график.</span>
      <button id="scsv" style="margin-left:auto">Скачать CSV</button></div>
      <div class="grid g2"><div class="tw" style="max-height:520px"><table><thead><tr><th class="l">${isInd ? 'Отрасль' : 'Регион'}</th><th>${qLabel(per)}</th><th>к пред. кв.</th><th>к году назад</th><th>к РК</th><th class="l">динамика</th></tr></thead><tbody>
      ${list.map(x => `<tr data-k="${esc(x.k)}" style="cursor:pointer;${SNAP.pick.has(x.k) ? 'background:var(--chip)' : ''}"><td>${esc(x.k)}</td><td class="med">${fmt(x.v)}</td>${chg(x.qoq)}${chg(x.yoy)}<td>${x.vs ? '×' + x.vs.toFixed(2).replace('.', ',') : '—'}</td><td class="l">${spark(x.ser)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Нет данных по этим фильтрам</td></tr>'}</tbody></table></div>
      <div>${legend(chartSeries)}${lineChart({series: chartSeries, xs: quarters.map(qLabel), W: 640, H: 340})}</div></div></div>
    <div class="card" id="vsnap"></div>
    <div class="card"><h3 style="margin-top:0">Актуальность источников</h3><div class="tw" style="max-height:200px"><table><thead><tr><th class="l">Источник вакансий</th><th>записей</th><th>обновлено</th></tr></thead><tbody>${fresh || '<tr><td colspan="3" class="empty">нет данных</td></tr>'}</tbody></table></div></div>`;
  $('#sp').onchange = e => { SNAP.per = +e.target.value; renderSnap(); };
  $('#sd').onchange = e => { SNAP.dim = e.target.value; SNAP.pick.clear(); SNAP.pickInit = false; renderSnap(); };
  sec.querySelectorAll('tbody tr[data-k]').forEach(tr => tr.onclick = () => { const k = tr.dataset.k; SNAP.pick.has(k) ? SNAP.pick.delete(k) : SNAP.pick.add(k); renderSnap(); });
  $('#scsv').onclick = () => download('snapshot.csv', toCsv([[isInd ? 'industry' : 'region', 'period', 'avg_wage', 'qoq_pct', 'yoy_pct', 'vs_national'], ...list.map(x => [x.k, qLabel(per), Math.round(x.v), x.qoq != null ? x.qoq.toFixed(1) : '', x.yoy != null ? x.yoy.toFixed(1) : '', x.vs ? x.vs.toFixed(3) : ''])]));
  vacSnapshot();
}

/* vacancy snapshot: latest month vs the previous one, by professional area (needs ≥ MIN in both) */
function vacSnapshot() {
  const box = $('#vsnap'), ms = [...new Set(V.map(r => r.m))].sort();
  if (ms.length < 2) { box.innerHTML = `<h3 style="margin-top:0">Срез вакансий</h3><div class="note">В базе вакансий пока ${ms.length} мес. Сравнение «последний месяц к предыдущему» появится после второго месячного сбора (запускайте <code>collect</code> регулярно).</div>`; return; }
  const cur = ms[ms.length - 1], prev = ms[ms.length - 2];
  const rows = V.filter(r => (!S.sel.ind.size || S.sel.ind.has(r.ind)) && (!S.sel.reg.size || S.sel.reg.has(r.reg)) && (!S.sel.area.size || S.sel.area.has(r.area)));
  const g = [...groupBy(rows, r => r.area)].map(([k, v]) => { const a = summ(v.filter(r => r.m === cur)), b = summ(v.filter(r => r.m === prev)); return {k, a, b, d: a.ok && b.ok ? (a.med / b.med - 1) * 100 : null}; })
    .filter(x => x.a.n || x.b.n).sort((x, y) => y.a.n - x.a.n);
  box.innerHTML = `<h3 style="margin-top:0">Срез вакансий: ${cur} к ${prev}</h3><div class="note">Медиана середины вилки по профобластям; считается, если в обоих месяцах не менее ${MIN} вакансий.</div>
    <div class="tw" style="max-height:360px"><table><thead><tr><th class="l">Профобласть</th><th>${prev}: n</th><th>${prev}: медиана</th><th>${cur}: n</th><th>${cur}: медиана</th><th>Δ</th></tr></thead><tbody>
    ${g.map(x => `<tr><td>${esc(x.k)}</td><td>${x.b.n}</td><td>${x.b.ok ? fmt(x.b.med) : 'н/д'}</td><td>${x.a.n}</td><td class="med">${x.a.ok ? fmt(x.a.med) : 'н/д'}</td>${chg(x.d)}</tr>`).join('')}</tbody></table></div>`;
}
