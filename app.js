// ============================================================
// MarketPulse AI — app.js
// Main application controller: UI, state, event wiring
// ============================================================

const App = (() => {

  // ── State ──
  let state = {
    marketData: null,
    briefing: null,
    isGenerating: false,
    isPlaying: false,
    isPaused: false,
    currentSentenceIdx: 0,
    totalSentences: 0,
    voices: [],
    selectedVoiceName: localStorage.getItem('mp_voice') || '',
  };

  // ── DOM references ──
  const $ = id => document.getElementById(id);

  // ── Toast notifications ──
  function toast(msg, type = 'info', duration = 4000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const container = $('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'none';
      t.style.opacity = '0';
      t.style.transform = 'translateX(100%)';
      t.style.transition = 'all 0.3s ease';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  // ── Update clock ──
  function updateClock() {
    const clockEl = $('ist-clock');
    const dateEl = $('ist-date');
    if (clockEl) clockEl.textContent = Scheduler.getCurrentISTTime();
    if (dateEl) dateEl.textContent = Scheduler.getCurrentISTDate();
  }

  // ── Update market status badge ──
  function updateMarketStatus(status) {
    const badge = $('market-status-badge');
    const dot = $('status-dot');
    const label = $('status-label');
    if (!badge) return;
    badge.style.borderColor = status.color + '50';
    badge.style.color = status.color;
    badge.style.background = status.color + '15';
    if (dot) dot.style.background = status.color;
    if (label) label.textContent = status.label;
  }

  // ── Update countdown ──
  function updateCountdown(detail) {
    const countdown = $('nb-countdown');
    const time = $('nb-time');
    if (countdown) countdown.textContent = detail.countdown;
    if (time && detail.info) time.textContent = detail.info.label;
    updateMarketStatus(detail.marketStatus);

    // Highlight active briefing time pill
    const currentIST = new Date().toLocaleString('en-US', {timeZone:'Asia/Kolkata'});
    const currentHour = new Date(currentIST).getHours();
    ['pill-845', 'pill-1200', 'pill-1535'].forEach((id, i) => {
      const el = $(id);
      if (!el) return;
      el.classList.remove('active');
    });
  }

  // ── Render asset cards ──
  function renderAssetCards(assets) {
    const equityContainer = $('equity-cards');
    const commodityContainer = $('commodity-cards');
    if (!equityContainer || !commodityContainer) return;

    equityContainer.innerHTML = '';
    commodityContainer.innerHTML = '';

    CONFIG.assets.equities.forEach(assetDef => {
      const data = assets[assetDef.id];
      if (!data) return;
      equityContainer.appendChild(buildAssetCard(data, assetDef));
    });

    CONFIG.assets.commodities.forEach(assetDef => {
      const data = assets[assetDef.id];
      if (!data) return;
      commodityContainer.appendChild(buildAssetCard(data, assetDef));
    });
  }

  function buildAssetCard(data, assetDef) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.id = `card-${data.id}`;
    card.style.setProperty('--card-accent', assetDef.color);

    const pct = data.changePct;
    const changeClass = pct == null ? 'change-neutral' : pct > 0 ? 'change-positive' : 'change-negative';
    const arrow = pct == null ? '' : pct > 0 ? '▲' : '▼';
    const sentimentClass = getSentimentClass(data.sentiment);
    const sentimentDotColor = getSentimentColor(data.sentiment);

    // Price display — use pre-formatted string from data engine
    const priceStr = data.formattedPrice ?? (data.hasData ? '...' : '—');

    // Change display
    const changeStr = pct != null
      ? `${arrow} ${Math.abs(pct).toFixed(2)}%`
      : data.hasData ? 'Closed' : '—';

    // Change amount
    const changeAmt = data.change != null
      ? (data.change >= 0 ? '+' : '') + data.change.toFixed(2)
      : '';

    const pcrStr = data.pcr !== 'N/A' ? `PCR ${data.pcr}` : '';

    // Market state badge — FIX: use IST-based state, not Yahoo's value
    const isLiveMarket = data.marketState === 'REGULAR';
    const isClosed     = data.marketState === 'CLOSED' || data.marketState === 'POST';
    const isPreMarket  = data.marketState === 'PRE';
    const stateBadge = isLiveMarket && data.hasData
      ? `<span class="live-tag">Live</span>`
      : isClosed && data.hasData
        ? `<span class="last-close-tag">Last Close</span>`
        : isPreMarket
          ? `<span class="pre-market-tag">Pre-Mkt</span>`
          : '';

    card.innerHTML = `
      <div class="card-header">
        <div class="card-name">${data.shortSymbol} ${stateBadge}</div>
        <div class="sentiment-dot" style="background:${sentimentDotColor}"></div>
      </div>
      <div class="card-price" title="${data.name}">${priceStr}</div>
      <div class="card-change ${changeClass}">
        <span class="change-pct">${changeStr}</span>
        ${changeAmt ? `<span class="change-amt">${changeAmt}</span>` : ''}
      </div>
      <div class="card-footer">
        <div class="pcr-badge">${pcrStr}</div>
        <div class="sentiment-badge ${sentimentClass}">${data.sentiment}</div>
      </div>
    `;

    card.addEventListener('click', () => scrollToBriefingAsset(data.id));
    return card;
  }

  function getSentimentClass(sentiment) {
    if (!sentiment) return 'sentiment-neutral';
    const s = sentiment.toLowerCase();
    if (s.includes('bull')) return 'sentiment-bull';
    if (s.includes('bear')) return 'sentiment-bear';
    return 'sentiment-neutral';
  }

  function getSentimentColor(sentiment) {
    if (!sentiment) return 'var(--neutral-color)';
    const s = sentiment.toLowerCase();
    if (s.includes('bull')) return 'var(--bull-color)';
    if (s.includes('bear')) return 'var(--bear-color)';
    return 'var(--neutral-color)';
  }

  // ── Render briefing text ──
  function renderBriefing(briefing) {
    const body = $('briefing-body');
    if (!body) return;
    body.innerHTML = '';

    const allAssetDefs = [...CONFIG.assets.equities, ...CONFIG.assets.commodities];

    briefing.segments.forEach(seg => {
      const section = document.createElement('div');
      section.className = 'briefing-asset-section';
      section.id = `briefing-${slugify(seg.asset)}`;

      const assetDef = allAssetDefs.find(a => a.name.toLowerCase() === seg.asset.toLowerCase());
      const color = assetDef?.color || 'var(--accent-cyan)';
      const isMaster = seg.asset === 'MASTER SUMMARY';

      if (isMaster) {
        section.classList.add('master-summary-card');
        section.innerHTML = `
          <div class="master-summary-title">⭐ Master Summary</div>
          <div class="phase-text">${wrapSentences(seg.strategy || seg.pulse || '')}</div>
        `;
      } else {
        section.innerHTML = `
          <div class="briefing-asset-header">
            <div class="briefing-asset-dot" style="background:${color}"></div>
            <div class="briefing-asset-name">${seg.asset}</div>
          </div>
          ${seg.pulse ? `
          <div class="briefing-phase">
            <div class="phase-label">The Pulse</div>
            <div class="phase-text">${wrapSentences(seg.pulse)}</div>
          </div>` : ''}
          ${seg.metrics ? `
          <div class="briefing-phase">
            <div class="phase-label">The Metrics</div>
            <div class="phase-text">${wrapSentences(seg.metrics)}</div>
          </div>` : ''}
          ${seg.strategy ? `
          <div class="briefing-phase">
            <div class="phase-label">The Strategy</div>
            <div class="phase-text">${wrapSentences(seg.strategy)}</div>
          </div>` : ''}
        `;
      }

      body.appendChild(section);
    });

    // Show progress bar
    const progressEl = $('audio-progress');
    if (progressEl) progressEl.style.display = 'block';
  }

  function wrapSentences(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.map((s, i) =>
      `<span class="sentence" data-idx="${i}">${s.trim()} </span>`
    ).join('');
  }

  function slugify(str) {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function scrollToBriefingAsset(id) {
    const slugId = `briefing-${slugify(id.replace(/[0-9]/g, match => {
      const map = { '5': 'five', '0': 'zero' };
      return map[match] || match;
    }))}`;
    const el = document.getElementById(slugId) || document.querySelector('.briefing-asset-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Show loading shimmer ──
  function showGeneratingState() {
    const body = $('briefing-body');
    if (!body) return;
    body.innerHTML = `
      <div class="generating-indicator">
        <div class="gen-dots"><span></span><span></span><span></span></div>
        <span>Gemini AI is synthesizing your full market briefing. Pulling live data, options flow, and technical signals...</span>
      </div>
      ${Array(6).fill(0).map((_, i) => `
        <div style="padding: 0 4px; margin-bottom: 20px;">
          <div class="loading-shimmer" style="width:${30+i*5}%; height:10px; margin-bottom:6px;"></div>
          <div class="loading-shimmer" style="width:100%; height:12px; margin-bottom:4px;"></div>
          <div class="loading-shimmer" style="width:90%; height:12px; margin-bottom:4px;"></div>
          <div class="loading-shimmer" style="width:95%; height:12px;"></div>
        </div>
      `).join('')}
    `;
  }

  // ── Show placeholder ──
  function showPlaceholder() {
    const body = $('briefing-body');
    if (!body) return;
    body.innerHTML = `
      <div class="briefing-placeholder">
        <div class="icon">🎙️</div>
        <h3>Your Briefing Awaits</h3>
        <p>Click "Generate Briefing" to run the full analytical engine across all 8 assets and all timeframes. The bot will auto-trigger at 8:45 AM, 12:00 PM, and 3:35 PM on every trading day.</p>
        <p style="margin-top:12px; font-size:12px; color:var(--text-muted);">Make sure you have set your Gemini API key in Settings first.</p>
      </div>
    `;
  }

  // ── Update audio controls state ──
  function updateAudioControls() {
    const { isPlaying, isPaused } = state;
    const playBtn = $('btn-play');
    const pauseBtn = $('btn-pause');
    const stopBtn = $('btn-stop');

    if (playBtn) playBtn.disabled = isPlaying && !isPaused;
    if (pauseBtn) {
      pauseBtn.disabled = !isPlaying;
      pauseBtn.innerHTML = isPaused ? '▶ Resume' : '⏸ Pause';
    }
    if (stopBtn) stopBtn.disabled = !isPlaying;
  }

  // ── Update progress bar ──
  function updateProgress(idx, total) {
    const fill = $('progress-fill');
    const current = $('progress-current');
    const totalEl = $('progress-total');
    if (!fill) return;
    const pct = total > 0 ? (idx / total) * 100 : 0;
    fill.style.width = `${pct}%`;
    if (current) current.textContent = idx;
    if (totalEl) totalEl.textContent = total;

    // Highlight current sentence
    document.querySelectorAll('.sentence').forEach(el => el.classList.remove('speaking'));
    const speaking = document.querySelector(`.sentence[data-idx="${idx}"]`);
    if (speaking) {
      speaking.classList.add('speaking');
      speaking.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ── Populate voice dropdown ──
  function populateVoiceDropdown(voices) {
    const sel = $('voice-select');
    if (!sel) return;
    sel.innerHTML = '';
    const englishVoices = voices.filter(v => v.lang.startsWith('en'));
    englishVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === state.selectedVoiceName) opt.selected = true;
      sel.appendChild(opt);
    });
    // Auto-select Indian English
    if (!state.selectedVoiceName) {
      const indianVoice = englishVoices.find(v => v.lang === 'en-IN');
      if (indianVoice) {
        sel.value = indianVoice.name;
        state.selectedVoiceName = indianVoice.name;
      }
    }
  }

  // ── Core: Generate briefing ──
  async function generateBriefing(triggerInfo = null) {
    if (state.isGenerating) return;

    const apiKey = CONFIG.keys.gemini();
    if (!apiKey) {
      toast('Please set your Gemini API key in Settings first.', 'error');
      openSettings();
      return;
    }

    state.isGenerating = true;
    const genBtn = $('btn-generate');
    if (genBtn) { genBtn.disabled = true; genBtn.textContent = '⏳ Generating...'; }

    showGeneratingState();
    TTSEngine.stop();

    try {
      // Step 1: Fetch market data
      toast('Fetching live market data...', 'info', 2500);
      state.marketData = await DataEngine.fetchAllMarketData();
      renderAssetCards(state.marketData.assets);

      // Step 2: Generate AI briefing
      const sessionLabel = triggerInfo ? ` (${triggerInfo.type})` : '';
      toast(`Generating AI briefing${sessionLabel}...`, 'info', 3000);
      state.briefing = await AIEngine.generateBriefing(state.marketData);

      // Step 3: Render
      renderBriefing(state.briefing);

      // Step 4: Save to localStorage for persistence
      localStorage.setItem('mp_last_briefing', JSON.stringify({
        text: state.briefing.rawText,
        time: new Date().toISOString(),
      }));

      toast('Briefing ready! Press Play to listen.', 'success');

      // Step 5: Auto-play if triggered by scheduler
      if (triggerInfo) {
        setTimeout(() => playBriefing(), 1500);
      }

    } catch (err) {
      console.error('[App] Generation error:', err);
      const msgs = {
        'GEMINI_KEY_MISSING': 'Gemini API key not set. Go to Settings.',
        'GEMINI_KEY_INVALID': 'Invalid Gemini API key. Check Settings.',
        'GEMINI_EMPTY_RESPONSE': 'Gemini returned an empty response. Try again.',
      };
      toast(msgs[err.message] || `Error: ${err.message}`, 'error', 6000);
      showPlaceholder();
    } finally {
      state.isGenerating = false;
      if (genBtn) { genBtn.disabled = false; genBtn.innerHTML = '✨ Generate Briefing'; }
    }
  }

  // ── Play briefing ──
  function playBriefing() {
    if (!state.briefing) {
      toast('No briefing available. Generate one first.', 'warning');
      return;
    }

    state.isPlaying = true;
    state.isPaused = false;
    updateAudioControls();

    TTSEngine.speak(state.briefing.fullAudioText, {
      onStart: (total) => {
        state.totalSentences = total;
        state.isPlaying = true;
        updateAudioControls();
      },
      onSentence: (idx, sentence) => {
        state.currentSentenceIdx = idx;
        updateProgress(idx, state.totalSentences);
      },
      onEnd: () => {
        state.isPlaying = false;
        state.isPaused = false;
        updateAudioControls();
        updateProgress(state.totalSentences, state.totalSentences);
        toast('Briefing complete.', 'success', 2000);
      },
    });
  }

  // ── Pause/Resume ──
  function togglePause() {
    state.isPaused = !state.isPaused;
    TTSEngine.togglePause();
    updateAudioControls();
  }

  // ── Stop ──
  function stopPlayback() {
    TTSEngine.stop();
    state.isPlaying = false;
    state.isPaused = false;
    updateAudioControls();
    updateProgress(0, state.totalSentences);
  }

  // ── Settings modal ──
  function openSettings() {
    $('settings-modal').classList.remove('hidden');
    $('input-gemini-key').value = CONFIG.keys.gemini();
    $('input-angel-key').value = CONFIG.keys.angelOne();
    $('input-angel-client').value = CONFIG.keys.angelClientCode();
    $('speed-slider').value = CONFIG.tts.rate;
    $('speed-val').textContent = CONFIG.tts.rate.toFixed(1) + 'x';
  }

  function closeSettings() {
    $('settings-modal').classList.add('hidden');
  }

  function saveSettings() {
    const gemKey = $('input-gemini-key').value.trim();
    const angelKey = $('input-angel-key').value.trim();
    const angelClient = $('input-angel-client').value.trim();

    CONFIG.save('mp_gemini_key', gemKey);
    CONFIG.save('mp_angel_key', angelKey);
    CONFIG.save('mp_angel_client', angelClient);

    closeSettings();
    toast('Settings saved.', 'success');

    if (gemKey) {
      AIEngine.testApiKey(gemKey).then(ok => {
        toast(ok ? '✅ Gemini API key is valid!' : '❌ Gemini API key invalid. Check again.', ok ? 'success' : 'error');
      });
    }
  }

  // ── Load persisted briefing ──
  function loadLastBriefing() {
    const saved = localStorage.getItem('mp_last_briefing');
    if (!saved) return;
    try {
      const { text, time } = JSON.parse(saved);
      const ago = Math.round((Date.now() - new Date(time).getTime()) / 60000);
      if (ago < 480) { // Less than 8 hours old
        state.briefing = { fullAudioText: text, rawText: text, segments: [], generatedAt: time };
        const body = $('briefing-body');
        if (body) {
          body.innerHTML = `
            <div style="padding:12px 16px; margin-bottom:20px; border-radius:8px; background:rgba(0,212,255,0.06); border:1px solid rgba(0,212,255,0.15); font-size:12px; color:var(--text-muted);">
              📂 Last briefing from ${ago} minute${ago !== 1 ? 's' : ''} ago. Generate a new one or press Play to replay.
            </div>
            <div class="phase-text" style="white-space:pre-wrap; font-size:14px; line-height:1.8;">${text}</div>
          `;
          const progressEl = $('audio-progress');
          if (progressEl) progressEl.style.display = 'block';
        }
      }
    } catch { /* ignore */ }
  }

  // ── Initialize ──
  async function init() {
    console.log('[App] MarketPulse AI v1.0 initializing...');

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Load voices
    if (TTSEngine.isSupported()) {
      state.voices = await TTSEngine.loadVoices();
      populateVoiceDropdown(TTSEngine.getVoiceList());
    } else {
      toast('Web Speech API not supported. Use Chrome or Edge.', 'error', 8000);
    }

    // Load last briefing if available
    loadLastBriefing();
    if (!state.briefing) showPlaceholder();

    // Event: scheduler countdown
    window.addEventListener('mp:countdown', e => updateCountdown(e.detail));

    // Event: scheduler briefing trigger
    Scheduler.start(async (triggerInfo) => {
      toast(`Auto-briefing triggered: ${triggerInfo.type}`, 'info');
      await generateBriefing(triggerInfo);
    });

    // Wire UI events
    $('btn-generate')?.addEventListener('click', () => generateBriefing());
    $('btn-play')?.addEventListener('click', playBriefing);
    $('btn-pause')?.addEventListener('click', togglePause);
    $('btn-stop')?.addEventListener('click', stopPlayback);
    $('btn-settings')?.addEventListener('click', openSettings);
    $('btn-close-settings')?.addEventListener('click', closeSettings);
    $('btn-save-settings')?.addEventListener('click', saveSettings);
    $('btn-cancel-settings')?.addEventListener('click', closeSettings);
    $('btn-test-voice')?.addEventListener('click', () => TTSEngine.testSpeak());

    $('voice-select')?.addEventListener('change', e => {
      TTSEngine.setVoice(e.target.value);
      state.selectedVoiceName = e.target.value;
      CONFIG.save('mp_voice', e.target.value);
    });

    $('speed-slider')?.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      TTSEngine.setRate(val);
      $('speed-val').textContent = val.toFixed(1) + 'x';
    });

    // Close modal on overlay click
    $('settings-modal')?.addEventListener('click', e => {
      if (e.target === $('settings-modal')) closeSettings();
    });

    // Initial data fetch
    try {
      const data = await DataEngine.fetchAllMarketData();
      renderAssetCards(data.assets);
      const count = Object.values(data.assets).filter(a => a.hasData).length;
      if (count > 0) {
        const label = data.isMarketOpen ? 'Live' : 'Last close';
        toast(`${label} prices loaded for ${count}/8 assets.`, 'success', 3000);
      } else {
        toast('Fetching prices... retrying in 10s.', 'info', 3000);
        setTimeout(() => DataEngine.forceRefresh().then(d => renderAssetCards(d.assets)).catch(()=>{}), 10000);
      }
    } catch (e) {
      console.warn('[App] Initial data fetch failed:', e);
      toast('Price fetch failed. Will retry.', 'warning', 4000);
    }

    // Auto-refresh prices — 60s during market hours, 5min otherwise
    function scheduleRefresh() {
      const interval = DataEngine.isMarketOpen() ? 60 * 1000 : 5 * 60 * 1000;
      setTimeout(async () => {
        try {
          const data = await DataEngine.fetchAllMarketData();
          renderAssetCards(data.assets);
        } catch { /* silent */ }
        scheduleRefresh(); // reschedule dynamically
      }, interval);
    }
    scheduleRefresh();

    // Manual refresh button (⟳) wired if present
    $('btn-refresh')?.addEventListener('click', async () => {
      toast('Refreshing prices...', 'info', 2000);
      const data = await DataEngine.forceRefresh();
      renderAssetCards(data.assets);
      toast('Prices updated.', 'success', 2000);
    });

    // Persist default key to localStorage on first run
    if (!localStorage.getItem('mp_gemini_key') && CONFIG._defaultGeminiKey) {
      CONFIG.save('mp_gemini_key', CONFIG._defaultGeminiKey);
      console.log('[App] Default Gemini key persisted to localStorage.');
    }

    // Prompt for API key if not set
    if (!CONFIG.keys.gemini()) {
      setTimeout(() => {
        toast('Set your Gemini API key in Settings to activate AI briefings.', 'info', 6000);
      }, 2000);
    } else {
      setTimeout(() => {
        toast('MarketPulse AI is ready. Gemini key active.', 'success', 3000);
      }, 1500);
    }

    console.log('[App] Initialized.');
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', App.init);
