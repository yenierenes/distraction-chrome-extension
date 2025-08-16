let distractionLevel = 0;
let accessUntil = null;

// === Debounce için ek değişken ===
let ndLastAttempt = {}; // { "tabId|url": timestamp }

// === ODAK OTURUM SAYACI: RAM durumu ===
let ndSession = {
  running: false,
  startedAt: null,
  tickTimer: null
};

// === ND: Otomatik devam (auto-resume) durumu ===
let ndAutoResume = { waiting: false, tabId: null, host: '' };
function ndClearAutoResume() {
  ndAutoResume = { waiting: false, tabId: null, host: '' };
}
async function ndTryResume() {
  const { isActive = false } = await chrome.storage.sync.get('isActive');
  if (!isActive) { ndClearAutoResume(); return; }
  if (!ndSession.running) await ndStartSession(); // hydrate ederek başlatır
  ndClearAutoResume();
}

// === Yardımcı: Gün/Ay anahtarları ===
function ndDayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function ndMonthKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/* =========================
   UYKU/BEKLEME BOŞLUĞU FİX'i (HEARTBEAT)
   ========================= */
const ND_BEAT_INTERVAL_MS = 60 * 1000;   // 60 sn'de bir nabız
const ND_SLEEP_GAP_MS     = 90 * 1000;   // 90 sn'den uzun boşluk → uyku varsay

function ndScheduleBeat() {
  // Servis worker uyusa da alarm tekrar ayağa kalktığında çalışır
  chrome.alarms.create('nd-beat', { periodInMinutes: ND_BEAT_INTERVAL_MS / 60000 });
}
async function ndRecordBeat() {
  if (ndSession.running) {
    await chrome.storage.local.set({ ndLastBeat: Date.now() });
  }
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'nd-beat') {
    ndRecordBeat();
  }
});

// 1) Background uyandıysa storage'daki durumu RAM'e geri yükle (+ uyku düzeltme)
async function ndHydrateSessionFromStorage() {
  try {
    const { focusRunning = false, focusStartedAt = null, ndLastBeat = null } =
      await chrome.storage.local.get(['focusRunning', 'focusStartedAt', 'ndLastBeat']);

    if (focusRunning && typeof focusStartedAt === 'number') {
      ndSession.running   = true;
      ndSession.startedAt = focusStartedAt;

      const now = Date.now();
      if (typeof ndLastBeat === 'number') {
        const gap = now - ndLastBeat;
        // Uykuda geçen zamanı sayma: startedAt'i uyku uzunluğu kadar ileri kaydır
        if (gap > ND_SLEEP_GAP_MS) {
          ndSession.startedAt = focusStartedAt + gap;
          // Güvenlik: startedAt şimdiye taşarsa minimum = now - 1sn
          if (ndSession.startedAt > now - 1000) ndSession.startedAt = now - 1000;
          await chrome.storage.local.set({ focusStartedAt: ndSession.startedAt });
        }
      }

      if (!ndSession.tickTimer) {
        ndSession.tickTimer = setInterval(() => {}, 1000);
      }
      ndScheduleBeat();
      ndRecordBeat();
    }
  } catch { /* sessiz geç */ }
}

// 2) Oturumu BAŞLAT — varsa varolan startedAt'i kullan
async function ndStartSession() {
  if (ndSession.running && ndSession.startedAt) return;

  const { focusRunning = false, focusStartedAt = null } =
    await chrome.storage.local.get(['focusRunning', 'focusStartedAt']);

  if (focusRunning && typeof focusStartedAt === 'number') {
    ndSession.running   = true;
    ndSession.startedAt = focusStartedAt;
  } else {
    ndSession.running   = true;
    ndSession.startedAt = Date.now();
    await chrome.storage.local.set({
      focusRunning: true,
      focusStartedAt: ndSession.startedAt
    });
  }

  if (!ndSession.tickTimer) {
    ndSession.tickTimer = setInterval(() => {}, 1000);
  }
  ndScheduleBeat();
  ndRecordBeat();
}

// 3) Oturumu BİTİR ve KAYDET (yalnızca engelli domainde tetiklenir) — uyku yok sayılır
async function ndStopSession(breakerDomain = null) {
  if (!ndSession.running || !ndSession.startedAt) return;

  const now = Date.now();
  const { ndLastBeat = null } = await chrome.storage.local.get('ndLastBeat');

  // Uyku boşluğunu düş: son canlı zaman varsa ve şimdiye çok uzaksa onu esas al
  let effectiveEnd = now;
  if (typeof ndLastBeat === 'number') {
    const gap = now - ndLastBeat;
    if (gap > ND_SLEEP_GAP_MS) {
      effectiveEnd = ndLastBeat; // uykuda geçen kısmı dahil etme
    }
  }

  let durationMs = Math.max(0, effectiveEnd - ndSession.startedAt);
  // Aşırı uçları kes (opsiyonel güvenlik)
  const MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 saat
  if (durationMs > MAX_SESSION_MS) durationMs = MAX_SESSION_MS;

  const durationSec = Math.max(1, Math.round(durationMs / 1000));

  // RAM durumunu sıfırla
  ndSession.running = false;
  ndSession.startedAt = null;
  if (ndSession.tickTimer) { clearInterval(ndSession.tickTimer); ndSession.tickTimer = null; }

  // Popup canlı sayaç için state'i kapat
  chrome.storage.local.set({
    focusRunning: false,
    focusStartedAt: null
  });

  // İstatistik yazımı (TEK blok)
  const dayKey = ndDayKey();
  const monthKey = ndMonthKey();
  const store = await chrome.storage.local.get(['focusHistory', 'dailyTotals', 'monthlyTotals']);
  const focusHistory  = store.focusHistory  || {};
  const dailyTotals   = store.dailyTotals   || {};
  const monthlyTotals = store.monthlyTotals || {};

  if (!Array.isArray(focusHistory[dayKey])) focusHistory[dayKey] = [];
  focusHistory[dayKey].push({
    startedAt: effectiveEnd - durationMs,
    endedAt:   effectiveEnd,
    durationSec,
    breakerDomain: breakerDomain || null
  });

  if (!dailyTotals[dayKey]) {
    dailyTotals[dayKey] = { focusSecTotal: 0, sessionCount: 0, distractionsByDomain: {} };
  }
  dailyTotals[dayKey].focusSecTotal += durationSec;
  dailyTotals[dayKey].sessionCount  += 1;
  if (breakerDomain) {
    const dMap = dailyTotals[dayKey].distractionsByDomain || {};
    dMap[breakerDomain] = (dMap[breakerDomain] || 0) + 1;
    dailyTotals[dayKey].distractionsByDomain = dMap;
  }

  if (!monthlyTotals[monthKey]) {
    monthlyTotals[monthKey] = { focusSecTotal: 0, sessionCount: 0, distractionsByDomain: {} };
  }
  monthlyTotals[monthKey].focusSecTotal += durationSec;
  monthlyTotals[monthKey].sessionCount  += 1;
  if (breakerDomain) {
    const mMap = monthlyTotals[monthKey].distractionsByDomain || {};
    mMap[breakerDomain] = (mMap[breakerDomain] || 0) + 1;
    monthlyTotals[monthKey].distractionsByDomain = mMap;
  }

  await chrome.storage.local.set({ focusHistory, dailyTotals, monthlyTotals });
}

/* =========================
   Aktif sekme odak/dikkat değerlendirme
   ========================= */
async function ndEvaluateActiveTabFocus(tabLike) {
  try {
    await ndHydrateSessionFromStorage();

    const { isActive = false, customSites = [] } =
      await chrome.storage.sync.get(['isActive', 'customSites']);
    if (!isActive) {
      await ndStopSession(null);
      return;
    }

    let tab = tabLike;
    if (!tab) {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = current;
    }
    if (!tab || !tab.url) {
      await ndStartSession();
      return;
    }

    let host = '';
    try { host = new URL(tab.url).hostname; } catch { host = ''; }

    const isDistracting = Array.isArray(customSites) && customSites.some(site => site && host.includes(site));

    if (isDistracting) {
      await ndStopSession(host);
    } else {
      await ndStartSession();
    }
  } catch (e) {
    // sessiz geç
  }
}

/* =========================
   Serbest erişim ve mesajlar
   ========================= */

// Erişim süresi dolmuş mu?
function isAccessExpired() {
  return !accessUntil || Date.now() > accessUntil;
}

// Mesajları dinle (görev başarı → AYARDAKİ SÜRE kadar izin ver)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "grantAccess") {
    chrome.storage.sync.get({ accessMinutes: 10 }, ({ accessMinutes }) => {
      accessUntil = Date.now() + accessMinutes * 60 * 1000;

      chrome.storage.sync.set({ accessUntil });
      chrome.storage.local.set({ accessUntil });

      chrome.alarms.create('nd-clearAccess', { when: accessUntil });

      if (typeof sendResponse === 'function') sendResponse({ ok: true });
    });
    return true;
  }
});

// === Günlük deneme sayacı ===
function ndTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `nd_stats_${yyyy}-${mm}-${dd}`;
}

async function ndIncTodayAttempts(tabId, url) {
  const now = Date.now();
  const comboKey = `${tabId}|${url}`;
  if (ndLastAttempt[comboKey] && (now - ndLastAttempt[comboKey] < 3000)) {
    return; // çok hızlı tekrar → sayma
  }
  ndLastAttempt[comboKey] = now;

  const key = ndTodayKey();
  const data = await chrome.storage.local.get(key);
  const val = (data[key]?.attempts ?? 0) + 1;
  await chrome.storage.local.set({ [key]: { attempts: val } });
}

// Blur için ortak kontrol
function handleBlurInjection(details) {
  chrome.storage.sync.get(["isActive", "customSites", "accessUntil"], (data) => {
    const isActive = data.isActive ?? false;
    const distractingSites = data.customSites || [];
    const now = Date.now();

    accessUntil = data.accessUntil || 0;
    if (!isActive) return;

    let url;
    try { url = new URL(details.url); } catch { return; }

    const matched = distractingSites.some(site => url.hostname.includes(site));
    if (!matched) return;

    const isExpired = !accessUntil || now > accessUntil;

    if (isExpired) {
      let host = '';
      try { host = new URL(details.url).hostname; } catch {}
      ndStopSession(host);
      ndAutoResume = { waiting: true, tabId: details.tabId, host };

      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ["blur.js"]
      });

      distractionLevel++;
      ndIncTodayAttempts(details.tabId, details.url);
    }
  });
}

// Süre bittiğinde alarm: erişimi kapat ve açık sekmelere blur uygula
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'nd-clearAccess') return;

  await chrome.storage.sync.remove('accessUntil');
  await chrome.storage.local.remove('accessUntil');

  chrome.action.setBadgeText({ text: '' });

  const { isActive = false, customSites = [] } =
    await chrome.storage.sync.get({ isActive: false, customSites: [] });
  if (!isActive || !Array.isArray(customSites) || customSites.length === 0) return;

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      let url;
      try { url = new URL(tab.url || ''); } catch { return; }

      const matched = customSites.some(site => site && url.hostname.includes(site));
      if (!matched) return;

      try {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['blur.js']
        });
      } catch {}
    });
  });
});

/* =========================
   Dinleyiciler
   ========================= */

// Switch değişimi → başlat/durdur
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.isActive) {
    const isOn = changes.isActive.newValue;
    if (isOn) {
      ndStartSession();
      ndEvaluateActiveTabFocus(); // aktif sekmeye göre teyit et
    } else {
      ndStopSession(null);
    }
  }
});

// Başlangıçta mevcut duruma göre hydrate + başlat
chrome.runtime.onStartup?.addListener(async () => {
  await ndHydrateSessionFromStorage();
  const { isActive = false } = await chrome.storage.sync.get('isActive');
  if (isActive) ndEvaluateActiveTabFocus();
});
chrome.runtime.onInstalled.addListener(async () => {
  await ndHydrateSessionFromStorage();
  const { isActive = false } = await chrome.storage.sync.get('isActive');
  if (isActive) ndEvaluateActiveTabFocus();
});

// Popup için odak durumu cevaplayıcı
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req) return;
  if (req.action === 'nd-getFocusState') {
    sendResponse({
      running: !!(typeof ndSession !== 'undefined' && ndSession.running),
      startedAt: (typeof ndSession !== 'undefined' && ndSession.startedAt) ? ndSession.startedAt : null
    });
  }
});

// Auto-resume tetikleyicileri
chrome.tabs.onRemoved.addListener((tabId) => {
  if (ndAutoResume.waiting && ndAutoResume.tabId === tabId) {
    ndTryResume();
  }
});
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!ndAutoResume.waiting || ndAutoResume.tabId !== details.tabId) return;

  let newHost = '';
  try { newHost = new URL(details.url).hostname; } catch { return; }

  chrome.storage.sync.get(["customSites"], ({ customSites = [] }) => {
    const stillBlocked = customSites.some(site => site && newHost.includes(site));
    if (!stillBlocked) {
      ndTryResume();
    }
  });
});

// Aktif sekme değişince değerlendir
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    ndEvaluateActiveTabFocus(tab);
  } catch {}
});

// Aktif sekmenin URL'i değişince/yükleme bitince değerlendir
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.active) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    ndEvaluateActiveTabFocus(tab);
  }
});

// Başlangıçta bir kere daha
chrome.runtime.onStartup?.addListener(() => ndEvaluateActiveTabFocus());
chrome.runtime.onInstalled.addListener(() => ndEvaluateActiveTabFocus());

// accessUntil izleme için blur injection
chrome.webNavigation.onCompleted.addListener(handleBlurInjection);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
