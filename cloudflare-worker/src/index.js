/**
 * index.js — Cloudflare Worker entry point
 *
 * Receives TradingView webhook → validates secret → routes to handler
 *
 * Expected payload:
 * {
 *   "action":  "BUY" | "SELL" | "TP_EXIT" | "TP_EXIT_SHORT" | "TSL" | "TSL_SHORT",
 *   "symbol":  "SOL_USDT",
 *   "qty":     0.53,           // SOL contracts (required for opens, optional for closes)
 *   "price":   88.12,          // current bar close price
 *   "secret":  "your-secret"   // must match WEBHOOK_SECRET env var
 * }
 */

import { handleBuy, handleSell, handleTpExit, handleTpsExit, handleTsl, handleTslShort } from './handlers.js';

const HANDLERS = {
  BUY:           handleBuy,
  SELL:          handleSell,
  TP_EXIT:       handleTpExit,
  TP_EXIT_SHORT: handleTpsExit,
  TSL:           handleTsl,
  TSL_SHORT:     handleTslShort,
};

export default {
  async fetch(request, env) {
    // Only accept POST to /webhook
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not found', { status: 404 });
    }

    // Parse body
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    // Validate secret — accept from URL ?token= param OR payload body
    const urlToken = url.searchParams.get('token');
    const bodyToken = payload.secret;
    if (!env.WEBHOOK_SECRET || (urlToken !== env.WEBHOOK_SECRET && bodyToken !== env.WEBHOOK_SECRET)) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    // Route by action
    const action  = (payload.action ?? '').toUpperCase();
    const handler = HANDLERS[action];
    if (!handler) {
      return json({ ok: false, error: `Unknown action: ${action}` }, 400);
    }

    // Default symbol from env if not in payload
    payload.symbol = payload.symbol ?? env.SYMBOL;

    // Execute handler
    try {
      const result = await handler(env, payload);
      return json({ ok: true, action, dry_run: env.DRY_RUN === 'true', ...result });
    } catch (err) {
      console.error('Handler error:', err);
      return json({ ok: false, error: err.message }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
