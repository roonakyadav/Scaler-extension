// ============================================================
// customAudioTranscriber.js
// Handles transcription using user-provided API credentials.
// Supports multiple providers based on the URL.
// ============================================================

class CustomAudioTranscriber {
  constructor(baseUrl, apiKey, modelName, logFn) {
    this.baseUrl = baseUrl.trim();
    this.apiKey = apiKey.trim();
    this.modelName = modelName ? modelName.trim() : "";
    this.log = logFn || (() => {});
  }

  // ── Helper: Remove Repetitions ──
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
        if (repeatCount < MAX_REPEATS) cleaned.push(sentences[i]);
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
  async transcribe(audioBuffer, onProgress) {
    if (!this.baseUrl) throw new Error("Base URL is required.");
    if (!this.apiKey) throw new Error("API Key is required.");

    this.log("Starting parallel transcription process...");
    
    // Determine the provider based on URL
    const isOpenAI = this.baseUrl.includes("openai.com");
    const isGroq = this.baseUrl.includes("groq.com");
    const isDeepgram = this.baseUrl.includes("deepgram.com");
    const isElevenLabs = this.baseUrl.includes("elevenlabs.io");

    // Pre-process raw AAC/TS data: Decode entire stream, resample to 16kHz Mono, and split into safe 10-minute WAV chunks
    const wavBlobs = await this._prepareWavBlobs(audioBuffer);
    if (!wavBlobs || wavBlobs.length === 0) {
      throw new Error("Failed to decode audio into a supported format.");
    }
    const totalChunks = wavBlobs.length;
    const transcriptParts = new Array(totalChunks);

    let nextChunkIndex = 0;
    let completedCount = 0;

    const worker = async () => {
      while (nextChunkIndex < totalChunks) {
        const i = nextChunkIndex++;
        const blob = wavBlobs[i];

        let text = "";
        const MAX_RETRIES = 3;

        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            if (isDeepgram) {
              text = await this._transcribeDeepgram(blob);
            } else if (isElevenLabs) {
              text = await this._transcribeElevenLabs(blob);
            } else {
              // Default to OpenAI compatible (Groq, OpenAI, Custom)
              const model = this.modelName || (isGroq ? "whisper-large-v3" : "whisper-1");
              text = await this._transcribeOpenAICompatible(blob, model);
            }
            break; // Success! Break retry loop.
          } catch (err) {
            this.log(`❌ Chunk ${i + 1} attempt ${retry + 1} failed: ${err.message}`);
            if (retry < MAX_RETRIES - 1) {
              const backoffTime = 2000 * (retry + 1);
              this.log(`Waiting ${backoffTime / 1000}s before retry...`);
              await new Promise((resolve) => setTimeout(resolve, backoffTime));
            }
          }
        }

        if (text) {
          transcriptParts[i] = text.trim();
        } else {
          transcriptParts[i] = ""; // Keep place in array even if chunk completely failed
        }

        completedCount++;
        const pct = ((completedCount / totalChunks) * 100).toFixed(1);
        if (onProgress) onProgress(parseFloat(pct), completedCount, totalChunks);
        this.log(`Chunk ${i + 1} transcribed. Progress: ${completedCount}/${totalChunks} completed (${pct}%)`);
      }
    };

    // Spawn up to 5 concurrent workers
    const concurrency = Math.min(5, totalChunks);
    this.log(`Spawning ${concurrency} parallel worker(s) for transcription...`);
    const workers = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    // Join all non-empty results maintaining index-based chronological order
    let fullText = transcriptParts.filter((p) => p && p.length > 0).join(" ");
    return this._removeRepetitions(fullText);
  }

  /**
   * Decodes the ENTIRE raw AAC/TS audio buffer at once.
   * Resamples it to 16kHz Mono (highly compatible, small footprint).
   * Splits the uncompressed PCM data into 10-minute chunks.
   * Converts each chunk to a pristine WAV Blob (guaranteed <25MB).
   */
  async _prepareWavBlobs(rawAudioBuffer) {
    this.log("Decoding complete raw audio stream...");
    
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let decodedBuffer;
    try {
      // Decode the massive raw AAC/ADTS audio bytes at once
      decodedBuffer = await audioCtx.decodeAudioData(rawAudioBuffer.slice(0));
    } catch (e) {
      this.log(`⚠ Web Audio decode failed: ${e.message}`);
      this.log("Fallback: Attempting chunked ADTS decode to WAV...");
      const fallbackBlobs = await this._decodeAdtsInChunks(rawAudioBuffer, audioCtx);
      if (audioCtx.close) await audioCtx.close();
      return fallbackBlobs;
    }
    const wavBlobs = await this._resampleToWavBlobs(decodedBuffer);
    if (audioCtx.close) await audioCtx.close();
    return wavBlobs;
  }

  async _resampleToWavBlobs(decodedBuffer) {
    this.log(`Decoded duration: ${Math.round(decodedBuffer.duration)} seconds. Resampling to 16kHz Mono...`);

    const TARGET_SAMPLE_RATE = 16000;
    const totalSamples = Math.ceil(decodedBuffer.duration * TARGET_SAMPLE_RATE);

    const offlineCtx = new OfflineAudioContext(1, totalSamples, TARGET_SAMPLE_RATE);
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = decodedBuffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start();

    const resampledBuffer = await offlineCtx.startRendering();

    // 10 minutes per chunk (600 seconds) => ~19.2 MB WAV files at 16kHz mono
    const CHUNK_DURATION_SEC = 600;
    const samplesPerChunk = CHUNK_DURATION_SEC * TARGET_SAMPLE_RATE;
    const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

    this.log(`Splitting resampled audio into ${totalChunks} chunk(s) of ~10 minutes each...`);
    const wavBlobs = [];
    const channelData = resampledBuffer.getChannelData(0);

    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * samplesPerChunk;
      const endSample = Math.min(startSample + samplesPerChunk, totalSamples);
      const wavArrayBuffer = this._rawPcmToWav(channelData.subarray(startSample, endSample), TARGET_SAMPLE_RATE);
      wavBlobs.push(new Blob([wavArrayBuffer], { type: "audio/wav" }));
    }

    return wavBlobs;
  }

  async _decodeAdtsInChunks(rawAudioBuffer, audioCtx) {
    const frames = this._extractAdtsFrames(new Uint8Array(rawAudioBuffer));
    if (frames.length === 0) {
      this.log("⚠ No ADTS frames detected in raw audio.");
      return [];
    }

    const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
    const chunkBuffers = this._buildAdtsChunks(frames, MAX_CHUNK_BYTES);
    const wavBlobs = [];

    for (let i = 0; i < chunkBuffers.length; i++) {
      try {
        const decoded = await audioCtx.decodeAudioData(chunkBuffers[i].slice(0));
        const chunkWavs = await this._resampleToWavBlobs(decoded);
        for (const blob of chunkWavs) wavBlobs.push(blob);
      } catch (e) {
        this.log(`⚠ Chunked decode failed for part ${i + 1}: ${e.message}`);
      }
    }

    return wavBlobs;
  }

  _extractAdtsFrames(data) {
    const frames = [];
    let i = 0;

    while (i < data.length - 7) {
      if (data[i] === 0xff && (data[i + 1] & 0xf0) === 0xf0) {
        const frameLen =
          ((data[i + 3] & 0x03) << 11) |
          (data[i + 4] << 3) |
          ((data[i + 5] >> 5) & 0x07);

        if (frameLen > 0 && i + frameLen <= data.length) {
          frames.push(data.subarray(i, i + frameLen));
          i += frameLen;
          continue;
        }
      }
      i++;
    }

    return frames;
  }

  _buildAdtsChunks(frames, maxBytes) {
    const chunks = [];
    let current = [];
    let currentSize = 0;

    for (const frame of frames) {
      if (currentSize + frame.length > maxBytes && current.length > 0) {
        chunks.push(this._concatUint8Arrays(current));
        current = [];
        currentSize = 0;
      }
      current.push(frame);
      currentSize += frame.length;
    }

    if (current.length > 0) chunks.push(this._concatUint8Arrays(current));
    return chunks;
  }

  _concatUint8Arrays(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out.buffer;
  }

  _rawPcmToWav(channelData, sampleRate) {
    const format = 1; // raw PCM
    const numOfChan = 1; // mono
    const bitDepth = 16;
    
    const resultLength = channelData.length * 2 + 44;
    const arrayBuffer = new ArrayBuffer(resultLength);
    const view = new DataView(arrayBuffer);
    
    // RIFF identifier
    view.setUint32(0, 0x52494646, false);
    // file length minus RIFF identifier length
    view.setUint32(4, resultLength - 8, true);
    // RIFF type
    view.setUint32(8, 0x57415645, false);
    // format chunk identifier
    view.setUint32(12, 0x666d7420, false);
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw PCM)
    view.setUint16(20, format, true);
    // channel count
    view.setUint16(22, numOfChan, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * numOfChan * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, numOfChan * 2, true);
    // bits per sample
    view.setUint16(34, bitDepth, true);
    // data chunk identifier
    view.setUint32(36, 0x64617461, false);
    // chunk length
    view.setUint32(40, resultLength - 44, true);
    
    let offset = 44;
    for (let pos = 0; pos < channelData.length; pos++) {
      let sample = channelData[pos];
      sample = Math.max(-1, Math.min(1, sample));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    
    return arrayBuffer;
  }



  async _transcribeOpenAICompatible(blob, defaultModel) {
    const filename = blob.type === "audio/mpeg" ? "audio.m4a" : "audio.wav";
    const formData = new FormData();
    formData.append("model", defaultModel);
    formData.append("file", blob, filename);

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.text;
  }

  async _transcribeDeepgram(blob) {
    const model = this.modelName || "nova-3";
    const contentType = blob.type === "audio/mpeg" ? "audio/mpeg" : "audio/wav";
    const res = await fetch(`${this.baseUrl}?model=${encodeURIComponent(model)}&smart_format=true`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": contentType,
      },
      body: blob,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.results?.channels[0]?.alternatives[0]?.transcript || "";
  }

  async _transcribeElevenLabs(blob) {
    const filename = blob.type === "audio/mpeg" ? "audio.m4a" : "audio.wav";

    const formData = new FormData();
    formData.append("model_id", this.modelName || "scribe_v1");
    formData.append("file", blob, filename);

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.text;
  }
}
