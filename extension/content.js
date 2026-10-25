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
    videoEl.dataset.xyfionAttached = "true";

    const parent = videoEl.parentElement;
    if (!parent) return;

    // Ebeveyn kapsayıcının stilini kontrol et
    const computedStyle = window.getComputedStyle(parent);
    if (computedStyle.position === "static") {
      parent.style.position = "relative";
    }

    const btn = document.createElement("button");
    btn.className = "xyfion-dl-btn";
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
    parent.addEventListener("mouseenter", () => btn.classList.add("active"));
    parent.addEventListener("mouseleave", () => btn.classList.remove("active"));

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const videoSrc = videoEl.currentSrc || videoEl.src || window.location.href;
      const title = document.title || "Web Videosu";

      btn.querySelector("span").textContent = "Gönderiliyor...";
      btn.style.opacity = "1";

      chrome.runtime.sendMessage(
        {
          action: "DOWNLOAD_MEDIA",
          videoUrl: videoSrc,
          title: title,
          formatType: "mp4",
          quality: "best",
        },
        (response) => {
          if (response && response.success) {
            btn.querySelector("span").textContent = "✓ İletildi!";
            showToast("Video XyfionVid'e başarıyla iletildi!");
            setTimeout(() => {
              btn.querySelector("span").textContent = "XyfionVid ile İndir";
            }, 3000);
          } else {
            const err = response?.error || "Sunucuya bağlanılamadı. XyfionVid masaüstü uygulamasını açın.";
            btn.querySelector("span").textContent = "Hata!";
            showToast(err, true);
            setTimeout(() => {
              btn.querySelector("span").textContent = "XyfionVid ile İndir";
            }, 3000);
          }
        }
      );
    });

    parent.appendChild(btn);
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

  // İlk tarama
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanVideos);
  } else {
    scanVideos();
  }
})();
