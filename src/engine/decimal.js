// Decimal-safe helpers. All money/lot math rounds through these to avoid
// visible float artefacts (e.g. 0.1 + 0.2). Uses exponent-shift rounding,
// which is exact for the precision ranges used in this app.

export function round(x, dp = 2) {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const v = Math.round(Number(`${Math.abs(x)}e${dp}`));
  return sign * Number(`${v}e-${dp}`);
}

export function decimalsOf(step) {
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/** Floor a lot size to the nearest lower multiple of `step` (never rounds up risk). */
export function floorToStep(value, step) {
  if (!Number.isFinite(value) || value <= 0 || !(step > 0)) return 0;
  const steps = Math.floor(round(value / step, 9));
  return round(steps * step, decimalsOf(step));
}

/** Parse user input: accepts Arabic-Indic digits, Arabic decimal separator and thousands commas. */
export function parseNum(raw) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (!s) return NaN;
  s = s
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')      // Arabic decimal separator
    .replace(/[,٬\s]/g, ''); // thousands separators
  if (!/^-?\d*\.?\d+$|^-?\d+\.?$/.test(s)) return NaN;
  return Number(s);
}
