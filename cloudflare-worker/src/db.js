/**
 * db.js — D1 trade log helpers
 */

/**
 * Record a new open trade (BUY or SELL).
 * Returns the inserted row id.
 */
export async function openTrade(env, { action, symbol, qty, entry_price, mexc_order_id, status }) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO trades (action, symbol, qty, entry_price, mexc_order_id, status, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(action, symbol, qty, entry_price, mexc_order_id ?? null, status, now)
    .run();
  return result.meta.last_row_id;
}

/**
 * Mark the most-recent open long/short as closed.
 * direction: 'BUY' (long) | 'SELL' (short)
 */
export async function closeMostRecent(env, { symbol, direction, exit_price, mexc_order_id, status, error_msg }) {
  const now = new Date().toISOString();
  const action = direction === 'BUY' ? 'BUY' : 'SELL';

  const row = await env.DB.prepare(
    `SELECT id FROM trades
     WHERE action = ? AND symbol = ? AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`
  )
    .bind(action, symbol)
    .first();

  if (!row) return null;

  await env.DB.prepare(
    `UPDATE trades
     SET exit_price = ?, mexc_order_id = ?, status = ?, error_msg = ?, closed_at = ?
     WHERE id = ?`
  )
    .bind(exit_price ?? null, mexc_order_id ?? null, status, error_msg ?? null, now, row.id)
    .run();

  return row.id;
}

/**
 * Get the qty of the most-recent open long or short.
 * Used to determine how many contracts to close on TP / TSL exit.
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
