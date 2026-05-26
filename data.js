// ============================================================
// MarketPulse AI — data.js  (v3 — FIXED live prices)
// BUG FIXES:
//  - Cache cleared at market open so yesterday's close never shows as live
//  - marketState overridden by IST time — not Yahoo's often-wrong value
//  - Cache-busting on all Yahoo Finance URLs (prevents proxy caching stale data)
//  - 4 CORS proxies with smarter fallback order
//  - isLive flag tied to actual fetch time vs market schedule
//  - Faster refresh: 60s during market hours, 5min otherwise
// ============================================================

const DataEngine = (() => {

  // ── CORS proxies — ordered by reliability for Indian market data ──
  const PROXIES = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  const YF_BASE  = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  const YF_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';

  const CACHE_KEY    = 'mp_price_cache';
  const CACHE_TS_KEY = 'mp_price_cache_ts';
  const CACHE_DATE_KEY = 'mp_price_cache_date'; // NEW: track which trading day cache belongs to

  // Refresh intervals
  const STALE_MS_LIVE   = 60  * 1000;  // 60s during market hours
  const STALE_MS_CLOSED = 5 * 60 * 1000; // 5min when closed
  const MAX_AGE_MS      = 20 * 60 * 1000; // 20min max age — never serve data older than this as "live"

  const mem = { prices: {}, oi: {}, lastFetch: 0 };

  // ── Cache-busting timestamp appended to all Yahoo URLs ──
  function bustCache() {
    return `&_cb=${Math.floor(Date.now() / 30000)}`; // changes every 30 seconds
  }

  // ── Fetch with timeout ──
  async function fetchJSON(url, ms = 9000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'Accept': 'application/json' },
        cache: 'no-store', // never use browser cache
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  }

  // ── Try proxies in order ──
  async function fetchViaProxy(originalUrl) {
    // Try direct first
    try {
      return await fetchJSON(originalUrl + bustCache(), 5000);
    } catch { /* CORS — try proxies */ }

    for (const makProxy of PROXIES) {
      try {
        const proxied = makProxy(originalUrl + bustCache());
        console.log('[DataEngine] Proxy:', proxied.substring(0, 55) + '...');
        return await fetchJSON(proxied, 10000);
      } catch (e) {
        console.warn('[DataEngine] Proxy failed:', e.message);
      }
    }
    throw new Error('All proxies failed: ' + originalUrl);
  }

  // ── Parse Yahoo v8 chart ──
  function parseYFChart(data, symbol) {
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No chart meta for ' + symbol);
    const price     = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change    = price != null && prevClose != null ? price - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    return {
      symbol, price, prevClose, change, changePct,
      high:         meta.regularMarketDayHigh  ?? null,
      low:          meta.regularMarketDayLow   ?? null,
      open:         meta.regularMarketOpen     ?? null,
      volume:       meta.regularMarketVolume   ?? null,
      currency:     meta.currency              ?? 'INR',
      yahooState:   meta.marketState           ?? 'CLOSED',
      exchangeName: meta.exchangeName          ?? '',
    };
  }

  // ── Parse Yahoo v7 quote ──
  function parseYFQuote(data, symbol) {
    const q = data?.quoteResponse?.result?.[0];
    if (!q) throw new Error('No quote result for ' + symbol);
    const price     = q.regularMarketPrice ?? null;
    const prevClose = q.regularMarketPreviousClose ?? null;
    const change    = q.regularMarketChange ?? null;
    const changePct = q.regularMarketChangePercent ?? null;
    return {
      symbol, price, prevClose, change, changePct,
      high:         q.regularMarketDayHigh   ?? null,
      low:          q.regularMarketDayLow    ?? null,
      open:         q.regularMarketOpen      ?? null,
      volume:       q.regularMarketVolume    ?? null,
      currency:     q.currency               ?? 'INR',
      yahooState:   q.marketState            ?? 'CLOSED',
      exchangeName: q.fullExchangeName       ?? '',
    };
  }

  // ── Fetch single symbol ──
  async function fetchSymbol(symbol) {
    // v7 quote — fastest
    try {
      const url  = `${YF_QUOTE}${encodeURIComponent(symbol)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketPreviousClose,regularMarketOpen,currency,marketState,fullExchangeName`;
      const data = await fetchViaProxy(url);
      const parsed = parseYFQuote(data, symbol);
      if (parsed.price != null) return parsed;
      throw new Error('Null price from v7');
    } catch (e) {
      console.warn(`[DataEngine] v7 failed ${symbol}:`, e.message);
    }

    // v8 chart fallback
    try {
      const url  = `${YF_BASE}${encodeURIComponent(symbol)}?interval=1m&range=1d`;
      const data = await fetchViaProxy(url);
      const parsed = parseYFChart(data, symbol);
      if (parsed.price != null) return parsed;
      throw new Error('Null price from v8');
    } catch (e) {
      console.warn(`[DataEngine] v8 failed ${symbol}:`, e.message);
    }

    return null;
  }

  // ── USD/INR ──
  async function fetchUSDINR() {
    try {
      const r = await fetchSymbol('USDINR=X');
      return r?.price ?? 84.5;
    } catch { return 84.5; }
  }

  // ── MCX price conversion ──
  function toMCX(usdPrice, assetId, usdInr) {
    if (!usdPrice || !usdInr) return null;
    if (assetId === 'gold')   return (usdPrice * usdInr) / 31.1035 * 10;    // per 10g
    if (assetId === 'silver') return (usdPrice * usdInr) / 31.1035 * 1000;  // per kg
    if (assetId === 'crude')  return usdPrice * usdInr;                      // per barrel
    return usdPrice * usdInr;
  }

  // ── Sentiment ──
  function deriveSentiment(changePct, pcr) {
    const pcrNum = parseFloat(pcr);
    if (changePct == null) return 'Neutral';
    const p = changePct > 0.6 ? 1 : changePct < -0.6 ? -1 : 0;
    const o = isNaN(pcrNum) ? 0 : pcrNum > 1.1 ? 1 : pcrNum < 0.8 ? -1 : 0;
    const score = p + o;
    if (score >=  2) return 'Bullish';
    if (score <= -2) return 'Bearish';
    if (score ===  1) return 'Cautiously Bullish';
    if (score === -1) return 'Cautiously Bearish';
    return 'Neutral';
  }

  // ── IST helpers ──
  function getIST() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  }

  function getTodayISTDateStr() {
    const d = getIST();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }

  // FIX: determine market state purely from IST clock — never trust Yahoo's value
  function getActualMarketState() {
    const ist = getIST();
    const day = ist.getDay();
    if (day === 0 || day === 6) return 'CLOSED'; // weekend
    const hhmm = ist.getHours() * 100 + ist.getMinutes();
    if (hhmm >= 900  && hhmm < 915)  return 'PRE';
    if (hhmm >= 915  && hhmm <= 1530) return 'REGULAR'; // ← LIVE
    if (hhmm > 1530  && hhmm <= 1600) return 'POST';
    return 'CLOSED';
  }

  function isMarketOpen() {
    return getActualMarketState() === 'REGULAR';
  }

  // FIX: stale interval depends on market hours
  function getStaleMS() {
    return isMarketOpen() ? STALE_MS_LIVE : STALE_MS_CLOSED;
  }

  // ── Persist cache ──
  function persistCache() {
    try {
      localStorage.setItem(CACHE_KEY,      JSON.stringify(mem.prices));
      localStorage.setItem(CACHE_TS_KEY,   Date.now().toString());
      localStorage.setItem(CACHE_DATE_KEY, getTodayISTDateStr());
    } catch { /* quota */ }
  }

  // FIX: only load cache if it belongs to TODAY — never show yesterday's prices
  function loadPersistedCache() {
    try {
      const savedDate = localStorage.getItem(CACHE_DATE_KEY);
      const todayStr  = getTodayISTDateStr();

      if (savedDate !== todayStr) {
        console.log(`[DataEngine] Cache is from ${savedDate}, today is ${todayStr} — discarding stale cache`);
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TS_KEY);
        localStorage.removeItem(CACHE_DATE_KEY);
        return;
      }

      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
      if (Date.now() - ts > MAX_AGE_MS) {
        console.log('[DataEngine] Cache too old — discarding');
        return;
      }

      const saved = localStorage.getItem(CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(mem.prices, parsed);
        console.log('[DataEngine] Loaded', Object.keys(parsed).length, "today's cached prices");
      }
    } catch { /* corrupt */ }
  }

  // ── NSE OI/PCR ──
  async function fetchNSEOptionData(nseSymbol) {
    const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${nseSymbol}`;
    try {
      const data = await fetchViaProxy(url);
      if (!data?.filtered) return null;
      const totalCE = data.filtered.CE?.totOI || 0;
      const totalPE = data.filtered.PE?.totOI || 0;
      const pcr     = totalCE > 0 ? (totalPE / totalCE).toFixed(2) : 'N/A';
      let maxCallOI = 0, maxCallStrike = 0, maxPutOI = 0, maxPutStrike = 0;
      (data.records?.data || []).forEach(rec => {
        if (rec.CE?.openInterest > maxCallOI) { maxCallOI = rec.CE.openInterest; maxCallStrike = rec.strikePrice; }
        if (rec.PE?.openInterest > maxPutOI)  { maxPutOI  = rec.PE.openInterest; maxPutStrike  = rec.strikePrice; }
      });
      return { pcr, maxCallStrike, maxPutStrike, totalCE, totalPE, source: 'NSE' };
    } catch (e) {
      console.warn(`[DataEngine] NSE OI failed ${nseSymbol}:`, e.message);
      return null;
    }
  }

  // ── Master fetch ──
  async function fetchAllMarketData() {
    const now = Date.now();

    if (Object.keys(mem.prices).length === 0) loadPersistedCache();

    // FIX: use dynamic stale interval
    if (now - mem.lastFetch < getStaleMS() && Object.keys(mem.prices).length > 0) {
      console.log('[DataEngine] Cache fresh — returning stored data');
      return buildDataObject();
    }

    console.log('[DataEngine] Fetching fresh market data...');
    window.dispatchEvent(new CustomEvent('mp:fetchStart'));

    const usdInr = await fetchUSDINR();
    console.log('[DataEngine] USD/INR:', usdInr.toFixed(2));

    const allAssets = [...CONFIG.assets.equities, ...CONFIG.assets.commodities];
    const results = await Promise.allSettled(
      allAssets.map(asset => fetchSymbol(asset.symbol).then(q => ({ asset, quote: q })))
    );

    let successCount = 0;
    results.forEach(result => {
      if (result.status !== 'fulfilled') return;
      const { asset, quote } = result.value;
      if (!quote || quote.price == null) return;

      let displayPrice = quote.price;
      if (asset.type === 'commodity') {
        displayPrice = toMCX(quote.price, asset.id, usdInr);
      }

      mem.prices[asset.id] = {
        ...quote,
        displayPrice,
        usdInr,
        fetchedAt: new Date().toISOString(),
        isLive: true,
      };
      successCount++;
    });

    console.log(`[DataEngine] ${successCount}/${allAssets.length} assets fetched`);

    // OI/PCR only during market hours (NSE API rejects outside hours)
    if (isMarketOpen()) {
      const oiTargets = [
        { symbol: 'NIFTY',      id: 'nifty50' },
        { symbol: 'BANKNIFTY',  id: 'banknifty' },
        { symbol: 'FINNIFTY',   id: 'finnifty' },
        { symbol: 'MIDCPNIFTY', id: 'midcapselect' },
      ];
      await Promise.allSettled(
        oiTargets.map(async t => {
          const d = await fetchNSEOptionData(t.symbol);
          if (d) mem.oi[t.id] = d;
        })
      );
    }

    mem.lastFetch = now;
    persistCache();

    const dataObj = buildDataObject();
    window.dispatchEvent(new CustomEvent('mp:dataReady', { detail: dataObj }));
    return dataObj;
  }

  // ── Build data object — FIX: marketState from IST clock, not Yahoo ──
  function buildDataObject() {
    const assets      = {};
    const allDefs     = [...CONFIG.assets.equities, ...CONFIG.assets.commodities];
    const marketState = getActualMarketState(); // FIX: single source of truth
    const marketOpen  = marketState === 'REGULAR';

    allDefs.forEach(def => {
      const p   = mem.prices[def.id] || {};
      const oi  = mem.oi[def.id]     || null;
      const sentiment = deriveSentiment(p.changePct, oi?.pcr);

      const rawPrice = p.displayPrice ?? p.price ?? null;
      let formattedPrice = null;
      if (rawPrice != null) {
        const num = Number(rawPrice);
        if (def.type === 'commodity') {
          formattedPrice = num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
        } else {
          formattedPrice = num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
      }

      // FIX: use actual IST-based market state for ALL assets, not Yahoo's per-asset value
      const effectiveState = p.fetchedAt
        ? marketState  // we have fresh data — use real state
        : 'CLOSED';    // no data at all — show closed

      assets[def.id] = {
        id: def.id, name: def.name, shortSymbol: def.shortSymbol,
        color: def.color, type: def.type,
        rawPrice, formattedPrice,
        prevClose:    p.prevClose    ?? null,
        change:       p.change       ?? null,
        changePct:    p.changePct    ?? null,
        high:         p.high         ?? null,
        low:          p.low          ?? null,
        open:         p.open         ?? null,
        marketState:  effectiveState, // ← FIX: IST-based, not Yahoo's
        isLive:       marketOpen && (p.isLive ?? false),
        fetchedAt:    p.fetchedAt    ?? null,
        pcr:          oi?.pcr        ?? 'N/A',
        maxCallStrike: oi?.maxCallStrike ?? 'N/A',
        maxPutStrike:  oi?.maxPutStrike  ?? 'N/A',
        oiSource:      oi?.source        ?? '—',
        sentiment,
        hasData: rawPrice != null,
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

  // Expose isMarketOpen for app.js
  return { fetchAllMarketData, forceRefresh, buildDataObject, isMarketOpen, getActualMarketState };

})();

window.DataEngine = DataEngine;
