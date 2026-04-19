/**
 * status.js — Trade status dashboard
 *
 * Serves a nicely formatted HTML page showing:
 *   - Open positions with live MEXC P&L
 *   - Closed trade history with P&L
 *   - Summary stats (win rate, total P&L, etc.)
 */

import { getOpenPositions } from './mexc.js';

// Fetch current market price from MEXC public ticker (no auth needed)
async function fetchTickerPrice(env, symbol) {
  const res = await fetch(`${env.MEXC_BASE}/api/v1/contract/ticker?symbol=${symbol}`);
  const json = await res.json();
  if (json.success && json.data) {
    return parseFloat(json.data.lastPrice ?? json.data.last ?? json.data.fairPrice ?? 0);
  }
  return null;
}

export async function handleStatus(env, url) {
  const symbol = env.SYMBOL || 'SOL_USDT';

  // Fetch D1 trades, MEXC positions, and current ticker price in parallel
  const [openTrades, closedTrades, mexcPositions, tickerPrice] = await Promise.all([
    env.DB.prepare(`SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC`).all(),
    env.DB.prepare(`SELECT * FROM trades WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 50`).all(),
    getOpenPositions(env, symbol).catch(() => []),
    fetchTickerPrice(env, symbol).catch(() => null),
  ]);

  const open = openTrades.results || [];
  const closed = closedTrades.results || [];

  // Match MEXC positions to D1 trades for live P&L
  const enrichedOpen = open.map(trade => {
    const mexcPos = mexcPositions.find(p =>
      (trade.action === 'BUY' && p.positionType === 1) ||
      (trade.action === 'SELL' && p.positionType === 2)
    );

    const entryPrice = trade.entry_price;
    const currentPrice = tickerPrice;
    const lev = mexcPos?.leverage ?? (parseInt(env.LEVERAGE) || 3);
    const holdVol = mexcPos?.holdVol ?? trade.vol ?? 1;
    const contractSize = parseFloat(env.CONTRACT_SIZE || '0.1');

    // Calculate unrealised P&L
    let unrealisedPnl = null;
    let unrealisedPct = null;
    if (currentPrice && entryPrice) {
      unrealisedPnl = trade.action === 'BUY'
        ? (currentPrice - entryPrice) * holdVol * contractSize
        : (entryPrice - currentPrice) * holdVol * contractSize;
      unrealisedPnl = Math.round(unrealisedPnl * 100) / 100;
      unrealisedPct = trade.action === 'BUY'
        ? ((currentPrice - entryPrice) / entryPrice) * 100 * lev
        : ((entryPrice - currentPrice) / entryPrice) * 100 * lev;
      unrealisedPct = Math.round(unrealisedPct * 100) / 100;
    }

    return {
      ...trade,
      mexc_entry: mexcPos?.holdAvgPrice ?? null,
      current_price: currentPrice,
      unrealised_pnl: unrealisedPnl,
      unrealised_pct: unrealisedPct,
      liquidation_price: mexcPos?.liquidatePrice ?? null,
      leverage: lev,
      hold_vol: holdVol,
    };
  });

  // Calculate closed trade P&L
  const closedWithPnl = closed.map(trade => {
    if (!trade.entry_price || !trade.exit_price) return { ...trade, pnl: null, pnl_pct: null };
    const lev = parseInt(env.LEVERAGE) || 3;
    const pnl = trade.action === 'BUY'
      ? (trade.exit_price - trade.entry_price) * (trade.qty || 0)
      : (trade.entry_price - trade.exit_price) * (trade.qty || 0);
    const pnl_pct = trade.action === 'BUY'
      ? ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100 * lev
      : ((trade.entry_price - trade.exit_price) / trade.entry_price) * 100 * lev;
    return { ...trade, pnl: Math.round(pnl * 100) / 100, pnl_pct: Math.round(pnl_pct * 100) / 100 };
  });

  // Summary stats
  const wins = closedWithPnl.filter(t => t.pnl > 0).length;
  const losses = closedWithPnl.filter(t => t.pnl !== null && t.pnl <= 0).length;
  const realisedPnl = closedWithPnl.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const unrealisedTotal = enrichedOpen.reduce((sum, t) => sum + (t.unrealised_pnl || 0), 0);
  const totalPnl = realisedPnl + unrealisedTotal;
  const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const html = renderPage({ enrichedOpen, closedWithPnl, wins, losses, realisedPnl, unrealisedTotal, totalPnl, winRate, symbol });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function renderPage({ enrichedOpen, closedWithPnl, wins, losses, realisedPnl, unrealisedTotal, totalPnl, winRate, symbol }) {
  const pnlColor = v => v > 0 ? '#00E676' : v < 0 ? '#FF1744' : '#aaa';
  const fmt = v => v !== null && v !== undefined ? v.toFixed(2) : '—';
  const fmtDate = d => d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  const openRows = enrichedOpen.map(t => {
    const pnlText = t.unrealised_pnl !== null
      ? `${t.unrealised_pnl > 0 ? '+' : ''}${fmt(t.unrealised_pnl)} USDT (${t.unrealised_pct > 0 ? '+' : ''}${t.unrealised_pct}%)`
      : 'no price';
    return `
    <tr>
      <td>${t.id}</td>
      <td class="${t.action === 'BUY' ? 'long' : 'short'}">${t.action === 'BUY' ? '▲ LONG' : '▼ SHORT'}</td>
      <td>${fmt(t.entry_price)}</td>
      <td>${fmt(t.current_price)}</td>
      <td style="color:${pnlColor(t.unrealised_pnl)}">${pnlText}</td>
      <td>${t.leverage}x</td>
      <td>${fmtDate(t.opened_at)}</td>
      <td>${t.mexc_order_id ? '✓' : '—'}</td>
    </tr>`;
  }).join('');

  const closedRows = closedWithPnl.map(t => `
    <tr>
      <td>${t.id}</td>
      <td class="${t.action === 'BUY' ? 'long' : 'short'}">${t.action === 'BUY' ? '▲ LONG' : '▼ SHORT'}</td>
      <td>${fmt(t.entry_price)}</td>
      <td>${fmt(t.exit_price)}</td>
      <td style="color:${pnlColor(t.pnl)}">${t.pnl !== null ? (t.pnl > 0 ? '+' : '') + fmt(t.pnl) + ' USDT' : '—'}</td>
      <td style="color:${pnlColor(t.pnl_pct)}">${t.pnl_pct !== null ? (t.pnl_pct > 0 ? '+' : '') + t.pnl_pct + '%' : '—'}</td>
      <td>${t.close_reason || '—'}</td>
      <td>${fmtDate(t.opened_at)}</td>
      <td>${fmtDate(t.closed_at)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>IA Confluence — Trade Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0a0e17;
      color: #e0e0e0;
      padding: 16px;
      min-height: 100vh;
      -webkit-text-size-adjust: 100%;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      background: linear-gradient(135deg, #00E676, #00B0FF);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 4px;
    }
    .subtitle {
      color: #666;
      font-size: 0.8rem;
      margin-bottom: 20px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: linear-gradient(135deg, #111827, #1a2332);
      border: 1px solid #1e2d3d;
      border-radius: 10px;
      padding: 14px 10px;
      text-align: center;
    }
    .stat-card .label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #667;
      margin-bottom: 6px;
    }
    .stat-card .value {
      font-size: 1.1rem;
      font-weight: 700;
    }
    .section-title {
      font-size: 1rem;
      font-weight: 600;
      color: #ccc;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #1e2d3d;
    }
    .table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin-bottom: 24px;
      border-radius: 8px;
      border: 1px solid #1e2d3d;
    }
    table {
      width: 100%;
      min-width: 520px;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    th {
      background: #111827;
      color: #888;
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.65rem;
      letter-spacing: 0.5px;
      padding: 10px 10px;
      text-align: left;
      border-bottom: 1px solid #1e2d3d;
      white-space: nowrap;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #0f1923;
      white-space: nowrap;
    }
    tr:hover { background: #111827; }
    .long { color: #00E676; font-weight: 600; }
    .short { color: #FF1744; font-weight: 600; }
    .empty {
      text-align: center;
      color: #444;
      padding: 24px;
      font-style: italic;
    }
    .refresh-note {
      text-align: center;
      color: #333;
      font-size: 0.7rem;
      margin-top: 12px;
      padding-bottom: 24px;
    }
    @media (min-width: 640px) {
      body { padding: 24px; }
      h1 { font-size: 1.8rem; }
      .stats { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; }
      .stat-card { padding: 20px; }
      .stat-card .label { font-size: 0.75rem; }
      .stat-card .value { font-size: 1.5rem; }
      table { font-size: 0.85rem; }
      th { font-size: 0.7rem; padding: 12px 16px; }
      td { padding: 10px 16px; }
    }
  </style>
</head>
<body>
  <h1>IA Confluence</h1>
  <p class="subtitle">${symbol} — Auto-refreshes every 30s</p>

  <div class="stats">
    <div class="stat-card">
      <div class="label">Open</div>
      <div class="value" style="color:#00B0FF">${enrichedOpen.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Closed</div>
      <div class="value">${closedWithPnl.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Win Rate</div>
      <div class="value" style="color:${winRate >= 50 ? '#00E676' : '#FF1744'}">${winRate}%</div>
    </div>
    <div class="stat-card">
      <div class="label">Wins / Losses</div>
      <div class="value"><span style="color:#00E676">${wins}</span> / <span style="color:#FF1744">${losses}</span></div>
    </div>
    <div class="stat-card">
      <div class="label">Realised P&L</div>
      <div class="value" style="color:${pnlColor(realisedPnl)}">${realisedPnl >= 0 ? '+' : ''}${fmt(realisedPnl)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Unrealised P&L</div>
      <div class="value" style="color:${pnlColor(unrealisedTotal)}">${unrealisedTotal >= 0 ? '+' : ''}${fmt(unrealisedTotal)}</div>
    </div>
    <div class="stat-card" style="grid-column: span 2;">
      <div class="label">Total P&L</div>
      <div class="value" style="color:${pnlColor(totalPnl)}">${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)} USDT</div>
    </div>
  </div>

  <h2 class="section-title">Open Positions</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>#</th><th>Dir</th><th>Entry</th><th>Now</th><th>P&L</th><th>Lev</th><th>Opened</th><th>✓</th></tr>
    </thead>
    <tbody>
      ${openRows || '<tr><td colspan="8" class="empty">No open positions</td></tr>'}
    </tbody>
  </table>
  </div>

  <h2 class="section-title">Closed Trades</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>#</th><th>Dir</th><th>Entry</th><th>Exit</th><th>P&L</th><th>%</th><th>Reason</th><th>Opened</th><th>Closed</th></tr>
    </thead>
    <tbody>
      ${closedRows || '<tr><td colspan="9" class="empty">No closed trades yet</td></tr>'}
    </tbody>
  </table>
  </div>

  <p class="refresh-note">Last updated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}</p>
</body>
</html>`;
}

