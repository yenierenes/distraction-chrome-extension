let distractionLevel = 0;
let accessUntil = null;

// === Debounce için ek değişken (EKLE) ===
let ndLastAttempt = {}; // { "tabId|url": timestamp }

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

// Event dinleyiciler
chrome.webNavigation.onCompleted.addListener(handleBlurInjection);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
