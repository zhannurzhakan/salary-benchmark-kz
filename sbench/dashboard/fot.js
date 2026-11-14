/* ===== module 5: payroll (ФОТ) budget calculator ===== */
const FOT = {
  rows: [{name: '', hc: 1, sal: null, start: 1, market: null}],
  p: {bonus: 10, raise: 0, raiseMonth: 7, dms: 0, train: 0, other: 0, pos: 100}
};
const MN = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function fotCompute() {
  const p = FOT.p, months = Array.from({length: 12}, () => ({sal: 0, bonus: 0, opvr: 0, so: 0, oosms: 0, sn: 0, ben: 0, hc: 0}));
  const rows = FOT.rows.filter(r => r.sal && r.hc).map(r => {
    const t = {sal: 0, bonus: 0, tax: 0, ben: 0, opvr: 0, so: 0, oosms: 0, sn: 0};
    for (let m = 0; m < 12; m++) {
      if (m + 1 < (r.start || 1)) continue;
      const sal = r.sal * (m + 1 >= p.raiseMonth ? 1 + p.raise / 100 : 1), bonus = sal * p.bonus / 100, gross = sal + bonus;
      const et = taxEmployer(gross), ben = p.dms + p.other + p.train / 12;
      const hc = r.hc;
      const M = months[m];
      M.sal += sal * hc; M.bonus += bonus * hc; M.opvr += et.opvr * hc; M.so += et.so * hc; M.oosms += et.oosms * hc; M.sn += et.sn * hc; M.ben += ben * hc; M.hc += hc;
      t.sal += sal * hc; t.bonus += bonus * hc; t.tax += et.total * hc; t.ben += ben * hc;
      t.opvr += et.opvr * hc; t.so += et.so * hc; t.oosms += et.oosms * hc; t.sn += et.sn * hc;
    }
    const active = Math.max(0, 13 - (r.start || 1)), cost = t.sal + t.bonus + t.tax + t.ben;
    const net = taxEmployee(r.sal).net;
    const atMarket = r.market ? r.market * p.pos / 100 : null;
    return {...r, salY: t.sal, bonus: t.bonus, tax: t.tax, ben: t.ben, opvr: t.opvr, so: t.so, oosms: t.oosms, sn: t.sn, cost, perHead: r.hc && active ? cost / r.hc / active : 0, net, cr: r.market ? r.sal / r.market : null, atMarket};
  });
  const tot = rows.reduce((a, r) => { for (const k of ['bonus', 'tax', 'ben', 'cost', 'opvr', 'so', 'oosms', 'sn']) a[k] = (a[k] || 0) + r[k]; a.sal = (a.sal || 0) + r.salY; a.hc = (a.hc || 0) + r.hc; return a; }, {});
  return {rows, months, tot};
}

function renderFot() {
  const sec = $('#m-fot'), p = FOT.p;
  if (!sec.dataset.ready) {
    sec.innerHTML = `<div class="card"><h2>Калькулятор бюджета на ФОТ</h2>
      <div class="note">Заполните штатное расписание (или передайте его из «AI-маппинга» / бенчмаркинга) и параметры: получите годовой бюджет по месяцам с налогами работодателя (ОПВР, СО, ООСМС, СН) и «на руки» по сотруднику. Ставки по умолчанию — Налоговый кодекс РК с 1 января 2026 г.; их можно править ниже.</div>
      <div class="grid g4" style="margin-top:8px">
        <div class="field"><label>Премия, % от оклада</label><input type="number" id="fBonus" value="${p.bonus}"><div class="h">начисляется равномерно по месяцам</div></div>
        <div class="field"><label>Индексация окладов, %</label><input type="number" id="fRaise" value="${p.raise}"></div>
        <div class="field"><label>С какого месяца (1–12)</label><input type="number" id="fRaiseM" value="${p.raiseMonth}" min="1" max="12"></div>
        <div class="field"><label>ДМС и льготы, ₸/мес на чел.</label><input type="number" id="fDms" value="${p.dms}"><div class="h">в налоговой базе не учитываются</div></div>
        <div class="field"><label>Обучение, ₸/год на чел.</label><input type="number" id="fTrain" value="${p.train}"></div>
        <div class="field"><label>Прочие выплаты, ₸/мес на чел.</label><input type="number" id="fOther" value="${p.other}"></div>
        <div class="field"><label>Сценарий «по рынку», % от рыночной точки</label><input type="number" id="fPos" value="${p.pos}"></div></div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Налоговые параметры (${TAXP.year}) — проверьте с бухгалтерией</summary>
        <div class="grid g4" id="fTax" style="margin-top:8px"></div>
        <div class="note">Показатели ${TAXP.year}: МРП ${TAXP.mrp} ₸, МЗП ${TAXP.mzp} ₸. Базы: ОПВР и ООСМС — с потолками; СО = 5% от (оклад − ОПВ) в пределах 1–7 МЗП; СН = 6% от (оклад − ОПВ − ВОСМС) без зачёта СО. Если ваша бухгалтерия считает иначе, измените ставки здесь (значения сохраняются только в этой сессии).</div></details></div>
    <div class="card"><div class="toolbar"><b>Штатное расписание</b><span style="margin-left:auto"></span>
      <button id="fAdd">+ строка</button><button id="fRef">+ из рыночной точки</button><button id="fMk">Оклады = рынок × %</button><button id="fClr">Очистить</button></div>
      <div id="fRows"></div></div>
    <div id="fOut"></div>`;
    const bind = (id, k) => { $(id).oninput = e => { FOT.p[k] = num(e.target.value) ?? 0; fotOut(); }; };
    [['#fBonus', 'bonus'], ['#fRaise', 'raise'], ['#fRaiseM', 'raiseMonth'], ['#fDms', 'dms'], ['#fTrain', 'train'], ['#fOther', 'other'], ['#fPos', 'pos']].forEach(([i, k]) => bind(i, k));
    const taxFields = [['opvr', 'ОПВР, %', 100], ['so', 'СО, %', 100], ['oosms', 'ООСМС, %', 100], ['sn', 'СН, %', 100], ['opv', 'ОПВ (работник), %', 100], ['vosms', 'ВОСМС (работник), %', 100], ['ipn', 'ИПН, %', 100], ['deduction_mrp', 'Вычет, МРП', 1], ['mrp', 'МРП, ₸', 1], ['mzp', 'МЗП, ₸', 1]];
    $('#fTax').innerHTML = taxFields.map(([k, l, m]) => `<div class="field"><label>${l}</label><input type="number" step="any" data-tk="${k}" data-m="${m}" value="${+(TAXP[k] * m).toFixed(4)}"></div>`).join('');
    $('#fTax').oninput = e => { const k = e.target.dataset.tk; if (!k) return; const v = num(e.target.value); if (v != null) { TAXP[k] = v / +e.target.dataset.m; fotOut(); } };
    $('#fAdd').onclick = () => { FOT.rows.push({name: '', hc: 1, sal: null, start: 1, market: null}); drawFotRows(); };
    $('#fRef').onclick = () => { if (!S.ref) { alert('Сначала в «Рыночном бенчмаркинге» получите рыночную точку.'); return; } FOT.rows.push({name: S.ref.label, hc: 1, sal: Math.round(S.ref.value), start: 1, market: Math.round(S.ref.value)}); drawFotRows(); fotOut(); };
    $('#fMk').onclick = () => { FOT.rows.forEach(r => { if (r.market) r.sal = Math.round(r.market * FOT.p.pos / 100); }); drawFotRows(); fotOut(); };
    $('#fClr').onclick = () => { FOT.rows = [{name: '', hc: 1, sal: null, start: 1, market: null}]; drawFotRows(); fotOut(); };
    sec.dataset.ready = 1;
  }
  drawFotRows(); fotOut();
}
function drawFotRows() {
  const host = $('#fRows');
  host.innerHTML = `<div class="tw" style="max-height:320px"><table><thead><tr><th class="l">Должность</th><th>Чел.</th><th>Оклад, ₸/мес</th><th>С месяца</th><th>Рынок P50</th><th>CR</th><th></th></tr></thead><tbody>${FOT.rows.map((r, i) =>
    `<tr><td class="l"><input class="cell t" data-i="${i}" data-f="name" value="${esc(r.name)}"></td><td><input class="cell" type="number" data-i="${i}" data-f="hc" value="${r.hc ?? ''}" style="width:70px"></td>
     <td><input class="cell" type="number" data-i="${i}" data-f="sal" value="${r.sal ?? ''}"></td><td><input class="cell" type="number" data-i="${i}" data-f="start" value="${r.start ?? 1}" min="1" max="12" style="width:70px"></td>
     <td><input class="cell" type="number" data-i="${i}" data-f="market" value="${r.market ?? ''}"></td><td data-cr="${i}">${r.sal && r.market ? f2(r.sal / r.market) : ''}</td><td><button class="link" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>`;
  host.oninput = e => { const i = e.target.dataset.i; if (i == null) return; const f = e.target.dataset.f; FOT.rows[+i][f] = f === 'name' ? e.target.value : num(e.target.value);
    const r = FOT.rows[+i], c = host.querySelector(`[data-cr="${i}"]`); if (c) c.textContent = r.sal && r.market ? f2(r.sal / r.market) : ''; fotOut(); };
  host.onclick = e => { if (e.target.dataset.del != null) { FOT.rows.splice(+e.target.dataset.del, 1); if (!FOT.rows.length) FOT.rows.push({name: '', hc: 1, sal: null, start: 1, market: null}); drawFotRows(); fotOut(); } };
}
function fotOut() {
  const out = $('#fOut'), {rows, months, tot} = fotCompute();
  if (!rows.length) { out.innerHTML = '<div class="card empty">Добавьте хотя бы одну строку с окладом и численностью.</div>'; return; }
  const kpi = (l, v, s, c = '') => `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
  const pay = tot.sal + tot.bonus, mk = rows.filter(r => r.atMarket), atM = mk.reduce((a, r) => a + r.atMarket * r.hc * Math.max(0, 13 - (r.start || 1)), 0), planM = mk.reduce((a, r) => a + r.sal * r.hc * Math.max(0, 13 - (r.start || 1)), 0);
  const maxM = Math.max(...months.map(m => m.sal + m.bonus + m.opvr + m.so + m.oosms + m.sn + m.ben), 1);
  const W = 760, H = 250, L = 56, T = 14, B = 34, bw = (W - L - 10) / 12, Y = v => T + (H - T - B) * (1 - v / maxM);
  const stacks = [['sal', 'Оклады', 'var(--c1)'], ['bonus', 'Премии', 'var(--c3)'], ['tax', 'Налоги работодателя', 'var(--c4)'], ['ben', 'Льготы и обучение', 'var(--c5)']];
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">`;
  for (let k = 0; k <= 4; k++) { const v = maxM * k / 4; svg += `<line x1="${L}" x2="${W - 8}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtK(v)}</text>`; }
  months.forEach((m, i) => {
    const vals = {sal: m.sal, bonus: m.bonus, tax: m.opvr + m.so + m.oosms + m.sn, ben: m.ben}; let acc = 0;
    stacks.forEach(([k, l, c]) => { const h = (H - T - B) * vals[k] / maxM; svg += `<rect x="${L + i * bw + 3}" y="${Y(acc + vals[k])}" width="${bw - 6}" height="${h}" fill="${c}"><title>${MN[i]}: ${l} ${fmt(vals[k])} ₸ (${m.hc} чел.)</title></rect>`; acc += vals[k]; });
    svg += `<text x="${L + i * bw + bw / 2}" y="${H - 14}" text-anchor="middle">${MN[i]}</text>`;
  });
  svg += '</svg>';
  out.innerHTML = `<div class="kpis">
      ${kpi('Годовой ФОТ (оклады + премии)', fmt(pay) + ' ₸', `${tot.hc} чел. в расписании`, 'm')}
      ${kpi('Налоги работодателя', fmt(tot.tax) + ' ₸', `${(tot.tax / pay * 100).toFixed(1).replace('.', ',')}% к ФОТ`)}
      ${kpi('Льготы и обучение', fmt(tot.ben) + ' ₸', 'вне налоговой базы')}
      ${kpi('Полная стоимость', fmt(tot.cost) + ' ₸', `${(tot.cost / pay).toFixed(3).replace('.', ',')} × ФОТ`, 'o')}
      ${kpi('В среднем на человека', fmt(tot.cost / Math.max(1, rows.reduce((a, r) => a + r.hc * Math.max(0, 13 - (r.start || 1)), 0))) + ' ₸/мес', 'полная стоимость 1 FTE')}
      ${mk.length ? kpi('Сценарий «по рынку»', fmtPct((atM / planM - 1) * 100), `${fmt(atM - planM)} ₸/год к плану (ФОТ по окладам)`) : ''}</div>
    <div class="card"><h3 style="margin-top:0">Бюджет по месяцам</h3>${legend(stacks.map(s => ({name: s[1], color: s[2]})))}${svg}</div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">По позициям</h3><button id="fCsv" style="margin-left:auto">Скачать CSV</button></div><div class="tw"><table><thead><tr><th class="l">Должность</th><th>Чел.</th><th>Оклад</th><th>На руки/мес</th><th>Оклады+премии</th><th>Налоги</th><th>Льготы</th><th>Полная стоимость</th><th>На 1 чел./мес</th><th>CR к рынку</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${esc(r.name || '—')}</td><td>${r.hc}</td><td>${fmt(r.sal)}</td><td>${fmt(r.net)}</td><td>${fmt(r.salY + r.bonus)}</td><td>${fmt(r.tax)}</td><td>${fmt(r.ben)}</td><td class="med">${fmt(r.cost)}</td><td>${fmt(r.perHead)}</td><td>${r.cr ? f2(r.cr) : ''}</td></tr>`).join('')}
      <tr style="font-weight:700"><td>Итого</td><td>${tot.hc}</td><td></td><td></td><td>${fmt(pay)}</td><td>${fmt(tot.tax)}</td><td>${fmt(tot.ben)}</td><td class="med">${fmt(tot.cost)}</td><td></td><td></td></tr></tbody></table></div>
      <div class="note">Налоги работодателя за год: ОПВР ${fmt(tot.opvr)} · СО ${fmt(tot.so)} · ООСМС ${fmt(tot.oosms)} · СН ${fmt(tot.sn)} ₸. «На руки» — оклад за вычетом ОПВ, ВОСМС и ИПН (без премии).</div></div>`;
  $('#fCsv').onclick = () => download('fot_budget.csv', toCsv([['month', 'headcount', 'salaries', 'bonuses', 'opvr', 'so', 'oosms', 'sn', 'benefits', 'total'],
    ...months.map((m, i) => [MN[i], m.hc, ...['sal', 'bonus', 'opvr', 'so', 'oosms', 'sn', 'ben'].map(k => Math.round(m[k])), Math.round(m.sal + m.bonus + m.opvr + m.so + m.oosms + m.sn + m.ben)])]));
}
