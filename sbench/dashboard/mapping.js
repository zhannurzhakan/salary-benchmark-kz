/* ===== module 2: automatic title mapping ("AI mapping") ===== */
const OTBY = new Map(), OIBY = new Map(), VBYROLE = groupBy(V, r => r.role);
OT.forEach(r => { if (!OTBY.has(r.p)) OTBY.set(r.p, []); OTBY.get(r.p).push(r); });
OI.forEach(r => { if (!OIBY.has(r.p)) OIBY.set(r.p, []); OIBY.get(r.p).push(r); });

/* latest official value of a profession: national figure if the Bureau publishes it, otherwise mean over industries */
function offProfValue(pi) {
  for (const y of [...OFF_YEARS].reverse()) {
    const t = (OTBY.get(pi) || []).find(r => r.y === y);
    if (t) return {v: t.v, y, kind: 'РК'};
    const arr = (OIBY.get(pi) || []).filter(r => r.y === y).map(r => r.v);
    if (arr.length) return {v: mean(arr), y, kind: `ср. по ${arr.length} отр.`};
  }
  return null;
}
/* market reference for a mapped position: vacancy P50 of the role (same level if enough data), else official value */
function marketFor(m) {
  const rows = VBYROLE.get(m.role) || [];
  let pool = rows.filter(r => r.level === m.level);
  if (pool.length < MIN) pool = rows;
  const s = summ(pool), off = m.prof && m.prof[0] ? offProfValue(m.prof[0].i) : null;
  if (s.ok) return {value: s.med, src: `вакансии, n=${s.n}`, vac: s, off};
  if (off) return {value: off.v, src: `официально ${off.y} (${off.kind})`, vac: s, off};
  return {value: null, src: 'нет данных', vac: s, off};
}

const MAP = {rows: []};
const SAMPLE = `Главный бухгалтер;650000
Senior Python Developer;1400000
Менеджер по продажам B2B;520000
HR Business Partner;700000
C&B специалист;600000
Руководитель отдела логистики;900000
Юрисконсульт;480000
Инженер по охране труда;450000
Водитель категории С;300000
Chief Financial Officer;2500000`;

function renderMap() {
  const sec = $('#m-map');
  if (!sec.dataset.ready) {
    sec.innerHTML = `<div class="card"><h2>AI-маппинг должностей</h2>
      <div class="note">Вставьте названия должностей из вашей структуры (по одной в строке; можно <code>должность;оклад;численность</code>) или загрузите CSV. Система сама определит профессию в едином классификаторе, профобласть, уровень и найдёт рыночные данные.
      Алгоритм работает локально в браузере: словарь синонимов и транслитерации (RU/EN) → основы слов → TF-IDF по словам и триграммам → косинусная близость. Данные никуда не отправляются.</div>
      <div class="grid g2"><div><textarea id="mapIn" placeholder="Главный бухгалтер;650000&#10;Senior Python Developer;1400000&#10;…"></textarea>
        <div class="toolbar" style="margin-top:8px"><button class="primary" id="mapGo">Сопоставить</button><button id="mapSample">Пример</button>
        <input type="file" id="mapFile" accept=".csv,.txt,text/csv,text/plain" style="width:auto"></div></div>
      <div class="note"><b>Как читать результат.</b><br><span class="pill p-ok">высокая</span> ≥ 0,80 — можно использовать<br><span class="pill p-mid">средняя</span> 0,55–0,80 — быстро проверьте, при необходимости выберите другую роль в списке<br>
        <span class="pill p-low">низкая</span> &lt; 0,55 — вручную; рыночная точка не определяется по такой роли надёжно.<br>«Рыночная точка» — медиана вакансий роли (при n ≥ ${MIN}), иначе официальная средняя Бюро нацстатистики.</div></div></div>
      <div id="mapOut"></div>`;
    $('#mapGo').onclick = runMap;
    $('#mapSample').onclick = () => { $('#mapIn').value = SAMPLE; runMap(); };
    $('#mapFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $('#mapIn').value = fromCsvText(rd.result); runMap(); }; rd.readAsText(f, 'utf-8'); };
    sec.dataset.ready = 1;
  }
}
function fromCsvText(t) {   // accept CSV with header (position/title/должность, salary/оклад, headcount/численность) or plain lines
  const p = parseCsv(t), h = p.head, ix = (...n) => h.findIndex(x => n.includes(x));
  const iT = ix('position', 'title', 'должность', 'название'), iS = ix('salary', 'оклад', 'зарплата'), iH = ix('headcount', 'численность', 'fte', 'штат');
  if (iT < 0) return t;
  return p.rows.map(r => [r[iT], iS >= 0 ? r[iS] : '', iH >= 0 ? r[iH] : ''].join(';').replace(/;+$/, '')).join('\n');
}
function runMap() {
  const lines = $('#mapIn').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  MAP.rows = lines.map(l => {
    const [title, sal, hc] = l.split(/[;\t]/).map(x => x.trim());
    const m = MAPPER.map(title, 3), mk = marketFor(m);
    return {title, sal: num(sal), hc: num(hc) || 1, m, mk, use: true, alt: 0};
  });
  drawMap();
}
function pickAlt(row, idx) {   // user overrides the role -> recompute level-independent market
  const cands = [{role: row.m.role, area: row.m.area, score: row.m.score}, ...row.m.alts];
  const c = cands[idx];
  row.alt = idx;
  const m = {...row.m, role: c.role, area: c.area, score: c.score, conf: MAPPER.conf(c.score)};
  row.cur = m; row.mk = marketFor(m);
}
function drawMap() {
  const out = $('#mapOut'), rows = MAP.rows;
  if (!rows.length) { out.innerHTML = ''; return; }
  const cnt = {высокая: 0, средняя: 0, низкая: 0}; rows.forEach(r => cnt[(r.cur || r.m).conf]++);
  const pill = c => `<span class="pill ${c === 'высокая' ? 'p-ok' : c === 'средняя' ? 'p-mid' : 'p-low'}">${c}</span>`;
  out.innerHTML = `<div class="card"><div class="toolbar"><b>Результат: ${rows.length} должностей</b> ${pill('высокая')} ${cnt.высокая} ${pill('средняя')} ${cnt.средняя} ${pill('низкая')} ${cnt.низкая}
      <span style="margin-left:auto"></span><button id="mapCsv">Скачать CSV</button><button id="mapFot" class="primary">→ в бюджет ФОТ</button></div>
    <div class="tw"><table><thead><tr><th class="l"></th><th class="l">Ваша должность</th><th class="l">Роль в классификаторе</th><th class="l">Профобласть</th><th class="l">Уровень</th><th>Уверенность</th><th class="l">Офиц. профессия (НКЗ)</th><th>Вакансии P50</th><th>Офиц. зарплата</th><th>Рыночная точка</th><th>Ваш оклад</th><th>CR</th></tr></thead><tbody>` +
    rows.map((r, i) => {
      const m = r.cur || r.m, mk = r.mk, cands = [{role: r.m.role, score: r.m.score}, ...r.m.alts];
      const cr = r.sal && mk.value ? r.sal / mk.value : null, band = cr == null ? null : crBand(cr);
      return `<tr><td class="l"><input type="checkbox" data-i="${i}" ${r.use ? 'checked' : ''}></td><td class="l">${esc(r.title)}</td>
        <td class="l">${m.role ? `<select data-alt="${i}" style="min-width:210px">${cands.map((c, j) => `<option value="${j}" ${j === r.alt ? 'selected' : ''}>${esc(c.role)} (${c.score.toFixed(2)})</option>`).join('')}</select>` : '<span style="color:var(--mute)">не определена</span>'}</td>
        <td class="l">${esc(m.area)}</td><td class="l">${esc(r.m.level)}</td><td>${pill(m.conf)}</td>
        <td class="l">${r.m.prof[0] ? esc(r.m.prof[0].name) + ` <span style="color:var(--mute)">(${r.m.prof[0].score.toFixed(2)})</span>` : '<span style="color:var(--mute)">—</span>'}</td>
        <td>${mk.vac.ok ? fmt(mk.vac.med) + ` <span style="color:var(--mute)">n=${mk.vac.n}</span>` : '<span style="color:var(--mute)">н/д</span>'}</td>
        <td>${mk.off ? fmt(mk.off.v) + ` <span style="color:var(--mute)">${mk.off.y}</span>` : '<span style="color:var(--mute)">н/д</span>'}</td>
        <td class="med">${mk.value ? fmt(mk.value) : '—'}</td><td>${r.sal ? fmt(r.sal) : ''}</td>
        <td>${cr != null ? `${cr.toFixed(2).replace('.', ',')} <span class="pill ${band[1]}">${band[0]}</span>` : ''}</td></tr>`;
    }).join('') + `</tbody></table></div>
    <div class="note">Если уверенность низкая или роль выбрана неверно — выберите другую из списка кандидатов. Для редких профессий (например, железнодорожных) в классификаторе hh.kz может не быть точной роли: тогда ориентируйтесь на колонку «Офиц. профессия (НКЗ)».</div></div>`;
  out.querySelectorAll('select[data-alt]').forEach(s => s.onchange = () => { pickAlt(rows[+s.dataset.alt], +s.value); drawMap(); });
  out.querySelectorAll('input[data-i]').forEach(c => c.onchange = () => rows[+c.dataset.i].use = c.checked);
  $('#mapCsv').onclick = () => download('mapping.csv', toCsv([['title', 'role', 'area', 'level', 'confidence', 'score', 'official_profession', 'vacancy_p50', 'vacancy_n', 'official_value', 'market_point', 'salary', 'cr'],
    ...rows.map(r => { const m = r.cur || r.m, mk = r.mk; return [r.title, m.role || '', m.area, r.m.level, m.conf, m.score, r.m.prof[0]?.name || '', mk.vac.ok ? Math.round(mk.vac.med) : '', mk.vac.n, mk.off ? Math.round(mk.off.v) : '', mk.value ? Math.round(mk.value) : '', r.sal || '', r.sal && mk.value ? (r.sal / mk.value).toFixed(3) : '']; })]));
  $('#mapFot').onclick = () => {
    FOT.rows = rows.filter(r => r.use).map(r => ({name: r.title, hc: r.hc, sal: r.sal || (r.mk.value ? Math.round(r.mk.value) : 0), market: r.mk.value ? Math.round(r.mk.value) : null}));
    switchMod('fot');
  };
}
