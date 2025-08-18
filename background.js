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
  if (!ndSession.running) await ndStartSession();
  ndClearAutoResume();
}

// === Yardımcı: Gün/Ay anahtarları ===
function ndDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ndMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* =========================
   KALICI BAŞLANGIÇ ZAMANI FIX'i
   ========================= */
async function ndHydrateSessionFromStorage() {
  try {
    const { focusRunning = false, focusStartedAt = null } =
      await chrome.storage.local.get(['focusRunning', 'focusStartedAt']);
    if (focusRunning && typeof focusStartedAt === 'number') {
      ndSession.running = true;
      ndSession.startedAt = focusStartedAt;
      if (!ndSession.tickTimer) {
        ndSession.tickTimer = setInterval(() => {}, 1000);
      }
    }
  } catch {}
}

async function ndStartSession() {
  if (ndSession.running && ndSession.startedAt) return;
  const { focusRunning = false, focusStartedAt = null } =
    await chrome.storage.local.get(['focusRunning', 'focusStartedAt']);
  if (focusRunning && typeof focusStartedAt === 'number') {
    ndSession.running = true;
    ndSession.startedAt = focusStartedAt;
  } else {
    ndSession.running = true;
    ndSession.startedAt = Date.now();
    await chrome.storage.local.set({
      focusRunning: true,
      focusStartedAt: ndSession.startedAt
    });
  }
  if (!ndSession.tickTimer) {
    ndSession.tickTimer = setInterval(() => {}, 1000);
  }
}

async function ndStopSession(breakerDomain = null) {
  if (!ndSession.running || !ndSession.startedAt) return;

  const endedAt = Date.now();
  const startedAt = ndSession.startedAt;
  const durationSec = Math.max(1, Math.round((endedAt - startedAt) / 1000));

  ndSession.running = false;
  ndSession.startedAt = null;
  if (ndSession.tickTimer) { clearInterval(ndSession.tickTimer); ndSession.tickTimer = null; }

  chrome.storage.local.set({ focusRunning: false, focusStartedAt: null });

  const dayKey = ndDayKey();
  const monthKey = ndMonthKey();
  const store = await chrome.storage.local.get(['focusHistory', 'dailyTotals', 'monthlyTotals']);
  const focusHistory  = store.focusHistory  || {};
  const dailyTotals   = store.dailyTotals   || {};
  const monthlyTotals = store.monthlyTotals || {};

  if (!Array.isArray(focusHistory[dayKey])) focusHistory[dayKey] = [];
  focusHistory[dayKey].push({ startedAt, endedAt, durationSec, breakerDomain: breakerDomain || null });

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
   Aktif sekme odak kontrolü
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
    try { host = new URL(tab.url).hostname; } catch {}
    const isDistracting = Array.isArray(customSites) && customSites.some(site => site && host.includes(site));
    if (isDistracting) {
      await ndStopSession(host);
    } else {
      await ndStartSession();
    }
  } catch {}
}

/* =========================
   Serbest erişim ve blur
   ========================= */
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
      chrome.scripting.executeScript({ target: { tabId: details.tabId }, files: ["blur.js"] });
      distractionLevel++;
    }
  });
}

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
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['blur.js'] });
      } catch {}
    });
  });
});

/* =========================
   Dinleyiciler
   ========================= */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.isActive) {
    const isOn = changes.isActive.newValue;
    if (isOn) {
      ndStartSession();
      ndEvaluateActiveTabFocus();
    } else {
      ndStopSession(null);
    }
  }
});

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

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req) return;
  if (req.action === 'nd-getFocusState') {
    sendResponse({ running: ndSession.running, startedAt: ndSession.startedAt });
  }
});

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
    if (!stillBlocked) ndTryResume();
  });
});
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    ndEvaluateActiveTabFocus(tab);
  } catch {}
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.active) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    ndEvaluateActiveTabFocus(tab);
  }
});
chrome.runtime.onStartup?.addListener(() => ndEvaluateActiveTabFocus());
chrome.runtime.onInstalled.addListener(() => ndEvaluateActiveTabFocus());

chrome.webNavigation.onCompleted.addListener(handleBlurInjection);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
