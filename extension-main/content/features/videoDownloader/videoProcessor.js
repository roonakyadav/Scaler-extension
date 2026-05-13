// ============================================================
// videoProcessor.js
// Concurrent HLS stream downloader with audio extraction
// ============================================================

const logsElem = document.getElementById("logs");
const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const chunksText = document.getElementById("progress-chunks");
const percentText = document.getElementById("progress-percent");
const startBtn = document.getElementById("start-btn");

const CONCURRENCY = 6; // Number of parallel chunk fetches

function log(msg) {
  const p = document.createElement("div");
  p.innerText = `> ${msg}`;
  logsElem.appendChild(p);
  logsElem.scrollTop = logsElem.scrollHeight;
}

// ── Get params from URL ──
const urlParams = new URLSearchParams(window.location.search);
const m3u8Url = urlParams.get("url");
const downloadType = urlParams.get("type") || "video";
const videoTitle = urlParams.get("title") || "";
const lectureSlug = urlParams.get("lectureSlug") || "";

// The lectureSlug is the unique identifier for cache lookups.
// It comes from Scaler's classroom meta API (data.attributes.slug)
// and is unique per lecture even across batches that share the same class title.
const cacheKey = lectureSlug || videoTitle;

// ── Show video title if available ──
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
  log(`Mode: ${downloadType.toUpperCase()}`);
  log(`Stream: ${m3u8Url.substring(0, 60)}...`);
  if (downloadType === "audio") {
    log("Audio extraction enabled — will strip video tracks from chunks.");
  } else if (downloadType === "transcript") {
    log(
      "Transcript mode — will download audio, then use online transcription API.",
    );
    const infoBox = document.getElementById("info-box");
    if (infoBox) infoBox.style.display = "block";
  }
}

// ── Fire-and-forget download tracking (called only after success) ──

function trackCompletedDownload(type) {
  try {
    chrome.storage.sync.get(["scaler_user"], (result) => {
      const email = result?.scaler_user?.email;
      if (email && chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          action: "trackDownload",
          email,
          downloadType: type,
          lecture: videoTitle || "",
          lectureSlug: cacheKey,
        });
      }
    });
  } catch (_) {
    /* fail silently — tracking should never break downloads */
  }
}

// ── Helpers ──

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

// ── M3U8 Parsing ──

function getMediaPlaylistUrl(masterText, baseUrl) {
  const lines = masterText.split("\n").map((l) => l.trim());

  if (!lines[0].startsWith("#EXTM3U")) {
    throw new Error("Invalid M3U8 format");
  }

  // If it already has segments → it IS the media playlist
  if (lines.some((l) => l.startsWith("#EXTINF"))) {
    return baseUrl;
  }

  // ── Master playlist: find best stream ──

  // For AUDIO or TRANSCRIPT: try to find a dedicated audio-only rendition first
  if (downloadType === "audio" || downloadType === "transcript") {
    for (const line of lines) {
      if (line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=AUDIO")) {
        const match = line.match(/URI="([^"]+)"/);
        if (match && match[1]) {
          log("Found dedicated audio rendition in master playlist.");
          return resolveUrl(baseUrl, match[1]);
        }
      }
    }
    log("No separate audio rendition found — will demux from video chunks.");
  }

  // Find highest bandwidth video stream
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

  if (!bestUrl) {
    const fallback = lines.find((l) => l && !l.startsWith("#"));
    if (fallback) return resolveUrl(baseUrl, fallback);
    throw new Error("No media streams found in master playlist.");
  }

  return resolveUrl(baseUrl, bestUrl);
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

// ── Fetch a single chunk with retries ──

async function fetchChunk(url, index) {
  const MAX_RETRIES = 3;
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (e) {
      if (retry < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (retry + 1)));
      }
    }
  }
  log(`⚠ Chunk ${index + 1} failed after ${MAX_RETRIES} retries. Skipping.`);
  return null;
}

// ── Concurrent Download Engine ──
//
// Uses a worker-pool pattern: N workers each grab the next available chunk,
// fetch it, optionally extract audio, and submit it to the ordered write queue.
// Chunks are written to disk sequentially even though they download in parallel.

async function downloadConcurrently(segments, writable, audioExtractor) {
  const total = segments.length;
  let nextToFetch = 0; // shared index for workers to claim chunks
  let nextToWrite = 0; // sequential write pointer
  const buffer = new Map(); // stores out-of-order completed chunks

  // Write queue ensures sequential, non-overlapping writes
  let writeChain = Promise.resolve();

  function updateUI(written) {
    const pct = ((written / total) * 100).toFixed(1);
    progressBar.style.width = pct + "%";
    chunksText.innerText = `${written} / ${total} chunks`;
    percentText.innerText = `${pct}%`;
  }

  function flushToFile() {
    writeChain = writeChain.then(async () => {
      while (buffer.has(nextToWrite)) {
        const data = buffer.get(nextToWrite);
        buffer.delete(nextToWrite);
        if (data && data.byteLength > 0) {
          await writable.write(data);
        }
        nextToWrite++;
        updateUI(nextToWrite);

        // Log progress milestones
        if (nextToWrite % 50 === 0) {
          log(`Progress: ${nextToWrite}/${total} chunks written to disk.`);
        }
      }
    });
    return writeChain;
  }

  // Each worker grabs the next unchlaimed chunk, downloads + processes it,
  // then triggers the sequential flush
  async function worker(workerId) {
    while (true) {
      const idx = nextToFetch++;
      if (idx >= total) break;

      const raw = await fetchChunk(segments[idx], idx);

      let processed;
      if (raw === null) {
        processed = new Uint8Array(0); // skip failed chunks
      } else if (audioExtractor) {
        // Extract only audio bytes from the .ts chunk
        processed = audioExtractor.extract(raw);
      } else {
        processed = new Uint8Array(raw);
      }

      buffer.set(idx, processed);
      flushToFile(); // don't await — let it queue up
    }
  }

  // Launch N parallel workers
  log(`Launching ${CONCURRENCY} parallel download workers...`);
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  // Final flush for any remaining buffered chunks
  await flushToFile();
  await writeChain;

  log(`All ${total} chunks processed.`);
}

// ── Concurrent Download to Memory (for transcript mode) ──

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
      if (data && data.byteLength > 0) {
        audioChunks.push(data);
      }
      nextToWrite++;
      updateUI(nextToWrite);
      if (nextToWrite % 50 === 0) {
        log(`Audio download: ${nextToWrite}/${total} chunks.`);
      }
    }
  }

  async function worker() {
    while (true) {
      const idx = nextToFetch++;
      if (idx >= total) break;
      const raw = await fetchChunk(segments[idx], idx);
      let processed;
      if (raw === null) {
        processed = new Uint8Array(0);
      } else if (audioExtractor) {
        processed = audioExtractor.extract(raw);
      } else {
        processed = new Uint8Array(raw);
      }
      buffer.set(idx, processed);
      flush();
    }
  }

  log(`Downloading audio (${CONCURRENCY}x parallel)...`);
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  flush();

  // Concatenate all chunks into a single ArrayBuffer
  let totalBytes = 0;
  for (const chunk of audioChunks) totalBytes += chunk.byteLength;
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(
      chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk),
      offset,
    );
    offset += chunk.byteLength;
  }

  log(`Audio downloaded: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  return combined.buffer;
}

// ── Main Download Flow ──

// Derive a clean filename from the video title, falling back to 'Scaler_Lecture'
function getSuggestedName(ext) {
  if (videoTitle) {
    const slug = videoTitle
      .replace(/[\\/:*?"<>|]/g, "") // strip illegal filename chars
      .replace(/\s+/g, "_") // spaces → underscores
      .substring(0, 80) // cap length
      .replace(/_+$/, ""); // trim trailing underscores
    if (slug) return `${slug}.${ext}`;
  }
  return `Scaler_Lecture.${ext}`;
}

startBtn.addEventListener("click", async () => {
  try {
    startBtn.disabled = true;
    statusText.innerText = "Analyzing stream...";

    // 1. Fetch and parse master M3U8
    log("Fetching stream manifest...");
    const masterText = await fetchText(m3u8Url);

    const mediaPlaylistUrl = getMediaPlaylistUrl(masterText, m3u8Url);
    log("Media playlist: " + mediaPlaylistUrl.substring(0, 60) + "...");

    // 2. Fetch media playlist and extract segment URLs
    const mediaText = await fetchText(mediaPlaylistUrl);
    const segments = extractSegments(mediaText, mediaPlaylistUrl);

    if (segments.length === 0) {
      throw new Error("0 segments found. Streaming format not supported.");
    }

    log(`Found ${segments.length} chunks to download.`);

    // ── TRANSCRIPT MODE ──
    if (downloadType === "transcript") {
      const startTime = Date.now();
      const transcriber = new AudioTranscriber(log);
      let transcript = null;

      // 1. Check Cache FIRST before downloading audio stream
      if (cacheKey) {
        statusText.innerText = "Phase 1/3: Checking cache...";
        log(`🔍 Checking transcript cache for: "${cacheKey}"...`);
        transcript = await transcriber.checkCache(cacheKey);
        if (transcript) {
          log(
            "⚡ Cache hit! Returning cached transcript — no downloading needed.",
          );
          progressBar.style.width = "100%";
          chunksText.innerText = "—";
          percentText.innerText = "100%";
        } else {
          log("Cache miss — proceeding to download and transcribe.");
        }
      } else {
        log("No cache key provided — skipping cache lookup.");
      }

      if (!transcript) {
        statusText.innerText = "Phase 1/3: Checking transcription health...";
        const healthy = await transcriber.checkHealth();
        if (!healthy) {
          log("❌ Transcript service unavailable — aborting.");
          statusText.innerText = "Transcript Failed!";
          progressBar.style.background = "#ef4444";
          throw new Error("Transcription service unavailable.");
        }

        statusText.innerText = "Phase 1/3: Downloading audio...";

        // Download audio into memory
        const audioExtractor = new TSAudioExtractor();
        const audioBuffer = await downloadToMemory(segments, audioExtractor);

        // ── Reset progress bar for Phase 2 ──
        progressBar.style.width = "0%";
        chunksText.innerText = "—";
        percentText.innerText = "0%";

        // Initialize Transcriber (Checks Lemonfox API availability)
        statusText.innerText = "Phase 2/3: Initializing Whisper AI...";
        await transcriber.init();

        // ── Reset progress bar for Phase 3 ──
        progressBar.style.width = "0%";
        chunksText.innerText = "0 / 0 segments";
        percentText.innerText = "0%";

        // Transcribe
        statusText.innerText =
          "Phase 3/3: Transcribing (this takes a while)...";
        transcript = await transcriber.transcribe(
          audioBuffer,
          (pct, current, total) => {
            progressBar.style.width = pct.toFixed(1) + "%";
            chunksText.innerText = `${current} / ${total} segments`;
            percentText.innerText = `${pct.toFixed(1)}%`;
          },
          cacheKey || null, // unique slug for cache save (batch-safe)
          videoTitle || null, // human-readable title for display
        );

        if (!transcript || transcript.trim().length === 0) {
          throw new Error(
            "Transcription produced no text. Audio may be silent or unsupported.",
          );
        }
      }

      // Save transcript as .txt
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

      // ── Track completed download ──────────────────────────────
      trackCompletedDownload("transcript");
      return;
    }

    // ── AUDIO / VIDEO MODE ──
    // Download everything into memory first, then trigger save — consistent with transcript mode.
    const ext = downloadType === "audio" ? "mp3" : "mp4";
    const mimeType = downloadType === "audio" ? "audio/mpeg" : "video/mp4";
    const startTime = Date.now();

    let audioExtractor = null;
    if (downloadType === "audio") {
      audioExtractor = new TSAudioExtractor();
      log("Audio extractor initialized — stripping video from each chunk.");
    }

    statusText.innerText = `Downloading ${downloadType} (${CONCURRENCY}x parallel)...`;
    log(
      "Downloading to memory — save dialog will appear after download completes.",
    );

    const memBuffer = await downloadToMemory(segments, audioExtractor);
    const blob = new Blob([memBuffer], { type: mimeType });

    // ── Try File System Access API after download is complete ──
    // We attempt showSaveFilePicker here (post-download) so the user picks a
    // save location *after* seeing 100% progress — same feel as transcript mode.
    // Brave / Firefox fall through to the blob URL fallback automatically.
    const supportsFilePicker =
      typeof window.showSaveFilePicker === "function" && !navigator.brave;

    let saved = false;
    if (supportsFilePicker) {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: getSuggestedName(ext),
          types: [
            {
              description:
                downloadType === "audio" ? "Audio File" : "Video File",
              accept:
                downloadType === "audio"
                  ? { "audio/mpeg": [".mp3"] }
                  : { "video/mp4": [".mp4"] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        saved = true;
      } catch (err) {
        if (err.name === "AbortError") {
          log("File selection cancelled.");
          startBtn.disabled = false;
          statusText.innerText = "Ready to download.";
          return;
        }
        // Any other error (e.g. Brave blocking) → fall through to blob URL
        log("Save picker unavailable — switching to direct download...");
      }
    }

    if (!saved) {
      // Blob URL fallback (Brave, Firefox, or picker unavailable)
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = getSuggestedName(ext);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`✅ Download triggered in ${elapsed}s! Check your Downloads folder.`);
    statusText.innerText = `🎉 Download Complete! (${elapsed}s)`;
    progressBar.style.background = "#28a745";

    // ── Track completed download ──────────────────────────────
    trackCompletedDownload(downloadType);
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    console.error(err);
    if (downloadType === "transcript") {
      statusText.innerText = "Transcript Failed!";
      progressBar.style.background = "#ef4444";
    } else {
      statusText.innerText = "Download Failed!";
    }
    startBtn.disabled = false;
  }
});
