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
const capturedHeaders = new Map(); // cleanUrl -> { referer, origin, userAgent, cookie }

function enqueueTabTask(tabId, fn) {
  const prev = tabLocks.get(tabId) || Promise.resolve();
  const next = prev.then(fn, fn);
  tabLocks.set(tabId, next);
  return next;
}

function recordRequestHeaders(rawUrl, requestHeaders) {
  if (!requestHeaders || !isCandidateMediaUrl(rawUrl)) return;
  const cleanUrl = cleanMediaUrl(rawUrl);
  const hdr = { referer: "", origin: "", userAgent: "", cookie: "" };
  for (const h of requestHeaders) {
    if (!h || !h.name) continue;
    const name = h.name.toLowerCase();
    if (name === "referer") hdr.referer = h.value || "";
    else if (name === "origin") hdr.origin = h.value || "";
    else if (name === "user-agent") hdr.userAgent = h.value || "";
    else if (name === "cookie") hdr.cookie = h.value || "";
  }
  capturedHeaders.set(cleanUrl, hdr);
  if (capturedHeaders.size > 200) {
    const firstKey = capturedHeaders.keys().next().value;
    if (firstKey) capturedHeaders.delete(firstKey);
  }
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

// 1.1 Gerçek HTTP Başlıklarını Yakala (Referer, Origin, User-Agent, Cookie)
function onBeforeSendHeadersHandler(details) {
  if (details.tabId < 0 || details.method !== "GET") return;
  recordRequestHeaders(details.url, details.requestHeaders);
}

try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeadersHandler,
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
  );
} catch {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeadersHandler,
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );
}

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

    const genericTitles = new Set(["", "service", "embed", "player", "video", "untitled"]);
    let tabTitle = explicitTitle && !genericTitles.has(explicitTitle.trim().toLowerCase()) ? explicitTitle.trim() : "";
    let tabPageUrl = referer;

    try {
      const tab = await new Promise((resolve) => {
        chrome.tabs.get(tabId, (t) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(t);
        });
      });
      if (tab) {
        if (tab.title && !genericTitles.has(tab.title.trim().toLowerCase())) {
          tabTitle = tab.title.trim();
        }
        if (!tabPageUrl && tab.url) tabPageUrl = tab.url;
      }
    } catch {}
    if (!tabTitle) tabTitle = "Web Videosu";

    const liveHeaders = capturedHeaders.get(url) || {};
    const mediaItem = {
      id: "media_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      url,
      pageUrl: liveHeaders.referer || tabPageUrl || "",
      headers: liveHeaders,
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

  if (request.action === "OPEN_DESKTOP_APP") {
    fetch(`${SERVER_URL}/api/focus`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => sendResponse({ success: Boolean(data && data.success), data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "DOWNLOAD_MEDIA") {
    (async () => {
      let { videoUrl, title, formatType = "mp4", quality = "best", pageUrl = "", tabId: explicitTabId } = request;
      const tabId = typeof sender?.tab?.id === "number" ? sender.tab.id : explicitTabId;
      let storedItem = null;

      if (typeof tabId === "number" && tabId >= 0) {
        const pendingLock = tabLocks.get(tabId);
        if (pendingLock) {
          try { await pendingLock; } catch {}
        }

        const genericTitles = new Set(["", "service", "embed", "player", "video", "untitled", "web videosu"]);
        if (sender?.tab?.title && (!title || genericTitles.has(title.trim().toLowerCase()))) {
          title = sender.tab.title.trim();
        }

        const list = await getTabMedia(tabId);
        if (!videoUrl || videoUrl.startsWith("blob:")) {
          const preferred = list.find((m) => m.type.includes("HLS") || m.type.includes("MP4") || m.type.includes("DASH")) || list[0];
          if (preferred) {
            storedItem = preferred;
            videoUrl = preferred.url;
            if (preferred.pageUrl) pageUrl = preferred.pageUrl;
            if (preferred.title && (!title || genericTitles.has(title.trim().toLowerCase()))) {
              title = preferred.title;
            }
          } else {
            throw new Error("Video akışı henüz yakalanamadı. Sağ üstteki XyfionVid eklenti ikonuna tıklayıp 'Tara' butonunu kullanın.");
          }
        } else {
          const cleaned = cleanMediaUrl(videoUrl);
          storedItem = list.find((m) => m.url === cleaned) || null;
        }
      }

      const cleanTargetUrl = cleanMediaUrl(videoUrl);
      const memHeaders = capturedHeaders.get(cleanTargetUrl) || {};
      const itemHeaders = (storedItem && storedItem.headers) || {};
      const finalReferer = memHeaders.referer || itemHeaders.referer || pageUrl || "";
      const finalOrigin = memHeaders.origin || itemHeaders.origin || "";
      const finalUa = memHeaders.userAgent || itemHeaders.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");
      const finalCookie = memHeaders.cookie || itemHeaders.cookie || "";
      const hasCapturedHeaders = Boolean(
        memHeaders.referer || memHeaders.origin || memHeaders.cookie || itemHeaders.referer || itemHeaders.origin || itemHeaders.cookie
      );

      const res = await fetch(`${SERVER_URL}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: title || "Web Videosu",
          pageUrl: finalReferer,
          origin: finalOrigin,
          userAgent: finalUa,
          cookie: finalCookie,
          hasCapturedHeaders,
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
