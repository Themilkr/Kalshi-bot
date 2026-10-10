const express = require('express');
const WebSocket = require('ws');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

// Set your exact ntfy topic name here:
const NTFY_TOPIC = 'jb-kalshi-btc-942';

let liveState = {
  spotPrice: 0,
  strikePrice: 0,
  timeRemainingSec: 900,
  signal: 'HOLD'
};

let lastAlertSignal = 'HOLD';

// Uses GET query parameters: completely avoids HTTP header encoding errors
function sendPhoneAlert(message, title = 'Kalshi Alert') {
  const cleanTitle = title.replace(/[^\x00-\x7F]/g, '').trim();
  const cleanMsg = message.replace(/[^\x00-\x7F]/g, '').trim();
  const urlPath = `/${NTFY_TOPIC}?message=${encodeURIComponent(cleanMsg)}&title=${encodeURIComponent(cleanTitle)}&priority=urgent&tags=chart_with_upwards_trend`;

  const req = https.get({
    hostname: 'ntfy.sh',
    port: 443,
    path: urlPath
  }, (res) => {
    // Alert processed
  });

  req.on('error', (err) => console.error('Alert Error:', err.message));
}

// US-compatible Coinbase live price stream
function connectCoinbase() {
  const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');

  ws.on('open', () => {
    console.log('Connected to Coinbase live BTC ticker');
    const subscribeMsg = {
      type: 'subscribe',
      product_ids: ['BTC-USD'],
      channels: ['ticker']
    };
    ws.send(JSON.stringify(subscribeMsg));
  });

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'ticker' && parsed.price) {
        liveState.spotPrice = parseFloat(parsed.price);
        evaluateSignal();
      }
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });

  ws.on('error', (err) => {
    console.error('Coinbase WS error:', err.message);
  });

  ws.on('close', () => {
    console.log('Coinbase WS closed, reconnecting in 3 seconds...');
    setTimeout(connectCoinbase, 3000);
  });
}

function evaluateSignal() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const windowElapsedSec = (minutes % 15) * 60 + seconds;
  liveState.timeRemainingSec = 900 - windowElapsedSec;

  if (windowElapsedSec < 5 || liveState.strikePrice === 0) {
    liveState.strikePrice = liveState.spotPrice;
  }

  const delta = liveState.spotPrice - liveState.strikePrice;

  // Signal triggers ($20 swing threshold)
  if (liveState.timeRemainingSec > 780) {
    liveState.signal = 'HOLD';
  } else if (liveState.timeRemainingSec < 90) {
    liveState.signal = 'CLOSE / EXPIRING';
  } else {
    if (delta > 20) {
      liveState.signal = 'BUY YES (OVER)';
    } else if (delta < -20) {
      liveState.signal = 'BUY NO (UNDER)';
    } else {
      liveState.signal = 'HOLD';
    }
  }

  if (liveState.signal !== lastAlertSignal) {
    if (liveState.signal === 'BUY YES (OVER)') {
      sendPhoneAlert(
        `BUY YES | Delta: +$${delta.toFixed(2)} | Spot: $${liveState.spotPrice.toFixed(2)} | Left: ${Math.floor(liveState.timeRemainingSec / 60)}m`,
        'BUY YES - Over Strike'
      );
    } else if (liveState.signal === 'BUY NO (UNDER)') {
      sendPhoneAlert(
        `BUY NO | Delta: -$${Math.abs(delta).toFixed(2)} | Spot: $${liveState.spotPrice.toFixed(2)} | Left: ${Math.floor(liveState.timeRemainingSec / 60)}m`,
        'BUY NO - Under Strike'
      );
    } else if (liveState.signal === 'CLOSE / EXPIRING' && lastAlertSignal.includes('BUY')) {
      sendPhoneAlert(
        'Under 90s left. Close contract or take profit before BRTI settlement lock.',
        'EXIT - Window Expiring'
      );
    }
    lastAlertSignal = liveState.signal;
  }
}

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    spotPrice: liveState.spotPrice,
    strikePrice: liveState.strikePrice,
    delta: (liveState.spotPrice - liveState.strikePrice).toFixed(2),
    signal: liveState.signal,
    timeRemainingSec: liveState.timeRemainingSec
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server live on port ${PORT}`);
  sendPhoneAlert('Bot running clean with no errors!', 'Bot Online');
  connectCoinbase();
});
