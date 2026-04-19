/**
 * db.js — D1 trade log helpers
 */

/**
 * Record a new open trade (BUY or SELL).
 * Returns the inserted row id.
 */
export async function openTrade(env, { action, symbol, qty, vol, entry_price, entry_time, mexc_order_id, position_id, status, error_msg }) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO trades (action, symbol, qty, vol, entry_price, entry_time, mexc_order_id, position_id, status, error_msg, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(action, symbol, qty, vol ?? null, entry_price, entry_time ?? null, mexc_order_id ?? null, position_id ?? null, status, error_msg ?? null, now)
    .run();
  return result.meta.last_row_id;
}

/**
 * Mark the most-recent open long/short as closed.
 * direction: 'BUY' (long) | 'SELL' (short)
 */
export async function closeMostRecent(env, { symbol, direction, entry_time, exit_price, mexc_order_id, status, error_msg, close_reason }) {
  const now = new Date().toISOString();
  const action = direction === 'BUY' ? 'BUY' : 'SELL';

  let row;
  if (entry_time) {
    // Match by entry_time (exact trade identification)
    row = await env.DB.prepare(
      `SELECT id FROM trades
       WHERE action = ? AND symbol = ? AND status = 'open' AND entry_time = ?
       LIMIT 1`
    ).bind(action, symbol, String(entry_time)).first();
  }
  if (!row) {
    // Fallback: LIFO (most recent open)
    row = await env.DB.prepare(
      `SELECT id FROM trades
       WHERE action = ? AND symbol = ? AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`
    ).bind(action, symbol).first();
  }

  if (!row) return null;

  await env.DB.prepare(
    `UPDATE trades
     SET exit_price = ?, mexc_order_id = ?, status = ?, error_msg = ?, close_reason = ?, closed_at = ?
     WHERE id = ?`
  )
    .bind(exit_price ?? null, mexc_order_id ?? null, status, error_msg ?? null, close_reason ?? null, now, row.id)
    .run();

  return row.id;
}

/**
 * Get the qty of the most-recent open long or short.
 */
export async function getMostRecentQty(env, { symbol, direction }) {
  const action = direction === 'BUY' ? 'BUY' : 'SELL';
  const row = await env.DB.prepare(
    `SELECT qty FROM trades
     WHERE action = ? AND symbol = ? AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`
  )
    .bind(action, symbol)
    .first();
  return row ? row.qty : null;
}

/**
 * Get vol + position_id of the open trade matching entry_time, or LIFO fallback.
 * Used to close the exact number of contracts we opened.
 */
export async function getMostRecentOpenTrade(env, { symbol, direction, entry_time }) {
  const action = direction === 'BUY' ? 'BUY' : 'SELL';
  let row;
  if (entry_time) {
    row = await env.DB.prepare(
      `SELECT id, vol, position_id FROM trades
       WHERE action = ? AND symbol = ? AND status = 'open' AND entry_time = ?
       LIMIT 1`
    ).bind(action, symbol, String(entry_time)).first();
  }
  if (!row) {
    row = await env.DB.prepare(
      `SELECT id, vol, position_id FROM trades
       WHERE action = ? AND symbol = ? AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`
    ).bind(action, symbol).first();
  }
  return row ? { tradeId: row.id, vol: row.vol, positionId: row.position_id } : null;
}
