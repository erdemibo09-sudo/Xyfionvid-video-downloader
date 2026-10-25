// XyfionVid Popup Controller

document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const tabTitleEl = document.getElementById("tabTitle");
  const mediaCountBadge = document.getElementById("mediaCountBadge");
  const mediaList = document.getElementById("mediaList");
  const emptyState = document.getElementById("emptyState");
  const btnClearMedia = document.getElementById("btnClearMedia");

  let currentTabId = null;
  let currentTabTitle = "Web Videosu";

  // 1. Aktif sekmeyi tespit et
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    currentTabId = activeTab.id;
    currentTabTitle = activeTab.title || "Web Videosu";
    tabTitleEl.textContent = currentTabTitle;
  }

  // 2. Masaüstü Sunucu Durumunu Kontrol Et
  chrome.runtime.sendMessage({ action: "CHECK_SERVER" }, (response) => {
    if (response && response.online) {
      statusDot.className = "status-dot online";
      statusText.textContent = "Sunucu Aktif";
    } else {
      statusDot.className = "status-dot offline";
      statusText.textContent = "Sunucu Kapalı (Start.bat)";
      statusText.title = "XyfionVid masaüstü uygulaması açık değil. Lütfen Start.bat'ı çalıştırın.";
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
        sendDownload(item.url, item.title, "mp3", card.querySelector(".btn-audio"));
      });

      // MP4 İndir
      card.querySelector(".btn-video").addEventListener("click", () => {
        sendDownload(item.url, item.title, "mp4", card.querySelector(".btn-video"));
      });

      mediaList.appendChild(card);
    });
  }

  function sendDownload(url, title, formatType, buttonEl) {
    const originalText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "İletiliyor...";

    chrome.runtime.sendMessage(
      {
        action: "DOWNLOAD_MEDIA",
        videoUrl: url,
        title: title || currentTabTitle,
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
          alert("Hata: " + (res?.error || "Masaüstü sunucusuna bağlanılamadı. Lütfen Start.bat dosyasını açın."));
          buttonEl.disabled = false;
          buttonEl.textContent = originalText;
        }
      }
    );
  }

  // Temizle Butonu
  btnClearMedia.addEventListener("click", () => {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ action: "CLEAR_MEDIA", tabId: currentTabId }, () => {
      renderMedia([]);
    });
  });

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  loadMediaList();
});
