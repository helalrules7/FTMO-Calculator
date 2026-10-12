// Default, user-configurable settings and FTMO 2-Step rule reference.

export const DEFAULT_SETTINGS = Object.freeze({
  accountType: 'swing',      // swing | standard — selects per-symbol leverage
  riskPct: 1.0,
  // Exposure thresholds (notional / equity). Applied to unleveraged (1:1)
  // symbols — crypto & stocks on Swing. Leveraged symbols are governed by margin
  // unless capLeveraged is on.
  preferredExposurePct: 25,  // 0–25 healthy
  maxExposurePct: 30,        // hard cap used for sizing; 25–30 caution
  highRiskExposurePct: 40,   // 30–40 warning, 40+ high risk
  capLeveraged: false,
  minFreeMarginPct: 20,      // keep at least this % of equity free
  volumeStep: 0.01,
  dailyLossPct: 5,
  maxLossPct: 10,
  currency: 'USD',
  theme: 'system',           // system | dark | light
  lang: 'ar',                // ar | en
});

export const FTMO_2STEP_RULES = Object.freeze({
  phase1TargetPct: 10,
  phase2TargetPct: 5,
  maxDailyLossPct: 5,
  maxLossPct: 10,
  minTradingDays: 4,
  tradingPeriod: 'unlimited',
});

/** Old reference rule: 0.01 lot per $1,000 of balance. */
export const FIXED_RULE_LOTS_PER_1000 = 0.01;
