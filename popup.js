/* --- DİL MIGRASYONU ve VARSAYILAN (EN) --- */
// Eski 'language' varsa 'lang'e taşı; hiçbiri yoksa 'en' ata
chrome.storage.sync.get(['lang', 'language'], (data) => {
  if (!data.lang && data.language) {
    chrome.storage.sync.set({ lang: data.language });
  }
  if (!data.lang && !data.language) {
    chrome.storage.sync.set({ lang: 'en' });
  }
});

/* ===================== I18N / Dil ===================== */
const ND_I18N = {
  tr: {
    title: "Not-Distracted",
    settings: "Ayarları Aç",
    statusActive: "Odak kalkanı aktif",
    statusInactive: "Uygulamayı aktif et",
    waiting: "Serbest zaman bekleniyor…",
    freeTime: "Serbest zaman bitimine kalan süre:",
    ended: "Serbest zaman doldu.",
    todayPrefix: "Bugün:",
    todaySuffix: "kere dikkatin dağıldı!",
    focusLiveTitle: "Odak Süresi (Canlı)",
    todayTotalPrefix: "Bugünkü Toplam",
    statsButton: "İstatistikler",
    last7Days: "Son 7 Gün",
    tableDay: "Gün",
    tableDuration: "Süre",
    thisWeek: "Bu Hafta",
    thisMonth: "Bu Ay",
    topDistractors: "En Çok Dikkatini Dağıtan",
    todayLabel: "Bugün",
    weekLabel: "Bu Hafta",
    monthLabel: "Bu Ay",
    none: "-"
  },
  en: {
    title: "Not-Distracted",
    settings: "Open Settings",
    statusActive: "Focus shield active",
    statusInactive: "Activate the extension",
    waiting: "Waiting for free time…",
    freeTime: "Time left for free access:",
    ended: "Free time ended.",
    todayPrefix: "Today:",
    todaySuffix: "times distracted!",
    focusLiveTitle: "Focus Time (Live)",
    todayTotalPrefix: "Today's Total",
    statsButton: "Statistics",
    last7Days: "Last 7 Days",
    tableDay: "Day",
    tableDuration: "Duration",
    thisWeek: "This Week",
    thisMonth: "This Month",
    topDistractors: "Top Distractors",
    todayLabel: "Today",
    weekLabel: "This Week",
    monthLabel: "This Month",
    none: "-"
  }
};
let ndLang = "en"; // <- başlangıçta EN
function t(key){ return (ND_I18N[ndLang] && ND_I18N[ndLang][key]) || key; }

async function ndLoadLang(){
  const { lang } = await chrome.storage.sync.get("lang");
  if (lang === "tr" || lang === "en") {
    ndLang = lang;
  } else {
    ndLang = "en";
    await chrome.storage.sync.set({ lang: "en" });
  }
}
async function ndToggleLang(){
  const newLang = (ndLang === "tr") ? "en" : "tr";
  await chrome.storage.sync.set({ lang: newLang });
  ndLang = newLang;
  applyLanguageToStatic();
  document.dispatchEvent(new Event("nd-lang-changed"));
}

/* Statik metinleri güncelle (başlık, butonlar, etiketler) */
function applyLanguageToStatic(){
  const titleEl = document.getElementById("nd-title");
  if (titleEl) titleEl.textContent = t("title");
  document.title = t("title");

  const langSwitch = document.getElementById("lang-switch");
  if (langSwitch) langSwitch.textContent = (ndLang === "tr") ? "🌐 EN" : "🌐 TR";

  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) settingsBtn.textContent = t("settings");

  const liveTitle = document.getElementById("nd-live-title");
  if (liveTitle) liveTitle.textContent = t("focusLiveTitle");

  const todayPrefix = document.getElementById("nd-today-prefix");
  if (todayPrefix) todayPrefix.textContent = t("todayPrefix");

  const todaySuffix = document.getElementById("nd-today-suffix");
  if (todaySuffix) todaySuffix.textContent = t("todaySuffix");

  const statsBtn = document.getElementById("nd-stats-btn");
  if (statsBtn) statsBtn.textContent = t("statsButton");
}

/* İlk yüklemede dili getir ve butona davranış bağla */
document.addEventListener("DOMContentLoaded", async () => {
  await ndLoadLang();
  applyLanguageToStatic();
  const langSwitch = document.getElementById("lang-switch");
  if (langSwitch) {
    langSwitch.addEventListener("click", ndToggleLang);
  }
});

/* ===================== Toggle / Status ===================== */
const toggleSwitch = document.getElementById("toggleSwitch");
const statusText = document.getElementById("statusText");
const settingsBtn = document.getElementById("settingsBtn");

function updateStatusText(isActive) {
  statusText.textContent = isActive ? t("statusActive") : t("statusInactive");
}

chrome.storage.sync.get("isActive", (data) => {
  const isActive = data.isActive ?? false;
  if (toggleSwitch) toggleSwitch.checked = isActive;
  updateStatusText(isActive);
});

if (toggleSwitch) {
  toggleSwitch.addEventListener("change", () => {
    const isActive = toggleSwitch.checked;
    chrome.storage.sync.set({ isActive }, () => {
      updateStatusText(isActive);
    });
  });
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage
      ? chrome.runtime.openOptionsPage()
      : window.open(chrome.runtime.getURL("settings.html"));
  });
}

/* Dil değişince status metnini de yenile */
document.addEventListener("nd-lang-changed", () => {
  chrome.storage.sync.get("isActive", ({ isActive = false }) => updateStatusText(isActive));
});

/* ===================== Geri Sayım ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('nd-timerStatus');
  const countdownEl = document.getElementById('nd-countdown');
  if (!statusEl || !countdownEl) return;

  let ndIntervalId = null;

  const fmt = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  async function readAccessUntil() {
    let { accessUntil } = await chrome.storage.local.get('accessUntil');
    if (!accessUntil) {
      const syncData = await chrome.storage.sync.get('accessUntil');
      accessUntil = syncData.accessUntil;
    }
    return typeof accessUntil === 'number' ? accessUntil : 0;
  }

  async function render() {
    clearInterval(ndIntervalId);

    const accessUntil = await readAccessUntil();

    if (!accessUntil || Date.now() >= accessUntil) {
      statusEl.textContent = t('waiting');
      countdownEl.textContent = '--:--';
      return;
    }

    statusEl.textContent = t('freeTime');
    const tick = () => {
      const remain = accessUntil - Date.now();
      countdownEl.textContent = fmt(remain);
      if (remain <= 0) {
        clearInterval(ndIntervalId);
        statusEl.textContent = t('ended');
        countdownEl.textContent = '00:00';
      }
    };
    tick();
    ndIntervalId = setInterval(tick, 1000);
  }

  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && changes.accessUntil) || (area === 'sync' && changes.accessUntil)) {
      render();
    }
  });

  document.addEventListener("nd-lang-changed", render);
});
/* ===================== Geri Sayım Sonu ===================== */

/* === ND: Popup canlı sayaç ve istatistikler === */
document.addEventListener('DOMContentLoaded', () => {
  const two = n => String(n).padStart(2,'0');
  const secToMinStr = sec => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${two(m)}:${two(s)}`;
  };
  const dayKeyOf = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const monthKeyOf = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    return `${yyyy}-${mm}`;
  };

  const liveEl   = document.getElementById('nd-live-counter');
  const todayEl  = document.getElementById('nd-today-total');
  const statsBtn = document.getElementById('nd-stats-btn');
  const panel    = document.getElementById('nd-stats-panel');
  const content  = document.getElementById('nd-stats-content');
  const liveTitle= document.getElementById('nd-live-title');

  if (!liveEl || !todayEl || !statsBtn || !panel || !content) return;

  document.addEventListener("nd-lang-changed", () => {
    if (liveTitle) liveTitle.textContent = t("focusLiveTitle");
    renderTodayTotal();
    if (panel.style.display === 'block') {
      chrome.storage.local.get(['dailyTotals','monthlyTotals']).then(res => {
        renderStatsPanel(res.dailyTotals || {}, res.monthlyTotals || {});
      });
    }
  });

  let liveTimer = null;

  async function getFocusState() {
    const { focusRunning=false, focusStartedAt=null } = await chrome.storage.local.get(['focusRunning','focusStartedAt']);
    if (!focusRunning || !focusStartedAt) {
      const state = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'nd-getFocusState' }, (resp) => resolve(resp || {}));
      });
      return {
        running: !!state.running || !!focusRunning,
        startedAt: state.startedAt || focusStartedAt || null
      };
    }
    return { running: focusRunning, startedAt: focusStartedAt };
  }

  function renderLive(running, startedAt) {
    if (!running || !startedAt) {
      liveEl.textContent = '00:00';
      return;
    }
    const sec = Math.max(0, Math.floor((Date.now() - startedAt)/1000));
    liveEl.textContent = secToMinStr(sec);
  }

  async function startLiveCounter() {
    if (liveTimer) clearInterval(liveTimer);
    const st = await getFocusState();
    renderLive(st.running, st.startedAt);
    liveTimer = setInterval(async () => {
      const st2 = await getFocusState();
      renderLive(st2.running, st2.startedAt);
    }, 1000);
  }

  async function renderTodayTotal() {
    const now = new Date();
    const key = dayKeyOf(now);
    const { dailyTotals={} } = await chrome.storage.local.get('dailyTotals');
    const sec = dailyTotals[key]?.focusSecTotal || 0;
    todayEl.textContent = `${t('todayTotalPrefix')}: ${secToMinStr(sec)}`;
  }

  function renderStatsPanel(dailyTotals = {}, monthlyTotals = {}) {
    const now = new Date();
    const rows = [];

    rows.push(`<div style="font-weight:700;margin-bottom:4px;">${t('last7Days')}</div>`);
    rows.push(`<table style="width:100%; border-collapse:collapse; font-size:12px;">`);
    rows.push(`<tr><th style="text-align:left;padding:2px 0;">${t('tableDay')}</th><th style="text-align:right;">${t('tableDuration')}</th></tr>`);

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dk = dayKeyOf(d);
      const sec = dailyTotals[dk]?.focusSecTotal || 0;
      rows.push(`<tr><td style="padding:2px 0;">${dk}</td><td style="text-align:right;">${secToMinStr(sec)}</td></tr>`);
    }
    rows.push(`</table>`);

    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dk = dayKeyOf(d);
      weekTotal += (dailyTotals[dk]?.focusSecTotal || 0);
    }
    rows.push(`<div style="margin-top:8px;"><b>${t('thisWeek')}:</b> ${secToMinStr(weekTotal)}</div>`);

    const monthKey = monthKeyOf(now);
    const monthTotal = monthlyTotals?.[monthKey]?.focusSecTotal || 0;
    rows.push(`<div><b>${t('thisMonth')}:</b> ${secToMinStr(monthTotal)}</div>`);

    function topDomainFromMap(mapObj) {
      if (!mapObj || typeof mapObj !== 'object') return t('none');
      let bestKey = null, bestVal = 0;
      for (const [k, v] of Object.entries(mapObj)) {
        if ((v || 0) > bestVal) { bestVal = v || 0; bestKey = k; }
      }
      return bestKey ? `${bestKey} (${bestVal})` : t('none');
    }

    const todayKey = dayKeyOf(now);
    const todayTop = topDomainFromMap((dailyTotals[todayKey] || {}).distractionsByDomain);

    const weekAgg = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dk = dayKeyOf(d);
      const m = (dailyTotals[dk] || {}).distractionsByDomain;
      if (!m) continue;
      for (const [dom, cnt] of Object.entries(m)) {
        weekAgg[dom] = (weekAgg[dom] || 0) + (cnt || 0);
      }
    }
    const weekTop = topDomainFromMap(weekAgg);

    const monthTop = topDomainFromMap((monthlyTotals[monthKey] || {}).distractionsByDomain);

    rows.push(`<div style="margin-top:8px; font-weight:700;">${t('topDistractors')}</div>`);
    rows.push(`<div>${t('todayLabel')}: ${todayTop}</div>`);
    rows.push(`<div>${t('weekLabel')}: ${weekTop}</div>`);
    rows.push(`<div>${t('monthLabel')}: ${monthTop}</div>`);

    content.innerHTML = rows.join('');
  }

  statsBtn.addEventListener('click', async () => {
    const open = panel.style.display === 'block';
    if (open) {
      panel.style.display = 'none';
      return;
    }
    const data = await chrome.storage.local.get(['dailyTotals','monthlyTotals']);
    renderStatsPanel(data.dailyTotals || {}, data.monthlyTotals || {});
    panel.style.display = 'block';
  });

  startLiveCounter();
  renderTodayTotal();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.dailyTotals) renderTodayTotal();
      if (changes.focusRunning || changes.focusStartedAt) startLiveCounter();
      if (changes.monthlyTotals && panel.style.display === 'block') {
        chrome.storage.local.get(['dailyTotals','monthlyTotals']).then(res => {
          renderStatsPanel(res.dailyTotals || {}, res.monthlyTotals || {});
        });
      }
    }
    if (area === 'sync' && changes.isActive) startLiveCounter();
  });
});

/* ===================== Bugünkü deneme sayısı ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const label = document.getElementById('nd-today-count');
  const prefix = document.getElementById('nd-today-prefix');
  const suffix = document.getElementById('nd-today-suffix');
  if (!label) return;

  document.addEventListener("nd-lang-changed", () => {
    if (prefix) prefix.textContent = t('todayPrefix');
    if (suffix) suffix.textContent = t('todaySuffix');
  });

  function todayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `nd_stats_${yyyy}-${mm}-${dd}`;
  }

  async function renderToday() {
    const key = todayKey();
    const data = await chrome.storage.local.get(key);
    const attempts = data[key]?.attempts ?? 0;
    label.textContent = attempts;
  }

  renderToday();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const key = todayKey();
    if (changes[key]) renderToday();
  });
});
/* ===================== Bugünkü deneme sayısı Son ===================== */
