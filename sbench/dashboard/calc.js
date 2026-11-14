/* ===== payroll tax model (JS twin of sbench/tax.py) + module 4: pay ranges & compa-ratio ===== */
const TAXP = {...META.tax};
function taxEmployee(g, t = TAXP) {
  const opv = t.opv * Math.min(g, t.opv_cap_mzp * t.mzp), vosms = t.vosms * Math.min(g, t.vosms_cap_mzp * t.mzp);
  const base = Math.max(0, g - opv - vosms - t.deduction_mrp * t.mrp), thr = t.ipn_high_threshold_mrp_year * t.mrp / 12;
  const ipn = base <= thr ? t.ipn * base : t.ipn * thr + t.ipn_high * (base - thr);
  return {opv, vosms, ipn, net: g - opv - vosms - ipn};
}
function taxEmployer(g, t = TAXP) {
  const opv = t.opv * Math.min(g, t.opv_cap_mzp * t.mzp), vosms = t.vosms * Math.min(g, t.vosms_cap_mzp * t.mzp);
  const opvr = t.opvr * Math.min(g, t.opv_cap_mzp * t.mzp), so = t.so * Math.min(Math.max(g - opv, t.so_min_mzp * t.mzp), t.so_max_mzp * t.mzp);
  const oosms = t.oosms * Math.min(g, t.oosms_cap_mzp * t.mzp), sn = t.sn * Math.max(0, g - opv - vosms);
  return {opvr, so, oosms, sn, total: opvr + so + oosms + sn};
}

/* compa-ratio bands (market practice): <0.80 well below, 0.80-0.95 below, 0.95-1.05 at market, 1.05-1.20 above, >1.20 well above */
function crBand(cr) {
  return cr < .8 ? ['значительно ниже', 'p-low'] : cr < .95 ? ['ниже', 'p-mid'] : cr <= 1.05 ? ['на уровне', 'p-ok'] : cr <= 1.2 ? ['выше', 'p-high'] : ['значительно выше', 'p-high'];
}
const f2 = v => v == null ? '—' : v.toFixed(2).replace('.', ',');

const CALC = {title: '', m: null, mk: null, opt: 'p50', custom: null, pos: 100, spread: 40, emps: [{name: '', sal: null}, {name: '', sal: null}, {name: '', sal: null}],
              g: {n: 8, low: null, prog: 15}};

function marketOptions() {
  const o = [];
  if (CALC.mk?.vac?.ok) { const v = CALC.mk.vac; o.push(['p50', `Медиана вакансий (P50), n=${v.n}`, v.med], ['p25', 'P25 вакансий', v.p25], ['p75', 'P75 вакансий', v.p75]); }
  if (CALC.mk?.off) o.push(['off', `Официальная средняя, ${CALC.mk.off.y} (${CALC.mk.off.kind})`, CALC.mk.off.v]);
  if (S.ref) o.push(['ref', `Из бенчмаркинга: ${S.ref.label}`, S.ref.value]);
  o.push(['custom', 'Своё значение', CALC.custom]);
  return o;
}
function marketValue() {
  const o = marketOptions(); let sel = o.find(x => x[0] === CALC.opt);
  if (!sel || (sel[2] == null && sel[0] !== 'custom')) sel = o[0];
  CALC.opt = sel[0];
  return sel[2];
}
function rangeOf(mkt) {
  const mid = mkt * CALC.pos / 100, w = CALC.spread / 100, min = mid / (1 + w / 2), max = min * (1 + w);
  return {mid, min, max, q1: min + (max - min) / 4, q3: min + (max - min) * 3 / 4};
}

function renderRange() {
  const sec = $('#m-range');
  if (!sec.dataset.ready) {
    sec.innerHTML = `<div class="card"><h2>Калькулятор вилок и Compa-ratio</h2>
      <div class="note">Определите рыночную точку для позиции, задайте политику оплаты, получите вилку оклада «минимум – середина – максимум» и оцените сотрудников. <b>Compa-ratio (CR)</b> = оклад ÷ середина вилки (1,00 — оплата ровно по середине). <b>Позиция в вилке</b> = (оклад − минимум) ÷ (максимум − минимум).</div></div>
    <div class="grid g2"><div class="card">
      <div class="step"><span class="no">1</span><div style="flex:1"><b>Позиция и рыночная точка</b>
        <div class="toolbar" style="margin-top:6px"><input type="search" id="cTitle" placeholder="Должность: напр. Главный бухгалтер" style="flex:1"><button id="cMap">Определить</button></div>
        <div id="cInfo" class="note"></div><div id="cOpts"></div></div></div>
      <div class="step"><span class="no">2</span><div style="flex:1"><b>Политика оплаты</b>
        <div class="grid g2" style="margin-top:6px"><div class="field"><label>Позиционирование к рынку, %</label><input type="number" id="cPos" value="100" min="50" max="150">
          <div class="h">100% = середина вилки на уровне рыночной точки; 90–110% — типичный коридор</div></div>
          <div class="field"><label>Ширина вилки, %</label><input type="number" id="cSpr" value="40" min="10" max="150">
          <div class="h">(макс − мин) ÷ мин. Специалисты 30–50%, менеджеры 50–70%, руководители выше</div></div></div></div></div>
      <div class="step"><span class="no">3</span><div style="flex:1"><b>Сотрудники на позиции</b>
        <div class="note">Введите оклады вручную или вставьте столбцы «имя/табельный; оклад» из Excel.</div>
        <textarea id="cPaste" placeholder="Иванов И.;520000&#10;Петрова А.;610000" style="min-height:60px"></textarea>
        <div class="toolbar" style="margin-top:6px"><button id="cPasteGo">Загрузить из вставки</button><button id="cAdd">+ строка</button></div>
        <div id="cEmps"></div></div></div></div>
    <div><div class="card" id="cOut"></div><div class="card" id="cGrades"></div></div></div>`;
    $('#cMap').onclick = calcMapTitle;
    $('#cTitle').onkeydown = e => { if (e.key === 'Enter') calcMapTitle(); };
    $('#cPos').oninput = e => { CALC.pos = num(e.target.value) || 100; calcOut(); };
    $('#cSpr').oninput = e => { CALC.spread = num(e.target.value) || 40; calcOut(); };
    $('#cAdd').onclick = () => { CALC.emps.push({name: '', sal: null}); drawEmps(); };
    $('#cPasteGo').onclick = () => { const rows = $('#cPaste').value.split(/\r?\n/).map(l => l.split(/[;\t]/).map(x => x.trim())).filter(r => r.length && r[r.length - 1]);
      CALC.emps = rows.map(r => r.length > 1 ? {name: r[0], sal: num(r[1])} : {name: '', sal: num(r[0])}).filter(e => e.sal); if (!CALC.emps.length) CALC.emps = [{name: '', sal: null}]; drawEmps(); calcOut(); };
    sec.dataset.ready = 1;
    drawEmps();
  }
  drawOpts(); calcOut();
}
function calcMapTitle() {
  const t = $('#cTitle').value.trim(); if (!t) return;
  CALC.title = t; CALC.m = MAPPER.map(t, 3); CALC.mk = marketFor(CALC.m);
  const m = CALC.m;
  $('#cInfo').innerHTML = `Роль: <b>${esc(m.role || 'не определена')}</b> · область: ${esc(m.area)} · уровень: ${esc(m.level)} · уверенность: <span class="pill ${m.conf === 'высокая' ? 'p-ok' : m.conf === 'средняя' ? 'p-mid' : 'p-low'}">${m.conf}</span>` +
    (m.prof[0] ? `<br>Ближайшая официальная профессия: ${esc(m.prof[0].name)}` : '') + (m.conf === 'низкая' ? '<br><span class="dn">Роль определена ненадёжно — введите рыночную точку вручную.</span>' : '');
  CALC.opt = 'p50'; drawOpts(); calcOut();
}
function drawOpts() {
  const o = marketOptions(), host = $('#cOpts'); marketValue();
  host.innerHTML = o.map(([k, l, v]) => `<label style="display:flex;gap:8px;align-items:center;margin:3px 0"><input type="radio" name="cOpt" value="${k}" ${k === CALC.opt ? 'checked' : ''}>
    <span style="flex:1">${esc(l)}</span>${k === 'custom' ? `<input type="number" id="cCustom" value="${CALC.custom ?? ''}" placeholder="₸/мес" style="width:130px">` : `<b>${fmt(v)} ₸</b>`}</label>`).join('');
  host.querySelectorAll('input[name=cOpt]').forEach(r => r.onchange = () => { CALC.opt = r.value; calcOut(); });
  const c = $('#cCustom'); if (c) c.oninput = e => { CALC.custom = num(e.target.value); CALC.opt = 'custom'; host.querySelector('input[value=custom]').checked = true; calcOut(); };
}
function drawEmps() {
  $('#cEmps').innerHTML = `<table style="margin-top:6px"><thead><tr><th class="l">Имя / таб. №</th><th>Оклад, ₸</th><th></th></tr></thead><tbody>${CALC.emps.map((e, i) =>
    `<tr><td class="l"><input class="cell t" data-i="${i}" data-f="name" value="${esc(e.name)}"></td><td><input class="cell" type="number" data-i="${i}" data-f="sal" value="${e.sal ?? ''}"></td><td><button class="link" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>`;
  $('#cEmps').oninput = e => { const i = e.target.dataset.i; if (i == null) return; CALC.emps[+i][e.target.dataset.f] = e.target.dataset.f === 'sal' ? num(e.target.value) : e.target.value; calcOut(); };
  $('#cEmps').onclick = e => { if (e.target.dataset.del != null) { CALC.emps.splice(+e.target.dataset.del, 1); if (!CALC.emps.length) CALC.emps.push({name: '', sal: null}); drawEmps(); calcOut(); } };
}
function zone(pen) { return pen < 0 ? ['ниже минимума', 'p-low'] : pen < .25 ? ['1-й квартиль', 'p-mid'] : pen < .5 ? ['2-й квартиль', 'p-ok'] : pen < .75 ? ['3-й квартиль', 'p-ok'] : pen <= 1 ? ['4-й квартиль', 'p-high'] : ['выше максимума', 'p-high']; }

function calcOut() {
  const out = $('#cOut'), mkt = marketValue();
  if (!mkt) { out.innerHTML = '<div class="empty">Определите должность (шаг 1) или введите рыночную точку вручную.</div>'; $('#cGrades').innerHTML = ''; return; }
  const r = rangeOf(mkt), W = 560, H = 120, lo = r.min * .8, hi = r.max * 1.2, X = v => 10 + (v - lo) / (hi - lo) * (W - 20);
  const v = CALC.mk?.vac, emps = CALC.emps.filter(e => e.sal);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px"><rect x="${X(r.min)}" y="40" width="${X(r.q1) - X(r.min)}" height="26" fill="var(--band2)"/><rect x="${X(r.q1)}" y="40" width="${X(r.mid) - X(r.q1)}" height="26" fill="var(--band)"/><rect x="${X(r.mid)}" y="40" width="${X(r.q3) - X(r.mid)}" height="26" fill="var(--band)"/><rect x="${X(r.q3)}" y="40" width="${X(r.max) - X(r.q3)}" height="26" fill="var(--band2)"/>
    <rect x="${X(r.mid) - 1.5}" y="34" width="3" height="38" fill="var(--med)"/>` +
    [['мин', r.min], ['сер.', r.mid], ['макс', r.max]].map(([l, x]) => `<text x="${X(x)}" y="26" text-anchor="middle">${l} ${fmtK(x)}</text>`).join('');
  if (v?.ok) svg += `<line x1="${X(v.p25)}" x2="${X(v.p75)}" y1="92" y2="92" stroke="var(--c4)" stroke-width="5" stroke-linecap="round"/><text x="${X((v.p25 + v.p75) / 2)}" y="110" text-anchor="middle">вакансии P25–P75</text>`;
  emps.forEach(e => svg += `<circle cx="${Math.max(10, Math.min(W - 10, X(e.sal)))}" cy="53" r="5" fill="var(--accent)"><title>${esc(e.name || 'сотрудник')}: ${fmt(e.sal)} ₸</title></circle>`);
  svg += '</svg>';
  const rows = emps.map(e => { const cr = e.sal / r.mid, pen = (e.sal - r.min) / (r.max - r.min), z = zone(pen), b = crBand(cr);
    return {...e, cr, pen, z, b, mcr: e.sal / mkt, toMin: e.sal < r.min ? r.min - e.sal : 0}; });
  const avg = rows.length ? mean(rows.map(x => x.cr)) : null, cost = rows.reduce((a, x) => a + x.toMin, 0);
  out.innerHTML = `<h3 style="margin-top:0">Вилка оклада</h3>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      ${[['Минимум', r.min], ['Q1', r.q1], ['Середина', r.mid], ['Q3', r.q3], ['Максимум', r.max]].map(([l, x]) => `<div class="kpi ${l === 'Середина' ? 'm' : ''}"><div class="l">${l}</div><div class="v" style="font-size:17px">${fmt(x)}</div></div>`).join('')}</div>
    ${svg}<div class="note">Рыночная точка ${fmt(mkt)} ₸ × позиционирование ${CALC.pos}% = середина ${fmt(r.mid)} ₸; ширина вилки ${CALC.spread}%. Зоны: серая — края (развитие / потолок), тёмная — центральные квартили.</div>
    ${rows.length ? `<h3>Сотрудники</h3><div class="tw" style="max-height:340px"><table><thead><tr><th class="l">Сотрудник</th><th>Оклад</th><th>CR (к середине)</th><th>CR к рынку</th><th>В вилке</th><th class="l">Зона</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.name || '—')}</td><td>${fmt(x.sal)}</td><td class="med">${f2(x.cr)} <span class="pill ${x.b[1]}">${x.b[0]}</span></td><td>${f2(x.mcr)}</td><td>${Math.round(x.pen * 100)}%</td><td class="l"><span class="pill ${x.z[1]}">${x.z[0]}</span></td></tr>`).join('')}</tbody></table></div>
      <div class="note">Средний CR: <b>${f2(avg)}</b> · ниже минимума вилки: ${rows.filter(x => x.toMin).length} чел.${cost ? ` · доплата до минимума: <b>${fmt(cost)} ₸/мес</b> (${fmt(cost * 12)} ₸/год)` : ''}</div>
      <button id="cCsv">Скачать CSV</button>` : '<div class="note">Добавьте оклады сотрудников (шаг 3), чтобы увидеть CR и позицию в вилке.</div>'}`;
  const csv = $('#cCsv'); if (csv) csv.onclick = () => download('compa_ratio.csv', toCsv([['employee', 'salary', 'range_min', 'range_mid', 'range_max', 'cr_to_mid', 'cr_to_market', 'penetration_pct'], ...rows.map(x => [x.name, x.sal, Math.round(r.min), Math.round(r.mid), Math.round(r.max), x.cr.toFixed(3), x.mcr.toFixed(3), Math.round(x.pen * 100)])]));
  drawGrades(r);
}
function drawGrades(r) {
  const g = CALC.g, host = $('#cGrades');
  if (g.low == null) g.low = Math.round(r.mid / 1000) * 1000;
  const n = Math.max(2, Math.min(20, g.n)), prog = g.prog / 100, w = CALC.spread / 100;
  const grades = Array.from({length: n}, (_, i) => { const mid = g.low * Math.pow(1 + prog, i), min = mid / (1 + w / 2), max = min * (1 + w); return {no: i + 1, min, mid, max}; });
  host.innerHTML = `<h3 style="margin-top:0">Грейдовая сетка</h3><div class="note">Ряд вилок с постоянным шагом между серединами. Помогает вписать позицию в структуру грейдов (перекрытие соседних вилок — норма 20–50%).</div>
    <div class="grid g3"><div class="field"><label>Число грейдов</label><input type="number" id="gN" value="${n}" min="2" max="20"></div>
      <div class="field"><label>Середина низшего грейда, ₸</label><input type="number" id="gLow" value="${g.low}"></div>
      <div class="field"><label>Шаг между серединами, %</label><input type="number" id="gProg" value="${g.prog}"></div></div>
    <div class="tw" style="max-height:300px"><table><thead><tr><th>Грейд</th><th>Мин</th><th>Середина</th><th>Макс</th><th>Перекрытие</th></tr></thead><tbody>${grades.map((x, i) => {
      const ov = i < n - 1 ? Math.max(0, (x.max - grades[i + 1].min) / (x.max - x.min)) : null, here = r.mid >= x.min && r.mid <= x.max;
      return `<tr ${here ? 'style="background:var(--chip)"' : ''}><td>${x.no}${here ? ' ◀ позиция' : ''}</td><td>${fmt(x.min)}</td><td class="med">${fmt(x.mid)}</td><td>${fmt(x.max)}</td><td>${ov == null ? '' : Math.round(ov * 100) + '%'}</td></tr>`; }).join('')}</tbody></table></div>
    <button id="gCsv" style="margin-top:8px">Скачать CSV</button>`;
  $('#gN').onchange = e => { g.n = num(e.target.value) || 8; calcOut(); };
  $('#gLow').onchange = e => { g.low = num(e.target.value); calcOut(); };
  $('#gProg').onchange = e => { g.prog = num(e.target.value) || 15; calcOut(); };
  $('#gCsv').onclick = () => download('grades.csv', toCsv([['grade', 'min', 'mid', 'max'], ...grades.map(x => [x.no, Math.round(x.min), Math.round(x.mid), Math.round(x.max)])]));
}
document.addEventListener('refchange', () => { if ($('#m-range').dataset.ready) { drawOpts(); calcOut(); } });
