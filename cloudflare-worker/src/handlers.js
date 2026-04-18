/**
 * handlers.js — One handler per TradingView signal action
 *
 * All handlers:
 *   - In DRY_RUN mode: log the intended order to D1, never call MEXC
 *   - In live mode: submit order to MEXC, log result to D1
 */

import { submitOrder } from './mexc.js';
import { openTrade, closeMostRecent, getMostRecentQty } from './db.js';

const DRY = env => env.DRY_RUN === 'true';

// ─── BUY — Open Long ────────────────────────────────────────────────────────
export async function handleBuy(env, payload) {
  const { symbol, qty, price } = payload;
  const lev = parseInt(env.LEVERAGE);

  if (DRY(env)) {
    await openTrade(env, { action: 'BUY', symbol, qty, entry_price: price, status: 'dry_run' });
    return { ok: true, dry_run: true, order: { symbol, qty, side: 1, price } };
  }

  const order = await submitOrder(env, {
    symbol,
    price: 0,          // market order
    vol: qty,
    leverage: lev,
    side: 1,           // Open Long
    type: 5,           // Market order (MEXC uses type 5 for market)
    openType: 2,       // Cross margin
  });

  const status    = order.success ? 'open' : 'error';
  const orderId   = order.success ? String(order.data) : null;
  const errorMsg  = order.success ? null : JSON.stringify(order);

  await openTrade(env, {
    action: 'BUY', symbol, qty, entry_price: price,
    mexc_order_id: orderId, status,
    ...(errorMsg && { error_msg: errorMsg }),
  });

  return { ok: order.success, order };
}

// ─── SELL — Open Short ───────────────────────────────────────────────────────
export async function handleSell(env, payload) {
  const { symbol, qty, price } = payload;
  const lev = parseInt(env.LEVERAGE);

  if (DRY(env)) {
    await openTrade(env, { action: 'SELL', symbol, qty, entry_price: price, status: 'dry_run' });
    return { ok: true, dry_run: true, order: { symbol, qty, side: 3, price } };
  }

  const order = await submitOrder(env, {
    symbol,
    price: 0,
    vol: qty,
    leverage: lev,
    side: 3,           // Open Short
    type: 5,
    openType: 2,
  });

  const status   = order.success ? 'open' : 'error';
  const orderId  = order.success ? String(order.data) : null;
  const errorMsg = order.success ? null : JSON.stringify(order);

  await openTrade(env, {
    action: 'SELL', symbol, qty, entry_price: price,
    mexc_order_id: orderId, status,
    ...(errorMsg && { error_msg: errorMsg }),
  });

  return { ok: order.success, order };
}

// ─── TP_EXIT — Close most recent Long ───────────────────────────────────────
export async function handleTpExit(env, payload) {
  const { symbol, price } = payload;
  const lev = parseInt(env.LEVERAGE);

  // Qty: use from payload if provided, else look up from D1
  const qty = payload.qty ?? await getMostRecentQty(env, { symbol, direction: 'BUY' });
  if (!qty) return { ok: false, error: 'No open long found in trade log' };

  if (DRY(env)) {
    await closeMostRecent(env, { symbol, direction: 'BUY', exit_price: price, status: 'dry_run' });
    return { ok: true, dry_run: true, order: { symbol, qty, side: 2, price } };
  }

  const order = await submitOrder(env, {
    symbol,
    price: 0,
    vol: qty,
    leverage: lev,
    side: 2,           // Close Long
    type: 5,
    openType: 2,
    positionType: 1,   // Hedge mode: specify long position
  });

  const status   = order.success ? 'closed' : 'error';
  const orderId  = order.success ? String(order.data) : null;
  const errorMsg = order.success ? null : JSON.stringify(order);

  await closeMostRecent(env, {
    symbol, direction: 'BUY', exit_price: price,
    mexc_order_id: orderId, status,
    ...(errorMsg && { error_msg: errorMsg }),
  });

  return { ok: order.success, order };
}

// ─── TP_EXIT_SHORT — Close most recent Short ─────────────────────────────────
export async function handleTpsExit(env, payload) {
  const { symbol, price } = payload;
  const lev = parseInt(env.LEVERAGE);

  const qty = payload.qty ?? await getMostRecentQty(env, { symbol, direction: 'SELL' });
  if (!qty) return { ok: false, error: 'No open short found in trade log' };

  if (DRY(env)) {
    await closeMostRecent(env, { symbol, direction: 'SELL', exit_price: price, status: 'dry_run' });
    return { ok: true, dry_run: true, order: { symbol, qty, side: 4, price } };
  }

  const order = await submitOrder(env, {
    symbol,
    price: 0,
    vol: qty,
    leverage: lev,
    side: 4,           // Close Short
    type: 5,
    openType: 2,
    positionType: 2,   // Hedge mode: specify short position
  });

  const status   = order.success ? 'closed' : 'error';
  const orderId  = order.success ? String(order.data) : null;
  const errorMsg = order.success ? null : JSON.stringify(order);

  await closeMostRecent(env, {
    symbol, direction: 'SELL', exit_price: price,
    mexc_order_id: orderId, status,
    ...(errorMsg && { error_msg: errorMsg }),
  });

  return { ok: order.success, order };
}

// ─── TSL — Trailing stop closed a Long ──────────────────────────────────────
export async function handleTsl(env, payload) {
  // Same as TP_EXIT but action label is TSL
  const result = await handleTpExit(env, payload);
  // Relabel in D1 (already closed above; just return result)
  return result;
}

// ─── TSL_SHORT — Trailing stop closed a Short ────────────────────────────────
export async function handleTslShort(env, payload) {
  return handleTpsExit(env, payload);
}
