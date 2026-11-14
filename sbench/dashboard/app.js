/* ===== module 6 (methodology) + app wiring ===== */
function renderMeth() {
  const sec = $('#m-meth'), cnt = {}; V.forEach(r => cnt[r.s] = (cnt[r.s] || 0) + 1);
  const per = quarters.length ? `${qLabel(quarters[0])} – ${qLabel(quarters[quarters.length - 1])}` : '—';
  const row = (name, status, what, how) => `<tr><td class="l"><b>${name}</b></td><td class="l">${status}</td><td class="l">${what}</td><td class="l">${how}</td></tr>`;
  sec.innerHTML = `<div class="card"><h2>Источники и методология</h2>
    <div class="note">Открытые источники объединены в единые справочники отраслей (разделы ОКЭД), регионов (17 областей + 3 города республиканского значения), профобластей и профессий.</div>
    <div class="tw" style="max-height:none"><table><thead><tr><th class="l">Источник</th><th class="l">Статус</th><th class="l">Что даёт</th><th class="l">Как получаем</th></tr></thead><tbody>
    ${row('stat.gov.kz — Бюро национальной статистики', '<span class="pill p-ok">работает</span>', `Фактическая начисленная зарплата: по отраслям и регионам поквартально (${per}); по профессиям × отраслям и профессиям × регионам — апрель ${OFF_YEARS.join(' и ') || '—'}`, 'Публичные таблицы xlsx, без регистрации. Новые кварталы — командой <code>collect stat</code>')}
    ${row('qsamruk.kz — Самрук-Қазына', '<span class="pill p-ok">работает</span>', `Вакансии с вилками (${(cnt['qsamruk.kz'] || 0).toLocaleString('ru-RU')} в базе); квазигосударственный сектор, много рабочих профессий`, 'Открытый список вакансий (robots.txt разрешает)')}
    ${row('hh.kz — официальный API', '<span class="pill p-mid">нужен токен</span>', 'Вакансии всех отраслей с вилками и описанием (льготы)', 'Бесплатный токен приложения на dev.hh.ru; парсинг сайта условиями hh запрещён')}
    ${row('enbek.kz / hr.enbek.kz', '<span class="pill p-mid">только CSV</span>', 'Вакансии биржи труда', 'Поиск закрыт для ботов в robots.txt — импорт CSV (<code>import-csv</code>)')}
    ${row('Обзоры PwC / EY / WTW, свои данные', '<span class="pill p-ok">импорт</span>', 'Любые срезы в CSV', 'Команда <code>import-csv</code>')}</tbody></table></div></div>
    <div class="grid g2"><div class="card"><h3 style="margin-top:0">Как считаются показатели</h3><ul style="line-height:1.7;padding-left:18px;margin:0">
      <li><b>Вакансии.</b> Единица — вакансия с вилкой. Базовая точка — середина вилки; если задана одна граница — она. Медиана и квартили — по этим точкам (линейная интерполяция, как PERCENTILE.INC в Excel). Min/Max — границы вилок.</li>
      <li><b>Gross/net.</b> Суммы приводятся к gross/мес. «На руки» пересчитывается точной обратной формулой ОПВ/ВОСМС/ИПН; валюты — по курсам из config.json.</li>
      <li><b>Минимальная выборка</b> — n &lt; ${MIN} показывается как «н/д».</li>
      <li><b>Официальная статистика</b> — средняя начисленная зарплата с премиями и доплатами; отдельные профессии за апрель, макро-ряды — квартальные. Значения по профессиям в разрезе отрасли учитывают верхний уровень отрасли (без подотраслей).</li>
      <li><b>Рыночная точка</b> — медиана вакансий (n ≥ ${MIN}), иначе официальная средняя. Вакансии и официальная статистика различаются по определению: предложения vs факт.</li>
      <li><b>Compa-ratio</b> = оклад ÷ середина вилки (или ÷ рынок); полосы 0,95–1,05 «на уровне», &lt;0,80 и &gt;1,20 «значительно ниже/выше».</li></ul></div>
    <div class="card"><h3 style="margin-top:0">AI-маппинг и ограничения</h3><ul style="line-height:1.7;padding-left:18px;margin:0">
      <li>Маппинг — локальный алгоритм (синонимы RU/EN → основы слов → TF-IDF по словам и триграммам → косинусная близость), не внешняя нейросеть: детерминированный, объяснимый, данные не покидают браузер.</li>
      <li>Классификатор ролей — 304 роли hh.kz в 27 профобластях; для редких профессий точной роли может не быть — используйте «Офиц. профессию (НКЗ)».</li>
      <li>Уровень (Стажёр/Middle/Senior/Руководитель) определяется по названию должности.</li>
      <li>Вакансии — предложения работодателей (не фактические выплаты). Выборка qsamruk.kz смещена в сторону госсектора и рабочих профессий.</li>
      <li>Налоговые параметры ${TAXP.year}: МРП ${TAXP.mrp}, МЗП ${TAXP.mzp}, ОПВР ${TAXP.opvr * 100}%, СО ${TAXP.so * 100}%, ООСМС ${TAXP.oosms * 100}%, СН ${TAXP.sn * 100}%. Проверьте с бухгалтерией перед бюджетированием.</li></ul></div></div>`;
}

const MODS = {bench: renderBench, map: renderMap, snap: renderSnap, range: renderRange, fot: renderFot, meth: renderMeth};
const WITH_FILTERS = new Set(['bench', 'snap']);
function switchMod(m) {
  S.mod = m;
  $$('#mods button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $$('main > section').forEach(s => s.hidden = s.id !== 'm-' + m);
  $('#layout').classList.toggle('nofilters', !WITH_FILTERS.has(m));
  MODS[m]();
  window.scrollTo({top: 0});
}
function update() { updateFacets(); if (S.mod === 'bench' || S.mod === 'snap') MODS[S.mod](); }

buildFacets();
$('#mods').onclick = e => { const m = e.target.dataset.m; if (m) switchMod(m); };
switchMod('bench');
