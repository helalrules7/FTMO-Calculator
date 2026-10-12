// Input validation. Returns i18n message codes; the UI translates them.
// errors block the calculation, warnings are shown alongside results.

const pos = v => Number.isFinite(v) && v > 0;

export function validateTrade(input) {
  const errors = [];
  const warnings = [];
  const { equity, riskPct, direction, entry, sl, tp } = input;

  if (!pos(equity)) errors.push('err.equity');
  if (!pos(riskPct)) errors.push('err.risk');
  else if (riskPct > 5) warnings.push('warn.riskHigh');
  if (!pos(entry)) errors.push('err.entry');
  if (!pos(sl)) errors.push('err.sl');

  if (pos(entry) && pos(sl)) {
    if (sl === entry) errors.push('err.slEqualsEntry');
    else if (direction === 'long' && sl > entry) errors.push('err.longSl');
    else if (direction === 'short' && sl < entry) errors.push('err.shortSl');
  }

  let tpValid = false;
  if (Number.isFinite(tp) && tp > 0 && pos(entry)) {
    if (direction === 'long' && tp <= entry) warnings.push('warn.longTp');
    else if (direction === 'short' && tp >= entry) warnings.push('warn.shortTp');
    else tpValid = true;
  }

  return { ok: errors.length === 0, errors, warnings, tpValid };
}
