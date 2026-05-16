// ============================================================
// transcriptProcessor.js
// Handles client-side transcription using CustomAudioTranscriber
// ============================================================

const logsElem = document.getElementById("logs");
const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const chunksText = document.getElementById("progress-chunks");
const percentText = document.getElementById("progress-percent");
const startBtn = document.getElementById("start-btn");

const providerSelect = document.getElementById("provider-select");
const baseUrlInput = document.getElementById("base-url");
const apiKeyInput = document.getElementById("api-key");
const getKeyLink = document.getElementById("get-key-link");

const CONCURRENCY = 6;

function log(msg) {
  const p = document.createElement("div");
  p.innerText = `> ${msg}`;
  logsElem.appendChild(p);
  logsElem.scrollTop = logsElem.scrollHeight;
}

// ── Get params from URL ──
const urlParams = new URLSearchParams(window.location.search);
const m3u8Url = urlParams.get("url");
const videoTitle = urlParams.get("title") || "";
const lectureSlug = urlParams.get("lectureSlug") || "";
const cacheKey = lectureSlug || videoTitle;

const titleElem = document.getElementById("video-title");
if (titleElem && videoTitle) {
  titleElem.textContent = videoTitle;
  titleElem.style.display = "block";
}

if (!m3u8Url) {
  log("Error: No M3U8 URL provided.");
  statusText.innerText = "Error: Invalid Stream Data";
  startBtn.disabled = true;
} else {
  log("Mode: TRANSCRIPT");
  log(`Stream: ${m3u8Url.substring(0, 60)}...`);
}

// ── Configuration Management ──

function saveConfig() {
  const config = {
    provider: providerSelect.value,
    baseUrl: baseUrlInput.value,
    apiKey: apiKeyInput.value,
  };
  chrome.storage.local.set({ scaler_transcript_config: config }, () => {
    console.log("Config saved.");
  });
}

function loadConfig() {
  chrome.storage.local.get(["scaler_transcript_config"], (result) => {
    const config = result.scaler_transcript_config;
    if (config) {
      if (config.provider) providerSelect.value = config.provider;
      if (config.baseUrl) baseUrlInput.value = config.baseUrl;
      if (config.apiKey) apiKeyInput.value = config.apiKey;
      updateProviderLink();
    }
  });
}

function updateProviderLink() {
  const selectedOption = providerSelect.options[providerSelect.selectedIndex];
  const url = selectedOption.getAttribute("data-url");
  const link = selectedOption.getAttribute("data-link");
  
  if (providerSelect.value !== "custom" && url) {
    baseUrlInput.value = url;
  }
  
  if (link) {
    getKeyLink.href = link;
    getKeyLink.innerText = `Get API Key for ${selectedOption.text.split(' (')[0]}`;
    getKeyLink.style.display = "inline-block";
  } else {
    getKeyLink.style.display = "none";
  }
  
  saveConfig();
}

providerSelect.addEventListener("change", updateProviderLink);
baseUrlInput.addEventListener("input", saveConfig);
apiKeyInput.addEventListener("input", saveConfig);

// Initialize config
loadConfig();


// ── M3U8 Download Helpers ──

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return relative;
  }
}

function getMediaPlaylistUrl(masterText, baseUrl) {
  const lines = masterText.split("\n").map((l) => l.trim());
  if (!lines[0].startsWith("#EXTM3U")) throw new Error("Invalid M3U8 format");
  if (lines.some((l) => l.startsWith("#EXTINF"))) return baseUrl;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=AUDIO")) {
      const match = line.match(/URI="([^"]+)"/);
      if (match && match[1]) {
        return resolveUrl(baseUrl, match[1]);
      }
    }
  }

  let bestBandwidth = 0;
  let bestUrl = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
      if (bwMatch) {
        const bw = parseInt(bwMatch[1], 10);
        if (bw > bestBandwidth) {
          bestBandwidth = bw;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j] && !lines[j].startsWith("#")) {
              bestUrl = lines[j];
              break;
            }
          }
        }
      }
    }
  }

  if (bestUrl) return resolveUrl(baseUrl, bestUrl);
  const fallback = lines.find((l) => l && !l.startsWith("#"));
  if (fallback) return resolveUrl(baseUrl, fallback);
  throw new Error("No media streams found.");
}

function extractSegments(mediaText, baseUrl) {
  const lines = mediaText.split("\n").map((l) => l.trim());
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXTINF")) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] && !lines[j].startsWith("#")) {
          segments.push(resolveUrl(baseUrl, lines[j]));
          break;
        }
      }
    }
  }
  return segments;
}

async function fetchChunk(url, index) {
  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (e) {
      if (retry < 2) await new Promise((r) => setTimeout(r, 1000 * (retry + 1)));
    }
  }
  return null;
}

async function downloadToMemory(segments, audioExtractor) {
  const total = segments.length;
  let nextToFetch = 0;
  let nextToWrite = 0;
  const buffer = new Map();
  const audioChunks = [];

  function updateUI(written) {
    const pct = ((written / total) * 100).toFixed(1);
    progressBar.style.width = pct + "%";
    chunksText.innerText = `${written} / ${total} chunks`;
    percentText.innerText = `${pct}%`;
  }

  function flush() {
    while (buffer.has(nextToWrite)) {
      const data = buffer.get(nextToWrite);
      buffer.delete(nextToWrite);
      if (data && data.byteLength > 0) audioChunks.push(data);
      nextToWrite++;
      updateUI(nextToWrite);
    }
  }

  async function worker() {
    while (true) {
      const idx = nextToFetch++;
      if (idx >= total) break;
      const raw = await fetchChunk(segments[idx], idx);
      let processed = raw ? audioExtractor.extract(raw) : new Uint8Array(0);
      buffer.set(idx, processed);
      flush();
    }
  }

  log(`Downloading audio (${CONCURRENCY}x parallel)...`);
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);
  flush();

  let totalBytes = 0;
  for (const chunk of audioChunks) totalBytes += chunk.byteLength;
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return combined.buffer;
}

function getSuggestedName(ext) {
  if (videoTitle) {
    const slug = videoTitle.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").substring(0, 80).replace(/_+$/, "");
    if (slug) return `${slug}.${ext}`;
  }
  return `Scaler_Lecture.${ext}`;
}

// ── Main Flow ──

startBtn.addEventListener("click", async () => {
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  
  if (!baseUrl || !apiKey) {
    alert("Please provide both Base URL and API Key.");
    return;
  }

  try {
    startBtn.disabled = true;
    
    // Disable inputs during processing
    providerSelect.disabled = true;
    baseUrlInput.disabled = true;
    apiKeyInput.disabled = true;

    statusText.innerText = "Phase 1/2: Downloading audio...";
    const masterText = await fetchText(m3u8Url);
    const mediaPlaylistUrl = getMediaPlaylistUrl(masterText, m3u8Url);
    const mediaText = await fetchText(mediaPlaylistUrl);
    const segments = extractSegments(mediaText, mediaPlaylistUrl);

    if (segments.length === 0) throw new Error("0 segments found.");

    const audioExtractor = new TSAudioExtractor();
    const audioBuffer = await downloadToMemory(segments, audioExtractor);

    progressBar.style.width = "0%";
    chunksText.innerText = "—";
    percentText.innerText = "0%";
    
    statusText.innerText = "Phase 2/2: Transcribing via your API...";
    
    const transcriber = new CustomAudioTranscriber(baseUrl, apiKey, log);
    
    const startTime = Date.now();
    const transcript = await transcriber.transcribe(audioBuffer, (pct, current, total) => {
      progressBar.style.width = pct.toFixed(1) + "%";
      chunksText.innerText = `${current} / ${total} segments`;
      percentText.innerText = `${pct.toFixed(1)}%`;
    });

    if (!transcript || transcript.trim().length === 0) {
      throw new Error("Transcription produced no text. Audio may be silent or unsupported.");
    }

    // Save
    const blob = new Blob([transcript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getSuggestedName("txt");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const wordCount = transcript.split(/\s+/).length;
    log(`✅ Transcript saved! ${wordCount} words in ${elapsed} min.`);
    statusText.innerText = `🎉 Transcript Complete! (${wordCount} words, ${elapsed} min)`;
    progressBar.style.width = "100%";
    progressBar.style.background = "#10b981";

    // Track
    chrome.storage.sync.get(["scaler_user"], (result) => {
      const email = result?.scaler_user?.email;
      if (email && chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          action: "trackDownload",
          email,
          downloadType: "transcript",
          lecture: videoTitle || "",
          lectureSlug: cacheKey,
        });
      }
    });

  } catch (err) {
    log(`❌ Error: ${err.message}`);
    console.error(err);
    statusText.innerText = "Transcript Failed!";
    progressBar.style.background = "#ef4444";
  } finally {
    startBtn.disabled = false;
    providerSelect.disabled = false;
    baseUrlInput.disabled = false;
    apiKeyInput.disabled = false;
  }
});
