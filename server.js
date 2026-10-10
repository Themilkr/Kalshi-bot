const express = require('express');
const WebSocket = require('ws');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// REPLACE THIS WITH YOUR EXACT NTFY TOPIC NAME:
const NTFY_TOPIC = 'jb-kalshi-btc-942';

let liveState = {
  spotPrice: 0,
  strikePrice: 0,
  timeRemainingSec: 900,
  signal: 'HOLD'
};

let lastAlertSignal = 'HOLD';

function sendPhoneAlert(message, title = 'Kalshi BTC Alert') {
  const options = {
    hostname: 'ntfy.sh',
    port: 443,
    path: `/${NTFY_TOPIC}`,
    method: 'POST',
    headers: {
      'Title': title,
      'Priority': 'urgent',
      'Tags': 'chart_with_upwards_trend'
    }
  };

  const req = https.request(options);
  req.on('error', (err) => console.error(err.message));
  req.write(message);
  req.end();
}

// Connect to Binance live BTC feed
const binanceWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

binanceWs.on('message', (data) => {
  const parsed = JSON.parse(data);
  liveState.spotPrice = parseFloat(parsed.c);
  evaluateSignal();
});

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

  if (liveState.timeRemainingSec > 780) {
    liveState.signal = 'HOLD';
  } else if (liveState.timeRemainingSec < 90) {
    liveState.signal = 'CLOSE / EXPIRING';
  } else {
    if (delta > 35) {
      liveState.signal = 'BUY YES (OVER)';
    } else if (delta < -35) {
      liveState.signal = 'BUY NO (UNDER)';
    } else {
      liveState.signal = 'HOLD';
    }
  }

  if (liveState.signal !== lastAlertSignal) {
    if (liveState.signal === 'BUY YES (OVER)') {
      sendPhoneAlert(
        `Delta: +$${delta.toFixed(2)} | Spot: $${liveState.spotPrice.toFixed(2)} | Time Left: ${Math.floor(liveState.timeRemainingSec / 60)}m`,
        '🚀 BUY YES (Over)'
      );
    } else if (liveState.signal === 'BUY NO (UNDER)') {
      sendPhoneAlert(
        `Delta: -$${Math.abs(delta).toFixed(2)} | Spot: $${liveState.spotPrice.toFixed(2)} | Time Left: ${Math.floor(liveState.timeRemainingSec / 60)}m`,
        '🔻 BUY NO (Under)'
      );
    } else if (liveState.signal === 'CLOSE / EXPIRING' && lastAlertSignal.includes('BUY')) {
      sendPhoneAlert('Under 90s left. Lock in profit or close position.', '⚠️ Close / Settlement Lock');
    }
    lastAlertSignal = liveState.signal;
  }
}

app.get('/', (req, res) => res.send('Bot is active and running 24/7!'));

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  sendPhoneAlert('Bot deployed and live! Monitoring BTC 15m windows.', 'Kalshi Bot Online');
});
