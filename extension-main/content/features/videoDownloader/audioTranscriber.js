// ============================================================
// audioTranscriber.js
// Uses Lemonfox API for transcription
// ============================================================

class AudioTranscriber {
  constructor(logFn) {
    this.log = logFn || (() => {});
    this.BACKEND = "https://scalerbackend.vercel.app";
    // this.BACKEND = "http://localhost:3001";
    this.AUTH_HEADERS = {
      Authorization:
        "Bearer Ritesh-Prajapati-created-started-this-extension-super-secret-key-12345",
    };
  }

  /**
   * Initialize transcriber. Checks if Backend API is active.
   */
  async init() {
    this.log("Checking Backend API availability...");
    try {
      const res = await fetch(`${this.BACKEND}/`, { method: "GET" });
      if (res.ok) {
        this.log(
          "✅ Backend API is active. Will use remote API for fast transcription.",
        );
        return;
      }
    } catch (e) {
      this.log(`⚠ Backend ping failed: ${e.message}`);
      throw new Error("Backend API is unavailable");
    }
    throw new Error("Backend API is unavailable");
  }

  // ── Cache helpers ──

  /**
   * Check MongoDB cache via backend.
   * Returns the cached transcript text string if found, or null.
   * @param {string} slug - unique identifier (slug) for the lecture
   */
  async checkCache(slug) {
    if (!slug) return null;
    try {
      const res = await fetch(
        `${this.BACKEND}/api/transcript?slug=${encodeURIComponent(slug)}`,
        { method: "GET", headers: this.AUTH_HEADERS },
      );
      if (res.status === 404) return null; // not cached
      if (!res.ok) {
        this.log(
          `⚠ Cache lookup HTTP ${res.status} — proceeding without cache.`,
        );
        return null;
      }
      const data = await res.json();
      return data.cached ? data.text : null;
    } catch (e) {
      this.log(
        `⚠ Cache lookup failed: ${e.message} — proceeding without cache.`,
      );
      return null;
    }
  }

  /**
   * Save a newly generated transcript to the backend cache.
   * Fire-and-forget — failures are logged but don't block the user.
   * @param {string} slug  - unique identifier (slug) for the lecture
   * @param {string} title - human-readable lecture title
   * @param {string} text  - full transcript text
   */
  async saveToCache(slug, title, text) {
    if (!slug || !text) return;
    try {
      const res = await fetch(`${this.BACKEND}/api/transcript/save`, {
        method: "POST",
        headers: { ...this.AUTH_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title: title || slug, text }),
      });
      if (res.ok) {
        this.log("✅ Transcript saved to cache for future requests.");
      } else {
        this.log(
          `⚠ Cache save returned HTTP ${res.status} — transcript not cached.`,
        );
      }
    } catch (e) {
      this.log(`⚠ Cache save failed: ${e.message}`);
    }
  }

  // ── Anti-hallucination helpers ──

  _removeRepetitions(text) {
    if (!text || text.length < 20) return text;

    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    if (sentences.length < 3) return text;

    const cleaned = [sentences[0]];
    let repeatCount = 0;
    const MAX_REPEATS = 2;

    for (let i = 1; i < sentences.length; i++) {
      const prev = cleaned[cleaned.length - 1].trim().toLowerCase();
      const curr = sentences[i].trim().toLowerCase();

      if (curr === prev) {
        repeatCount++;
        if (repeatCount < MAX_REPEATS) {
          cleaned.push(sentences[i]);
        }
      } else {
        repeatCount = 0;
        cleaned.push(sentences[i]);
      }
    }

    let result = cleaned.join(" ");
    result = result.replace(/\b(\w+(?:\s+\w+){0,3})(?:\s+\1){2,}/gi, "$1");
    result = result.replace(/(\b\w+(?:\s+\w+){0,4},)(?:\s*\1){2,}/gi, "$1");

    return result.trim();
  }

  // ── Main Entry ──
  /**
   * @param {ArrayBuffer} audioBuffer
   * @param {function}    onProgress
   * @param {string}      [slug]   - unique slug for cache lookup/save
   * @param {string}      [title]  - human-readable title stored alongside
   */
  async transcribe(audioBuffer, onProgress, slug, title) {
    // 1. Generate via Whisper
    const text = await this.transcribeRemote(audioBuffer, onProgress);

    // 2. Save to cache in background (non-blocking)
    if (slug && text) {
      this.log("💾 Saving transcript to cache...");
      this.saveToCache(slug, title, text); // intentionally not awaited
    }

    return text;
  }

  // ── Remote Transcription ── //
  async transcribeRemote(audioBuffer, onProgress) {
    this.log("Uploading chunks to Lemonfox Whisper API...");

    // Keep chunks well under Lemonfox's limit to avoid 413 errors.
    // 4 MB per chunk is a safe ceiling (Lemonfox rejects ~10 MB+).
    const CHUNK_SIZE = 48 * 1024 * 1024; // 950 MB
    const MAX_RETRIES = 3;
    const INTER_CHUNK_DELAY_MS = 800; // avoid hammering the API

    const totalChunks = Math.ceil(audioBuffer.byteLength / CHUNK_SIZE);
    const transcriptParts = [];

    this.log(
      `Audio size: ${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)} MB → ${totalChunks} chunk(s)`,
    );

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, audioBuffer.byteLength);
      const chunk = audioBuffer.slice(start, end);

      // Use audio/mpeg (.mp3) — matches the audio output format
      const blob = new Blob([chunk], { type: "audio/mpeg" });

      let success = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // 1. Get Pre-signed URL
          const urlRes = await fetch(
            `${this.BACKEND}/api/transcribe/upload-url`,
            {
              method: "GET",
              headers: this.AUTH_HEADERS,
            },
          );
          if (!urlRes.ok)
            throw new Error("Failed to get upload URL from backend");
          const { uploadUrl, path, audioUrl } = await urlRes.json();

          // 2. Upload file directly to Supabase storage
          const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "audio/mpeg" },
          });
          if (!uploadRes.ok)
            throw new Error("Failed to upload chunk to Supabase storage");

          // 3. Initiate transcription via Vercel passing URL
          const response = await fetch(`${this.BACKEND}/api/transcribe`, {
            method: "POST",
            headers: {
              ...this.AUTH_HEADERS,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ audioUrl, path }),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error ${response.status}: ${errText}`);
          }

          const data = await response.json();
          if (data && data.text) {
            transcriptParts.push(data.text.trim());
          }
          success = true;
          break; // success — no more retries needed
        } catch (err) {
          this.log(
            `⚠ Chunk ${i + 1} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`,
          );
          if (attempt < MAX_RETRIES) {
            // Exponential back-off: 2s, 4s
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      }

      if (!success) {
        this.log(
          `❌ Chunk ${i + 1} could not be transcribed after ${MAX_RETRIES} attempts. Skipping.`,
        );
      }

      const pct = (((i + 1) / totalChunks) * 100).toFixed(1);
      if (onProgress) {
        onProgress(parseFloat(pct), i + 1, totalChunks);
      }
      this.log(`Transcribed API Chunk: ${i + 1}/${totalChunks} (${pct}%)`);

      // Small pause between chunks to avoid rate-limiting
      if (i < totalChunks - 1) {
        await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
      }
    }

    let fullText = transcriptParts.join(" ");
    return this._removeRepetitions(fullText);
  }
}
