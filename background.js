let distractionLevel = 0;
let accessUntil = null;

// Erişim süresi dolmuş mu? (true = artık izin yok)
function isAccessExpired() {
  return !accessUntil || Date.now() > accessUntil;
}

// Mesajları dinle (görev başarı → AYARDAKİ SÜRE kadar izin ver)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "grantAccess") {
    // Kullanıcının settings.html'de belirlediği dakika değerini oku (varsayılan 10 dk)
    chrome.storage.sync.get({ accessMinutes: 10 }, ({ accessMinutes }) => {
      
      // accessUntil = şu an + (kullanıcı süresi * dakika cinsinden ms)
      accessUntil = Date.now() + accessMinutes * 60 * 1000;

      // 1) SYNC → Blur kontrolün buradan okuyor + cihazlar arası senkronize
      chrome.storage.sync.set({ accessUntil });

      // 2) LOCAL → Popup’taki sayaç buradan okuyor (hızlı, kota sorunu yok)
      chrome.storage.local.set({ accessUntil });

      // 3) Alarm kur → accessUntil süresi dolunca otomatik blur geri gelecek
      chrome.alarms.create('nd-clearAccess', { when: accessUntil });

      // (İsteğe bağlı) Badge ile göster:
      // chrome.action.setBadgeText({ text: 'ON' });
      // chrome.action.setBadgeBackgroundColor({ color: '#0b8' });

      // Gönderen tarafa "tamam" cevabı ver
      if (typeof sendResponse === 'function') sendResponse({ ok: true });
    });

    // async sendResponse kullanılacağı için true döndür
    return true;
  }
});

// Blur için ortak kontrol fonksiyonu
function handleBlurInjection(details) {
  chrome.storage.sync.get(["isActive", "customSites", "accessUntil"], (data) => {
    const isActive = data.isActive ?? false;
    const distractingSites = data.customSites || [];
    const now = Date.now();

    // SYNC'ten okunan accessUntil
    accessUntil = data.accessUntil || 0;

    if (!isActive) return;

    let url;
    try {
      url = new URL(details.url);
    } catch (e) {
      // Bazı özel URL’ler hata atabilir
      return;
    }

    const matched = distractingSites.some(site =>
      url.hostname.includes(site)
    );

    if (!matched) return;

    const isExpired = !accessUntil || now > accessUntil;

    if (isExpired) {
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ["blur.js"]
      });

      distractionLevel++;
    }
  });
}

// Süre bittiğinde alarm tetiklenir → erişimi kapat ve açık sekmelere blur uygula
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'nd-clearAccess') return;

  // accessUntil değerlerini temizle
  await chrome.storage.sync.remove('accessUntil');
  await chrome.storage.local.remove('accessUntil');

  // (İsteğe bağlı) Badge temizle
  chrome.action.setBadgeText({ text: '' });

  // Ayarları al (aktif mi, hangi siteler engelli)
  const { isActive = false, customSites = [] } = await chrome.storage.sync.get({ isActive: false, customSites: [] });
  if (!isActive || !Array.isArray(customSites) || customSites.length === 0) return;

  // Açık sekmeleri kontrol et ve dikkat dağıtan sitelere blur.js enjekte et
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
      } catch (e) { /* injection hatasını sessiz geç */ }
    });
  });
});

// Sayfa tamamen yüklendiğinde çalışır
chrome.webNavigation.onCompleted.addListener(handleBlurInjection);

// SPA (tek sayfa uygulamaları) geçişlerinde çalışır
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
