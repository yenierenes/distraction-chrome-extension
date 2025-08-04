const input = document.getElementById("siteInput");
const addBtn = document.getElementById("addBtn");
const siteListContainer = document.getElementById("siteList");

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
