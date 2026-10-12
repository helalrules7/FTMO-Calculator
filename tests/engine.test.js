import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, exposureLevel, fixedRuleLots, lossPerUnit, positionMetrics, conversions } from '../src/engine/calc.js';
import { resolveInstrument, INSTRUMENTS } from '../src/engine/instruments.js';
import { ftmoLimits } from '../src/engine/ftmo.js';
import { round, floorToStep, parseNum } from '../src/engine/decimal.js';

const base = { balance: 100000, equity: 100000, riskPct: 1, direction: 'long' };
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('decimal helpers', () => {
  assert.equal(round(0.1 + 0.2, 2), 0.3);
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(floorToStep(0.1974, 0.01), 0.19);
  assert.equal(floorToStep(0.3, 0.01), 0.3); // no 0.29 float artefact
  assert.equal(parseNum('100,000.5'), 100000.5);
  assert.equal(parseNum('١٠٠٠٠٠'), 100000);
  assert.ok(Number.isNaN(parseNum('abc')));
});

test('BTC: $100K, BTC=$100K, 1% risk, SL 5% away', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 100000, sl: 95000, tp: 110000 });
  assert.ok(r.ok);
  assert.equal(r.instrument.contractSize, 1);
  assert.equal(r.targetRisk, 1000);
  // per-unit: 5000 move + 0.0325% × (100000 + 95000) commission = 5063.375
  assert.equal(r.perUnitLoss, 5063.375);
  close(r.rawRiskQty, 1000 / 5063.375, 1e-6);
  assert.equal(r.lots, 0.19);
  assert.equal(r.limitedBy, 'risk');
  const m = r.metrics;
  assert.equal(m.qty, 0.19);
  assert.equal(m.notional, 19000);
  assert.equal(m.exposurePct, 19);
  assert.equal(m.margin, 19000);           // 1:1 leverage
  assert.equal(m.marginUsedPct, 19);
  assert.equal(m.freeMargin, 81000);
  assert.equal(m.commEntry, 6.18);         // 19000 × 0.000325 = 6.175
  assert.equal(m.commSl, 12.04);           // + 18050 × 0.000325
  assert.equal(m.grossLoss, 950);
  assert.equal(m.netLoss, 962.04);
  assert.ok(m.netLoss <= r.targetRisk);
  assert.equal(m.riskPct, 0.96);
  assert.equal(m.grossProfit, 1900);
  assert.equal(m.commTp, 12.97);
  assert.equal(m.netProfit, 1887.03);
  assert.equal(m.rr, 1.96);
  assert.equal(r.status, 'safe');
});

test('ETH: $100K, ETH=$4,000, 1% risk, SL 5% away', () => {
  const r = calculate({ ...base, symbol: 'ETHUSD', entry: 4000, sl: 3800, tp: 4400 });
  assert.ok(r.ok);
  assert.equal(r.instrument.contractSize, 10);
  assert.equal(r.perUnitLoss, 202.535);
  close(r.rawRiskQty, 1000 / 202.535, 1e-6); // ≈ 4.937 ETH
  assert.equal(r.lots, 0.49);
  assert.equal(r.metrics.qty, 4.9);
  assert.equal(r.metrics.notional, 19600);
  assert.equal(r.metrics.margin, 19600);
  assert.equal(r.metrics.exposurePct, 19.6);
  assert.ok(r.metrics.netLoss <= 1000);
});

test('same lots → different exposure for BTC vs ETH', () => {
  const mk = (sym, entry, sl) => {
    const instrument = resolveInstrument(sym);
    return positionMetrics({ instrument, conv: conversions(instrument, entry, 'USD'), direction: 'long', lots: 1, equity: 100000, entry, sl });
  };
  const btc = mk('BTCUSD', 100000, 95000);
  const eth = mk('ETHUSD', 4000, 3800);
  assert.equal(btc.qty, 1);
  assert.equal(eth.qty, 10);
  assert.equal(btc.notional, 100000);
  assert.equal(eth.notional, 40000);
});

test('long valid SL/TP', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 60000, sl: 58000, tp: 66000 });
  assert.ok(r.ok);
  assert.ok(r.validation.tpValid);
  assert.ok(r.metrics.netProfit > 0);
});

test('short valid SL/TP', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', direction: 'short', entry: 100000, sl: 105000, tp: 90000 });
  assert.ok(r.ok);
  assert.ok(r.validation.tpValid);
  assert.equal(r.perUnitLoss, 5000 + 0.000325 * 205000);
  assert.equal(r.metrics.grossLoss, round(r.lots * 5000, 2));
  assert.equal(r.metrics.grossProfit, round(r.lots * 10000, 2));
  assert.ok(r.metrics.netLoss <= 1000);
});

test('invalid long: SL above entry', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 100000, sl: 101000 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.validation.errors, ['err.longSl']);
});

test('invalid short: SL below entry', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', direction: 'short', entry: 100000, sl: 99000 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.validation.errors, ['err.shortSl']);
});

test('TP on wrong side → warning, TP metrics hidden', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 100000, sl: 95000, tp: 99000 });
  assert.ok(r.ok);
  assert.ok(r.warnings.includes('warn.longTp'));
  assert.equal(r.metrics.netProfit, null);
});

test('exposure cap limits position', () => {
  // SL 1% away → risk allows ~0.93 lot (93% exposure); max exposure 30% → 0.30
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 100000, sl: 99000 });
  assert.ok(r.limits.risk > 0.9);
  assert.equal(r.limits.exposure, 0.3);
  assert.equal(r.limitedBy, 'exposure');
  assert.equal(r.lots, 0.3);
  assert.equal(r.metrics.exposurePct, 30);
});

test('margin cap with existing margin + free-margin buffer', () => {
  const r = calculate(
    { ...base, symbol: 'BTCUSD', entry: 100000, sl: 99500, existingMargin: 50000 },
    { maxExposurePct: 200 },
  );
  // budget = 100000 × 80% − 50000 = 30000 → 0.30 lot
  assert.equal(r.limits.margin, 0.3);
  assert.equal(r.limitedBy, 'margin');
  assert.equal(r.lots, 0.3);
  assert.equal(r.metrics.freeMargin, 20000);
});

test('no margin available → not executable', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 100000, sl: 95000, existingMargin: 85000 });
  assert.equal(r.lots, 0);
  assert.equal(r.executable, false);
  assert.equal(r.status, 'notExecutable');
});

test('FTMO max volume caps at 5 lots', () => {
  const r = calculate(
    { balance: 1e6, equity: 1e6, riskPct: 1, direction: 'long', symbol: 'ETHUSD', entry: 100, sl: 99 },
    { maxExposurePct: 1000, minFreeMarginPct: 0 },
  );
  assert.equal(r.limits.volume, INSTRUMENTS.ETHUSD.maxVolume);
  assert.equal(r.limitedBy, 'volume');
  assert.equal(r.lots, 5);
});

test('fixed rule: 0.01 lot per $1K', () => {
  assert.equal(fixedRuleLots(100000), 1);
  assert.equal(fixedRuleLots(50000), 0.5);
  assert.equal(fixedRuleLots(25000), 0.25);
  assert.equal(fixedRuleLots(10000), 0.1);
  assert.equal(fixedRuleLots(150000), 1.5);
  assert.equal(fixedRuleLots(200000), 2);
});

test('critical: fixed rule 1 lot BTC on $100K consumes ~all margin', () => {
  const r = calculate({ ...base, symbol: 'BTCUSD', entry: 100000, sl: 95000, tp: 110000 });
  assert.equal(r.fixed.lots, 1);
  assert.equal(r.fixed.metrics.margin, 100000);
  assert.equal(r.fixed.metrics.marginUsedPct, 100);
  assert.equal(r.fixed.metrics.freeMargin, 0);
  assert.notEqual(r.fixed.level, 'safe');
  assert.ok(r.fixed.lots < INSTRUMENTS.BTCUSD.maxVolume); // allowed by FTMO volume, still unsafe
  assert.ok(r.lots < r.fixed.lots);
});

test('exposure thresholds (configurable)', () => {
  const s = { preferredExposurePct: 25, maxExposurePct: 30, highRiskExposurePct: 40 };
  assert.equal(exposureLevel(25, s), 'safe');
  assert.equal(exposureLevel(27, s), 'caution');
  assert.equal(exposureLevel(35, s), 'warning');
  assert.equal(exposureLevel(41, s), 'high');
  assert.equal(exposureLevel(35, { ...s, maxExposurePct: 50, highRiskExposurePct: 60 }), 'caution');
});

test('commission uses entry + exit notional, not flat 0.065%', () => {
  const instrument = resolveInstrument('BTCUSD');
  assert.equal(instrument.commissionRate, 0.000325); // FTMO 0.065% round turn → 0.0325% per side
  const lpu = lossPerUnit({ instrument, entry: 100000, sl: 95000, conv: conversions(instrument, 100000, 'USD') });
  assert.notEqual(lpu, 5000 + 100000 * 0.00065);
  assert.equal(round(lpu, 6), 5063.375);
});

test('Swing leverage from FTMO data', () => {
  assert.equal(resolveInstrument('BTCUSD').leverage, 1);
  assert.equal(resolveInstrument('EURUSD').leverage, 30);
  assert.equal(resolveInstrument('XAUUSD').leverage, 15);
  assert.equal(resolveInstrument('US100.cash').leverage, 15);
  assert.equal(resolveInstrument('AAPL').leverage, 1);
  assert.equal(resolveInstrument('BTCUSD', { accountType: 'standard' }).leverage, INSTRUMENTS.BTCUSD.levStandard);
});

test('EURUSD: flat $5/lot round-turn, 1:30 margin, no exposure cap', () => {
  const r = calculate({ ...base, symbol: 'EURUSD', entry: 1.1, sl: 1.095, tp: 1.11 });
  assert.ok(r.ok);
  assert.equal(r.instrument.contractSize, 100000);
  assert.equal(r.perUnitLoss, 0.00505); // 0.005 move + 2 × $2.5/100000
  assert.equal(r.lots, 1.98);
  assert.equal(r.limits.exposure, Infinity);
  assert.equal(r.limitedBy, 'risk');
  assert.equal(r.metrics.margin, 7260);    // 1.98 × 100000 × 1.1 / 30
  assert.equal(r.metrics.commSl, 9.9);     // 1.98 × $5
  assert.equal(r.metrics.netLoss, 999.9);
});

test('USDJPY: JPY P/L converted with 1/price automatically', () => {
  const r = calculate({ ...base, symbol: 'USDJPY', entry: 150, sl: 149 });
  assert.ok(r.ok);
  close(r.conv.q2a, 1 / 150, 1e-12);
  assert.equal(r.lots, 1.48);
  assert.equal(r.metrics.margin, 4933.33); // 1.48 × 100000 USD / 30
  assert.ok(r.metrics.netLoss <= 1000 && r.metrics.netLoss > 990);
});

test('GER40: needs EUR rate, then converts', () => {
  const miss = calculate({ ...base, symbol: 'GER40.cash', entry: 20000, sl: 19900 });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.missingRates, ['EUR']);
  const r = calculate({ ...base, symbol: 'GER40.cash', entry: 20000, sl: 19900, rates: { EUR: 1.1 } });
  assert.ok(r.ok);
  assert.equal(r.perUnitLoss, 110);        // 100 pts × 1.10, zero commission
  assert.equal(r.lots, 9.09);
  assert.equal(r.metrics.margin, 13332);   // 9.09 × 20000 × 1.1 / 15
});

test('XAUUSD: 100 oz contract, 0.0007% per side', () => {
  const r = calculate({ ...base, symbol: 'XAUUSD', entry: 2500, sl: 2475 });
  assert.equal(r.perUnitLoss, 25.034825);
  assert.equal(r.lots, 0.39);
  assert.equal(r.metrics.qty, 39);
  assert.equal(r.metrics.margin, 6500);    // 0.39 × 100 × 2500 / 15
});

test('per-symbol FTMO max volume (DOGEUSD = 1 lot)', () => {
  const r = calculate({ ...base, balance: 1e7, equity: 1e7, symbol: 'DOGEUSD', entry: 0.2, sl: 0.199 }, { maxExposurePct: 1000, minFreeMarginPct: 0 });
  assert.equal(r.limits.volume, 1);
  assert.equal(r.lots, 1);
});

test('FTMO limits in dollars', () => {
  const f = ftmoLimits({ initial: 100000, balance: 101000, dailyStart: 101000, openPL: -1500, commissions: 20, swaps: -5, tradeNetLoss: 962.04 });
  assert.equal(f.maxDailyLoss, 5000);
  assert.equal(f.dailyFloor, 96000);
  assert.equal(f.maxLoss, 10000);
  assert.equal(f.maxLossFloor, 90000);
  assert.equal(f.equity, 99475);
  assert.equal(f.dailyRoom, 3475);
  assert.equal(f.maxRoom, 9475);
  assert.equal(f.roomAfterSl, 2512.96);
  assert.ok(f.tradeFits);
});
