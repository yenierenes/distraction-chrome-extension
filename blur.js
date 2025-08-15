// blur.js — i18n'li blur ekranı

if (!document.getElementById("nd-blur-overlay")) {

  // ---- i18n sözlüğü ----
  const ND_I18N = {
    en: {
      distractedTitle: "You got distracted!",
      distractedDesc: "Please leave this site.<br>If you still want to continue, answer below.",
      reasonPlaceholder: "Why do you want to enter this site?",
      enterSite: "Enter Site",
      taskTitle: "Task Time!",
      send: "Send",
      wrong: "❌ Wrong answer, try again.",
      allowBtn: "Allow Access",
      allowMsg: (mins) => `✅ Correct! You may enter the site for ${mins} minutes.`
    },
    tr: {
      distractedTitle: "Dikkatin dağıldı!",
      distractedDesc: "Lütfen bu siteden çık!<br>Devam etmek istiyorsan aşağıyı yanıtla.",
      reasonPlaceholder: "Bu siteye neden girmek istiyorsun?",
      enterSite: "Siteye Gir",
      taskTitle: "Görev Zamanı!",
      send: "Gönder",
      wrong: "❌ Yanlış cevap, tekrar dene.",
      allowBtn: "Siteye Giriş",
      allowMsg: (mins) => `✅ Doğru cevap! ${mins} dakika siteye girebilirsin.`
    }
  };

  // Dil ve süreyi oku, sonra UI oluştur
  chrome.storage.sync.get({ lang: 'en', accessMinutes: 10 }, ({ lang, accessMinutes }) => {
    const L = (lang === 'tr') ? ND_I18N.tr : ND_I18N.en;

    // Sayfayı blurla
    const style = document.createElement("style");
    style.id = "nd-blur-style";
    style.textContent = `
      body > *:not(#nd-blur-overlay) {
        filter: blur(8px) !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);

    // Arayüz kapsayıcısı
    const overlay = document.createElement("div");
    overlay.id = "nd-blur-overlay";
    overlay.style = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-family: sans-serif;
    `;

    // Modal kutusu
    const modal = document.createElement("div");
    modal.id = "nd-modal";
    modal.style = `
      background: white;
      padding: 30px;
      border-radius: 16px;
      box-shadow: 0 0 30px rgba(0,0,0,0.3);
      width: 350px;
      max-width: 90%;
      text-align: center;
    `;

    // Sebep ekranı
    modal.innerHTML = `
      <h2 style="margin-top:0;">${L.distractedTitle}</h2>
      <p>${L.distractedDesc}</p>
      <div style="font-size: 32px; margin: 10px 0;">⬇️</div>
      <input type="text" id="nd-reason" placeholder="${L.reasonPlaceholder}"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        style="display:block; margin:0 auto 10px; width:100%; max-width:100%; box-sizing:border-box; padding:10px; font-size:14px; border:1px solid #ccc; border-radius:6px;">
      <button id="nd-continue" disabled
        style="padding:10px 20px; font-size:15px; background:gray; color:white; border:none; border-radius:8px; cursor:not-allowed;">
        ${L.enterSite}
      </button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Sebep ekranı input ve buton
    const input = modal.querySelector("#nd-reason");
    const button = modal.querySelector("#nd-continue");

    // === EKLE: accessUntil verildiğinde blur'u otomatik kaldır ===
    function ndRemoveOverlay() {
      document.getElementById("nd-blur-style")?.remove();
      document.getElementById("nd-blur-overlay")?.remove();
    }

    // İlk kontrol: izin varsa UI göstermeyelim
    chrome.storage.local.get('accessUntil', ({ accessUntil }) => {
      if (typeof accessUntil === 'number' && Date.now() < accessUntil) {
        ndRemoveOverlay();
      }
    });

    // Canlı dinleme
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.accessUntil) return;
      const newVal = changes.accessUntil.newValue;
      if (typeof newVal === 'number' && Date.now() < newVal) {
        ndRemoveOverlay();
      }
    });

    input.addEventListener("input", () => {
      if (input.value.trim().length >= 5) {
        button.disabled = false;
        button.style.background = "#4CAF50";
        button.style.cursor = "pointer";
      } else {
        button.disabled = true;
        button.style.background = "gray";
        button.style.cursor = "not-allowed";
      }
    });

    button.addEventListener("click", () => {
      showTaskScreen();
    });

    // Görev ekranı
    function showTaskScreen() {
      const num1 = Math.floor(Math.random() * 90 + 10);
      const num2 = Math.floor(Math.random() * 90 + 10);
      const correct = num1 + num2;

      modal.innerHTML = `
        <h2>${L.taskTitle}</h2>
        <p>${num1} + ${num2} = ?</p>
        <input type="number" id="nd-answer" placeholder="···"
          style="padding:8px; font-size:16px; width:100px; text-align:center;">
        <br>
        <button id="nd-submit"
          style="margin-top:10px; padding:8px 16px; font-size:15px; background:#4CAF50; color:white; border:none; border-radius:6px; cursor:pointer;">
          ${L.send}
        </button>
        <p id="nd-msg" style="margin-top:10px;"></p>
        <button id="nd-access" disabled
          style="margin-top:10px; padding:8px 16px; font-size:15px; background:gray; color:white; border:none; border-radius:6px; cursor:not-allowed;">
          ${L.allowBtn}
        </button>
      `;

      const answerInput = modal.querySelector("#nd-answer");
      const submitBtn   = modal.querySelector("#nd-submit");
      const accessBtn   = modal.querySelector("#nd-access");
      const msg         = modal.querySelector("#nd-msg");

      submitBtn.addEventListener("click", () => {
        const userAnswer = parseInt(answerInput.value, 10);
        if (userAnswer === correct) {
          msg.textContent = L.allowMsg(accessMinutes);
          accessBtn.disabled = false;
          accessBtn.style.background = "#2196F3";
          accessBtn.style.cursor = "pointer";

          // Arka plana "grantAccess" gönderir → süreyi background ayarlar (accessMinutes)
          chrome.runtime.sendMessage({ action: "grantAccess" });
        } else {
          msg.textContent = L.wrong;
        }
      });

      accessBtn.addEventListener("click", () => {
        ndRemoveOverlay();
      });
    }
  });
}
