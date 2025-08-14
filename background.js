let distractionLevel = 0;
let accessUntil = null;

// === Debounce için ek değişken (EKLE) ===
let ndLastAttempt = {}; // { "tabId|url": timestamp }

// === ODAK OTURUM SAYACI: RAM durumu ve yardımcılar (EKLE) ===
let ndSession = {
  running: false,   // sayaç açık mı?
  startedAt: null,  // ms cinsinden başlangıç
  tickTimer: null   // ileride popup canlı sayaç için kullanılabilir
};

// === ND: Otomatik devam (auto-resume) durumu (EKLE) ===
let ndAutoResume = { waiting: false, tabId: null, host: '' };
function ndClearAutoResume() {
  ndAutoResume = { waiting: false, tabId: null, host: '' };
}
async function ndTryResume() {
  const { isActive = false } = await chrome.storage.sync.get('isActive');
  if (!isActive) { ndClearAutoResume(); return; }
  if (!ndSession.running) ndStartSession();
  ndClearAutoResume();
}

// Bugün ve Ay anahtarları (örn. "2025-08-14", "2025-08")
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

// Oturumu BAŞLAT (switch açıldığında)
function ndStartSession() {
  if (ndSession.running) return; // zaten açık
  ndSession.running = true;
  ndSession.startedAt = Date.now();

  // >>> Popup canlı sayaç için state'i yaz
  chrome.storage.local.set({
    focusRunning: true,
    focusStartedAt: ndSession.startedAt
  });

  if (!ndSession.tickTimer) {
    ndSession.tickTimer = setInterval(() => {}, 1000);
  }
}

// Oturumu BİTİR ve KAYDET (switch kapanınca veya engelli site tetiklenince)
async function ndStopSession(breakerDomain = null) {
  if (!ndSession.running || !ndSession.startedAt) return;

  const endedAt = Date.now();
  const startedAt = ndSession.startedAt;
  const durationSec = Math.max(1, Math.round((endedAt - startedAt) / 1000));

  // RAM durumunu sıfırla
  ndSession.running = false;
  ndSession.startedAt = null;
  if (ndSession.tickTimer) { clearInterval(ndSession.tickTimer); ndSession.tickTimer = null; }

  // >>> Popup canlı sayaç için state'i kapat
  chrome.storage.local.set({
    focusRunning: false,
    focusStartedAt: null
  });

  // === DÜZELTİLDİ: Tüm istatistik yazımları TEK blokta (çift artma yok) ===
  const dayKey = ndDayKey();
  const monthKey = ndMonthKey();
  const store = await chrome.storage.local.get(['focusHistory', 'dailyTotals', 'monthlyTotals']);
  const focusHistory  = store.focusHistory  || {};
  const dailyTotals   = store.dailyTotals   || {};
  const monthlyTotals = store.monthlyTotals || {};

  // 1) focusHistory (günlük oturum listesi)
  if (!Array.isArray(focusHistory[dayKey])) focusHistory[dayKey] = [];
  focusHistory[dayKey].push({
    startedAt, endedAt, durationSec,
    breakerDomain: breakerDomain || null // istatistikte kullanıyoruz
  });

  // 2) Günlük toplamlar + günlük en çok dağıtanlar
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

  // 3) Aylık toplamlar + aylık en çok dağıtanlar (TEK YER burası)
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

// Aktif sekme odak/dikkat durumu kontrolü (YENİ)
async function ndEvaluateActiveTabFocus(tabLike) {
  try {
    const { isActive = false, customSites = [] } = await chrome.storage.sync.get(['isActive', 'customSites']);
    if (!isActive) {
      // Uygulama kapalıysa sayaç da kapalı kalsın
      ndStopSession(null);
      return;
    }

    // Tab bilgisi yoksa aktif olanı çek
    let tab = tabLike;
    if (!tab) {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = current;
    }
    if (!tab || !tab.url) {
      // URL yoksa güvenli yaklaşım: odak başlat (boş sayfa vs.)
      ndStartSession();
      return;
    }

    let host = '';
    try { host = new URL(tab.url).hostname; } catch { host = ''; }

    const isDistracting = Array.isArray(customSites) && customSites.some(site => site && host.includes(site));

    if (isDistracting) {
      // Aktif sekme dikkat dağıtansa odak sayacını durdur
      ndStopSession(host);
    } else {
      // Değilse sayacı başlat/ devam ettir
      ndStartSession();
    }
  } catch (e) {
    // sessiz geç
  }
}

// Erişim süresi dolmuş mu? (true = artık izin yok)
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
  // Debounce kontrolü — aynı sekme+url 3 sn içinde tekrar sayma
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
// === Günlük deneme sayacı SON ===

// Blur için ortak kontrol fonksiyonu
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
      // === ODAK: Engelli site tetiklenmeden hemen önce açık oturumu bitir + auto‑resume bayrağı (EKLE) ===
      let host = '';
      try { host = new URL(details.url).hostname; } catch {}
      ndStopSession(host); // raporlar için "bozan domain"
      ndAutoResume = { waiting: true, tabId: details.tabId, host }; // sekmeden çıkınca devam et

      // Mevcut davranış: blur'u enjekte et
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ["blur.js"]
      });

      distractionLevel++;

      // Günlük deneme sayacını arttır (debounce'lu)
      ndIncTodayAttempts(details.tabId, details.url);
    }
  });
}

// Süre bittiğinde alarm tetiklenir → erişimi kapat ve açık sekmelere blur uygula
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'nd-clearAccess') return;

  await chrome.storage.sync.remove('accessUntil');
  await chrome.storage.local.remove('accessUntil');

  chrome.action.setBadgeText({ text: '' });

  const { isActive = false, customSites = [] } = await chrome.storage.sync.get({ isActive: false, customSites: [] });
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

// === ODAK: Switch değişimini dinle ve oturumu yönet (EKLE) ===
// popup'taki ana switch isActive değiştiğinde sayaç başlat/durdur
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.isActive) {
    const isOn = changes.isActive.newValue;
    if (isOn) {
      ndStartSession();     // switch AÇILDI → oturum başlar (sayaç akar)
    } else {
      ndStopSession(null);  // switch KAPANDI → oturum biter (bozan yok)
    }
  }
});

// Tarayıcı açılış/kurulumda mevcut duruma göre başlat (EKLE)
chrome.runtime.onStartup?.addListener(async () => {
  const { isActive = false } = await chrome.storage.sync.get('isActive');
  if (isActive) ndStartSession();
});
chrome.runtime.onInstalled.addListener(async () => {
  const { isActive = false } = await chrome.storage.sync.get('isActive');
  if (isActive) ndStartSession();
});

// === ND: Popup için odak durumu cevaplayıcı (EKLE) ===
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req) return;

  // Odak oturumu state'ini soran istek
  if (req.action === 'nd-getFocusState') {
    sendResponse({
      running: !!(typeof ndSession !== 'undefined' && ndSession.running),
      startedAt: (typeof ndSession !== 'undefined' && ndSession.startedAt) ? ndSession.startedAt : null
    });
  }
});

// === ND: Auto-resume tetikleyicileri (EKLE) ===
// Sekme kapandığında → devam
chrome.tabs.onRemoved.addListener((tabId) => {
  if (ndAutoResume.waiting && ndAutoResume.tabId === tabId) {
    ndTryResume();
  }
});
// Sekme yeni URL'e geçtiğinde → engelli domain’den çıkıldıysa devam
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

// Aktif sekme değişince kontrol et (YENİ)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    ndEvaluateActiveTabFocus(tab);
  } catch {}
});

// Aktif sekmenin URL'i değişince veya yükleme bitince kontrol et (YENİ)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.active) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    ndEvaluateActiveTabFocus(tab);
  }
});

// Uygulama başlarken de bir kere değerlendir (mevcut onStartup/onInstalled yanına)
chrome.runtime.onStartup?.addListener(() => ndEvaluateActiveTabFocus());
chrome.runtime.onInstalled.addListener(() => ndEvaluateActiveTabFocus());

// isActive switch'i değişince de aktif sekmeyi değerlendir (mevcut storage.onChanged içine ek satır)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.isActive) {
    const isOn = changes.isActive.newValue;
    if (isOn) {
      // açıldıysa o anki aktif sekmeye göre başlat/durdur
      ndEvaluateActiveTabFocus();
    } else {
      ndStopSession(null);
    }
  }
});

// Event dinleyiciler
chrome.webNavigation.onCompleted.addListener(handleBlurInjection);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
