// Tracker to capture .m3u8 network requests for downloading
const tabVideoStreams = {};

chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Only capture master m3u8 playlists if possible, or specifically from Scaler's media servers
    if (details.url.includes(".m3u8")) {
      const tabId = details.tabId;
      if (tabId === -1) return;

      // If we already have a URL for this tab, we might only overwrite if it looks like a master playlist
      if (!tabVideoStreams[tabId]) {
        tabVideoStreams[tabId] = details.url;
      } else if (
        details.url.includes("master") ||
        details.url.includes("index")
      ) {
        tabVideoStreams[tabId] = details.url;
      }
    }
  },
  // Scoped to scaler.com only — was "*://*/*" which captured ALL network
  // requests across every tab the user had open.
  { urls: ["*://*.scaler.com/*"] },
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_VIDEO_URL") {
    sendResponse({ url: tabVideoStreams[sender.tab?.id] || null });
  } else if (request.type === "INITIATE_DOWNLOAD") {
    // Initiate actual download of the stream
    const url = request.payload.url;
    const type = request.payload.type;

    // Open the downloader processing tab!
    const title = request.payload.title || "";
    const lectureSlug = request.payload.lectureSlug || "";
    const htmlPage = type === "transcript" ? "transcriptProcessor.html" : "videoProcessor.html";
    const processorUrl = chrome.runtime.getURL(
      `content/features/videoDownloader/${htmlPage}?url=${encodeURIComponent(url)}&type=${type}&title=${encodeURIComponent(title)}&lectureSlug=${encodeURIComponent(lectureSlug)}`,
    );

    chrome.tabs.create({ url: processorUrl }, (tab) => {
      console.log(`[Scaler++] Opened ${htmlPage} tab ID: ${tab.id}`);
    });

    // We send a tiny response back
    sendResponse({ status: "started" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabVideoStreams[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    delete tabVideoStreams[tabId];
  }
});
