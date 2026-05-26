// ============================================================
// MarketPulse AI — config.js
// Central configuration store. All settings persist in localStorage.
// ============================================================

const CONFIG = {
  version: '1.0.0',
  appName: 'MarketPulse AI',

  // ── API Keys ──
  // IMPORTANT: Do NOT hardcode keys here. Enter your key in the app's Settings panel.
  // Your key is stored only in your browser's localStorage and never sent anywhere except Google's API.
  _defaultGeminiKey: '',

  keys: {
    gemini: () => localStorage.getItem('mp_gemini_key') || window.CONFIG._defaultGeminiKey,
    angelOne: () => localStorage.getItem('mp_angel_key') || '',
    angelClientCode: () => localStorage.getItem('mp_angel_client') || '',
    angelTotp: () => localStorage.getItem('mp_angel_totp') || '',
  },

  // ── Gemini AI ──
  gemini: {
    model: 'gemini-2.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    useSearchGrounding: true,
    temperature: 0.3,
    maxOutputTokens: 8192,
  },

  // ── Market Schedule (IST) ──
  schedule: {
    timezone: 'Asia/Kolkata',
    briefingTimes: ['08:45', '12:00', '15:35'],
    marketOpen: '09:15',
    marketClose: '15:30',
    // NSE Trading Holidays 2026 (YYYY-MM-DD)
    holidays2026: [
      '2026-01-26', // Republic Day
      '2026-02-18', // Mahashivratri
      '2026-03-02', // Holi
      '2026-03-25', // Good Friday (tentative)
      '2026-04-06', // Ram Navami (tentative)
      '2026-04-14', // Dr. Ambedkar Jayanti / Baisakhi
      '2026-05-01', // Maharashtra Day
      '2026-06-27', // Eid ul Adha (tentative)
      '2026-08-15', // Independence Day
      '2026-08-24', // Ganesh Chaturthi (tentative)
      '2026-10-02', // Gandhi Jayanti / Dussehra (tentative)
      '2026-10-20', // Diwali Laxmi Puja (tentative)
      '2026-10-21', // Diwali Balipratipada (tentative)
      '2026-11-04', // Guru Nanak Jayanti (tentative)
      '2026-11-25', // Christmas (tentative)
      '2026-12-25', // Christmas
    ],
  },

  // ── Asset Universe ──
  assets: {
    equities: [
      { id: 'nifty50',       name: 'Nifty 50',       symbol: '^NSEI',    shortSymbol: 'NIFTY',     color: '#00d4ff', type: 'equity' },
      { id: 'banknifty',     name: 'BankNifty',      symbol: '^NSEBANK', shortSymbol: 'BANKNIFTY', color: '#f59e0b', type: 'equity' },
      { id: 'sensex',        name: 'Sensex',         symbol: '^BSESN',   shortSymbol: 'SENSEX',    color: '#a78bfa', type: 'equity' },
      { id: 'midcapselect',  name: 'Midcap Select',  symbol: 'MIDCPNIFTY.NS', shortSymbol: 'MIDCAP', color: '#34d399', type: 'equity' },
      { id: 'finnifty',      name: 'FinNifty',       symbol: 'NIFTY_FIN_SERVICE.NS', shortSymbol: 'FINNIFTY', color: '#f472b6', type: 'equity' },
    ],
    commodities: [
      { id: 'gold',   name: 'Gold MCX',       symbol: 'GC=F',  shortSymbol: 'GOLD',  color: '#fbbf24', type: 'commodity', mcxMultiplier: 85 },
      { id: 'silver', name: 'Silver MCX',     symbol: 'SI=F',  shortSymbol: 'SILVER', color: '#94a3b8', type: 'commodity', mcxMultiplier: 85 },
      { id: 'crude',  name: 'Crude Oil MCX',  symbol: 'CL=F',  shortSymbol: 'CRUDE', color: '#fb923c', type: 'commodity', mcxMultiplier: 85 },
    ],
  },

  // ── Analysis Parameters ──
  analysis: {
    riskRewardRatio: '1:3',
    timeframes: ['1-min', '5-min', '15-min', '30-min', '1-hour', 'Daily', 'Weekly'],
    primaryTimeframe: '5-min',
  },

  // ── TTS Settings ──
  tts: {
    preferredVoiceLang: 'en-IN',
    fallbackVoiceLang: 'en-US',
    rate: parseFloat(localStorage.getItem('mp_tts_rate') || '0.95'),
    pitch: parseFloat(localStorage.getItem('mp_tts_pitch') || '1.0'),
    volume: parseFloat(localStorage.getItem('mp_tts_vol') || '1.0'),
  },

  // ── Helpers ──
  save(key, value) {
    localStorage.setItem(key, value);
  },

  getAll() {
    return {
      geminiKey: this.keys.gemini(),
      angelKey: this.keys.angelOne(),
      ttsRate: this.tts.rate,
      ttsPitch: this.tts.pitch,
    };
  },
};

window.CONFIG = CONFIG;
