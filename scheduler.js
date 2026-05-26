// ============================================================
// MarketPulse AI — scheduler.js
// Market calendar + auto-trigger engine
// Fires briefings at 8:45 AM, 12:00 PM, 3:35 PM IST on trading days
// ============================================================

const Scheduler = (() => {

  let timers = [];
  let onBriefingTrigger = null;
  let countdownInterval = null;
  let nextTriggerInfo = null;

  // ── Check if today is a trading day ──
  function isTradingDay(date = new Date()) {
    const ist = toIST(date);
    const dayOfWeek = ist.getDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;

    const dateStr = formatDate(ist);
    return !CONFIG.schedule.holidays2026.includes(dateStr);
  }

  // ── Convert UTC Date to IST Date ──
  function toIST(date = new Date()) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utc + 5.5 * 3600000);
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // ── Get market status ──
  function getMarketStatus() {
    const ist = toIST();
    const time = formatTime(ist);
    const isTrading = isTradingDay(ist);

    if (!isTrading) return { status: 'HOLIDAY', label: 'Market Holiday', color: '#64748b' };
    if (time < '09:15') return { status: 'PRE_MARKET', label: 'Pre Market', color: '#f59e0b' };
    if (time >= '09:15' && time <= '15:30') return { status: 'OPEN', label: 'Market Open', color: '#10b981' };
    return { status: 'CLOSED', label: 'Market Closed', color: '#64748b' };
  }

  // ── Calculate ms until a given HH:MM time today in IST ──
  function msUntilISTTime(hhmm) {
    const ist = toIST();
    const [h, m] = hhmm.split(':').map(Number);
    const target = new Date(ist);
    target.setHours(h, m, 0, 0);
    const diff = target.getTime() - ist.getTime();
    return diff > 0 ? diff : diff + 24 * 3600 * 1000; // if past, next day
  }

  // ── Find next briefing time ──
  function getNextBriefingInfo() {
    const ist = toIST();
    const todayStr = formatDate(ist);
    const currentTime = formatTime(ist);
    const times = CONFIG.schedule.briefingTimes; // ['08:45', '12:00', '15:35']

    // Check today's remaining briefings
    for (const t of times) {
      if (t > currentTime && isTradingDay(ist)) {
        return { date: todayStr, time: t, label: `Today at ${t} IST` };
      }
    }

    // Find next trading day
    let nextDay = new Date(ist);
    for (let i = 1; i <= 10; i++) {
      nextDay.setDate(nextDay.getDate() + 1);
      if (isTradingDay(nextDay)) {
        const nextDayStr = formatDate(nextDay);
        return { date: nextDayStr, time: times[0], label: `${nextDayStr} at ${times[0]} IST` };
      }
    }
    return null;
  }

  // ── Format countdown string ──
  function formatCountdown(ms) {
    if (ms <= 0) return 'Now';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  // ── Schedule all briefing triggers for today ──
  function scheduleToday(callback) {
    clearAllTimers();
    if (!isTradingDay()) {
      console.log('[Scheduler] Today is not a trading day. Skipping.');
      return;
    }

    CONFIG.schedule.briefingTimes.forEach(time => {
      const ms = msUntilISTTime(time);
      console.log(`[Scheduler] Next briefing at ${time} IST — in ${formatCountdown(ms)}`);
      const timer = setTimeout(() => {
        console.log(`[Scheduler] Firing briefing: ${time} IST`);
        if (callback) callback({ time, type: getSessionType(time) });
        // Re-schedule for tomorrow
        scheduleForTomorrow(callback);
      }, ms);
      timers.push(timer);
    });
  }

  function getSessionType(time) {
    if (time === '08:45') return 'PRE_MARKET';
    if (time === '12:00') return 'MIDDAY';
    if (time === '15:35') return 'CLOSING';
    return 'MANUAL';
  }

  function scheduleForTomorrow(callback) {
    // Check again in 1 minute for the next trading day
    setTimeout(() => scheduleToday(callback), 60 * 1000);
  }

  function clearAllTimers() {
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  // ── Start the scheduler ──
  function start(onTrigger) {
    onBriefingTrigger = onTrigger;
    scheduleToday(onTrigger);
    startCountdown();
    console.log('[Scheduler] Started');
  }

  function stop() {
    clearAllTimers();
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
    console.log('[Scheduler] Stopped');
  }

  // ── Live countdown updater ──
  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      const info = getNextBriefingInfo();
      nextTriggerInfo = info;
      if (info) {
        const ms = msUntilISTTime(info.time);
        const countdown = formatCountdown(ms);
        window.dispatchEvent(new CustomEvent('mp:countdown', {
          detail: { info, countdown, marketStatus: getMarketStatus() }
        }));
      }
    }, 1000);
  }

  // ── Get current IST time string ──
  function getCurrentISTTime() {
    return toIST().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function getCurrentISTDate() {
    return toIST().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  return {
    start,
    stop,
    isTradingDay,
    getMarketStatus,
    getNextBriefingInfo,
    formatCountdown,
    getCurrentISTTime,
    getCurrentISTDate,
    toIST,
  };

})();

window.Scheduler = Scheduler;
