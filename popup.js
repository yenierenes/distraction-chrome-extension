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
  toggleSwitch.checked = isActive;
  updateStatusText(isActive);
});

toggleSwitch.addEventListener("change", () => {
  const isActive = toggleSwitch.checked;
  chrome.storage.sync.set({ isActive }, () => {
    updateStatusText(isActive);
  });
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage
    ? chrome.runtime.openOptionsPage()
    : window.open(chrome.runtime.getURL("settings.html"));
});
