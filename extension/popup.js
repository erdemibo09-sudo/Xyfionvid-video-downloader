// XyfionVid Popup Controller

document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const tabTitleEl = document.getElementById("tabTitle");
  const mediaCountBadge = document.getElementById("mediaCountBadge");
  const mediaList = document.getElementById("mediaList");
  const emptyState = document.getElementById("emptyState");
  const btnClearMedia = document.getElementById("btnClearMedia");
  const btnRescanMedia = document.getElementById("btnRescanMedia");
  const btnOpenDesktopApp = document.getElementById("btnOpenDesktopApp");
  const permissionBanner = document.getElementById("permissionBanner");
  const btnGrantPermission = document.getElementById("btnGrantPermission");

  let currentTabId = null;
  let currentTabTitle = "Web Videosu";
  let currentTabUrl = "";

  // 0. Firefox MV3 tüm siteler izni kontrolü
  if (chrome.permissions && chrome.permissions.contains && permissionBanner) {
    chrome.permissions.contains({ origins: ["<all_urls>"] }, (hasPerm) => {
      if (!hasPerm) {
        permissionBanner.classList.remove("hidden");
      }
    });

    if (btnGrantPermission) {
      btnGrantPermission.addEventListener("click", () => {
        chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => {
          if (granted) {
            permissionBanner.classList.add("hidden");
            triggerTabScan();
          }
        });
      });
    }
  }

  // 1. Aktif sekmeyi tespit et
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    currentTabId = activeTab.id;
    currentTabTitle = activeTab.title || "Web Videosu";
    currentTabUrl = activeTab.url || "";
    tabTitleEl.textContent = currentTabTitle;
  }

  // 2. Masaüstü Sunucu Durumunu Kontrol Et
  chrome.runtime.sendMessage({ action: "CHECK_SERVER" }, (response) => {
    if (response && response.online) {
      statusDot.className = "status-dot online";
      statusText.textContent = "Sunucu Aktif";
    } else {
      statusDot.className = "status-dot offline";
      statusText.textContent = "Sunucu Kapalı (XyfionVid)";
      statusText.title = "XyfionVid masaüstü uygulaması açık değil. Lütfen XyfionVid.exe veya Start.bat'ı çalıştırın.";
    }
  });

  // 3. Yakalanan Medyaları Listele
  function loadMediaList() {
    if (!currentTabId) return;

    chrome.runtime.sendMessage({ action: "GET_MEDIA", tabId: currentTabId }, (response) => {
      const items = response?.media || [];
      renderMedia(items);
    });
  }

  function triggerTabScan() {
    if (!currentTabId) return;
    try {
      chrome.tabs.sendMessage(currentTabId, { action: "SCAN_PAGE_MEDIA" }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
    setTimeout(loadMediaList, 250);
  }

  function renderMedia(items) {
    mediaCountBadge.textContent = `${items.length} Video Algılandı`;

    if (items.length === 0) {
      emptyState.style.display = "block";
      // Eski kartları kaldır
      const cards = mediaList.querySelectorAll(".media-card");
      cards.forEach((c) => c.remove());
      return;
    }

    emptyState.style.display = "none";
    mediaList.innerHTML = "";

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "media-card";

      let tagClass = "tag-other";
      if (item.type.includes("m3u8")) tagClass = "tag-hls";
      else if (item.type.includes("mp4")) tagClass = "tag-mp4";

      card.innerHTML = `
        <div class="media-header">
          <span class="media-type-tag ${tagClass}">${item.type}</span>
          <span class="media-time">${item.detectedAt}</span>
        </div>
        <div class="media-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
        <div class="media-actions">
          <button class="btn-dl btn-secondary btn-copy" title="Bağlantıyı kopyala">📋</button>
          <button class="btn-dl btn-secondary btn-audio" title="Sadece Ses (MP3)">🎵 MP3</button>
          <button class="btn-dl btn-primary btn-video" title="Full HD MP4 İndir">⚡ İndir</button>
        </div>
      `;

      // Kopyala
      card.querySelector(".btn-copy").addEventListener("click", () => {
        navigator.clipboard.writeText(item.url);
        const btn = card.querySelector(".btn-copy");
        btn.textContent = "✓";
        setTimeout(() => (btn.textContent = "📋"), 1500);
      });

      // MP3 İndir
      card.querySelector(".btn-audio").addEventListener("click", () => {
        sendDownload(item.url, item.title, "mp3", card.querySelector(".btn-audio"), item.pageUrl);
      });

      // MP4 İndir
      card.querySelector(".btn-video").addEventListener("click", () => {
        sendDownload(item.url, item.title, "mp4", card.querySelector(".btn-video"), item.pageUrl);
      });

      mediaList.appendChild(card);
    });
  }

  function sendDownload(url, title, formatType, buttonEl, customPageUrl = "") {
    const originalText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "İletiliyor...";

    chrome.runtime.sendMessage(
      {
        action: "DOWNLOAD_MEDIA",
        videoUrl: url,
        title: title || currentTabTitle,
        pageUrl: customPageUrl || currentTabUrl,
        formatType: formatType,
        quality: "best",
      },
      (res) => {
        if (res && res.success) {
          buttonEl.textContent = "✓ İletildi!";
          buttonEl.style.background = "#10b981";
          setTimeout(() => {
            buttonEl.disabled = false;
            buttonEl.textContent = originalText;
            buttonEl.style.background = "";
          }, 3000);
        } else {
          alert("Hata: " + (res?.error || "Masaüstü sunucusuna bağlanılamadı. Lütfen XyfionVid uygulamasını açın."));
          buttonEl.disabled = false;
          buttonEl.textContent = originalText;
        }
      }
    );
  }

  // Tara Butonu
  if (btnRescanMedia) {
    btnRescanMedia.addEventListener("click", () => {
      triggerTabScan();
    });
  }

  // Temizle Butonu
  btnClearMedia.addEventListener("click", () => {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ action: "CLEAR_MEDIA", tabId: currentTabId }, () => {
      renderMedia([]);
    });
  });

  // Masaüstü Uygulamasını Aç Butonu (.exe öne getir / kapalıysa xyfionvid:// ile aç)
  if (btnOpenDesktopApp) {
    btnOpenDesktopApp.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_DESKTOP_APP" }, (res) => {
        if (res && res.success) {
          window.close();
        } else {
          chrome.tabs.create({ url: "xyfionvid://open", active: true });
        }
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  loadMediaList();
  triggerTabScan();
});
