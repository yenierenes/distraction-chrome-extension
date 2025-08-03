const siteInput = document.getElementById("siteInput");
const addBtn = document.getElementById("addSiteBtn");
const listContainer = document.getElementById("siteListContainer");

// Siteyi ekrana liste olarak ekle
function renderSite(site) {
  const item = document.createElement("div");
  item.textContent = site;
  listContainer.appendChild(item);
}

// + butonuna tıklandığında çalışacak
addBtn.addEventListener("click", () => {
  const site = siteInput.value.trim();
  if (site !== "") {
    renderSite(site);   // ekrana yazdır
    siteInput.value = ""; // kutuyu temizle
  }
});
