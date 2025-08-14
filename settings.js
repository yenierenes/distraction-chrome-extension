/* --- DİL MIGRASYONU ve VARSAYILAN (EN) --- */
chrome.storage.sync.get(['lang', 'language'], (data) => {
  if (!data.lang && data.language) {
    chrome.storage.sync.set({ lang: data.language });
  }
  if (!data.lang && !data.language) {
    chrome.storage.sync.set({ lang: 'en' });
  }
});

/* ========== I18N ========== */
const ND_I18N = {
  en: {
    title: "Settings - Not-Distracted",
    headingSites: "Distracting Sites",
    placeholderSite: "e.g. facebook.com",
    save: "Save",
    savedOK: "Saved",
    durationLabel: "Free access duration (minutes):",
    remove: "Remove"
  },
  tr: {
    title: "Ayarlar - Not-Distracted",
    headingSites: "Dikkat Dağıtan Siteler",
    placeholderSite: "örnek: facebook.com",
    save: "Kaydet",
    savedOK: "Kaydedildi",
    durationLabel: "Serbest erişim süresi (dakika):",
    remove: "Kaldır"
  }
};
let ndLang = "en";
function t(k){ return (ND_I18N[ndLang] && ND_I18N[ndLang][k]) || k; }

async function loadLang(){
  const { lang } = await chrome.storage.sync.get("lang");
  if (lang === "tr" || lang === "en") {
    ndLang = lang;
  } else {
    ndLang = "en";
    await chrome.storage.sync.set({ lang: "en" });
  }
}
async function toggleLang(){
  const newLang = (ndLang === "en") ? "tr" : "en";
  await chrome.storage.sync.set({ lang: newLang });
  ndLang = newLang;
  applyLanguage();
}

/* ========== Uİ Dili uygula ========== */
function applyLanguage(){
  const titleEl = document.getElementById("nd-set-title");
  if (titleEl) { titleEl.textContent = t("title"); document.title = t("title"); }

  const langSwitch = document.getElementById("lang-switch-settings");
  if (langSwitch) langSwitch.textContent = (ndLang === "en") ? "🌐 TR" : "🌐 EN";

  const h2 = document.getElementById("nd-heading-sites");
  if (h2) h2.textContent = t("headingSites");

  const input = document.getElementById("siteInput");
  if (input) input.placeholder = t("placeholderSite");

  const saveBtn = document.getElementById("nd-save-minutes");
  if (saveBtn) saveBtn.textContent = t("save");

  const label = document.getElementById("nd-duration-label");
  if (label) label.textContent = t("durationLabel");
}

/* ========== Siteler listesi render/kaydet ========== */
function normalizeHost(raw) {
  try {
    let v = raw.trim().toLowerCase();
    if (!v) return "";
    if (v.startsWith("http://") || v.startsWith("https://")) {
      v = new URL(v).hostname;
    }
    if (v.startsWith("www.")) v = v.slice(4);
    return v;
  } catch { return ""; }
}

async function renderList() {
  const wrap = document.getElementById("siteList");
  if (!wrap) return;
  const { customSites = [] } = await chrome.storage.sync.get("customSites");

  wrap.innerHTML = "";
  customSites.forEach((host, idx) => {
    const row = document.createElement("div");
    row.className = "site-item";

    const span = document.createElement("span");
    span.textContent = host;

    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.title = t("remove");
    btn.textContent = "×";
    btn.addEventListener("click", async () => {
      const arr = [...customSites];
      arr.splice(idx, 1);
      await chrome.storage.sync.set({ customSites: arr });
      renderList();
    });

    row.appendChild(span);
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

async function addSite() {
  const input = document.getElementById("siteInput");
  if (!input) return;
  const host = normalizeHost(input.value);
  if (!host) return;

  const { customSites = [] } = await chrome.storage.sync.get("customSites");
  if (!customSites.includes(host)) {
    customSites.push(host);
    await chrome.storage.sync.set({ customSites });
  }
  input.value = "";
  renderList();
}

/* ========== Süre ayarı ========== */
async function loadMinutes() {
  const minutesEl = document.getElementById("nd-minutes");
  if (!minutesEl) return;
  const { accessMinutes = 10 } = await chrome.storage.sync.get("accessMinutes");
  minutesEl.value = accessMinutes;
}

async function saveMinutes() {
  const minutesEl = document.getElementById("nd-minutes");
  const savedEl   = document.getElementById("nd-saved");
  if (!minutesEl) return;
  const v = parseInt(minutesEl.value, 10);
  const safe = Number.isFinite(v) ? Math.max(1, Math.min(180, v)) : 10;
  await chrome.storage.sync.set({ accessMinutes: safe });
  if (savedEl) {
    savedEl.textContent = t("savedOK");
    setTimeout(() => { savedEl.textContent = ""; }, 1500);
  }
}

/* ========== Init ========== */
document.addEventListener("DOMContentLoaded", async () => {
  await loadLang();
  applyLanguage();

  const langSwitch = document.getElementById("lang-switch-settings");
  if (langSwitch) langSwitch.addEventListener("click", async () => {
    await toggleLang();
    applyLanguage();
    renderList();
  });

  renderList();
  document.getElementById("addBtn")?.addEventListener("click", addSite);
  document.getElementById("siteInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addSite();
  });

  await loadMinutes();
  document.getElementById("nd-save-minutes")?.addEventListener("click", saveMinutes);
});
