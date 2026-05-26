// ============================================================
// MarketPulse AI — app.js v2 (COMPLETE REWRITE)
//
// FIX 1: Auto-refresh uses DataEngine.startAutoRefresh()
//         — 60s during market hours, 5min otherwise
// FIX 2: Live/LastClose/PreMkt badge from IST clock
// FIX 3: play/pause/stop wired to new async-safe TTS methods
// FIX 4: Gemini progress messages shown in UI during generation
// FIX 5: GEMINI_TIMEOUT and GEMINI_RATE_LIMIT error messages
// FIX 6: TTS stop() is now async — properly awaited before play
// ============================================================

const App = (() => {

  let state = {
    marketData:      null,
    briefing:        null,
    isGenerating:    false,
    isPlaying:       false,
    isPaused:        false,
    totalSentences:  0,
    voices:          [],
    selectedVoiceName: localStorage.getItem('mp_voice') || '',
  };

  const $ = id => document.getElementById(id);

  // ── Toast ──
  function toast(msg, type = 'info', duration = 4000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const container = $('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'all 0.3s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateX(100%)';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  // ── Clock ──
  function updateClock() {
    const clockEl = $('ist-clock');
    const dateEl  = $('ist-date');
    if (clockEl) clockEl.textContent = Scheduler.getCurrentISTTime();
    if (dateEl)  dateEl.textContent  = Scheduler.getCurrentISTDate();
  }

  // ── Market status badge ──
  function updateMarketStatus(status) {
    const badge = $('market-status-badge');
    const dot   = $('status-dot');
    const label = $('status-label');
    if (!badge) return;
    badge.style.borderColor = status.color + '50';
    badge.style.color       = status.color;
    badge.style.background  = status.color + '15';
    if (dot)   dot.style.background  = status.color;
    if (label) label.textContent     = status.label;
  }

  // ── Countdown ──
  function updateCountdown(detail) {
    const countdown = $('nb-countdown');
    const time      = $('nb-time');
    if (countdown) countdown.textContent = detail.countdown;
    if (time && detail.info) time.textContent = detail.info.label;
    updateMarketStatus(detail.marketStatus);
  }

  // ── Render asset cards ──
  function renderAssetCards(assets) {
    const eq  = $('equity-cards');
    const com = $('commodity-cards');
    if (!eq || !com) return;
    eq.innerHTML  = '';
    com.innerHTML = '';
    CONFIG.assets.equities.forEach(def => {
      const d = assets[def.id];
      if (d) eq.appendChild(buildAssetCard(d, def));
    });
    CONFIG.assets.commodities.forEach(def => {
      const d = assets[def.id];
      if (d) com.appendChild(buildAssetCard(d, def));
    });
  }

  function buildAssetCard(data, assetDef) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.id = `card-${data.id}`;
    card.style.setProperty('--card-accent', assetDef.color);

    const pct         = data.changePct;
    const changeClass = pct == null ? 'change-neutral' : pct > 0 ? 'change-positive' : 'change-negative';
    const arrow       = pct == null ? '' : pct > 0 ? '▲' : '▼';
    const priceStr    = data.formattedPrice ?? (data.hasData ? '...' : '—');
    const changeStr   = pct != null ? `${arrow} ${Math.abs(pct).toFixed(2)}%` : data.hasData ? 'Closed' : '—';
    const changeAmt   = data.change != null ? (data.change >= 0 ? '+' : '') + data.change.toFixed(2) : '';
    const pcrStr      = data.pcr !== 'N/A' ? `PCR ${data.pcr}` : '';

    // FIX: badge determined by IST clock state — not Yahoo's value
    const isLive    = data.marketState === 'REGULAR';
    const isClosed  = data.marketState === 'CLOSED' || data.marketState === 'POST';
    const isPre     = data.marketState === 'PRE';
    const stateBadge = isLive && data.hasData
      ? `<span class="live-tag">Live</span>`
      : isClosed && data.hasData
        ? `<span class="last-close-tag">Last Close</span>`
        : isPre && data.hasData
          ? `<span class="pre-market-tag">Pre-Mkt</span>`
          : '';

    const sentimentClass = getSentimentClass(data.sentiment);
    const sentimentDot   = getSentimentColor(data.sentiment);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-name">${data.shortSymbol} ${stateBadge}</div>
        <div class="sentiment-dot" style="background:${sentimentDot}"></div>
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

  function getSentimentClass(s) {
    if (!s) return 'sentiment-neutral';
    const l = s.toLowerCase();
    if (l.includes('bull')) return 'sentiment-bull';
    if (l.includes('bear')) return 'sentiment-bear';
    return 'sentiment-neutral';
  }

  function getSentimentColor(s) {
    if (!s) return 'var(--neutral-color)';
    const l = s.toLowerCase();
    if (l.includes('bull')) return 'var(--bull-color)';
    if (l.includes('bear')) return 'var(--bear-color)';
    return 'var(--neutral-color)';
  }

  // ── Render briefing ──
  function renderBriefing(briefing) {
    const body = $('briefing-body');
    if (!body) return;
    body.innerHTML = '';

    const allDefs = [...CONFIG.assets.equities, ...CONFIG.assets.commodities];

    briefing.segments.forEach(seg => {
      const section = document.createElement('div');
      section.className = 'briefing-asset-section';
      section.id = `briefing-${slugify(seg.asset)}`;

      const assetDef = allDefs.find(a => a.name.toLowerCase() === seg.asset.toLowerCase());
      const color    = assetDef?.color || 'var(--accent-cyan)';
      const isMaster = seg.asset === 'MASTER SUMMARY';

      if (isMaster) {
        section.classList.add('master-summary-card');
        section.innerHTML = `
          <div class="master-summary-title">⭐ Master Summary</div>
          <div class="phase-text">${wrapSentences(seg.strategy || seg.pulse || '')}</div>`;
      } else {
        section.innerHTML = `
          <div class="briefing-asset-header">
            <div class="briefing-asset-dot" style="background:${color}"></div>
            <div class="briefing-asset-name">${seg.asset}</div>
          </div>
          ${seg.pulse ? `<div class="briefing-phase">
            <div class="phase-label">The Pulse</div>
            <div class="phase-text">${wrapSentences(seg.pulse)}</div></div>` : ''}
          ${seg.metrics ? `<div class="briefing-phase">
            <div class="phase-label">The Metrics</div>
            <div class="phase-text">${wrapSentences(seg.metrics)}</div></div>` : ''}
          ${seg.strategy ? `<div class="briefing-phase">
            <div class="phase-label">The Strategy</div>
            <div class="phase-text">${wrapSentences(seg.strategy)}</div></div>` : ''}`;
      }
      body.appendChild(section);
    });

    const prog = $('audio-progress');
    if (prog) prog.style.display = 'block';
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
    const el = document.getElementById(`briefing-${slugify(id)}`)
            || document.querySelector('.briefing-asset-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Generating state UI ──
  function showGeneratingState(message = 'Gemini AI is synthesizing your full market briefing...') {
    const body = $('briefing-body');
    if (!body) return;
    body.innerHTML = `
      <div class="generating-indicator">
        <div class="gen-dots"><span></span><span></span><span></span></div>
        <span id="gen-progress-msg">${message}</span>
      </div>
      ${Array(6).fill(0).map((_, i) => `
        <div style="padding:0 4px; margin-bottom:20px;">
          <div class="loading-shimmer" style="width:${30+i*5}%; height:10px; margin-bottom:6px;"></div>
          <div class="loading-shimmer" style="width:100%; height:12px; margin-bottom:4px;"></div>
          <div class="loading-shimmer" style="width:90%; height:12px; margin-bottom:4px;"></div>
          <div class="loading-shimmer" style="width:95%; height:12px;"></div>
        </div>`).join('')}`;
  }

  function showPlaceholder() {
    const body = $('briefing-body');
    if (!body) return;
    body.innerHTML = `
      <div class="briefing-placeholder">
        <div class="icon">🎙️</div>
        <h3>Your Briefing Awaits</h3>
        <p>Click "Generate Briefing" to get the full AI analysis across all 8 assets and 7 timeframes.</p>
        <p style="margin-top:12px; font-size:12px; color:var(--text-muted);">Set your Gemini API key in ⚙️ Settings first.</p>
      </div>`;
  }

  // ── Audio control state ──
  function updateAudioControls() {
    const { isPlaying, isPaused } = state;
    const playBtn  = $('btn-play');
    const pauseBtn = $('btn-pause');
    const stopBtn  = $('btn-stop');
    if (playBtn)  playBtn.disabled  = isPlaying && !isPaused;
    if (pauseBtn) {
      pauseBtn.disabled = !isPlaying;
      pauseBtn.innerHTML = isPaused ? '▶ Resume' : '⏸ Pause';
    }
    if (stopBtn) stopBtn.disabled = !isPlaying;
  }

  // ── Progress bar ──
  function updateProgress(idx, total) {
    const fill    = $('progress-fill');
    const current = $('progress-current');
    const totalEl = $('progress-total');
    if (!fill) return;
    fill.style.width = total > 0 ? `${(idx / total) * 100}%` : '0%';
    if (current) current.textContent = idx;
    if (totalEl) totalEl.textContent = total;
    document.querySelectorAll('.sentence').forEach(el => el.classList.remove('speaking'));
    const el = document.querySelector(`.sentence[data-idx="${idx}"]`);
    if (el) { el.classList.add('speaking'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }

  // ── Voice dropdown ──
  function populateVoiceDropdown(voices) {
    const sel = $('voice-select');
    if (!sel) return;
    sel.innerHTML = '';
    const engVoices = voices.filter(v => v.lang.startsWith('en'));
    engVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === state.selectedVoiceName) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!state.selectedVoiceName) {
      const indian = engVoices.find(v => v.lang === 'en-IN');
      if (indian) { sel.value = indian.name; state.selectedVoiceName = indian.name; }
    }
  }

  // ── Generate briefing ──
  async function generateBriefing(triggerInfo = null) {
    if (state.isGenerating) return;
    const apiKey = CONFIG.keys.gemini();
    if (!apiKey) {
      toast('Set your Gemini API key in Settings first.', 'error');
      openSettings();
      return;
    }

    state.isGenerating = true;
    const genBtn = $('btn-generate');
    if (genBtn) { genBtn.disabled = true; genBtn.textContent = '⏳ Generating...'; }

    showGeneratingState();
    await TTSEngine.stop();

    // Listen for Gemini progress messages and update UI
    const progressHandler = (e) => {
      const msgEl = $('gen-progress-msg');
      if (msgEl) msgEl.textContent = e.detail.message;
    };
    window.addEventListener('mp:aiProgress', progressHandler);

    try {
      toast('Fetching live market data...', 'info', 2500);
      state.marketData = await DataEngine.fetchAllMarketData();
      renderAssetCards(state.marketData.assets);

      const label = triggerInfo ? ` (${triggerInfo.type})` : '';
      toast(`Generating AI briefing${label}... this takes 15-30s`, 'info', 8000);

      state.briefing = await AIEngine.generateBriefing(state.marketData);

      renderBriefing(state.briefing);

      localStorage.setItem('mp_last_briefing', JSON.stringify({
        text: state.briefing.rawText,
        time: new Date().toISOString(),
      }));

      toast('Briefing ready! Press ▶ Play to listen.', 'success');

      if (triggerInfo) setTimeout(() => playBriefing(), 1500);

    } catch(err) {
      console.error('[App] Generation error:', err);
      const msgs = {
        'GEMINI_KEY_MISSING':  'Gemini API key not set. Go to ⚙️ Settings.',
        'GEMINI_KEY_INVALID':  'Invalid Gemini API key. Check ⚙️ Settings.',
        'GEMINI_EMPTY_RESPONSE': 'Gemini returned empty response. Try again.',
        'GEMINI_TIMEOUT':      'Gemini timed out (45s). Check your internet or try again.',
        'GEMINI_RATE_LIMIT':   'Rate limit hit. Wait 30 seconds and try again.',
      };
      toast(msgs[err.message] || `Error: ${err.message}`, 'error', 8000);
      showPlaceholder();
    } finally {
      window.removeEventListener('mp:aiProgress', progressHandler);
      state.isGenerating = false;
      if (genBtn) { genBtn.disabled = false; genBtn.innerHTML = '✨ Generate Briefing'; }
    }
  }

  // ── Play ──
  function playBriefing() {
    if (!state.briefing) {
      toast('No briefing yet. Generate one first.', 'warning');
      return;
    }
    if (state.isPlaying && !state.isPaused) return;

    // If paused — resume instead of restart
    if (state.isPaused) {
      state.isPaused = false;
      TTSEngine.resume();
      updateAudioControls();
      return;
    }

    state.isPlaying = true;
    state.isPaused  = false;
    updateAudioControls();

    TTSEngine.speak(state.briefing.fullAudioText, {
      onStart: (total) => {
        state.totalSentences = total;
        state.isPlaying = true;
        updateAudioControls();
      },
      onSentence: (idx) => {
        state.currentSentenceIdx = idx;
        updateProgress(idx, state.totalSentences);
      },
      onEnd: () => {
        state.isPlaying = false;
        state.isPaused  = false;
        updateAudioControls();
        updateProgress(state.totalSentences, state.totalSentences);
        toast('Briefing complete.', 'success', 2000);
      },
    });
  }

  // ── Pause / Resume ──
  function togglePause() {
    if (!state.isPlaying) return;
    state.isPaused = !state.isPaused;
    TTSEngine.togglePause();
    updateAudioControls();
  }

  // ── Stop ──
  async function stopPlayback() {
    await TTSEngine.stop();
    state.isPlaying = false;
    state.isPaused  = false;
    updateAudioControls();
    updateProgress(0, state.totalSentences);
  }

  // ── Settings ──
  function openSettings() {
    $('settings-modal').classList.remove('hidden');
    $('input-gemini-key').value    = CONFIG.keys.gemini();
    $('input-angel-key').value     = CONFIG.keys.angelOne();
    $('input-angel-client').value  = CONFIG.keys.angelClientCode();
    $('speed-slider').value        = CONFIG.tts.rate;
    $('speed-val').textContent     = CONFIG.tts.rate.toFixed(1) + 'x';
  }

  function closeSettings() {
    $('settings-modal').classList.add('hidden');
  }

  function saveSettings() {
    CONFIG.save('mp_gemini_key',   $('input-gemini-key').value.trim());
    CONFIG.save('mp_angel_key',    $('input-angel-key').value.trim());
    CONFIG.save('mp_angel_client', $('input-angel-client').value.trim());
    closeSettings();
    toast('Settings saved.', 'success');
    const key = CONFIG.keys.gemini();
    if (key) {
      AIEngine.testApiKey(key).then(ok =>
        toast(ok ? '✅ Gemini key valid!' : '❌ Gemini key invalid.', ok ? 'success' : 'error')
      );
    }
  }

  // ── Load last briefing ──
  function loadLastBriefing() {
    try {
      const saved = localStorage.getItem('mp_last_briefing');
      if (!saved) return;
      const { text, time } = JSON.parse(saved);
      const ago = Math.round((Date.now() - new Date(time).getTime()) / 60000);
      if (ago < 480) {
        state.briefing = { fullAudioText: text, rawText: text, segments: [], generatedAt: time };
        const body = $('briefing-body');
        if (body) {
          body.innerHTML = `
            <div style="padding:12px 16px; margin-bottom:20px; border-radius:8px;
              background:rgba(0,212,255,0.06); border:1px solid rgba(0,212,255,0.15);
              font-size:12px; color:var(--text-muted);">
              📂 Last briefing from ${ago} min ago. Press ▶ Play to replay or generate a new one.
            </div>
            <div class="phase-text" style="white-space:pre-wrap; font-size:14px; line-height:1.8;">${text}</div>`;
          const prog = $('audio-progress');
          if (prog) prog.style.display = 'block';
        }
      }
    } catch { /* ignore */ }
  }

  // ── Init ──
  async function init() {
    console.log('[App] MarketPulse AI initializing...');

    updateClock();
    setInterval(updateClock, 1000);

    if (TTSEngine.isSupported()) {
      state.voices = await TTSEngine.loadVoices();
      populateVoiceDropdown(TTSEngine.getVoiceList());
    } else {
      toast('Web Speech API not supported. Please use Chrome or Edge.', 'error', 8000);
    }

    loadLastBriefing();
    if (!state.briefing) showPlaceholder();

    window.addEventListener('mp:countdown', e => updateCountdown(e.detail));

    Scheduler.start(async (triggerInfo) => {
      toast(`Auto-briefing: ${triggerInfo.type}`, 'info');
      await generateBriefing(triggerInfo);
    });

    // Wire all buttons
    $('btn-generate')?.addEventListener('click', () => generateBriefing());

    // FIX: Play button — handles both fresh play and resume
    $('btn-play')?.addEventListener('click', () => playBriefing());

    // FIX: Pause wired to async-safe togglePause
    $('btn-pause')?.addEventListener('click', () => togglePause());

    // FIX: Stop wired to async stop
    $('btn-stop')?.addEventListener('click', () => stopPlayback());

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

    $('settings-modal')?.addEventListener('click', e => {
      if (e.target === $('settings-modal')) closeSettings();
    });

    // Manual refresh button
    $('btn-refresh')?.addEventListener('click', async () => {
      toast('Refreshing prices...', 'info', 2000);
      try {
        const data = await DataEngine.forceRefresh();
        renderAssetCards(data.assets);
        toast('Prices updated.', 'success', 2000);
      } catch(e) {
        toast('Refresh failed. Try again.', 'error', 3000);
      }
    });

    // Initial data fetch
    try {
      toast('Loading live market prices...', 'info', 3000);
      const data = await DataEngine.fetchAllMarketData();
      renderAssetCards(data.assets);
      const count = Object.values(data.assets).filter(a => a.hasData).length;
      if (count > 0) {
        const label = data.isMarketOpen ? 'Live' : 'Last close';
        toast(`${label} prices loaded — ${count}/8 assets.`, 'success', 3000);
      } else {
        toast('Price fetch failed. Retrying in 15s...', 'warning', 4000);
        setTimeout(() => DataEngine.forceRefresh().then(d => renderAssetCards(d.assets)).catch(()=>{}), 15000);
      }
    } catch(e) {
      console.warn('[App] Initial fetch failed:', e);
      toast('Could not load prices. Check connection.', 'warning', 4000);
    }

    // FIX: Dynamic auto-refresh — 60s live, 5min closed
    DataEngine.startAutoRefresh((data) => {
      renderAssetCards(data.assets);
      console.log('[App] Prices auto-refreshed at', new Date().toLocaleTimeString('en-IN'));
    });

    // API key prompt
    if (!CONFIG.keys.gemini()) {
      setTimeout(() => toast('Set your Gemini API key in ⚙️ Settings to enable AI briefings.', 'info', 6000), 2000);
    } else {
      setTimeout(() => toast('MarketPulse AI ready. Gemini key active.', 'success', 3000), 1500);
    }

    console.log('[App] Initialized.');
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', App.init);
