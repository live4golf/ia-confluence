/**
 * handlers.js — One handler per TradingView signal action
 *
 * All handlers:
 *   - In DRY_RUN mode: log the intended order to D1, never call MEXC
 *   - In live mode: submit order to MEXC, log result to D1
 */

import { submitOrder, getOpenPositions, getOrderDeals } from './mexc.js';
import { openTrade, closeMostRecent, getMostRecentOpenTrade } from './db.js';

const DRY = env => env.DRY_RUN === 'true';

// ─── BUY — Open Long ────────────────────────────────────────────────────────
export async function handleBuy(env, payload) {
  const { symbol, qty, price, entry_time } = payload;
  console.log('[BUY] RECEIVED:', JSON.stringify({ symbol, qty, price, entry_time }));
  const lev          = parseInt(env.LEVERAGE);
  const contractSize = parseFloat(env.CONTRACT_SIZE || '0.1');
  const vol          = Math.max(1, Math.round(qty / (price * contractSize)));
  console.log('[BUY] vol:', vol, 'lev:', lev, 'contractSize:', contractSize);

  // Dedup: reject if same entry_time already processed, or if a BUY was opened in last 60s
  if (entry_time) {
    const dup = await env.DB.prepare(
      `SELECT id FROM trades WHERE entry_time = ? AND action = 'BUY' AND symbol = ? LIMIT 1`
    ).bind(String(entry_time), symbol).first();
    if (dup) {
      console.log('[BUY] DEDUP: entry_time', entry_time, 'already exists as trade', dup.id);
      return { ok: false, error: 'Duplicate signal (entry_time)', existing_id: dup.id };
    }
    console.log('[BUY] entry_time dedup passed (no match for', String(entry_time), ')');
  }
  const recent = await env.DB.prepare(
    `SELECT id, opened_at FROM trades WHERE action = 'BUY' AND symbol = ? AND status = 'open'
     AND opened_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds') LIMIT 1`
  ).bind(symbol).first();
  if (recent) {
    console.log('[BUY] DEDUP: recent BUY', recent.id, 'opened at', recent.opened_at);
    return { ok: false, error: 'Duplicate signal (cooldown)', existing_id: recent.id };
  }
  console.log('[BUY] cooldown dedup passed');

  if (DRY(env)) {
    console.log('[BUY] DRY RUN');
    await openTrade(env, { action: 'BUY', symbol, qty, entry_price: price, status: 'dry_run' });
    return { ok: true, dry_run: true, order: { symbol, qty, side: 1, price } };
  }

  console.log('[BUY] Submitting order to MEXC...');
  const order = await submitOrder(env, {
    symbol,
    price: 0,          // market order
    vol,
    leverage: lev,
    side: 1,           // Open Long
    type: 5,           // Market order
    openType: 1,       // Isolated margin
  });
  console.log('[BUY] MEXC response:', JSON.stringify(order));

  const status    = order.success ? 'open' : 'error';
  const orderId   = order.success ? String(order.data) : null;
  const errorMsg  = order.success ? null : JSON.stringify(order);

  // Record trade immediately (no position ID yet — fast response to avoid TV timeout)
  const tradeId = await openTrade(env, {
    action: 'BUY', symbol, qty, vol, entry_price: price, entry_time: entry_time ?? String(Date.now()),
    mexc_order_id: orderId, position_id: null, status,
    ...(errorMsg && { error_msg: errorMsg }),
  });
  console.log('[BUY] Trade recorded in D1, tradeId:', tradeId, 'status:', status);

  // Fetch position ID and actual fill price in background (after response is sent)
  if (order.success && env._ctx) {
    env._ctx.waitUntil((async () => {
      try {
        await new Promise(r => setTimeout(r, 2000));
        // Fetch actual fill price from order deals
        const deals = await getOrderDeals(env, String(order.data));
        console.log('[BUY] deals:', JSON.stringify(deals));
        if (deals.length > 0) {
          const totalVol = deals.reduce((s, d) => s + (d.vol || 0), 0);
          const avgFill = totalVol > 0
            ? deals.reduce((s, d) => s + (d.price || 0) * (d.vol || 0), 0) / totalVol
            : null;
          if (avgFill && tradeId) {
            await env.DB.prepare(`UPDATE trades SET entry_price = ? WHERE id = ?`)
              .bind(avgFill, tradeId).run();
            console.log('[BUY] updated trade', tradeId, 'with fill price', avgFill);
          }
        }
        // Fetch position ID
        const positions = await getOpenPositions(env, symbol);
        console.log('[BUY] background positions:', JSON.stringify(positions));
        const pos = positions.find(p => p.positionType === 1 || p.direction === 1);
        if (pos && tradeId) {
          await env.DB.prepare(`UPDATE trades SET position_id = ? WHERE id = ?`)
            .bind(String(pos.positionId), tradeId).run();
          console.log('[BUY] updated trade', tradeId, 'with positionId', pos.positionId);
        }
      } catch (e) { console.error('[BUY] background fetch error:', e); }
    })());
  }

  return { ok: order.success, action: 'BUY', vol, order };
}

// ─── SELL — Open Short ───────────────────────────────────────────────────────
export async function handleSell(env, payload) {
  const { symbol, qty, price, entry_time } = payload;
  const lev          = parseInt(env.LEVERAGE);
  const contractSize = parseFloat(env.CONTRACT_SIZE || '0.1');
  const vol          = Math.max(1, Math.round(qty / (price * contractSize)));

  // Dedup: reject if same entry_time already processed, or if a SELL was opened in last 60s
  if (entry_time) {
    const dup = await env.DB.prepare(
      `SELECT id FROM trades WHERE entry_time = ? AND action = 'SELL' AND symbol = ? LIMIT 1`
    ).bind(String(entry_time), symbol).first();
    if (dup) {
      console.log('[SELL] DEDUP: entry_time', entry_time, 'already exists as trade', dup.id);
      return { ok: false, error: 'Duplicate signal (entry_time)', existing_id: dup.id };
    }
  }
  const recent = await env.DB.prepare(
    `SELECT id, opened_at FROM trades WHERE action = 'SELL' AND symbol = ? AND status = 'open'
     AND opened_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds') LIMIT 1`
  ).bind(symbol).first();
  if (recent) {
    console.log('[SELL] DEDUP: recent SELL', recent.id, 'opened at', recent.opened_at);
    return { ok: false, error: 'Duplicate signal (cooldown)', existing_id: recent.id };
  }

  if (DRY(env)) {
    await openTrade(env, { action: 'SELL', symbol, qty, entry_price: price, status: 'dry_run' });
    return { ok: true, dry_run: true, order: { symbol, qty, side: 3, price } };
  }

  const order = await submitOrder(env, {
    symbol,
    price: 0,
    vol,
    leverage: lev,
    side: 3,           // Open Short
    type: 5,
    openType: 1,       // Isolated margin
  });

  const status   = order.success ? 'open' : 'error';
  const orderId  = order.success ? String(order.data) : null;
  const errorMsg = order.success ? null : JSON.stringify(order);

  // Record trade immediately (no position ID yet — fast response to avoid TV timeout)
  const tradeId = await openTrade(env, {
    action: 'SELL', symbol, qty, vol, entry_price: price, entry_time: entry_time ?? String(Date.now()),
    mexc_order_id: orderId, position_id: null, status,
    ...(errorMsg && { error_msg: errorMsg }),
  });

  // Fetch position ID and actual fill price in background (after response is sent)
  if (order.success && env._ctx) {
    env._ctx.waitUntil((async () => {
      try {
        await new Promise(r => setTimeout(r, 2000));
        // Fetch actual fill price from order deals
        const deals = await getOrderDeals(env, String(order.data));
        console.log('[SELL] deals:', JSON.stringify(deals));
        if (deals.length > 0) {
          const totalVol = deals.reduce((s, d) => s + (d.vol || 0), 0);
          const avgFill = totalVol > 0
            ? deals.reduce((s, d) => s + (d.price || 0) * (d.vol || 0), 0) / totalVol
            : null;
          if (avgFill && tradeId) {
            await env.DB.prepare(`UPDATE trades SET entry_price = ? WHERE id = ?`)
              .bind(avgFill, tradeId).run();
            console.log('[SELL] updated trade', tradeId, 'with fill price', avgFill);
          }
        }
        // Fetch position ID
        const positions = await getOpenPositions(env, symbol);
        const pos = positions.find(p => p.positionType === 2);
        if (pos && tradeId) {
          await env.DB.prepare(`UPDATE trades SET position_id = ? WHERE id = ?`)
            .bind(String(pos.positionId), tradeId).run();
          console.log('[SELL] updated trade', tradeId, 'with positionId', pos.positionId);
        }
      } catch (e) { console.error('[SELL] background fetch error:', e); }
    })());
  }

  return { ok: order.success, action: 'SELL', vol, order };
}

// ─── TP_EXIT — Close most recent Long (LIFO) ─────────────────────────────────
export async function handleTpExit(env, payload) {
  const { symbol, price, entry_time } = payload;

  // Get vol from D1 (LIFO — most recent open BUY)
  const trade = await getMostRecentOpenTrade(env, { symbol, direction: 'BUY', entry_time });
  if (!trade) return { ok: false, error: 'No matching open long in trade log' };

  if (DRY(env)) {
    await closeMostRecent(env, { symbol, direction: 'BUY', entry_time, exit_price: price, status: 'dry_run', close_reason: 'TP_EXIT' });
    return { ok: true, dry_run: true, order: { symbol, vol: trade.vol, side: 4, price } };
  }

  // Also need positionId from MEXC for isolated margin
  const positions = await getOpenPositions(env, symbol);
  const pos = positions.find(p => p.positionType === 1);
  const positionId = pos ? pos.positionId : (trade.positionId ? parseInt(trade.positionId) : undefined);

  console.log('[TP_EXIT] LIFO close vol:', trade.vol, 'positionId:', positionId);

  const orderParams = {
    symbol, price: 0, vol: trade.vol,
    leverage: pos?.leverage ?? parseInt(env.LEVERAGE),
    side: 4, type: 5, openType: 1,
  };
  if (positionId) orderParams.positionId = positionId;

  const order = await submitOrder(env, orderParams);

  const status   = order.success ? 'closed' : 'error';
  const orderId  = order.success ? String(order.data) : null;
  const errorMsg = order.success ? null : JSON.stringify(order);

  await closeMostRecent(env, {
    symbol, direction: 'BUY', entry_time, exit_price: price,
    mexc_order_id: orderId, status, close_reason: 'TP_EXIT',
    ...(errorMsg && { error_msg: errorMsg }),
  });

  return { ok: order.success, action: 'TP_EXIT', vol: trade.vol, order };
}

// ─── TP_EXIT_SHORT — Close most recent Short (LIFO) ───────────────────────────
export async function handleTpsExit(env, payload) {
  const { symbol, price, entry_time } = payload;

  const trade = await getMostRecentOpenTrade(env, { symbol, direction: 'SELL', entry_time });
  if (!trade) return { ok: false, error: 'No matching open short in trade log' };

  if (DRY(env)) {
    await closeMostRecent(env, { symbol, direction: 'SELL', entry_time, exit_price: price, status: 'dry_run', close_reason: 'TP_EXIT_SHORT' });
    return { ok: true, dry_run: true, order: { symbol, vol: trade.vol, side: 2, price } };
  }

  const positions = await getOpenPositions(env, symbol);
  const pos = positions.find(p => p.positionType === 2);
  const positionId = pos ? pos.positionId : (trade.positionId ? parseInt(trade.positionId) : undefined);

  console.log('[TP_EXIT_SHORT] LIFO close vol:', trade.vol, 'positionId:', positionId);

  const orderParams = {
    symbol, price: 0, vol: trade.vol,
    leverage: pos?.leverage ?? parseInt(env.LEVERAGE),
    side: 2, type: 5, openType: 1,
  };
  if (positionId) orderParams.positionId = positionId;

  const order = await submitOrder(env, orderParams);

  const status   = order.success ? 'closed' : 'error';
  const orderId  = order.success ? String(order.data) : null;
  const errorMsg = order.success ? null : JSON.stringify(order);

  await closeMostRecent(env, {
    symbol, direction: 'SELL', entry_time, exit_price: price,
    mexc_order_id: orderId, status, close_reason: 'TP_EXIT_SHORT',
    ...(errorMsg && { error_msg: errorMsg }),
  });

  return { ok: order.success, action: 'TP_EXIT_SHORT', vol: trade.vol, order };
}

// ─── TSL — Trailing stop closed a Long ────────────────────────────────────
export async function handleTsl(env, payload) {
  const result = await handleTpExit(env, payload);
  // Overwrite close_reason to TSL
  if (result.ok) {
    const trade = await getMostRecentOpenTrade(env, { symbol: payload.symbol, direction: 'BUY' });
    // Already closed by handleTpExit — update the most recently closed row's reason
    await env.DB.prepare(`UPDATE trades SET close_reason = 'TSL' WHERE action = 'BUY' AND symbol = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`)
      .bind(payload.symbol).run();
  }
  return result;
}

// ─── TSL_SHORT — Trailing stop closed a Short ──────────────────────────────
export async function handleTslShort(env, payload) {
  const result = await handleTpsExit(env, payload);
  if (result.ok) {
    await env.DB.prepare(`UPDATE trades SET close_reason = 'TSL_SHORT' WHERE action = 'SELL' AND symbol = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`)
      .bind(payload.symbol).run();
  }
  return result;
}
