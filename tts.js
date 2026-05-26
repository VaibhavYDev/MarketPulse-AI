// ============================================================
// MarketPulse AI — tts.js v3 (COMPLETE REWRITE)
//
// BUG FIXES:
// FIX 1: Chrome 15-second speechSynthesis silence bug
//         → keepalive timer calls synth.resume() every 12s
// FIX 2: pause() race condition — was calling synth.cancel()
//         which fires onerror='interrupted' before isPaused=true
//         → now uses a clean stopSignal + pauseSignal approach
// FIX 3: speak() async loop getting stuck on unresolved promises
//         → each utterance has its own 20s timeout fallback
// FIX 4: stop() not breaking out of async for-loop
//         → stopSignal flag checked at every await point
// FIX 5: Resume after pause was re-speaking from wrong index
//         → resumeFromIndex tracked explicitly
// ============================================================

const TTSEngine = (() => {

  const synth = window.speechSynthesis;

  let voices         = [];
  let selectedVoice  = null;
  let isPlaying      = false;
  let isPaused       = false;
  let stopSignal     = false;   // NEW: clean break signal for async loop
  let pauseSignal    = false;   // NEW: separate from isPaused state
  let sentences      = [];
  let resumeFromIdx  = 0;       // NEW: exact index to resume from
  let keepaliveTimer = null;    // NEW: Chrome silence-bug fix timer

  let onSentenceCallback = null;
  let onEndCallback      = null;
  let onStartCallback    = null;

  // ── Load voices ──
  function loadVoices() {
    return new Promise((resolve) => {
      voices = synth.getVoices();
      if (voices.length > 0) {
        selectBestVoice();
        resolve(voices);
        return;
      }
      synth.onvoiceschanged = () => {
        voices = synth.getVoices();
        selectBestVoice();
        resolve(voices);
      };
      // Fallback if onvoiceschanged never fires (some browsers)
      setTimeout(() => {
        if (voices.length === 0) {
          voices = synth.getVoices();
          selectBestVoice();
          resolve(voices);
        }
      }, 2000);
    });
  }

  function selectBestVoice() {
    selectedVoice =
      voices.find(v => v.lang === 'en-IN') ||
      voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('india')) ||
      voices.find(v => v.name.includes('Google UK English Male')) ||
      voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
      voices.find(v => v.lang.startsWith('en')) ||
      voices[0] || null;
    if (selectedVoice) {
      console.log('[TTS] Voice selected:', selectedVoice.name, selectedVoice.lang);
    }
  }

  function getVoiceList() {
    return voices.filter(v => v.lang.startsWith('en'));
  }

  function setVoice(name) {
    const v = voices.find(v => v.name === name);
    if (v) selectedVoice = v;
  }

  // ── FIX: Chrome 15s keepalive ──
  // Chrome stops TTS after ~15s of a long utterance or between sentences.
  // Calling synth.pause() + synth.resume() every 12s keeps it alive.
  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
      if (isPlaying && !isPaused && synth.speaking) {
        synth.pause();
        synth.resume();
      }
    }, 12000);
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  // ── Split text into short chunks for reliable TTS ──
  function splitIntoSentences(text) {
    // Clean any markdown that might have slipped through
    let clean = text
      .replace(/\*\*/g, '').replace(/#{1,6}\s/g, '')
      .replace(/\*/g, '').replace(/_/g, '')
      .replace(/\[|\]/g, '').replace(/\n{3,}/g, '\n\n');

    // Split on sentence boundaries
    const raw = clean.match(/[^.!?\n]+[.!?\n]+/g) || [clean];
    return raw
      .map(s => s.trim())
      .filter(s => s.length > 3);
  }

  // ── FIX: Single utterance with 20s hard timeout ──
  // Prevents the speak loop from hanging forever if onend never fires
  function speakOne(text) {
    return new Promise((resolve) => {
      if (stopSignal) { resolve(); return; }

      // Chrome bug: if tab is not focused, speak() may silently fail
      // Workaround: cancel any pending speech first
      synth.cancel();

      const utt     = new SpeechSynthesisUtterance(text);
      utt.voice     = selectedVoice;
      utt.rate      = CONFIG.tts.rate;
      utt.pitch     = CONFIG.tts.pitch;
      utt.volume    = CONFIG.tts.volume;
      utt.lang      = selectedVoice?.lang || 'en-IN';

      let resolved = false;

      const done = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(hardTimeout);
          resolve();
        }
      };

      // Hard timeout — if onend never fires (Chrome bug), move to next sentence anyway
      const hardTimeout = setTimeout(done, Math.max(20000, text.length * 80));

      utt.onend   = done;
      utt.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') {
          // Expected when stop() is called — just resolve
          done();
        } else {
          console.warn('[TTS] utterance error:', e.error);
          done();
        }
      };

      synth.speak(utt);
    });
  }

  // ── Main speak function ──
  async function speak(text, callbacks = {}) {
    // Stop any current playback cleanly
    await stop();

    onSentenceCallback = callbacks.onSentence || null;
    onEndCallback      = callbacks.onEnd      || null;
    onStartCallback    = callbacks.onStart    || null;

    sentences     = splitIntoSentences(text);
    resumeFromIdx = 0;
    stopSignal    = false;
    pauseSignal   = false;
    isPlaying     = true;
    isPaused      = false;

    if (onStartCallback) onStartCallback(sentences.length);

    startKeepalive();
    await runLoop(0);
  }

  // ── The playback loop — separated so resume can call it too ──
  async function runLoop(startIdx) {
    for (let i = startIdx; i < sentences.length; i++) {
      if (stopSignal) break;

      // Wait while paused
      while (pauseSignal && !stopSignal) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (stopSignal) break;

      resumeFromIdx = i;
      if (onSentenceCallback) onSentenceCallback(i, sentences[i]);

      await speakOne(sentences[i]);

      // Small breath between sentences
      if (!stopSignal && !pauseSignal && i < sentences.length - 1) {
        await new Promise(r => setTimeout(r, 180));
      }
    }

    if (!pauseSignal) {
      // Natural end
      isPlaying  = false;
      isPaused   = false;
      stopSignal = false;
      stopKeepalive();
      if (onEndCallback) onEndCallback();
    }
  }

  // ── FIX: Pause — no more synth.cancel() race condition ──
  function pause() {
    if (!isPlaying || isPaused) return;
    pauseSignal = true;
    isPaused    = true;
    synth.cancel(); // stop current utterance audio
    stopKeepalive();
    console.log('[TTS] Paused at sentence', resumeFromIdx);
  }

  // ── FIX: Resume — restarts loop from exact sentence ──
  function resume() {
    if (!isPaused) return;
    pauseSignal = false;
    isPaused    = false;
    stopSignal  = false;
    startKeepalive();
    console.log('[TTS] Resuming from sentence', resumeFromIdx);
    // The runLoop while(pauseSignal) will exit and continue
    // But if loop already exited, restart from resumeFromIdx
    runLoop(resumeFromIdx);
  }

  // ── FIX: Stop — clean break at next await point ──
  function stop() {
    return new Promise(resolve => {
      stopSignal  = true;
      pauseSignal = false;
      isPaused    = false;
      isPlaying   = false;
      resumeFromIdx = 0;
      stopKeepalive();
      synth.cancel();
      // Give the loop 100ms to break cleanly before resolving
      setTimeout(() => {
        stopSignal = false; // reset for next speak()
        resolve();
      }, 100);
    });
  }

  function togglePause() {
    if (!isPlaying) return;
    if (isPaused) resume();
    else pause();
  }

  function setRate(rate) {
    CONFIG.tts.rate = Math.min(2, Math.max(0.5, parseFloat(rate)));
    CONFIG.save('mp_tts_rate', CONFIG.tts.rate);
  }

  function setPitch(pitch) {
    CONFIG.tts.pitch = Math.min(2, Math.max(0.5, parseFloat(pitch)));
    CONFIG.save('mp_tts_pitch', CONFIG.tts.pitch);
  }

  function setVolume(volume) {
    CONFIG.tts.volume = Math.min(1, Math.max(0, parseFloat(volume)));
    CONFIG.save('mp_tts_vol', CONFIG.tts.volume);
  }

  function getState() {
    return {
      isPlaying, isPaused,
      currentSentenceIndex: resumeFromIdx,
      totalSentences: sentences.length,
    };
  }

  function testSpeak(text = 'MarketPulse AI is ready. Indian English voice active. Play, Pause, and Stop buttons are all working.') {
    synth.cancel();
    const utt   = new SpeechSynthesisUtterance(text);
    utt.voice   = selectedVoice;
    utt.rate    = CONFIG.tts.rate;
    utt.pitch   = CONFIG.tts.pitch;
    utt.volume  = CONFIG.tts.volume;
    utt.lang    = selectedVoice?.lang || 'en-IN';
    synth.speak(utt);
  }

  return {
    loadVoices, getVoiceList, setVoice,
    speak, pause, resume, stop, togglePause,
    setRate, setPitch, setVolume,
    getState, testSpeak,
    isSupported: () => 'speechSynthesis' in window,
  };

})();

window.TTSEngine = TTSEngine;
