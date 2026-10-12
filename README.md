# FTMO Risk Calculator

A mobile-first, risk-first position-size calculator for FTMO accounts. It is an installable PWA: no backend, works offline, Arabic (RTL) and English.

**Live:** https://api.ahmedhelal.dev

> **Not affiliated with FTMO.** Symbol specifications come from FTMO's public symbols list and can change. Always confirm them in your platform's *Specification* window. All P/L figures are estimates before spread and swaps. Nothing here guarantees execution or rule compliance.

## What it does

You enter your balance, risk %, symbol, direction, entry, stop loss and take profit. The app returns:

- **Recommended size.** This is the smallest of four limits:
  1. **Risk:** net loss at SL, including commission and optional slippage, is at or below your target.
  2. **Exposure:** a notional cap (25 / 30 / 40 % by default). It applies to 1:1 symbols.
  3. **Margin:** the position must fit while keeping a minimum free-margin buffer.
  4. **FTMO max volume:** the per-symbol limit.

  The app shows which of the four limited the size.
- **Exposure, margin used and free margin.** The app warns when a position consumes almost all margin. Example: 1 BTC lot on a $100K Swing account.
- **Net loss at SL, net profit at TP and R:R.** Commission is charged on entry notional plus exit notional.
- **FTMO safety panel.** Daily-loss and max-loss floors in dollars, plus the room left if the SL is hit.
- **Your old 0.01 lot per $1K rule,** shown as a reference only.

### Supported symbols

The app covers all 166 active FTMO symbols: crypto, forex, exotics, metals, indices, commodities and stocks. Each symbol has its own contract size, Swing/Standard leverage, commission model and max volume.

If a symbol's P/L currency differs from your account currency, the app asks for a conversion rate. It works this out on its own when the symbol is itself the pair, for example USDJPY.

## Run locally

```bash
npm start      # static server on http://localhost:5173
npm test       # engine unit tests (node --test, no dependencies)
```

There is no build step and there are no runtime dependencies.

## Refresh FTMO specs

```bash
node scripts/update-symbols.mjs
```

This regenerates `src/engine/symbols.data.js` from `https://ftmo.com/wp-json/ftmo/symbols`.

## Project structure

```
src/engine/   pure calculation engine (no DOM). It is tested in tests/
  calc.js         sizing, conversions, P/L, safety assessment
  ftmo.js         daily / max loss limits
  instruments.js  symbol specs and account-type leverage
  validate.js     long/short SL/TP validation
  decimal.js      rounding, lot-step flooring, Arabic-digit parsing
src/ui/       rendering, i18n (ar/en), localStorage persistence
sw.js         offline service worker
deploy/       self-hosting: rsync deploy script, nginx config, Hestia include
```

## Self-hosting

1. Run `cp deploy/.env.example deploy/.env` and fill in the host, user, SSH key and web root.
2. Serve the folder over **HTTPS**. Installing the PWA requires it. Use `deploy/nginx.conf` with plain nginx, or `deploy/hestia-nginx.ssl.conf_pwa` with HestiaCP.
3. Run `./deploy/deploy.sh`. It runs the tests, builds `dist/`, stamps the service-worker version and rsyncs the result over SSH.

When the site sits behind a CDN, `sw.js` and `src/` must not be edge-cached for long.

## License

The code is released under the [MIT](LICENSE) license. The Changa font is released under the [SIL OFL 1.1](fonts/OFL.txt).
