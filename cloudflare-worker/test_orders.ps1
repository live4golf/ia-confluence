#!/usr/bin/env pwsh
# test_orders.ps1
# Full cycle test: BUY → wait 10s → SELL + TP_EXIT → wait 10s → TP_EXIT_SHORT
# This hits the live Cloudflare Worker to validate MEXC API order submission.

$WORKER_URL = "https://ia-confluence.mark-981.workers.dev/webhook"
$TOKEN      = "LFG-IA-k1bbyd1g"   # <-- your WEBHOOK_SECRET
$PRICE      = 88.36                 # approximate current SOL price (cosmetic only for market orders)
$QTY        = 0.17                  # matches trade_usdt=5, lev=3 at ~$88

function Send-Signal($action, $qty = $null) {
    $body = @{ action = $action; price = $PRICE }
    if ($qty) { $body.qty = $qty }
    $json = $body | ConvertTo-Json -Compress
    Write-Host "`n➤ Sending $action..." -ForegroundColor Cyan
    try {
        $res = Invoke-RestMethod -Uri "${WORKER_URL}?token=${TOKEN}" `
                                  -Method POST `
                                  -ContentType "application/json" `
                                  -Body $json
        Write-Host "   ✅ Response: $($res | ConvertTo-Json -Compress)" -ForegroundColor Green
    } catch {
        $body = $_.ErrorDetails.Message
        Write-Host "   ❌ Error: $body" -ForegroundColor Red
    }
}

Write-Host "=== MEXC Order Flow Test ===" -ForegroundColor Yellow
Write-Host "Worker: $WORKER_URL"
Write-Host "Price:  $PRICE  |  Qty: $QTY"

# Step 1: BUY (Open Long)
Send-Signal "BUY" $QTY

Write-Host "`nWaiting 10s before SELL + TP_EXIT..." -ForegroundColor DarkGray
Start-Sleep 10

# Step 2a: Close the long (TP_EXIT)
Send-Signal "TP_EXIT" $QTY

# Step 2b: Open Short (SELL)
Send-Signal "SELL" $QTY

Write-Host "`nWaiting 10s before closing short..." -ForegroundColor DarkGray
Start-Sleep 10

# Step 3: Close the short
Send-Signal "TP_EXIT_SHORT" $QTY

Write-Host "`n=== Done. Checking D1 log... ===" -ForegroundColor Yellow
