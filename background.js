let distractionLevel = 0;
let accessUntil = null;

// Erişim süresi dolmuş mu?
function isAccessExpired() {
  return !accessUntil || Date.now() > accessUntil;
}

// Mesajları dinle (sadece 10dk izin artık)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "grantAccess") {
    accessUntil = Date.now() + 10 * 60 * 1000; // 10 dakika
    chrome.storage.sync.set({ accessUntil });
  }
});

// Blur için ortak kontrol fonksiyonu
function handleBlurInjection(details) {
  chrome.storage.sync.get(["isActive", "customSites", "accessUntil"], (data) => {
    const isActive = data.isActive ?? false;
    const distractingSites = data.customSites || [];
    const now = Date.now();
    accessUntil = data.accessUntil || 0;

    if (!isActive) return;

    const url = new URL(details.url);
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

// SPA geçişlerinde çalışır (örn. YouTube, Facebook içi tıklamalar)
chrome.webNavigation.onHistoryStateUpdated.addListener(handleBlurInjection);
