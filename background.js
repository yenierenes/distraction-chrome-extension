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

// Sayfa tamamen yüklendiğinde çalışır
chrome.webNavigation.onCompleted.addListener(handleBlurInjection);

// SPA (tek sayfa uygulamaları) geçişlerinde çalışır
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
