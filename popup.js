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
    // console.log('[popup] sayaç öğeleri yok, çıkılıyor');
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
    // console.log('[popup] accessUntil:', accessUntil, 'now:', Date.now());

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
      // console.log('[popup] storage change:', area, changes.accessUntil);
      render();
    }
  });
});
/* ===================== Geri Sayım Sonu ===================== */


/* ===================== Bugünkü deneme sayısını göster (EKLE) ===================== */
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
