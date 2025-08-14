const toggleSwitch = document.getElementById("toggleSwitch");
const statusText = document.getElementById("statusText");
const settingsBtn = document.getElementById("settingsBtn");

function updateStatusText(isActive) {
  if (isActive) {
    statusText.textContent = "Odak kalkanı aktif";
  } else {
    statusText.textContent = "Uygulamayı aktif et";
  }
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

/* ===================== Geri Sayım (DOMContentLoaded) ===================== */
/* Not: Bu bölüm, background grantAccess sonrası ayarlanan accessUntil değerini
   popup'ta gösterir. Hem LOCAL hem SYNC depoyu kontrol eder;
   biri boşsa diğerinden alır ve storage değişimini canlı dinler. */

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('nd-timerStatus');
  const countdownEl = document.getElementById('nd-countdown');
  if (!statusEl || !countdownEl) {
    // Sayaç HTML'i yoksa sessiz çık (UI eklemediysen sorun değil)
    return;
  }

  let ndIntervalId = null;

  const fmt = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  async function readAccessUntil() {
    // Önce local, yoksa sync — ikisini de dene
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
      statusEl.textContent = 'Serbest zaman bekleniyor…';
      countdownEl.textContent = '--:--';
      return;
    }

    statusEl.textContent = 'Serbest zaman bitimine kalan süre:';
    const tick = () => {
      const remain = accessUntil - Date.now();
      countdownEl.textContent = fmt(remain);
      if (remain <= 0) {
        clearInterval(ndIntervalId);
        statusEl.textContent = 'Serbest zaman doldu.';
        countdownEl.textContent = '00:00';
      }
    };
    tick();
    ndIntervalId = setInterval(tick, 1000);
  }

  // İlk açılışta hesapla
  render();

  // accessUntil güncellenince canlı yenile (hem local hem sync’i dinle)
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && changes.accessUntil) || (area === 'sync' && changes.accessUntil)) {
      render();
    }
  });
});
/* ===================== Geri Sayım Sonu ===================== */

/* === ND: Popup canlı sayaç ve istatistikler === */
document.addEventListener('DOMContentLoaded', () => {
  // Yardımcılar (bu scope'ta tek kez tanımlı – fonksiyon içinde tekrar tanımlamıyoruz)
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

  // --- DOM elemanlarını YÜKLENDİKTEN SONRA al ---
  const liveEl   = document.getElementById('nd-live-counter');
  const todayEl  = document.getElementById('nd-today-total');
  const statsBtn = document.getElementById('nd-stats-btn');
  const panel    = document.getElementById('nd-stats-panel');
  const content  = document.getElementById('nd-stats-content');

  if (!liveEl || !todayEl || !statsBtn || !panel || !content) {
    // HTML yoksa sessiz çık
    return;
  }

  // ---- Canlı sayaç ----
  let liveTimer = null;

  // Arka plandan gerçek durumu iste (00:00 kalma sorunu için kritik)
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
    const st = await getFocusState();       // açılır açılmaz bir kere hesapla
    renderLive(st.running, st.startedAt);
    liveTimer = setInterval(async () => {   // sonra her saniye güncelle
      const st2 = await getFocusState();
      renderLive(st2.running, st2.startedAt);
    }, 1000);
  }

  // ---- Bugünün toplamı (oturum bitince artar) ----
  async function renderTodayTotal() {
    const now = new Date();
    const key = dayKeyOf(now);
    const { dailyTotals={} } = await chrome.storage.local.get('dailyTotals');
    const sec = dailyTotals[key]?.focusSecTotal || 0;
    todayEl.textContent = `Bugünkü Toplam: ${secToMinStr(sec)}`;
  }

  // ---- İstatistik paneli: Son 7 gün + Bu Hafta + Bu Ay + En çok dağıtanlar ----
  function renderStatsPanel(dailyTotals = {}, monthlyTotals = {}) {
    const now = new Date();

    // Son 7 gün tablosu
    const rows = [];
    rows.push(`<div style="font-weight:700;margin-bottom:4px;">Son 7 Gün</div>`);
    rows.push(`<table style="width:100%; border-collapse:collapse; font-size:12px;">`);
    rows.push(`<tr><th style="text-align:left;padding:2px 0;">Gün</th><th style="text-align:right;">Süre</th></tr>`);

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dk = dayKeyOf(d);
      const sec = dailyTotals[dk]?.focusSecTotal || 0;
      rows.push(
        `<tr><td style="padding:2px 0;">${dk}</td><td style="text-align:right;">${secToMinStr(sec)}</td></tr>`
      );
    }
    rows.push(`</table>`);

    // Bu hafta toplam (son 7 gün)
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dk = dayKeyOf(d);
      weekTotal += (dailyTotals[dk]?.focusSecTotal || 0);
    }
    rows.push(`<div style="margin-top:8px;"><b>Bu Hafta:</b> ${secToMinStr(weekTotal)}</div>`);

    // Bu ay toplam
    const monthKey = monthKeyOf(now);
    const monthTotal = monthlyTotals?.[monthKey]?.focusSecTotal || 0;
    rows.push(`<div><b>Bu Ay:</b> ${secToMinStr(monthTotal)}</div>`);

    // ==== EN ÇOK DİKKATİNİ DAĞITAN (BUGÜN / HAFTA / AY) ====
    function topDomainFromMap(mapObj) {
      if (!mapObj || typeof mapObj !== 'object') return '-';
      let bestKey = null, bestVal = 0;
      for (const [k, v] of Object.entries(mapObj)) {
        if ((v || 0) > bestVal) { bestVal = v || 0; bestKey = k; }
      }
      return bestKey ? `${bestKey} (${bestVal})` : '-';
    }

    // BUGÜN
    const todayKey = dayKeyOf(now);
    const todayTop = topDomainFromMap((dailyTotals[todayKey] || {}).distractionsByDomain);

    // BU HAFTA (son 7 gün toplanır)
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

    // BU AY
    const monthTop = topDomainFromMap((monthlyTotals[monthKey] || {}).distractionsByDomain);

    rows.push(`<div style="margin-top:8px; font-weight:700;">En Çok Dikkatini Dağıtan</div>`);
    rows.push(`<div>Bugün: ${todayTop}</div>`);
    rows.push(`<div>Bu Hafta: ${weekTop}</div>`);
    rows.push(`<div>Bu Ay: ${monthTop}</div>`);

    content.innerHTML = rows.join('');
  }

  // Panel aç/kapa
  statsBtn.addEventListener('click', async () => {
    const open = panel.style.display === 'block';
    if (open) {
      panel.style.display = 'none';
      return;
    }
    const data = await chrome.storage.local.get(['dailyTotals','monthlyTotals']);
    // (Opsiyonel cache, ama kullanmasak da sorun değil)
    window.__ndMonthlyCache = { monthlyTotals: data.monthlyTotals || {} };
    renderStatsPanel(data.dailyTotals || {}, data.monthlyTotals || {});
    panel.style.display = 'block';
  });

  // İlk çizimler (artık DOM hazır)
  startLiveCounter();
  renderTodayTotal();

  // Storage değişince güncelle
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
    // Switch değişirse de canlı sayacı tekrar değerlendir
    if (area === 'sync' && changes.isActive) startLiveCounter();
  });
});


/* ===================== Bugünkü deneme sayısını göster ===================== */
/* Arkaplanda (background.js) blur enjekte edildiğinde ndIncTodayAttempts()
   ile local storage'a gün bazında sayaç yazıyoruz.
   Burada o değeri okuyup popup'ta gösteriyoruz. */

document.addEventListener('DOMContentLoaded', () => {
  const label = document.getElementById('nd-today-count');
  if (!label) return; // popup.html'de alan yoksa sessiz çık

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

  // İlk yükleme
  renderToday();

  // Aynı gün içinde değer artınca canlı güncelle
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const key = todayKey();
    if (changes[key]) renderToday();
  });
});
/* ===================== Bugünkü deneme sayısı Son ===================== */
