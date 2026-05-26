// ============================================================
// MarketPulse AI — ai.js
// Gemini AI integration: generates TTS-formatted market briefings
// Uses Google Search Grounding for real-time context
// ============================================================

const AIEngine = (() => {

  // ── Build the master analytical prompt ──
  function buildPrompt(marketData) {
    const assets = marketData.assets;
    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const assetSummary = Object.values(assets).map(a => {
      return `${a.name} (${a.shortSymbol}):
  - Price: ${a.price ? Number(a.price).toLocaleString('en-IN') : 'Unavailable'}
  - Change: ${a.changePct != null ? a.changePct.toFixed(2) + '%' : 'N/A'}
  - PCR: ${a.pcr}
  - Max Call OI Strike: ${a.maxCallStrike}
  - Max Put OI Strike: ${a.maxPutStrike}
  - Pre-computed Sentiment: ${a.sentiment}`;
    }).join('\n\n');

    return `You are an elite quantitative analyst and market intelligence AI called MarketPulse.
Current time (IST): ${now}
USD/INR rate: ${marketData.usdInr}

LIVE MARKET DATA:
${assetSummary}

TASK:
Generate a complete market briefing for ALL 8 assets listed above. The briefing will be read aloud by a Text-to-Speech engine in Indian English voice. Follow these STRICT rules:

FORMATTING RULES (CRITICAL — DO NOT DEVIATE):
1. NO markdown. No asterisks, no hash symbols, no bullet points, no bold text.
2. Short, punchy sentences. 15 words maximum per sentence.
3. Spell out ALL numbers in words (e.g. "twenty three thousand seven hundred" not "23,700").
4. Spell out ALL symbols (e.g. "percent" not "%", "rupees" not "₹").
5. Never say "I" or refer to yourself.
6. Speak as a professional Bloomberg/CNBC anchor, but adapted for Indian markets.
7. Use Indian English phrasing naturally (e.g. "lakh", "crore", "rupees").

STRUCTURE (produce exactly this structure, asset by asset):
For EACH asset, produce three sections labeled exactly as:
ASSET: [Asset Name]
THE PULSE: [2 sentences. Latest news + overall sentiment. Bullish, Bearish, or Neutral.]
THE METRICS: [4-5 sentences. Cover PCR, OI buildup, key support/resistance, ADX trend strength on 5-minute, TTM Squeeze status.]
THE STRATEGY: [Precise multi-timeframe execution plan. Cover 1-minute, 5-minute, 15-minute, 30-minute, 1-hour, Daily, and Weekly timeframes. For EVERY entry, state: exact entry trigger, stop loss, and target. ALL strategies must have a 1 to 3 risk to reward ratio. Use ATR-based stops. Mention TTM Squeeze direction. Mention if pre-expiry dynamics apply.]

ANALYTICAL REQUIREMENTS:
- Use Google Search Grounding to find the most current news, analyst commentary, and market data from the last 24 hours for each asset.
- For equity derivatives (Nifty, BankNifty, FinNifty, Midcap Select): analyze PCR and OI for options intelligence.
- For MCX commodities (Gold, Silver, Crude): analyze global spot prices, USD/INR impact, and sector-specific catalysts.
- ADX < 20 = weak trend, 20-25 = developing trend, > 25 = strong trend.
- TTM Squeeze: describe if it is firing, coiling, or neutral.
- ATR-based stop loss must be calculated from the current price, not arbitrary levels.

RISK-REWARD RULE (NON-NEGOTIABLE):
Every single strategy must have stop loss distance equal to 1 unit and target distance equal to 3 units. State this explicitly.

CLOSING SUMMARY:
After all 8 assets, add a section labeled:
MASTER SUMMARY:
[Rank all 8 assets from most bullish to most bearish. State the single highest-probability trade of the day with full entry, stop, and target. Remind the listener to size down on expiry days and keep the 1 to 3 rule sacred.]

BEGIN THE BRIEFING NOW. Do not add any preamble. Start directly with ASSET: Nifty 50.`;
  }

  // ── Call Gemini API ──
  async function generateBriefing(marketData) {
    const apiKey = CONFIG.keys.gemini();
    if (!apiKey) {
      throw new Error('GEMINI_KEY_MISSING');
    }

    const prompt = buildPrompt(marketData);
    const endpoint = `${CONFIG.gemini.endpoint}${CONFIG.gemini.model}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: CONFIG.gemini.temperature,
        maxOutputTokens: CONFIG.gemini.maxOutputTokens,
      },
      tools: CONFIG.gemini.useSearchGrounding
        ? [{ googleSearch: {} }]
        : [],
    };

    console.log('[AIEngine] Calling Gemini API...');
    window.dispatchEvent(new CustomEvent('mp:aiGenerating'));

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;
      if (res.status === 403 || res.status === 400) throw new Error('GEMINI_KEY_INVALID');
      throw new Error(`GEMINI_API_ERROR: ${errMsg}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');

    const briefing = parseBriefing(text);
    console.log('[AIEngine] Briefing generated successfully');
    window.dispatchEvent(new CustomEvent('mp:briefingReady', { detail: briefing }));
    return briefing;
  }

  // ── Parse the structured briefing text ──
  function parseBriefing(rawText) {
    const segments = [];
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    let currentAsset = null;
    let currentSection = null;
    let buffer = [];

    const flush = () => {
      if (currentAsset && currentSection && buffer.length) {
        let seg = segments.find(s => s.asset === currentAsset);
        if (!seg) { seg = { asset: currentAsset, pulse: '', metrics: '', strategy: '' }; segments.push(seg); }
        const text = buffer.join(' ');
        if (currentSection === 'pulse') seg.pulse = text;
        else if (currentSection === 'metrics') seg.metrics = text;
        else if (currentSection === 'strategy') seg.strategy = text;
        buffer = [];
      }
    };

    for (const line of lines) {
      if (line.startsWith('ASSET:')) {
        flush();
        currentAsset = line.replace('ASSET:', '').trim();
        currentSection = null;
      } else if (line.startsWith('THE PULSE:')) {
        flush();
        currentSection = 'pulse';
        const content = line.replace('THE PULSE:', '').trim();
        if (content) buffer.push(content);
      } else if (line.startsWith('THE METRICS:')) {
        flush();
        currentSection = 'metrics';
        const content = line.replace('THE METRICS:', '').trim();
        if (content) buffer.push(content);
      } else if (line.startsWith('THE STRATEGY:')) {
        flush();
        currentSection = 'strategy';
        const content = line.replace('THE STRATEGY:', '').trim();
        if (content) buffer.push(content);
      } else if (line.startsWith('MASTER SUMMARY:')) {
        flush();
        currentAsset = 'MASTER SUMMARY';
        currentSection = 'strategy';
      } else {
        if (currentSection) buffer.push(line);
      }
    }
    flush();

    return {
      segments,
      rawText,
      fullAudioText: rawText,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Test API key validity ──
  async function testApiKey(key) {
    try {
      const endpoint = `${CONFIG.gemini.endpoint}${CONFIG.gemini.model}:generateContent?key=${key}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say "API OK" only.' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  return { generateBriefing, testApiKey };

})();

window.AIEngine = AIEngine;
