// Instrument specifications, generated from FTMO's official symbols list
// (see scripts/update-symbols.mjs). The engine is generic over these fields.
import { SYMBOL_ROWS, SYMBOLS_UPDATED } from './symbols.data.js';

export { SYMBOLS_UPDATED };
export const ASSET_CLASSES = ['crypto', 'forex', 'metals', 'cash', 'stocks', 'exotic'];

function toSpec([symbol, assetClass, contractSize, marginCcy, profitCcy, calc, commType, commRoundTurn, levSwing, levStandard, maxVolume, digits]) {
  const unit = assetClass === 'crypto' ? symbol.replace(/USD$/, '')
    : calc === 'forex' ? marginCcy
    : assetClass === 'metals' ? symbol.slice(0, 3)
    : '';
  return { symbol, assetClass, contractSize, marginCcy, profitCcy, calc, commType, commRoundTurn, levSwing, levStandard, maxVolume, digits, unit };
}

export const INSTRUMENTS = Object.fromEntries(SYMBOL_ROWS.map(r => [r[0], toSpec(r)]));
export const SYMBOLS = Object.keys(INSTRUMENTS);

/** Spec with account-type leverage and per-side commission resolved. */
export function resolveInstrument(symbol, settings = {}) {
  const base = INSTRUMENTS[symbol];
  if (!base) throw new Error(`Unknown instrument: ${symbol}`);
  const leverage = settings.accountType === 'standard' ? base.levStandard : base.levSwing;
  return {
    ...base,
    leverage,
    // FTMO publishes round-turn commission; we charge half on entry and half on exit.
    commissionRate: base.commType === 'pct' ? base.commRoundTurn / 100 / 2 : 0, // fraction of notional per side
    commissionUsdPerLot: base.commType === 'usd' ? base.commRoundTurn / 2 : 0,    // USD per lot per side
  };
}
