// XyfionVid Companion Extension - Background Service Worker (Manifest V3)

const SERVER_URL = "http://localhost:3000";
const detectedMedia = new Map(); // tabId -> Array of Media objects

// Medya URL filtreleme kuralları
const MEDIA_EXT_REGEX = /\.(m3u8|mpd|mp4|webm|m4a|m4s|ts)(\?.*)?$/i;
const EXCLUDED_REGEX = /(ad|analytics|tracker|telemetry|doubleclick|googlesyndication|facebook\.com\/tr)/i;

function cleanMediaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.href;
  } catch {
    return rawUrl;
  }
}

function detectMediaType(url, contentType = "") {
  const lowerUrl = url.toLowerCase();
  const lowerType = (contentType || "").toLowerCase();

  if (lowerUrl.includes(".m3u8") || lowerType.includes("mpegurl") || lowerType.includes("apple.mpegurl")) {
    return "HLS Akışı (.m3u8)";
  }
  if (lowerUrl.includes(".mpd") || lowerType.includes("dash+xml")) {
    return "DASH Akışı (.mpd)";
  }
  if (lowerUrl.includes(".mp4") || lowerType.includes("video/mp4")) {
    return "MP4 Video";
  }
  if (lowerUrl.includes(".webm") || lowerType.includes("video/webm")) {
    return "WebM Video";
  }
  if (lowerUrl.includes(".m4a") || lowerType.includes("audio/mp4")) {
    return "M4A Ses";
  }
  if (lowerUrl.includes(".ts") || lowerType.includes("video/mp2t")) {
    return "TS Parçası";
  }
  return "Medya Akışı";
}

// 1. Ağ Trafiğini Dinle (onBeforeRequest)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { tabId, url, method, initiator, documentUrl, originUrl } = details;
    if (tabId < 0 || method !== "GET") return;
    if (EXCLUDED_REGEX.test(url)) return;

    const referer = originUrl || documentUrl || initiator || "";
    if (MEDIA_EXT_REGEX.test(url)) {
      registerMedia(tabId, url, "", referer);
    }
  },
  { urls: ["<all_urls>"] }
);

// 2. Yanıt Başlıklarını Dinle (MIME Type üzerinden medya yakalama)
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const { tabId, url, responseHeaders, initiator, documentUrl, originUrl } = details;
    if (tabId < 0) return;
    if (EXCLUDED_REGEX.test(url)) return;

    let contentType = "";
    if (responseHeaders) {
      for (const header of responseHeaders) {
        if (header.name.toLowerCase() === "content-type") {
          contentType = header.value || "";
          break;
        }
      }
    }

    const isVideo = contentType.startsWith("video/") || contentType.includes("mpegurl") || contentType.includes("dash+xml");
    if (isVideo) {
      const referer = originUrl || documentUrl || initiator || "";
      registerMedia(tabId, url, contentType, referer);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// 3. Yakalanan Medyayı Kaydet ve Rozeti Güncelle
function registerMedia(tabId, rawUrl, contentType = "", referer = "") {
  const url = cleanMediaUrl(rawUrl);

  // TS parçalarını tek tek kaydetme, doğrudan .m3u8 ana akışı ara
  if (url.includes(".ts") && !url.includes(".m3u8")) {
    const list = detectedMedia.get(tabId) || [];
    const hasParentPlaylist = list.some((item) => item.type.includes("m3u8"));
    if (hasParentPlaylist) return; // Zaten ana playlist var, TS parçalarıyla doldurma
  }

  let list = detectedMedia.get(tabId) || [];

  // Mükerrer URL kontrolü
  if (list.some((item) => item.url === url)) return;

  chrome.tabs.get(tabId, (tab) => {
    const tabTitle = tab?.title || "Web Videosu";
    const mediaType = detectMediaType(url, contentType);

    const mediaItem = {
      id: "media_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      url: url,
      pageUrl: referer || tab?.url || "",
      title: tabTitle,
      type: mediaType,
      detectedAt: new Date().toLocaleTimeString("tr-TR"),
    };

    list.unshift(mediaItem);
    // Maksimum 30 adet tut
    if (list.length > 30) list.pop();
    detectedMedia.set(tabId, list);

    // Rozet sayısını güncelle
    chrome.action.setBadgeText({ tabId, text: list.length.toString() });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });

    // Sayfa içine algılandı uyarısı fırlat
    chrome.tabs.sendMessage(tabId, { action: "MEDIA_FOUND", media: mediaItem }).catch(() => {});
  });
}

// 4. Sekme Kapanınca veya Yenilenince Temizle
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedMedia.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    detectedMedia.set(tabId, []);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

// 5. Mesaj Dinleyicisi (Popup ve Content script ile iletişim)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_MEDIA") {
    const tabId = request.tabId;
    const list = detectedMedia.get(tabId) || [];
    sendResponse({ media: list });
    return true;
  }

  if (request.action === "CLEAR_MEDIA") {
    const tabId = request.tabId;
    detectedMedia.set(tabId, []);
    chrome.action.setBadgeText({ tabId, text: "" });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "CHECK_SERVER") {
    fetch(`${SERVER_URL}/api/status`)
      .then((res) => res.json())
      .then((data) => sendResponse({ online: true, data }))
      .catch((err) => sendResponse({ online: false, error: err.message }));
    return true;
  }

  if (request.action === "DOWNLOAD_MEDIA") {
    const { videoUrl, title, formatType = "mp4", quality = "best", pageUrl = "" } = request;

    fetch(`${SERVER_URL}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl,
        title: title || "Web Videosu",
        pageUrl: pageUrl,
        formatType,
        quality,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "İndirme başlatılamadı");
        sendResponse({ success: true, jobId: data.jobId });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});
