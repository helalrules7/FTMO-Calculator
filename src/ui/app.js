// UI layer: reads inputs, calls the pure engine, renders. No formulas here.
import { calculate, conversions } from '../engine/calc.js';
import { INSTRUMENTS, SYMBOLS, ASSET_CLASSES, SYMBOLS_UPDATED, resolveInstrument } from '../engine/instruments.js';
import { ftmoLimits } from '../engine/ftmo.js';
import { parseNum } from '../engine/decimal.js';
import { DEFAULT_SETTINGS, FTMO_2STEP_RULES } from '../engine/config.js';
import { makeT } from './i18n.js';
import { load, save } from './storage.js';

const $ = id => document.getElementById(id);
const state = load();
let t = makeT(state.settings.lang);

const NUM_FIELDS = ['balance', 'equity', 'riskPct', 'entry', 'sl', 'tp', 'initial', 'existingMargin',
  'desiredExposurePct', 'slippage', 'dailyStart', 'openPL', 'commissions', 'swaps'];

const FIRST_RUN = {
  symbol: 'BTCUSD', direction: 'long', balance: '100000', equity: '100000', initial: '100000',
  entry: '100000', sl: '95000', tp: '110000',
};
const DEFAULT_QUICK = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD'];
const shortSym = s => s.replace(/\.(cash|c)$/, '');

// ---------- formatting (Latin digits in both languages for trading clarity) ----------
const nf = (dp, min = dp) => { const f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: dp }); return v => f.format(v); };
const fmt = {
  money: v => {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = new Intl.NumberFormat('en-US', { style: 'currency', currency: state.settings.currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
    return v < 0 ? `−${s}` : s;
  },
  pct: v => (v == null || !Number.isFinite(v) ? '—' : `${nf(2)(v)}%`),
  lots: v => (Number.isFinite(v) ? nf(2)(v) : '—'),
  qty: v => (Number.isFinite(v) ? nf(6, 2)(v) : '—'),
  price: v => (Number.isFinite(v) ? nf(8, 2)(v) : '—'),
  rr: v => (Number.isFinite(v) ? `1 : ${nf(2)(v)}` : '—'),
};
const ltr = s => `<span class="ltr">${s}</span>`;

// ---------- settings schema ----------
const SETTINGS_SCHEMA = [
  ['sGroupRisk', [['riskPct', 'sDefaultRisk'], ['preferredExposurePct', 'sPreferred'], ['maxExposurePct', 'sMaxExp'], ['highRiskExposurePct', 'sHighExp'], ['minFreeMarginPct', 'sMinFree']]],
  ['sGroupBroker', [['volumeStep', 'sStep']]],
  ['sGroupFtmo', [['dailyLossPct', 'sDaily'], ['maxLossPct', 'sMaxLoss']]],
];

// ---------- input plumbing ----------
function readInputs() {
  const v = {};
  for (const id of NUM_FIELDS) v[id] = parseNum($(id).value);
  v.symbol = state.inputs.symbol;
  v.direction = state.inputs.direction;
  v.rates = {};
  document.querySelectorAll('[data-rate]').forEach(el => {
    const val = parseNum(el.value);
    if (val > 0) v.rates[el.dataset.rate] = el.dataset.invert === '1' ? 1 / val : val;
  });
  return v;
}

function hydrate() {
  const saved = Object.keys(state.inputs).length ? state.inputs : { ...FIRST_RUN };
  state.inputs = { symbol: 'BTCUSD', direction: 'long', rates: {}, ...saved };
  if (!INSTRUMENTS[state.inputs.symbol]) state.inputs.symbol = 'BTCUSD';
  if (!Array.isArray(state.inputs.recent)) state.inputs.recent = [...DEFAULT_QUICK];
  renderQuick();
  renderRates();
  for (const id of NUM_FIELDS) $(id).value = state.inputs[id] ?? '';
  if (!$('riskPct').value) $('riskPct').value = String(state.settings.riskPct);
  syncSegments();
}

function persistInputs() {
  for (const id of NUM_FIELDS) state.inputs[id] = $(id).value;
  save(state);
}

function syncSegments() {
  document.querySelectorAll('.seg').forEach(seg => {
    const val = state.inputs[seg.dataset.field];
    seg.querySelectorAll('button').forEach(b => {
      const on = b.dataset.value === val;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    });
  });
  const r = $('riskPct').value;
  document.querySelectorAll('#riskChips button').forEach(b => b.classList.toggle('on', parseNum(r) === Number(b.dataset.risk)));
}

// ---------- symbols ----------
function renderQuick() {
  const cur = state.inputs.symbol;
  const list = state.inputs.recent.includes(cur) ? state.inputs.recent : [cur, ...state.inputs.recent].slice(0, 4);
  $('symQuick').innerHTML = list.map(sym => `<button type="button" role="radio" data-value="${sym}" class="ltr">${shortSym(sym)}</button>`).join('');
  syncSegments();
}

function selectSymbol(sym, fromList = false) {
  state.inputs.symbol = sym;
  if (fromList && !state.inputs.recent.includes(sym)) state.inputs.recent = [sym, ...state.inputs.recent].slice(0, 4);
  renderQuick(); renderRates(); persistInputs(); render();
}

function commissionText(i) {
  if (!i.commRoundTurn) return t('free');
  return i.commType === 'usd' ? `$${i.commRoundTurn} ${t('perLotRT')}` : `${i.commRoundTurn}% ${t('rtShort')}`;
}

function renderSpec() {
  const i = resolveInstrument(state.inputs.symbol, state.settings);
  $('specLine').innerHTML = [
    `${t('leverage')} ${ltr(`1:${i.leverage}`)}`,
    `${t('contract')} ${ltr(`${nf(0)(i.contractSize)} ${i.unit}`)}${i.unit ? '' : ` ${t('units')}`}`,
    `${t('commission')} ${ltr(commissionText(i))}`,
    `${t('maxVol')} ${ltr(nf(2, 0)(i.maxVolume))}`,
  ].map(x => `<span>${x}</span>`).join('');
}

/** Conversion-rate inputs for currencies that can't be derived from the symbol itself. */
function renderRates() {
  const A = state.settings.currency;
  const need = conversions(resolveInstrument(state.inputs.symbol, state.settings), 1, A, {}).missing;
  state.inputs.rates ||= {};
  $('ratesBox').innerHTML = need.map(c => {
    const direct = INSTRUMENTS[c + A], inverse = INSTRUMENTS[A + c];
    const pair = direct ? c + A : inverse ? A + c : null;
    const key = pair || `${c}->${A}`;
    const label = pair ? t('rateLabel', { p: pair }) : t('rateLabelRaw', { c, a: A });
    return `<label class="field"><span class="ltr-mix">${label}</span><input data-rate="${c}" data-key="${key}" data-invert="${!direct && inverse ? 1 : 0}" inputmode="decimal" autocomplete="off" dir="ltr" value="${state.inputs.rates[key] ?? ''}"></label>`;
  }).join('') + (need.length ? `<p class="hint full">${t('rateHint')}</p>` : '');
}

let symClass = 'all';
function renderSymbolList() {
  const q = $('symSearch').value.trim().toUpperCase().replace(/[\/\s]/g, '');
  const cur = state.inputs.symbol;
  const list = SYMBOLS
    .filter(sym => (symClass === 'all' || INSTRUMENTS[sym].assetClass === symClass) && (!q || sym.toUpperCase().includes(q)))
    .sort((a, b) => ASSET_CLASSES.indexOf(INSTRUMENTS[a].assetClass) - ASSET_CLASSES.indexOf(INSTRUMENTS[b].assetClass) || a.localeCompare(b));
  $('symList').innerHTML = list.map(sym => {
    const i = resolveInstrument(sym, state.settings);
    return `<li><button type="button" data-sym="${sym}" class="${sym === cur ? 'on' : ''}"><b class="ltr">${shortSym(sym)}</b><span>${t(`cls.${i.assetClass}`)}</span><em class="ltr">1:${i.leverage}</em></button></li>`;
  }).join('');
}

function openSymbols() {
  $('symSearch').placeholder = t('search');
  $('symClasses').innerHTML = ['all', ...ASSET_CLASSES].map(c => `<button type="button" data-cls="${c}" class="${c === symClass ? 'on' : ''}">${t(`cls.${c}`)}</button>`).join('');
  $('symUpdated').textContent = t('symbolsUpdated', { d: SYMBOLS_UPDATED });
  renderSymbolList();
  $('symbolDlg').showModal();
}

// ---------- rendering ----------
function rows(el, items) {
  el.innerHTML = items.filter(Boolean).map(([k, v, cls = '']) =>
    `<div class="row ${cls}"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function pill(el, status) {
  el.className = `${el.className.replace(/\bs-\w+/g, '').trim()} s-${status}`;
  el.textContent = t(`status.${status}`);
}

function meter(label, value, max, level, marks = []) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  const ticks = marks.map(m => `<i style="inset-inline-start:${Math.min(100, (m / max) * 100)}%"></i>`).join('');
  return `<div class="meter"><div class="meter-top"><span>${label}</span><b class="ltr">${fmt.pct(value)}</b></div>
    <div class="track ltr-track">${ticks}<div class="fill l-${level}" style="width:${w}%"></div></div></div>`;
}

function render() {
  const inp = readInputs();
  const s = state.settings;
  const r = calculate(inp, s);
  const equity = inp.equity > 0 ? inp.equity : inp.balance;
  renderSpec();

  // SL distance hint
  $('slDist').innerHTML = inp.entry > 0 && inp.sl > 0
    ? `${t('sl')}: ${ltr(`${fmt.pct(Math.abs(inp.entry - inp.sl) / inp.entry * 100)} · ${fmt.price(Math.abs(inp.entry - inp.sl))}`)}` : '';

  const msgs = $('msgs');
  const hero = $('hero');
  if (!r.ok) {
    hero.classList.add('invalid');
    $('lotVal').textContent = '—';
    $('qtyVal').textContent = '';
    ['kExposure', 'kRisk', 'kMargin'].forEach(id => ($(id).textContent = '—'));
    const errs = r.validation.errors;
    const onlyMissing = errs.every(e => e === 'err.entry' || e === 'err.sl');
    msgs.innerHTML = onlyMissing ? `<li class="m-info">${t('enterTrade')}</li>`
      : errs.map(e => `<li class="m-error">${t(e)}</li>`).join('');
    $('statusPill').className = 'pill'; $('statusPill').textContent = '';
    $('resultsCard').hidden = $('fixedCard').hidden = true;
    $('dockLot').textContent = '—'; $('dockMeta').textContent = ''; $('dockPill').className = 'pill sm'; $('dockPill').textContent = '';
    renderFtmo(inp, null);
    return;
  }

  hero.classList.remove('invalid');
  $('resultsCard').hidden = $('fixedCard').hidden = false;
  const m = r.metrics;
  const base = r.instrument.unit || t('units');

  $('lotVal').textContent = fmt.lots(r.lots);
  $('qtyVal').textContent = `${fmt.qty(m.qty)} ${base} · ${fmt.money(m.notional)}`;
  $('kExposure').textContent = fmt.pct(m.exposurePct);
  $('kRisk').textContent = fmt.pct(m.riskPct);
  $('kMargin').textContent = fmt.money(m.margin);
  $('kExposure').className = `ltr l-${r.exposureLevel}`;
  pill($('statusPill'), r.status);
  msgs.innerHTML = [...new Set(r.warnings)].map(w => {
    const sev = /noMargin|insufficient|overMax|belowStep|marginAlmostAll|exposureHigh/.test(w) ? 'm-error' : /Tp$/.test(w) || /Caution/.test(w) ? 'm-info' : 'm-warn';
    return `<li class="${sev}">${t(w)}</li>`;
  }).join('');

  rows($('summaryRows'), [
    [t('netLossSl'), `<b class="ltr neg">${fmt.money(-m.netLoss)}</b> <small class="ltr">${fmt.pct(m.riskPct)}</small>`],
    [t('netProfitTp'), m.netProfit == null ? '—' : `<b class="ltr pos">${fmt.money(m.netProfit)}</b> <small class="ltr">${fmt.pct(m.rewardPct)}</small>`],
    [t('rr'), `<b class="ltr">${fmt.rr(m.rr)}</b>`],
    [t('quantity'), ltr(`${fmt.qty(m.qty)} ${base}`), 'sub'],
    [t('notional'), ltr(fmt.money(m.notional)), 'sub'],
    [t('reqMargin'), ltr(fmt.money(m.margin)), 'sub'],
    [t('marginUsed'), ltr(fmt.pct(m.marginUsedPct)), 'sub'],
    [t('freeMargin'), ltr(`${fmt.money(m.freeMargin)} · ${fmt.pct(m.freeMarginPct)}`), 'sub'],
    [t('grossLoss'), ltr(fmt.money(-m.grossLoss)), 'sub'],
    [t('commSl'), ltr(fmt.money(-m.commSl)), 'sub'],
    m.netProfit != null && [t('grossProfit'), ltr(fmt.money(m.grossProfit)), 'sub'],
    m.netProfit != null && [t('commTp'), ltr(fmt.money(-m.commTp)), 'sub'],
  ]);

  const marginLevel = m.freeMargin < 0 ? 'high' : m.marginUsedPct >= 90 ? 'high' : m.freeMarginPct < s.minFreeMarginPct ? 'warning' : 'safe';
  const riskLevel = m.riskPct > s.dailyLossPct * 0.5 ? 'high' : m.riskPct > inp.riskPct * 1.001 ? 'warning' : 'safe';
  $('meters').innerHTML =
    meter(t('risk'), m.riskPct, Math.max(s.dailyLossPct, m.riskPct), riskLevel, [inp.riskPct]) +
    meter(t('exposure'), m.exposurePct, Math.max(100, m.exposurePct), r.exposureRulesApply ? r.exposureLevel : 'info', r.exposureRulesApply ? [s.preferredExposurePct, s.maxExposurePct, s.highRiskExposurePct] : []) +
    meter(t('marginUsed'), m.marginUsedPct, Math.max(100, m.marginUsedPct), marginLevel, [100 - s.minFreeMarginPct]) +
    (r.exposureRulesApply ? '' : `<p class="hint">${t('expNotApplied')}</p>`);

  const L = r.limits;
  const lim = (key, label) => [label, `${L[key] === Infinity ? t('notApplied') : ltr(fmt.lots(L[key]))}${r.limitedBy === key ? ` <em class="tag">${t('limiting')}</em>` : ''}`, r.limitedBy === key ? 'hl' : ''];
  rows($('limitRows'), [
    lim('risk', t('limRisk')), lim('exposure', t('limExposure')), lim('margin', t('limMargin')), lim('volume', t('limVolume')),
    [t('finalSize'), `<b class="ltr">${fmt.lots(r.lots)} ${t('lot')}</b>`, 'total'],
  ]);
  $('estNote').textContent = inp.slippage > 0 ? t('estNoteSlip') : t('estNote');

  // Fixed rule reference
  const F = r.fixed;
  rows($('fixedRows'), [
    [t('fixedSize'), `${ltr(`${fmt.lots(F.lots)} · ${fmt.pct(F.metrics.exposurePct)}`)} <span class="pill sm s-${F.level}">${t(`status.${F.level}`)}</span>`],
    [t('riskSize'), ltr(fmt.lots(L.risk))],
    [t('expSize'), L.exposure === Infinity ? t('notApplied') : ltr(fmt.lots(L.exposure))],
    r.desired && [`${t('desiredLots')} (${ltr(fmt.pct(r.desired.pct))})`, ltr(`${fmt.lots(r.desired.lots)} · ${t('risk')} ${fmt.pct(r.desired.metrics.riskPct)}`)],
    [t('recSize'), `<b class="ltr">${fmt.lots(r.lots)}</b>`, 'total'],
  ]);
  const fm = F.metrics;
  $('fixedWarn').innerHTML = F.level === 'safe' ? '' :
    `${ltr(`${fmt.lots(F.lots)} = ${fmt.qty(fm.qty)} ${base}`)} — ${t('margin')} ${ltr(`${fmt.money(fm.margin)} (${fmt.pct(fm.marginUsedPct)})`)} · ${t('risk')} ${ltr(fmt.pct(fm.riskPct))}${fm.marginUsedPct >= 90 ? `<br><b>${t('warn.marginAlmostAll')}</b>` : ''}`;
  $('fixedWarn').className = `fixed-warn s-${F.level}`;

  // Dock
  $('dockLot').textContent = `${fmt.lots(r.lots)} ${t('lot')}`;
  $('dockMeta').textContent = `${fmt.pct(m.exposurePct)} · ${fmt.money(-m.netLoss)}`;
  pill($('dockPill'), r.status);

  renderFtmo(inp, r, equity);
}

function renderFtmo(inp, r) {
  const f = ftmoLimits({
    initial: inp.initial, balance: inp.balance, equity: inp.equity, dailyStart: inp.dailyStart,
    openPL: inp.openPL, commissions: inp.commissions, swaps: inp.swaps,
    tradeNetLoss: r ? r.metrics.netLoss : 0,
  }, state.settings);
  $('dailyStart').placeholder = Number.isFinite(inp.balance) ? String(inp.balance) : '';
  if (!f.ok) {
    $('ftmoRows').innerHTML = '';
    $('ftmoMsg').textContent = t('ftmoNeedInitial');
    $('ftmoPill').className = 'pill sm'; $('ftmoPill').textContent = '';
    return;
  }
  rows($('ftmoRows'), [
    [t('equityForLimits'), ltr(fmt.money(f.equity)), 'sub'],
    [`${t('maxDaily')} (${ltr(fmt.pct(state.settings.dailyLossPct))})`, ltr(fmt.money(f.maxDailyLoss))],
    [t('dailyFloor'), ltr(fmt.money(f.dailyFloor)), 'sub'],
    [t('dailyRoom'), `<b class="ltr ${f.dailyRoom <= 0 ? 'neg' : ''}">${fmt.money(f.dailyRoom)}</b>`],
    [`${t('maxLoss')} (${ltr(fmt.pct(state.settings.maxLossPct))})`, ltr(fmt.money(f.maxLoss))],
    [t('maxFloor'), ltr(fmt.money(f.maxLossFloor)), 'sub'],
    [t('maxRoom'), `<b class="ltr ${f.maxRoom <= 0 ? 'neg' : ''}">${fmt.money(f.maxRoom)}</b>`],
    r && [t('roomAfterSl'), `<b class="ltr ${f.roomAfterSl <= 0 ? 'neg' : ''}">${fmt.money(f.roomAfterSl)}</b>`, 'total'],
  ]);
  let status = 'safe';
  if (f.dailyBreached || f.maxBreached || (r && !f.tradeFits)) status = 'notExecutable';
  else if (f.tradeUsesPctOfRoom > 50) status = 'warning';
  else if (f.tradeUsesPctOfRoom > 25) status = 'caution';
  pill($('ftmoPill'), status);
  $('ftmoMsg').innerHTML = !r ? '' : !f.tradeFits ? t('tradeBreaksLimit')
    : t('tradeUses', { p: ltr(fmt.pct(f.tradeUsesPctOfRoom).replace('%', '')) });
}

function renderRules() {
  const R = FTMO_2STEP_RULES;
  rows($('rulesRows'), [
    [t('p1'), ltr(`${R.phase1TargetPct}%`)], [t('p2'), ltr(`${R.phase2TargetPct}%`)],
    [t('maxDaily'), ltr(`${R.maxDailyLossPct}%`)], [t('maxLoss'), ltr(`${R.maxLossPct}%`)],
    [t('minDays'), ltr(R.minTradingDays)], [t('period'), t('unlimited')],
  ]);
}

function renderDays() {
  const n = state.tradingDays.length;
  $('daysCount').textContent = `${n} / ${FTMO_2STEP_RULES.minTradingDays}`;
  $('daysCount').classList.toggle('done', n >= FTMO_2STEP_RULES.minTradingDays);
}

function renderSettings() {
  const s = state.settings;
  const num = (key, label) => `<label class="field"><span>${t(label)}</span><input data-setting="${key}" inputmode="decimal" dir="ltr" value="${s[key]}"></label>`;
  const sel = (key, label, opts) => `<label class="field"><span>${t(label)}</span><select data-setting="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  $('settingsBody').innerHTML =
    SETTINGS_SCHEMA.map(([g, items]) => `<h3 class="mini-title">${t(g)}</h3><div class="fields two">${items.map(([k, l]) => num(k, l)).join('')}</div>`).join('') +
    `<h3 class="mini-title">${t('sGroupApp')}</h3><div class="fields two">` +
    sel('accountType', 'sAccountType', [['swing', t('swing')], ['standard', t('standard')]]) +
    sel('capLeveraged', 'sCapLev', [['false', t('no')], ['true', t('yes')]]) +
    sel('currency', 'sCurrency', ['USD', 'EUR', 'GBP', 'CZK', 'CAD', 'AUD', 'CHF'].map(c => [c, c])) +
    sel('theme', 'sTheme', [['system', t('system')], ['dark', t('dark')], ['light', t('light')]]) +
    sel('lang', 'sLang', [['ar', 'العربية'], ['en', 'English']]) + '</div>';
}

function applyLang() {
  t = makeT(state.settings.lang);
  const ar = state.settings.lang === 'ar';
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => (el.textContent = t(el.dataset.i18n)));
  $('langBtn').textContent = ar ? 'EN' : 'ع';
  $('offline').textContent = navigator.serviceWorker?.controller ? t('offlineReady') : '';
  renderRules(); renderDays();
}

function applyTheme() {
  const th = state.settings.theme;
  if (th === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = th;
}

function refreshAll() { applyTheme(); applyLang(); render(); }

// ---------- events ----------
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    if (el.tagName === 'SELECT') state.settings[k] = k === 'capLeveraged' ? el.value === 'true' : el.value;
    else { const v = parseNum(el.value); if (Number.isFinite(v) && v >= 0) state.settings[k] = v; else return; }
    save(state);
    if (k === 'lang') { refreshAll(); renderSettings(); } else if (k === 'theme') applyTheme(); else { if (k === 'currency' || k === 'accountType') renderRates(); render(); }
    return;
  }
  if (el.dataset.rate) {
    state.inputs.rates[el.dataset.key] = el.value; save(state); render();
    return;
  }
  if (el.id === 'symSearch') { renderSymbolList(); return; }
  if (NUM_FIELDS.includes(el.id)) {
    if (el.id === 'riskPct') syncSegments();
    persistInputs(); render();
  }
});

document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (seg.dataset.field === 'symbol') return selectSymbol(b.dataset.value);
  state.inputs[seg.dataset.field] = b.dataset.value;
  syncSegments(); persistInputs(); render();
}));

$('riskChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('riskPct').value = b.dataset.risk; syncSegments(); persistInputs(); render();
});

// Enter / "next" on the keyboard moves to the next numeric field
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.closest('main')) return;
  const all = [...document.querySelectorAll('main input')].filter(i => i.offsetParent);
  const i = all.indexOf(e.target);
  e.preventDefault();
  (all[i + 1] || e.target).focus();
  if (!all[i + 1]) e.target.blur();
});

// Select-all on focus for fast overwrite
document.addEventListener('focusin', e => { if (e.target.matches('input[inputmode]')) setTimeout(() => e.target.select(), 0); });

$('langBtn').addEventListener('click', () => {
  state.settings.lang = state.settings.lang === 'ar' ? 'en' : 'ar'; save(state); refreshAll();
});
$('symAllBtn').addEventListener('click', openSymbols);
$('symClose').addEventListener('click', () => $('symbolDlg').close());
$('symbolDlg').addEventListener('click', e => { if (e.target === $('symbolDlg')) $('symbolDlg').close(); });
$('symClasses').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  symClass = b.dataset.cls;
  $('symClasses').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  renderSymbolList();
});
$('symList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  selectSymbol(b.dataset.sym, true);
  $('symbolDlg').close();
});
$('settingsBtn').addEventListener('click', () => { renderSettings(); $('settingsDlg').showModal(); });
$('settingsDlg').addEventListener('click', e => { if (e.target === $('settingsDlg')) $('settingsDlg').close(); });
$('resetSettings').addEventListener('click', () => {
  const { lang, theme } = state.settings;
  state.settings = { ...DEFAULT_SETTINGS, lang, theme }; save(state); renderSettings(); renderRates(); refreshAll();
});
$('dayMark').addEventListener('click', () => { state.tradingDays.push(new Date().toISOString()); save(state); renderDays(); });
$('dayReset').addEventListener('click', () => { state.tradingDays = []; save(state); renderDays(); });

// Dock appears when the hero result scrolls out of view (phones)
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([en]) => $('dock').classList.toggle('show', !en.isIntersecting && en.boundingClientRect.top < 0))
    .observe($('hero'));
}
$('dock').addEventListener('click', () => $('hero').scrollIntoView({ behavior: 'smooth', block: 'center' }));

// ---------- boot ----------
hydrate();
refreshAll();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)
    .then(() => { $('offline').textContent = t('offlineReady'); }).catch(() => {});
}
