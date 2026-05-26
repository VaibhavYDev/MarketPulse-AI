# MarketPulse AI

A browser-based trading intelligence bot for Indian markets. Open it, click Generate — it reads out a full structured briefing for all 8 assets. No install, no backend, runs entirely in the browser.

🌐 **Live:** [vaibhavy2011.github.io/MarketPulse-AI](https://vaibhavy2011.github.io/MarketPulse-AI/)

![MarketPulse](https://img.shields.io/badge/MarketPulse-Intelligence%20Engine-00d4ff?style=flat-square)
![Demo](https://img.shields.io/badge/demo-live-10b981?style=flat-square&logo=github)
![License](https://img.shields.io/badge/license-MIT-6366f1?style=flat-square)
![Markets](https://img.shields.io/badge/NSE%20%7C%20MCX-live%20data-f59e0b?style=flat-square)

---

## What it does

Built this because I was tired of checking 8 different charts manually before every trading session. The bot does it for me:

- Pulls live prices for all 8 assets from Yahoo Finance
- Fetches OI and PCR data from NSE
- Synthesizes news, technical signals, and options flow into a structured briefing
- Reads the entire briefing aloud in Indian English (Web Speech API)
- Auto-runs at **8:45 AM**, **12:00 PM**, and **3:35 PM IST** on trading days

Every trade setup comes with a **1:3 risk-to-reward ratio** and ATR-based stops. Not just "buy/sell" — exact entry trigger, stop, and target.

---

## Assets covered

| Type | Assets |
|------|--------|
| Equity Indices | Nifty 50 · BankNifty · Sensex · Midcap Select · FinNifty |
| Commodities | Gold · Silver · Crude Oil |

---

## Briefing structure

Each asset is covered across 7 timeframes: 1m · 5m · 15m · 30m · 1H · Daily · Weekly.

**The Pulse** — 2-sentence news summary + overall sentiment (Bullish / Bearish / Neutral)

**The Metrics** — PCR, OI buildup, max call/put strike, ADX trend strength, TTM Squeeze status

**The Strategy** — Entry trigger, ATR stop-loss, and target at 1:3 R:R. No exceptions.

---

## Tech stack

| Layer | What's used |
|-------|-------------|
| Frontend | HTML + CSS + Vanilla JS — no frameworks |
| Intelligence | LLM API with web search grounding |
| Voice | Web Speech API (Indian English) |
| Market data | Yahoo Finance + NSE public endpoints + Angel One SmartAPI |
| Scheduler | Browser-native timers + Windows Task Scheduler |
| Hosting | GitHub Pages |

---

## Setup

### 1. Get a free API key

Go to the AI Studio of the LLM provider → sign in → create a key → copy it.

### 2. Open the app

Open `index.html` in **Chrome or Edge**. Web Speech API needs a Chromium browser.

### 3. Enter your key

Click **⚙ Settings** → paste your API key → **Save**.

The key lives in your browser's `localStorage` only. It's never in the source code.

### 4. Run it

Click **✨ Generate Briefing** → **▶ Play**.

That's it.

---

## Auto-launch on Windows (optional)

To have it open automatically before market hours:

```powershell
schtasks /create /tn "MarketPulse AI" /tr "C:\path\to\MarketPulseAI\launch.bat" /sc WEEKLY /d MON,TUE,WED,THU,FRI /st 08:40 /f
```

Replace the path with your actual folder location.

---

## Optional: Live OI/PCR via Angel One

For real-time options chain data (PCR, max pain, OI shifts):

1. Open a free account at [Angel One](https://www.angelone.in)
2. Grab your SmartAPI key from their developer portal
3. Paste it in **⚙ Settings → Angel One API Key**

Without it, the app falls back to NSE's public endpoints.

---

## File structure

```
MarketPulseAI/
├── index.html       # Dashboard UI
├── style.css        # Dark glassmorphism theme
├── config.js        # Asset universe + schedule config
├── data.js          # Data fetching (prices, OI/PCR)
├── ai.js            # LLM API integration + briefing generation
├── tts.js           # Text-to-Speech engine
├── scheduler.js     # Market calendar + auto-trigger logic
├── app.js           # Main controller
└── launch.bat       # Windows auto-launch helper
```

---

## Disclaimer

For educational and informational purposes only. Not financial advice. All outputs are based on publicly available data and analytical models. Do your own research. The developer is not responsible for any trading losses.

---

## License

MIT — use it, fork it, modify it.

---

**Vaibhav Yadav** · Greater Noida, India
GitHub: [@Vaibhavy2011](https://github.com/Vaibhavy2011)

*"One unit of risk. Three units of reward. Every time."*
