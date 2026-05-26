// ============================================================
// MarketPulse AI — tts.js
// Text-to-Speech engine using Web Speech API
// Indian English preferred voice, full playback controls
// ============================================================

const TTSEngine = (() => {

  const synth = window.speechSynthesis;
  let voices = [];
  let selectedVoice = null;
  let currentUtterances = [];
  let isPaused = false;
  let isPlaying = false;
  let currentSentenceIndex = 0;
  let sentences = [];
  let onSentenceCallback = null;
  let onEndCallback = null;
  let onStartCallback = null;

  // ── Load available voices ──
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
    });
  }

  function selectBestVoice() {
    // Priority 1: Indian English
    selectedVoice = voices.find(v => v.lang === 'en-IN') ||
    // Priority 2: Any English with Indian in name
    voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('india')) ||
    // Priority 3: Google UK English (clean, authoritative)
    voices.find(v => v.name.includes('Google UK English Male')) ||
    // Priority 4: Any Google English
    voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
    // Priority 5: Any English
    voices.find(v => v.lang.startsWith('en')) ||
    // Fallback
    voices[0];
    console.log('[TTSEngine] Selected voice:', selectedVoice?.name, selectedVoice?.lang);
  }

  function getVoiceList() {
    return voices.filter(v => v.lang.startsWith('en'));
  }

  function setVoice(voiceName) {
    selectedVoice = voices.find(v => v.name === voiceName) || selectedVoice;
  }

  // ── Split text into speakable sentences ──
  function splitIntoSentences(text) {
    // Clean markdown artifacts if any slipped through
    let clean = text
      .replace(/\*\*/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\*/g, '')
      .replace(/\_/g, '')
      .replace(/\[|\]/g, '');

    // Split on sentence boundaries
    const raw = clean.match(/[^.!?]+[.!?]+/g) || [clean];
    return raw.map(s => s.trim()).filter(s => s.length > 3);
  }

  // ── Speak a single sentence ──
  function speakSentence(text, rate, pitch, volume) {
    return new Promise((resolve) => {
      const utt = new SpeechSynthesisUtterance(text);
      utt.voice = selectedVoice;
      utt.rate = rate || CONFIG.tts.rate;
      utt.pitch = pitch || CONFIG.tts.pitch;
      utt.volume = volume || CONFIG.tts.volume;

      utt.onend = () => resolve();
      utt.onerror = (e) => {
        if (e.error !== 'interrupted') console.warn('[TTS] Error:', e.error);
        resolve();
      };
      synth.speak(utt);
      currentUtterances.push(utt);
    });
  }

  // ── Main speak function: sequential sentence-by-sentence ──
  async function speak(text, callbacks = {}) {
    if (isPlaying) stop();

    onSentenceCallback = callbacks.onSentence || null;
    onEndCallback = callbacks.onEnd || null;
    onStartCallback = callbacks.onStart || null;

    sentences = splitIntoSentences(text);
    currentSentenceIndex = 0;
    isPlaying = true;
    isPaused = false;
    currentUtterances = [];

    if (onStartCallback) onStartCallback(sentences.length);

    const rate = CONFIG.tts.rate;
    const pitch = CONFIG.tts.pitch;
    const volume = CONFIG.tts.volume;

    for (let i = 0; i < sentences.length; i++) {
      if (!isPlaying) break;

      // Handle pause
      while (isPaused && isPlaying) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!isPlaying) break;

      currentSentenceIndex = i;
      if (onSentenceCallback) onSentenceCallback(i, sentences[i]);

      await speakSentence(sentences[i], rate, pitch, volume);

      // Small natural pause between sentences
      if (isPlaying && !isPaused && i < sentences.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    isPlaying = false;
    isPaused = false;
    if (onEndCallback) onEndCallback();
  }

  function pause() {
    if (isPlaying && !isPaused) {
      synth.cancel(); // Cancel current utterance
      isPaused = true;
    }
  }

  function resume() {
    if (isPaused) {
      isPaused = false;
      // Re-speak from current sentence
      // (The speak loop will handle this via the isPaused while loop)
    }
  }

  function stop() {
    isPlaying = false;
    isPaused = false;
    synth.cancel();
    currentUtterances = [];
    currentSentenceIndex = 0;
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
    return { isPlaying, isPaused, currentSentenceIndex, totalSentences: sentences.length };
  }

  // ── Quick test speak ──
  function testSpeak(text = 'MarketPulse AI is ready. Indian English voice active.') {
    stop();
    const utt = new SpeechSynthesisUtterance(text);
    utt.voice = selectedVoice;
    utt.rate = CONFIG.tts.rate;
    utt.pitch = CONFIG.tts.pitch;
    utt.volume = CONFIG.tts.volume;
    synth.speak(utt);
  }

  return {
    loadVoices,
    getVoiceList,
    setVoice,
    speak,
    pause,
    resume,
    stop,
    togglePause,
    setRate,
    setPitch,
    setVolume,
    getState,
    testSpeak,
    isSupported: () => 'speechSynthesis' in window,
  };

})();

window.TTSEngine = TTSEngine;
