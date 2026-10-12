// LocalStorage persistence. Every access is guarded: private mode / blocked
// storage must never break the calculator.
import { DEFAULT_SETTINGS } from '../engine/config.js';

const KEY = 'ftmo-risk-calc:v1';

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      inputs: raw.inputs || {},
      tradingDays: Array.isArray(raw.tradingDays) ? raw.tradingDays : [],
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, inputs: {}, tradingDays: [] };
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}
