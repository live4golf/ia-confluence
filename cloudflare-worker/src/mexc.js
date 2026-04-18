/**
 * mexc.js — MEXC Futures REST client
 *
 * Auth: HMAC-SHA256(apiKey + timestamp + bodyJson)
 * Docs: https://mexcdevelop.github.io/apidocs/contract_v1_en/
 */

/**
 * Build HMAC-SHA256 hex signature using the Web Crypto API (available in Workers).
 */
async function sign(secretKey, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Submit a futures order.
 *
 * params: { symbol, vol, side, leverage, type, openType, positionType?, price? }
 *   side:       1=Open Long, 2=Close Long, 3=Open Short, 4=Close Short
 *   type:       1=Limit, 2=Market
 *   openType:   1=Isolated, 2=Cross
 *   positionType: 1=Long, 2=Short (required when closing in hedge mode)
 */
export async function submitOrder(env, params) {
  const timestamp = Date.now().toString();
  const body = JSON.stringify(params);
  const message = env.MEXC_API_KEY + timestamp + body;
  const signature = await sign(env.MEXC_SECRET_KEY, message);

  const url = `${env.MEXC_BASE}/api/v1/private/order/submit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'ApiKey':        env.MEXC_API_KEY,
      'Request-Time':  timestamp,
      'Signature':     signature,
    },
    body,
  });

  return res.json();
}

/**
 * Get open positions for a symbol.
 * Returns array of position objects.
 */
export async function getOpenPositions(env, symbol) {
  const timestamp = Date.now().toString();
  const paramStr  = `symbol=${symbol}`;
  const message   = env.MEXC_API_KEY + timestamp + paramStr;
  const signature = await sign(env.MEXC_SECRET_KEY, message);

  const url = `${env.MEXC_BASE}/api/v1/private/position/open_positions?symbol=${symbol}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'ApiKey':       env.MEXC_API_KEY,
      'Request-Time': timestamp,
      'Signature':    signature,
    },
  });

  const json = await res.json();
  return json.success ? (json.data ?? []) : [];
}
