// Pure trading calculation engine. No DOM, no storage.
// All monetary outputs are in the ACCOUNT currency.
import { round, floorToStep } from './decimal.js';
import { resolveInstrument } from './instruments.js';
import { DEFAULT_SETTINGS, FIXED_RULE_LOTS_PER_1000 } from './config.js';
import { validateTrade } from './validate.js';

const sideSign = direction => (direction === 'short' ? -1 : 1);

/**
 * Conversion factors into the account currency.
 * rates: user-supplied { CCY: value } meaning 1 CCY = value ACCOUNT_CCY.
 * A rate is derived automatically when the instrument itself is CCY/ACCOUNT or ACCOUNT/CCY.
 */
export function conversions(instrument, entry, account, rates = {}) {
  const missing = [];
  const pairBase = instrument.calc === 'forex' ? instrument.marginCcy : null;
  const rateTo = ccy => {
    if (ccy === account) return 1;
    if (pairBase === ccy && instrument.profitCcy === account) return entry;
    if (pairBase === account && instrument.profitCcy === ccy) return 1 / entry;
    if (rates[ccy] > 0) return rates[ccy];
    if (!missing.includes(ccy)) missing.push(ccy);
    return NaN;
  };
  const q2a = rateTo(instrument.profitCcy);
  // Forex margin is in the base currency: 1 base = entry quote.
  const m2a = instrument.calc === 'forex' ? entry * q2a : rateTo(instrument.marginCcy);
  const usd2a = instrument.commissionUsdPerLot > 0 ? rateTo('USD') : 1;
  return { q2a, m2a, usd2a, missing };
}

/** Commission (account ccy) per 1 unit of quantity for ONE side at `price`. */
function commissionPerUnit(instrument, price, conv) {
  if (instrument.commissionUsdPerLot > 0) return (instrument.commissionUsdPerLot * conv.usd2a) / instrument.contractSize;
  return price * instrument.commissionRate * conv.q2a;
}

/**
 * Estimated net loss (account ccy) per 1 unit of quantity if SL is hit:
 * adverse move + slippage + entry commission + exit commission (at SL).
 */
export function lossPerUnit({ instrument, entry, sl, slippage = 0, conv }) {
  return (Math.abs(entry - sl) + slippage) * conv.q2a
    + commissionPerUnit(instrument, entry, conv) + commissionPerUnit(instrument, sl, conv);
}

/** Margin (account ccy) required for 1.00 lot. */
export function marginPerLot(instrument, entry, conv) {
  const perLot = instrument.calc === 'forex' ? instrument.contractSize * conv.m2a : instrument.contractSize * entry * conv.m2a;
  return perLot / instrument.leverage;
}

/** Full metrics for a given lot size. */
export function positionMetrics({ instrument, conv, direction, entry, sl, tp, lots, equity, existingMargin = 0, slippage = 0, tpValid = true }) {
  const s = sideSign(direction);
  const qty = lots * instrument.contractSize;
  const notional = qty * entry * conv.q2a;
  const margin = lots * marginPerLot(instrument, entry, conv);
  const totalMargin = existingMargin + margin;
  const freeMargin = equity - totalMargin;

  const commEntry = qty * commissionPerUnit(instrument, entry, conv);
  const commSl = commEntry + qty * commissionPerUnit(instrument, sl, conv);
  const grossLoss = (-(s * (sl - entry)) + slippage) * qty * conv.q2a;
  const netLoss = grossLoss + commSl;

  let grossProfit = null, commTp = null, netProfit = null, rr = null, rewardPct = null;
  if (tpValid && Number.isFinite(tp) && tp > 0) {
    grossProfit = s * (tp - entry) * qty * conv.q2a;
    commTp = commEntry + qty * commissionPerUnit(instrument, tp, conv);
    netProfit = grossProfit - commTp;
    rewardPct = (netProfit / equity) * 100;
    rr = netLoss > 0 ? netProfit / netLoss : null;
  }

  return {
    lots: round(lots, 2),
    qty: round(qty, 6),
    notional: round(notional, 2),
    margin: round(margin, 2),
    exposurePct: round((notional / equity) * 100, 2),
    marginUsedPct: round((totalMargin / equity) * 100, 2),
    freeMargin: round(freeMargin, 2),
    freeMarginPct: round((freeMargin / equity) * 100, 2),
    commEntry: round(commEntry, 2),
    grossLoss: round(grossLoss, 2),
    commSl: round(commSl, 2),
    netLoss: round(netLoss, 2),
    riskPct: round((netLoss / equity) * 100, 2),
    grossProfit: grossProfit === null ? null : round(grossProfit, 2),
    commTp: commTp === null ? null : round(commTp, 2),
    netProfit: netProfit === null ? null : round(netProfit, 2),
    rewardPct: rewardPct === null ? null : round(rewardPct, 2),
    rr: rr === null ? null : round(rr, 2),
  };
}

/** Old reference rule: 0.01 lot per $1,000 balance  ==  balance / 100,000. */
export function fixedRuleLots(balance, step = DEFAULT_SETTINGS.volumeStep) {
  return floorToStep((balance / 1000) * FIXED_RULE_LOTS_PER_1000, step);
}

/** Exposure classification against configurable thresholds. */
export function exposureLevel(exposurePct, settings) {
  if (exposurePct > settings.highRiskExposurePct) return 'high';
  if (exposurePct > settings.maxExposurePct) return 'warning';
  if (exposurePct > settings.preferredExposurePct) return 'caution';
  return 'safe';
}

/** Exposure rules apply to unleveraged (1:1) symbols, or to all when capLeveraged is on. */
export const exposureRulesApply = (instrument, settings) => instrument.leverage <= 1 || !!settings.capLeveraged;

/**
 * Main entry point. Computes each independent maximum, picks the smallest,
 * and reports why the size was limited plus safety status.
 *
 * input: { symbol, direction, balance, equity, existingMargin, riskPct, entry, sl, tp,
 *          desiredExposurePct?, slippage?, rates? }
 */
export function calculate(input, userSettings = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...userSettings };
  const equity = Number.isFinite(input.equity) && input.equity > 0 ? input.equity : input.balance;
  const balance = Number.isFinite(input.balance) && input.balance > 0 ? input.balance : equity;
  const existingMargin = Number.isFinite(input.existingMargin) && input.existingMargin > 0 ? input.existingMargin : 0;
  const slippage = Number.isFinite(input.slippage) && input.slippage > 0 ? input.slippage : 0;
  const riskPct = Number.isFinite(input.riskPct) ? input.riskPct : settings.riskPct;
  const trade = { ...input, equity, balance, riskPct };

  const validation = validateTrade(trade);
  if (!validation.ok) return { ok: false, validation };

  const instrument = resolveInstrument(input.symbol, settings);
  const { entry, sl, tp, direction } = input;
  const conv = conversions(instrument, entry, settings.currency, input.rates);
  if (conv.missing.length) {
    return { ok: false, instrument, missingRates: conv.missing, validation: { ...validation, ok: false, errors: ['err.rate'] } };
  }

  const { contractSize, maxVolume } = instrument;
  const step = settings.volumeStep;
  const lotNotional = contractSize * entry * conv.q2a;
  const rulesApply = exposureRulesApply(instrument, settings);

  // 1) Risk: net loss at SL (incl. commission + slippage) ≈ target risk
  const targetRisk = equity * riskPct / 100;
  const perUnit = lossPerUnit({ instrument, entry, sl, slippage, conv });
  const riskQty = targetRisk / perUnit;
  const riskLots = floorToStep(riskQty / contractSize, step);

  // 2) Max exposure (only where exposure rules apply)
  const exposureLots = rulesApply ? floorToStep((equity * settings.maxExposurePct / 100) / lotNotional, step) : Infinity;

  // 3) Margin incl. minimum free-margin buffer
  const marginBudget = equity * (1 - settings.minFreeMarginPct / 100) - existingMargin;
  const marginLots = marginBudget > 0 ? floorToStep(marginBudget / marginPerLot(instrument, entry, conv), step) : 0;

  // 4) FTMO max volume per trade
  const volumeLots = floorToStep(maxVolume, step);

  const limits = { risk: riskLots, exposure: exposureLots, margin: marginLots, volume: volumeLots };
  const order = ['risk', 'exposure', 'margin', 'volume'];
  const limitedBy = order.reduce((a, k) => (limits[k] < limits[a] ? k : a), 'risk');
  const lots = limits[limitedBy];
  const executable = lots >= step;

  const common = { instrument, conv, direction, entry, sl, tp, equity, existingMargin, slippage, tpValid: validation.tpValid };
  const metrics = positionMetrics({ ...common, lots });

  // Reference sizes
  const fixedLots = fixedRuleLots(balance, step);
  const fixed = { lots: fixedLots, metrics: positionMetrics({ ...common, lots: fixedLots }) };
  fixed.level = assess(fixed.metrics, fixedLots, settings, instrument).status;

  let desired = null;
  if (Number.isFinite(input.desiredExposurePct) && input.desiredExposurePct > 0) {
    const dLots = floorToStep((equity * input.desiredExposurePct / 100) / lotNotional, step);
    desired = { pct: input.desiredExposurePct, lots: dLots, metrics: positionMetrics({ ...common, lots: dLots }) };
  }

  const { status, warnings } = assess(metrics, lots, settings, instrument);
  if (!executable) warnings.unshift(limitedBy === 'margin' ? 'warn.noMargin' : 'warn.belowStep');

  return {
    ok: true,
    validation,
    settings,
    instrument,
    conv,
    exposureRulesApply: rulesApply,
    targetRisk: round(targetRisk, 2),
    rawRiskQty: round(riskQty, 6),
    perUnitLoss: round(perUnit, 6),
    limits,
    limitedBy,
    lots,
    executable,
    metrics,
    exposureLevel: rulesApply ? exposureLevel(metrics.exposurePct, settings) : 'safe',
    status: executable ? status : 'notExecutable',
    warnings: [...validation.warnings, ...warnings],
    fixed,
    desired,
  };
}

/** Safety assessment for a given position (used for recommended and reference sizes). */
export function assess(m, lots, settings, instrument) {
  const warnings = [];
  let rank = 0; // 0 safe, 1 caution, 2 warning, 3 notExecutable
  const bump = r => { rank = Math.max(rank, r); };

  if (lots > instrument.maxVolume) { warnings.push('warn.overMaxVolume'); bump(3); }
  if (m.freeMargin < 0) { warnings.push('warn.insufficientMargin'); bump(3); }
  else if (m.marginUsedPct >= 90) { warnings.push('warn.marginAlmostAll'); bump(2); }
  else if (m.freeMarginPct < settings.minFreeMarginPct) { warnings.push('warn.lowFreeMargin'); bump(2); }

  if (exposureRulesApply(instrument, settings)) {
    const lvl = exposureLevel(m.exposurePct, settings);
    if (lvl === 'high') { warnings.push('warn.exposureHigh'); bump(2); }
    else if (lvl === 'warning') { warnings.push('warn.exposureWarning'); bump(2); }
    else if (lvl === 'caution') { warnings.push('warn.exposureCaution'); bump(1); }
  }

  const status = ['safe', 'caution', 'warning', 'notExecutable'][rank];
  return { status, warnings };
}
