// XyfionVid Content Script - Floating Video Download Button Injector

(function () {
  let toastEl = null;

  function showToast(message, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "xyfion-toast";
      document.body.appendChild(toastEl);
    }

    toastEl.innerHTML = `
      <span class="xyfion-toast-icon">${isError ? "⚠️" : "✓"}</span>
      <span>${message}</span>
    `;
    toastEl.style.borderColor = isError ? "#ef4444" : "#10b981";
    toastEl.classList.add("show");

    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3500);
  }

  function attachDownloadBtn(videoEl) {
    if (videoEl.dataset.xyfionAttached) return;
    const isIframe = window.self !== window.top;
    if (isIframe && document.querySelector(".xyfion-dl-btn")) {
      videoEl.dataset.xyfionAttached = "true";
      return;
    }

    const hostContainer = isIframe ? (document.body || document.documentElement) : videoEl.parentElement;
    if (!hostContainer) return;
    videoEl.dataset.xyfionAttached = "true";

    if (!isIframe) {
      const computedStyle = window.getComputedStyle(hostContainer);
      if (computedStyle.position === "static") {
        hostContainer.style.position = "relative";
      }
    }

    const btn = document.createElement("button");
    btn.className = isIframe ? "xyfion-dl-btn xyfion-dl-btn-fixed" : "xyfion-dl-btn";
    btn.type = "button";
    btn.title = "Bu videoyu XyfionVid Masaüstü uygulaması ile indir";
    btn.innerHTML = `
      <svg class="xyfion-dl-icon" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>XyfionVid ile İndir</span>
    `;

    // Video üzerine gelindiğinde düğmeyi netleştir
    hostContainer.addEventListener("mouseenter", () => btn.classList.add("active"));
    hostContainer.addEventListener("mouseleave", () => btn.classList.remove("active"));

    // Oynatıcının mousedown/pointerdown ile tıklamayı yutmasını engelle
    ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((evt) => {
      btn.addEventListener(evt, (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      collectMediaFromFrame();

      const videoSrc = videoEl.currentSrc || videoEl.src || "blob:resolve";
      const title = document.title || "";

      btn.querySelector("span").textContent = "Gönderiliyor...";
      btn.style.opacity = "1";

      chrome.runtime.sendMessage(
        {
          action: "DOWNLOAD_MEDIA",
          videoUrl: videoSrc,
          pageUrl: window.location.href,
          title: title,
          formatType: "mp4",
          quality: "best",
        },
        (response) => {
          void chrome.runtime.lastError;
          if (response && response.success) {
            btn.querySelector("span").textContent = "✓ İletildi!";
            showToast("Video XyfionVid'e başarıyla iletildi!");
            setTimeout(() => {
              btn.querySelector("span").textContent = "XyfionVid ile İndir";
            }, 3000);
          } else {
            const err = response?.error || "Sunucuya bağlanılamadı. XyfionVid uygulamasını açın.";
            btn.querySelector("span").textContent = "Hata!";
            showToast(err, true);
            setTimeout(() => {
              btn.querySelector("span").textContent = "XyfionVid ile İndir";
            }, 3000);
          }
        }
      );
    }, true);

    hostContainer.appendChild(btn);
  }

  // Sayfadaki mevcut video etiketlerini tara
  function scanVideos() {
    const videos = document.querySelectorAll("video");
    videos.forEach((v) => {
      // 100 pikselden küçük reklam/dekoratif videoları atla
      if (v.offsetWidth > 160 || v.offsetHeight > 120 || v.readyState > 0) {
        attachDownloadBtn(v);
      }
    });
  }

  // Dinamik olarak yüklenen video oynatıcıları izle (SPA / AJAX)
  const observer = new MutationObserver(() => {
    scanVideos();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // DOM <video> etiketleri ve önceden yüklenmiş kaynakları (performance API) tara
  function collectMediaFromFrame() {
    const found = new Set();
    const pageUrl = window.location.href;
    const title = document.title || "";

    document.querySelectorAll("video").forEach((v) => {
      if (v.currentSrc && !v.currentSrc.startsWith("blob:")) found.add(v.currentSrc);
      if (v.src && !v.src.startsWith("blob:")) found.add(v.src);
      v.querySelectorAll("source").forEach((s) => {
        if (s.src && !s.src.startsWith("blob:")) found.add(s.src);
      });
    });

    try {
      const entries = performance.getEntriesByType("resource") || [];
      for (const entry of entries) {
        if (entry && entry.name && entry.name.startsWith("http")) {
          found.add(entry.name);
        }
      }
    } catch {}

    if (found.size > 0) {
      const items = Array.from(found).map((url) => ({ url, pageUrl }));
      try {
        chrome.runtime.sendMessage({ action: "REGISTER_DOM_MEDIA", items, title }, () => {
          void chrome.runtime.lastError;
        });
      } catch {}
    }
    return found.size;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCAN_PAGE_MEDIA") {
      scanVideos();
      const count = collectMediaFromFrame();
      sendResponse({ scanned: count });
      return true;
    }
  });

  // İlk tarama
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      scanVideos();
      collectMediaFromFrame();
    });
  } else {
    scanVideos();
    collectMediaFromFrame();
  }
})();
