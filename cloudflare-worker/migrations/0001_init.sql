-- D1 trade log for ia-confluence worker
-- Each row = one executed (or dry-run) order

CREATE TABLE IF NOT EXISTS trades (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  action         TEXT    NOT NULL,   -- BUY | SELL | TP_EXIT | TP_EXIT_SHORT | TSL | TSL_SHORT
  symbol         TEXT    NOT NULL,   -- SOL_USDT
  qty            REAL,               -- contracts (SOL)
  entry_price    REAL,               -- price at open
  exit_price     REAL,               -- price at close (null while open)
  mexc_order_id  TEXT,               -- order ID returned by MEXC
  status         TEXT    NOT NULL,   -- open | closed | error | dry_run
  error_msg      TEXT,               -- populated on error
  opened_at      TEXT    NOT NULL,   -- ISO timestamp
  closed_at      TEXT                -- ISO timestamp (null while open)
);

-- Index for fast lookup of open positions
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status, action, symbol);
