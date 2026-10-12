// FTMO 2-Step loss-limit dashboard. Actual dollar thresholds, not vague %.
import { round } from './decimal.js';
import { DEFAULT_SETTINGS } from './config.js';

const num = v => (Number.isFinite(v) ? v : 0);

/**
 * input: { initial, balance, equity, dailyStart, openPL, commissions, swaps, tradeNetLoss }
 * Equity for limits: if open P/L / swaps / commissions are given, derive it from balance;
 * otherwise use the equity entered on the Account card.
 */
export function ftmoLimits(input, userSettings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...userSettings };
  const initial = input.initial;
  if (!(initial > 0)) return { ok: false };

  const balance = input.balance > 0 ? input.balance : initial;
  const hasFloating = [input.openPL, input.commissions, input.swaps].some(Number.isFinite);
  const equity = hasFloating
    ? balance + num(input.openPL) + num(input.swaps) - Math.abs(num(input.commissions))
    : (input.equity > 0 ? input.equity : balance);
  const dailyStart = input.dailyStart > 0 ? input.dailyStart : balance;

  const maxDailyLoss = initial * s.dailyLossPct / 100;
  const dailyFloor = dailyStart - maxDailyLoss;
  const maxLoss = initial * s.maxLossPct / 100;
  const maxLossFloor = initial - maxLoss;

  const dailyRoom = equity - dailyFloor;
  const maxRoom = equity - maxLossFloor;
  const tradeLoss = num(input.tradeNetLoss);
  const room = Math.min(dailyRoom, maxRoom);

  return {
    ok: true,
    equity: round(equity, 2),
    maxDailyLoss: round(maxDailyLoss, 2),
    dailyFloor: round(dailyFloor, 2),
    dailyRoom: round(dailyRoom, 2),
    maxLoss: round(maxLoss, 2),
    maxLossFloor: round(maxLossFloor, 2),
    maxRoom: round(maxRoom, 2),
    roomAfterSl: round(room - tradeLoss, 2),
    dailyBreached: dailyRoom <= 0,
    maxBreached: maxRoom <= 0,
    tradeFits: tradeLoss < room,
    tradeUsesPctOfRoom: room > 0 ? round((tradeLoss / room) * 100, 2) : null,
  };
}
