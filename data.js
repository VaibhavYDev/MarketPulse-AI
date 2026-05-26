// ============================================================
// MarketPulse AI — data.js v4 (COMPLETE REWRITE)
// FIX 1: Switched from Yahoo+CORS-proxy to Stooq.com
//         Stooq has no CORS issues, no caching, returns live CSV
// FIX 2: Multi-source fallback: Stooq → Yahoo v7 → Yahoo v8
// FIX 3: Cache cleared daily — never serves yesterday's prices
// FIX 4: marketState determined by IST clock, not external APIs
// FIX 5: 60s refresh during market hours, 5min otherwise
// ============================================================

const DataEngine = (() => {

  // ── Stooq symbols for each asset ──
  // Stooq is free, CORS-safe, no rate limiting, returns live CSV
  const STOOQ_SYMBOLS = {
    nifty50:      '^nsei',
    banknifty:    '^nsebank',
    sensex:       '^bsesn',
    midcapselect: 'nifty_midcap_select.ns',
    finnifty:     'nifty_fin_service.ns',
    gold:         'xauusd',   // spot gold USD — converted to MCX
    silver:       'xagusd',   // spot silver USD — converted to MCX
    crude:        'cl.f',     // WTI crude futures USD
  };

  // Stooq base URL — returns CSV: Date,Time,Open,High,Low,Close,Volume
  const STOOQ_BASE = 'https://stooq.com/q/l/?f=sd2t2ohlcvn&e=csv&s=';

  // Yahoo Finance fallback
  const PROXIES = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  const YF_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';
  const YF_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';

  // Cache keys
  const CACHE_KEY      = 'mp_price_cache_v4';
  const CACHE_TS_KEY   = 'mp_price_cache_ts_v4';
  const CACHE_DATE_KEY = 'mp_price_cache_date_v4';

  // Refresh intervals
  const STALE_LIVE   = 60  * 1000;   // 60s during market hours
  const STALE_CLOSED = 5   * 60 * 1000; // 5min when closed
  const MAX_AGE      = 15  * 60 * 1000; // 15min max — never serve older as live

  const mem = { prices: {}, oi: {}, lastFetch: 0 };

  // ── IST helpers — single source of truth ──
  function getIST() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  }

  function getISTDateStr() {
    const d = getIST();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // Actual market state from IST clock — never trust any API's marketState field
  function getMarketState() {
    const ist = getIST();
    const day = ist.getDay(); // 0=Sun 6=Sat
    if (day === 0 || day === 6) return 'CLOSED';
    const hhmm = ist.getHours() * 100 + ist.getMinutes();
    if (hhmm >= 900  && hhmm <  915)  return 'PRE';
    if (hhmm >= 915  && hhmm <= 1530) return 'REGULAR'; // LIVE
    if (hhmm >  1530 && hhmm <= 1600) return 'POST';
    return 'CLOSED';
  }

  function isMarketOpen() {
    return getMarketState() === 'REGULAR';
  }

  function getStaleMS() {
    return isMarketOpen() ? STALE_LIVE : STALE_CLOSED;
  }

  // ── Fetch with timeout ──
  async function fetchWithTimeout(url, ms = 8000, opts = {}) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, {
        ...opts,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch(e) {
      clearTimeout(tid);
      throw e;
    }
  }

  // ── STOOQ fetch — PRIMARY source ──
  // Stooq returns CSV: Date,Time,Open,High,Low,Close,Volume,Name
  async function fetchStooq(stooqSymbol) {
    const url = `${STOOQ_BASE}${encodeURIComponent(stooqSymbol)}`;
    try {
      const res  = await fetchWithTimeout(url, 8000);
      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) throw new Error('Empty Stooq response');

      // Header: Date,Time,Open,High,Low,Close,Volume,Name
      const vals = lines[1].split(',');
      if (vals.length < 7) throw new Error('Bad Stooq CSV');

      const open   = parseFloat(vals[2]);
      const high   = parseFloat(vals[3]);
      const low    = parseFloat(vals[4]);
      const close  = parseFloat(vals[5]);
      const volume = parseFloat(vals[6]);

      if (isNaN(close) || close <= 0) throw new Error('Invalid Stooq price');

      // Stooq doesn't give prevClose directly — use open as proxy for change calc
      const prevClose = open; // best available without extra call
      const change    = close - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      return {
        price: close, prevClose, change, changePct,
        high, low, open, volume,
        source: 'stooq',
      };
    } catch(e) {
      console.warn(`[DataEngine] Stooq failed for ${stooqSymbol}:`, e.message);
      return null;
    }
  }

  // ── Yahoo Finance fallback via proxy ──
  async function fetchYahooViaProxy(yahooSymbol) {
    const url = `${YF_QUOTE}${encodeURIComponent(yahooSymbol)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketPreviousClose,regularMarketOpen`;

    for (const makeProxy of PROXIES) {
      try {
        const proxied = makeProxy(url);
        const res  = await fetchWithTimeout(proxied, 10000);
        const data = await res.json();
        const q    = data?.quoteResponse?.result?.[0];
        if (!q || q.regularMarketPrice == null) throw new Error('No price');
        return {
          price:     q.regularMarketPrice,
          prevClose: q.regularMarketPreviousClose ?? q.regularMarketPrice,
          change:    q.regularMarketChange        ?? 0,
          changePct: q.regularMarketChangePercent ?? 0,
          high:      q.regularMarketDayHigh       ?? null,
          low:       q.regularMarketDayLow        ?? null,
          open:      q.regularMarketOpen          ?? null,
          volume:    q.regularMarketVolume        ?? null,
          source:    'yahoo',
        };
      } catch(e) {
        console.warn(`[DataEngine] Yahoo proxy failed for ${yahooSymbol}:`, e.message);
      }
    }
    return null;
  }

  // ── MCX price conversion from USD spot ──
  function toMCX(usdPrice, assetId, usdInr) {
    if (!usdPrice || !usdInr) return null;
    if (assetId === 'gold')   return (usdPrice * usdInr) / 31.1035 * 10;   // per 10g INR
    if (assetId === 'silver') return (usdPrice * usdInr) / 31.1035 * 1000; // per kg INR
    if (assetId === 'crude')  return usdPrice * usdInr;                     // per barrel INR
    return usdPrice * usdInr;
  }

  // ── Sentiment ──
  function deriveSentiment(changePct, pcr) {
    const pcrNum = parseFloat(pcr);
    if (changePct == null) return 'Neutral';
    const p = changePct >  0.6 ? 1 : changePct < -0.6 ? -1 : 0;
    const o = isNaN(pcrNum) ? 0 : pcrNum > 1.1 ? 1 : pcrNum < 0.8 ? -1 : 0;
    const score = p + o;
    if (score >=  2) return 'Bullish';
    if (score <= -2) return 'Bearish';
    if (score ===  1) return 'Cautiously Bullish';
    if (score === -1) return 'Cautiously Bearish';
    return 'Neutral';
  }

  // ── Cache management ──
  function persistCache() {
    try {
      localStorage.setItem(CACHE_KEY,      JSON.stringify(mem.prices));
      localStorage.setItem(CACHE_TS_KEY,   Date.now().toString());
      localStorage.setItem(CACHE_DATE_KEY, getISTDateStr());
    } catch { /* quota */ }
  }

  function loadPersistedCache() {
    try {
      const savedDate = localStorage.getItem(CACHE_DATE_KEY);
      const todayStr  = getISTDateStr();
      if (savedDate !== todayStr) {
        // Different day — wipe everything
        ['mp_price_cache','mp_price_cache_v4','mp_price_cache_ts','mp_price_cache_ts_v4',
         'mp_price_cache_date','mp_price_cache_date_v4'].forEach(k => localStorage.removeItem(k));
        console.log('[DataEngine] New trading day — cache cleared');
        return;
      }
      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
      if (Date.now() - ts > MAX_AGE) {
        console.log('[DataEngine] Cache too old — ignoring');
        return;
      }
      const saved = localStorage.getItem(CACHE_KEY);
      if (saved) {
        Object.assign(mem.prices, JSON.parse(saved));
        console.log('[DataEngine] Cache loaded:', Object.keys(mem.prices).length, 'assets');
      }
    } catch { /* corrupt cache */ }
  }

  // ── NSE OI/PCR ──
  async function fetchNSEOI(nseSymbol) {
    if (!isMarketOpen()) return null; // NSE API only works during hours
    const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${nseSymbol}`;
    for (const makeProxy of PROXIES) {
      try {
        const proxied = makeProxy(url);
        const res  = await fetchWithTimeout(proxied, 8000);
        const data = await res.json();
        if (!data?.filtered) throw new Error('No filtered data');
        const totalCE = data.filtered.CE?.totOI || 0;
        const totalPE = data.filtered.PE?.totOI || 0;
        const pcr = totalCE > 0 ? (totalPE / totalCE).toFixed(2) : 'N/A';
        let maxCallOI = 0, maxCallStrike = 'N/A', maxPutOI = 0, maxPutStrike = 'N/A';
        (data.records?.data || []).forEach(rec => {
          if ((rec.CE?.openInterest || 0) > maxCallOI) {
            maxCallOI = rec.CE.openInterest; maxCallStrike = rec.strikePrice;
          }
          if ((rec.PE?.openInterest || 0) > maxPutOI) {
            maxPutOI = rec.PE.openInterest; maxPutStrike = rec.strikePrice;
          }
        });
        return { pcr, maxCallStrike, maxPutStrike, source: 'NSE' };
      } catch(e) {
        console.warn(`[DataEngine] NSE OI proxy failed ${nseSymbol}:`, e.message);
      }
    }
    return null;
  }

  // ── Master fetch ──
  async function fetchAllMarketData() {
    const now = Date.now();

    if (Object.keys(mem.prices).length === 0) loadPersistedCache();

    if (now - mem.lastFetch < getStaleMS() && Object.keys(mem.prices).length > 0) {
      return buildDataObject();
    }

    console.log('[DataEngine] Fetching fresh data via Stooq...');
    window.dispatchEvent(new CustomEvent('mp:fetchStart'));

    // ── USD/INR for MCX conversion ──
    let usdInr = 84.5;
    try {
      const r = await fetchStooq('usdpln'); // Stooq USDINR
      // Try direct USDINR
    } catch {}
    try {
      const r = await fetchStooq('usd/inr');
      if (r?.price) usdInr = r.price;
    } catch {}
    if (usdInr === 84.5) {
      // Fallback: fetch USDINR from Yahoo
      try {
        const r = await fetchYahooViaProxy('USDINR=X');
        if (r?.price) usdInr = r.price;
      } catch {}
    }
    console.log('[DataEngine] USD/INR:', usdInr.toFixed(2));

    const allDefs = [...CONFIG.assets.equities, ...CONFIG.assets.commodities];
    let successCount = 0;

    // Fetch all assets in parallel
    await Promise.allSettled(allDefs.map(async (def) => {
      const stooqSym = STOOQ_SYMBOLS[def.id];

      // Try Stooq first
      let quote = stooqSym ? await fetchStooq(stooqSym) : null;

      // Fallback to Yahoo via proxy
      if (!quote || quote.price == null) {
        console.log(`[DataEngine] Stooq failed for ${def.id} — trying Yahoo fallback`);
        quote = await fetchYahooViaProxy(def.symbol);
      }

      if (!quote || quote.price == null) {
        console.warn(`[DataEngine] All sources failed for ${def.id}`);
        return;
      }

      let displayPrice = quote.price;
      if (def.type === 'commodity') {
        displayPrice = toMCX(quote.price, def.id, usdInr);
      }

      mem.prices[def.id] = {
        ...quote,
        displayPrice,
        usdInr,
        fetchedAt: new Date().toISOString(),
        isLive: true,
      };
      successCount++;
    }));

    console.log(`[DataEngine] ${successCount}/${allDefs.length} assets fetched`);

    // OI/PCR during market hours only
    if (isMarketOpen()) {
      await Promise.allSettled([
        fetchNSEOI('NIFTY').then(d      => { if (d) mem.oi['nifty50']      = d; }),
        fetchNSEOI('BANKNIFTY').then(d  => { if (d) mem.oi['banknifty']    = d; }),
        fetchNSEOI('FINNIFTY').then(d   => { if (d) mem.oi['finnifty']     = d; }),
        fetchNSEOI('MIDCPNIFTY').then(d => { if (d) mem.oi['midcapselect'] = d; }),
      ]);
    }

    mem.lastFetch = now;
    persistCache();

    const dataObj = buildDataObject();
    window.dispatchEvent(new CustomEvent('mp:dataReady', { detail: dataObj }));
    return dataObj;
  }

  // ── Build output object ──
  function buildDataObject() {
    const assets      = {};
    const allDefs     = [...CONFIG.assets.equities, ...CONFIG.assets.commodities];
    const marketState = getMarketState();
    const marketOpen  = marketState === 'REGULAR';

    allDefs.forEach(def => {
      const p   = mem.prices[def.id] || {};
      const oi  = mem.oi[def.id]     || null;
      const sentiment = deriveSentiment(p.changePct, oi?.pcr);

      const rawPrice = p.displayPrice ?? p.price ?? null;
      let formattedPrice = null;
      if (rawPrice != null) {
        const num = Number(rawPrice);
        formattedPrice = def.type === 'commodity'
          ? num.toLocaleString('en-IN', { maximumFractionDigits: 0 })
          : num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      assets[def.id] = {
        id: def.id, name: def.name,
        shortSymbol: def.shortSymbol,
        color: def.color, type: def.type,
        rawPrice, formattedPrice,
        prevClose:    p.prevClose    ?? null,
        change:       p.change       ?? null,
        changePct:    p.changePct    ?? null,
        high:         p.high         ?? null,
        low:          p.low          ?? null,
        open:         p.open         ?? null,
        // FIX: use IST clock state — never Yahoo's value
        marketState:  p.fetchedAt ? marketState : 'CLOSED',
        isLive:       marketOpen && !!p.isLive,
        fetchedAt:    p.fetchedAt    ?? null,
        pcr:          oi?.pcr        ?? 'N/A',
        maxCallStrike: oi?.maxCallStrike ?? 'N/A',
        maxPutStrike:  oi?.maxPutStrike  ?? 'N/A',
        sentiment,
        hasData: rawPrice != null,
        dataSource: p.source ?? '—',
      };
    });

    return {
      assets,
      fetchTime:    new Date().toISOString(),
      usdInr:       mem.prices['gold']?.usdInr ?? 84.5,
      isMarketOpen: marketOpen,
      marketState,
    };
  }

  async function forceRefresh() {
    mem.lastFetch = 0;
    return fetchAllMarketData();
  }

  // Auto-refresh during market hours — reschedules itself dynamically
  function startAutoRefresh(onRefresh) {
    function scheduleNext() {
      const ms = getStaleMS();
      setTimeout(async () => {
        try {
          mem.lastFetch = 0; // force fresh fetch
          const data = await fetchAllMarketData();
          if (onRefresh) onRefresh(data);
        } catch(e) {
          console.warn('[DataEngine] Auto-refresh failed:', e.message);
        }
        scheduleNext(); // always reschedule
      }, ms);
    }
    scheduleNext();
  }

  loadPersistedCache();

  return {
    fetchAllMarketData,
    forceRefresh,
    buildDataObject,
    isMarketOpen,
    getMarketState,
    startAutoRefresh,
  };

})();

window.DataEngine = DataEngine;
