// ============================================================
// customAudioTranscriber.js
// Handles transcription using user-provided API credentials.
// Supports multiple providers based on the URL.
// ============================================================

class CustomAudioTranscriber {
  constructor(baseUrl, apiKey, logFn) {
    this.baseUrl = baseUrl.trim();
    this.apiKey = apiKey.trim();
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

    this.log("Starting local transcription process...");
    
    // Most APIs (like OpenAI/Groq) have a 25MB limit. We use 20MB chunks to be safe.
    const CHUNK_SIZE = 20 * 1024 * 1024;
    const totalChunks = Math.ceil(audioBuffer.byteLength / CHUNK_SIZE);
    const transcriptParts = [];

    this.log(
      `Audio size: ${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)} MB → ${totalChunks} chunk(s)`
    );

    // Determine the provider based on URL
    const isOpenAI = this.baseUrl.includes("openai.com");
    const isGroq = this.baseUrl.includes("groq.com");
    const isDeepgram = this.baseUrl.includes("deepgram.com");
    const isAssembly = this.baseUrl.includes("assemblyai.com");
    const isGladia = this.baseUrl.includes("gladia.io");
    const isElevenLabs = this.baseUrl.includes("elevenlabs.io");

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, audioBuffer.byteLength);
      const chunk = audioBuffer.slice(start, end);

      const blob = new Blob([chunk], { type: "audio/mpeg" });
      let text = "";

      try {
        if (isDeepgram) {
          text = await this._transcribeDeepgram(blob);
        } else if (isAssembly) {
          text = await this._transcribeAssemblyAI(blob);
        } else if (isGladia) {
          text = await this._transcribeGladia(blob);
        } else if (isElevenLabs) {
          text = await this._transcribeElevenLabs(blob);
        } else {
          // Default to OpenAI compatible (Groq, OpenAI, Custom)
          const model = isGroq ? "whisper-large-v3" : "whisper-1";
          text = await this._transcribeOpenAICompatible(blob, model);
        }

        if (text) transcriptParts.push(text.trim());
      } catch (err) {
        this.log(`❌ Chunk ${i + 1} failed: ${err.message}`);
      }

      const pct = (((i + 1) / totalChunks) * 100).toFixed(1);
      if (onProgress) onProgress(parseFloat(pct), i + 1, totalChunks);
      this.log(`Transcribed Chunk: ${i + 1}/${totalChunks} (${pct}%)`);

      if (i < totalChunks - 1) {
        await new Promise((r) => setTimeout(r, 1000)); // Delay between chunks
      }
    }

    let fullText = transcriptParts.join(" ");
    return this._removeRepetitions(fullText);
  }

  async _transcribeOpenAICompatible(blob, defaultModel) {
    const formData = new FormData();
    formData.append("file", blob, "audio.mp3");
    formData.append("model", defaultModel);

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
    const res = await fetch(`${this.baseUrl}?model=nova-2&smart_format=true`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "audio/mpeg",
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

  async _transcribeAssemblyAI(blob) {
    // 1. Upload
    this.log("  Uploading chunk to AssemblyAI...");
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { authorization: this.apiKey },
      body: blob,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload HTTP ${uploadRes.status}: ${errText}`);
    }
    const uploadData = await uploadRes.json();
    const audioUrl = uploadData.upload_url;

    // 2. Transcribe
    this.log("  Starting AssemblyAI transcription job...");
    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio_url: audioUrl }),
    });

    if (!transcriptRes.ok) {
      const errText = await transcriptRes.text();
      throw new Error(`Transcript HTTP ${transcriptRes.status}: ${errText}`);
    }
    const transcriptData = await transcriptRes.json();
    const transcriptId = transcriptData.id;

    // 3. Poll
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: this.apiKey },
      });
      const pollData = await pollRes.json();
      if (pollData.status === "completed") {
        return pollData.text;
      } else if (pollData.status === "error") {
        throw new Error(`AssemblyAI Error: ${pollData.error}`);
      }
    }
  }

  async _transcribeGladia(blob) {
    const formData = new FormData();
    formData.append("audio", blob, "audio.mp3");

    const res = await fetch("https://api.gladia.io/v2/transcription/", {
      method: "POST",
      headers: {
        "x-gladia-key": this.apiKey,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const resultUrl = data.result_url;
    
    // Poll gladia result
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(resultUrl, {
        headers: { "x-gladia-key": this.apiKey },
      });
      const pollData = await pollRes.json();
      if (pollData.status === "done") {
        return pollData.result?.transcription?.full_transcript || "";
      } else if (pollData.status === "error") {
        throw new Error("Gladia Transcription failed.");
      }
    }
  }

  async _transcribeElevenLabs(blob) {
    const formData = new FormData();
    formData.append("file", blob, "audio.mp3");
    formData.append("model_id", "scribe_v1");

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
