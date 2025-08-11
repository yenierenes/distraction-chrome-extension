const input = document.getElementById("siteInput");
const addBtn = document.getElementById("addBtn");
const siteListContainer = document.getElementById("siteList");

// === SÜRE AYARI EKLEMESİ ===
const minutesInput = document.getElementById('nd-minutes');
const saveBtn = document.getElementById('nd-save-minutes');
const savedMsg = document.getElementById('nd-saved');

if (minutesInput && saveBtn) {
  // Açılışta değeri yükle (varsayılan 10 dk)
  chrome.storage.sync.get({ accessMinutes: 10 }, ({ accessMinutes }) => {
    minutesInput.value = accessMinutes;
  });

  // Kaydet butonu
  saveBtn.addEventListener('click', async () => {
    const val = parseInt(minutesInput.value, 10);
    const clamped = Number.isFinite(val) ? Math.min(180, Math.max(1, val)) : 10;
    await chrome.storage.sync.set({ accessMinutes: clamped });
    savedMsg.textContent = 'Kaydedildi';
    setTimeout(() => (savedMsg.textContent = ''), 1500);
  });
}
// === SÜRE AYARI EKLEMESİ SON ===

let sites = [];

// Sayfa açıldığında kayıtlı siteleri yükle
chrome.storage.sync.get("customSites", (data) => {
  sites = data.customSites || [];
  renderSites();
});

function renderSites() {
  siteListContainer.innerHTML = "";
  sites.forEach((site, index) => {
    const div = document.createElement("div");
    div.className = "site-item";

    const span = document.createElement("span");
    span.textContent = site;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "❌";
    removeBtn.className = "remove-btn";
    removeBtn.addEventListener("click", () => {
      sites.splice(index, 1);
      chrome.storage.sync.set({ customSites: sites }, renderSites);
    });

    div.appendChild(span);
    div.appendChild(removeBtn);
    siteListContainer.appendChild(div);
  });
}

addBtn.addEventListener("click", () => {
  const site = input.value.trim();
  if (site && !sites.includes(site)) {
    sites.push(site);
    chrome.storage.sync.set({ customSites: sites }, () => {
      input.value = "";
      renderSites();
    });
  }
});
