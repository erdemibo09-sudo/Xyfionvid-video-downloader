// XyfionVid Companion Extension - Background Script / Service Worker (Manifest V3)

const SERVER_URL = "http://localhost:3000";
const detectedMedia = new Map(); // tabId -> Array of media objects (fast cache)
const storageArea = chrome.storage && (chrome.storage.session || chrome.storage.local);

// Medya URL filtreleme kuralları
const MEDIA_EXT_REGEX = /\.(m3u8|mpd|mp4|webm|mkv|m4a|m4v|mov|flv|m4s|ts)(\?.*|#.*)?$/i;
const MASKED_PLAYLIST_REGEX = /(?:^|\/)(?:master|playlist|index|manifest|chunklist|sublist|hls|stream)[^/?#]*\.(?:txt|m3u8?|dat|bin|json)(\?.*|#.*)?$/i;
const STREAM_HINT_REGEX = /(?:m3u8|hls|master|playlist|manifest|sublist|chunklist|videoplayback|\/mp4\/)/i;
const ASSET_EXCLUDE_REGEX = /\.(css|js|mjs|map|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|vtt|srt|ass)(\?.*|#.*)?$/i;
const EXCLUDED_REGEX = /(adservice|doubleclick|googlesyndication|googletagmanager|google-analytics|analytics|telemetry|facebook\.com\/tr|clarity\.ms|mc\.yandex)/i;

function storageKey(tabId) {
  return "tab_media_" + tabId;
}

async function getTabMedia(tabId) {
  if (detectedMedia.has(tabId)) {
    return detectedMedia.get(tabId) || [];
  }
  if (!storageArea) return [];
  try {
    const key = storageKey(tabId);
    const data = await storageArea.get(key);
    const list = Array.isArray(data[key]) ? data[key] : [];
    detectedMedia.set(tabId, list);
    return list;
  } catch {
    return [];
  }
}

async function saveTabMedia(tabId, list) {
  detectedMedia.set(tabId, list);
  if (!storageArea) return;
  try {
    await storageArea.set({ [storageKey(tabId)]: list });
  } catch {
    // storage kotası veya kısıtlama durumunda bellekten devam et
  }
}

async function clearTabMedia(tabId) {
  detectedMedia.set(tabId, []);
  try {
    chrome.action.setBadgeText({ tabId, text: "" });
  } catch {}
  if (!storageArea) return;
  try {
    await storageArea.remove(storageKey(tabId));
  } catch {}
}

function cleanMediaUrl(rawUrl) {
  try {
    return new URL(rawUrl).href;
  } catch {
    return rawUrl;
  }
}

function isCandidateMediaUrl(url, contentType = "") {
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return false;
  if (EXCLUDED_REGEX.test(url) || ASSET_EXCLUDE_REGEX.test(url)) return false;

  const lowerType = (contentType || "").toLowerCase();
  if (
    lowerType.startsWith("video/") ||
    lowerType.includes("mpegurl") ||
    lowerType.includes("dash+xml") ||
    lowerType === "audio/mp4" ||
    lowerType === "audio/mpeg" ||
    lowerType === "audio/aac"
  ) {
    return true;
  }

  if (MEDIA_EXT_REGEX.test(url) || MASKED_PLAYLIST_REGEX.test(url)) {
    return true;
  }

  if (
    (lowerType.includes("text/plain") || lowerType.includes("octet-stream")) &&
    STREAM_HINT_REGEX.test(url)
  ) {
    return true;
  }

  return false;
}

function detectMediaType(url, contentType = "") {
  const lowerUrl = url.toLowerCase();
  const lowerType = (contentType || "").toLowerCase();

  if (
    lowerUrl.includes(".m3u8") ||
    MASKED_PLAYLIST_REGEX.test(lowerUrl) ||
    lowerType.includes("mpegurl") ||
    lowerType.includes("apple.mpegurl")
  ) {
    return "HLS Akışı (m3u8)";
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
  if (lowerUrl.includes(".mkv") || lowerType.includes("matroska")) {
    return "MKV Video";
  }
  if (lowerUrl.includes(".m4a") || lowerType.includes("audio/")) {
    return "Ses Akışı";
  }
  if (lowerUrl.includes(".ts") || lowerType.includes("video/mp2t")) {
    return "TS Parçası";
  }
  return "Medya Akışı";
}

// Sıralı işlem kuyruğu (aynı tabId için eşzamanlı yazma çakışmasını önler)
const tabLocks = new Map();

function enqueueTabTask(tabId, fn) {
  const prev = tabLocks.get(tabId) || Promise.resolve();
  const next = prev.then(fn, fn);
  tabLocks.set(tabId, next);
  return next;
}

// 1. Ağ Trafiğini Dinle (onBeforeRequest)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { tabId, url, method, initiator, documentUrl, originUrl } = details;
    if (tabId < 0 || method !== "GET") return;
    if (!isCandidateMediaUrl(url)) return;

    const referer = originUrl || documentUrl || initiator || "";
    registerMedia(tabId, url, "", referer);
  },
  { urls: ["<all_urls>"] }
);

// 2. Yanıt Başlıklarını Dinle (MIME Type üzerinden medya yakalama)
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const { tabId, url, responseHeaders, initiator, documentUrl, originUrl } = details;
    if (tabId < 0) return;

    let contentType = "";
    if (responseHeaders) {
      for (const header of responseHeaders) {
        if (header.name && header.name.toLowerCase() === "content-type") {
          contentType = header.value || "";
          break;
        }
      }
    }

    if (!isCandidateMediaUrl(url, contentType)) return;
    const referer = originUrl || documentUrl || initiator || "";
    registerMedia(tabId, url, contentType, referer);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// 3. Yakalanan Medyayı Kaydet ve Rozeti Güncelle
function registerMedia(tabId, rawUrl, contentType = "", referer = "", explicitTitle = "") {
  const url = cleanMediaUrl(rawUrl);

  enqueueTabTask(tabId, async () => {
    const list = await getTabMedia(tabId);
    const mediaType = detectMediaType(url, contentType);

    // Ana HLS listesi varsa .ts / .m4s parçalarını ekleme
    const isSegment = (url.includes(".ts") || url.includes(".m4s")) && !url.includes(".m3u8");
    if (isSegment && list.some((item) => item.type.includes("HLS") || item.type.includes("m3u8"))) {
      return;
    }

    // Mükerrer URL kontrolü
    if (list.some((item) => item.url === url)) return;

    let tabTitle = explicitTitle || "Web Videosu";
    let tabPageUrl = referer;

    try {
      const tab = await new Promise((resolve) => {
        chrome.tabs.get(tabId, (t) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(t);
        });
      });
      if (tab) {
        if (!explicitTitle && tab.title) tabTitle = tab.title;
        if (!tabPageUrl && tab.url) tabPageUrl = tab.url;
      }
    } catch {}

    const mediaItem = {
      id: "media_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      url,
      pageUrl: tabPageUrl || "",
      title: tabTitle,
      type: mediaType,
      detectedAt: new Date().toLocaleTimeString("tr-TR"),
    };

    const updated = [...list];
    if (mediaType.includes("HLS") || mediaType.includes("DASH")) {
      updated.unshift(mediaItem);
    } else {
      updated.push(mediaItem);
    }
    if (updated.length > 30) updated.pop();

    await saveTabMedia(tabId, updated);

    try {
      chrome.action.setBadgeText({ tabId, text: updated.length.toString() });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#10b981" });
    } catch {}

    try {
      chrome.tabs.sendMessage(tabId, { action: "MEDIA_FOUND", media: mediaItem }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
  });
}

// 4. Sekme Kapanınca veya Yeni Sayfaya Geçilince Temizle
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedMedia.delete(tabId);
  tabLocks.delete(tabId);
  if (storageArea) {
    storageArea.remove(storageKey(tabId)).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    enqueueTabTask(tabId, () => clearTabMedia(tabId));
  }
});

// 5. Mesaj Dinleyicisi (Popup ve Content script ile iletişim)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_MEDIA") {
    const tabId = request.tabId;
    getTabMedia(tabId).then((list) => {
      sendResponse({ media: list });
    });
    return true;
  }

  if (request.action === "CLEAR_MEDIA") {
    const tabId = request.tabId;
    enqueueTabTask(tabId, () => clearTabMedia(tabId)).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "REGISTER_DOM_MEDIA") {
    const tabId = sender?.tab?.id;
    const items = Array.isArray(request.items) ? request.items : [];
    if (tabId && tabId >= 0) {
      for (const item of items) {
        if (item.url && isCandidateMediaUrl(item.url)) {
          registerMedia(tabId, item.url, "", item.pageUrl || sender.url || "", request.title || "");
        }
      }
    }
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
    (async () => {
      let { videoUrl, title, formatType = "mp4", quality = "best", pageUrl = "" } = request;

      // Sayfa içi "blob:" linki gönderildiyse sekmede yakalanan gerçek akışı çöz
      if (videoUrl && videoUrl.startsWith("blob:") && sender?.tab?.id >= 0) {
        const list = await getTabMedia(sender.tab.id);
        const preferred = list.find((m) => m.type.includes("HLS") || m.type.includes("MP4") || m.type.includes("DASH")) || list[0];
        if (preferred) {
          videoUrl = preferred.url;
          if (!pageUrl && preferred.pageUrl) pageUrl = preferred.pageUrl;
        } else if (pageUrl || sender.tab.url) {
          videoUrl = pageUrl || sender.tab.url;
        }
      }

      const res = await fetch(`${SERVER_URL}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: title || "Web Videosu",
          pageUrl,
          formatType,
          quality,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "İndirme başlatılamadı");
      sendResponse({ success: true, jobId: data.jobId });
    })().catch((err) => {
      sendResponse({ success: false, error: err.message });
    });

    return true;
  }
});
