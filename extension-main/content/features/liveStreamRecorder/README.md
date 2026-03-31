# Live Stream Recorder Feature

---

## Table of Contents

1. [Architecture](#architecture)
2. [Key Files](#key-files)
3. [How It Works](#how-it-works)
4. [Scaler's Live Class Infrastructure](#scalers-live-class-infrastructure)
5. [API Endpoints](#api-endpoints)
6. [Agora Integration](#agora-integration)
7. [Implementation Details](#implementation-details)
8. [Known Quirks & Gotchas](#known-quirks--gotchas)
9. [Future Improvements](#future-improvements)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Content Script Context                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              liveStreamRecorder.js                      │    │
│  │  - Detects live class pages                             │    │
│  │  - Injects Record button in header                      │    │
│  │  - Fetches Agora credentials via Scaler APIs            │    │
│  │  - Manages DVR UI (timeline, play/pause, download)      │    │
│  │  - Stores recorded chunks in memory                     │    │
│  └───────────────────────┬─────────────────────────────────┘    │
│                          │ CustomEvents                         │
│                          ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 Page Context (injected)                 │    │
│  │  ┌─────────────┐    ┌─────────────────────────────┐     │    │
│  │  │ agora-sdk.js│───▶│    recorderBridge.js        │     │    │
│  │  │ (Agora RTC) │    │  - Creates Agora client     │     │    │
│  │  └─────────────┘    │  - Subscribes to streams    │     │    │
│  │                     │  - Manages MediaRecorder    │     │    │
│  │                     │  - Sends chunks via events  │     │    │
│  │                     └─────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Why Two Contexts?

Chrome extensions have isolated content script contexts that cannot directly access page JavaScript globals. The Agora SDK needs to run in the **page context** to:
1. Access the full Web Audio/Video APIs without restrictions
2. Interact with MediaStream objects properly
3. Avoid CSP (Content Security Policy) violations

We solve this by:
1. Injecting scripts into the page via `<script src="...">` tags
2. Communicating between contexts using `CustomEvent` dispatch/listen

---

## Key Files

| File | Purpose |
|------|---------|
| `liveStreamRecorder.js` | Main content script - UI injection, credential fetching, DVR logic |
| `recorderBridge.js` | Page context script - Agora client, stream subscription, MediaRecorder |
| `liveStreamRecorder.css` | Styles for custom player and footer status indicators |
| `libs/agora-sdk.js` | Agora Web SDK v4.22.0 (minified, ~1.1MB) |

---

## How It Works


---

## Scaler's Live Class Infrastructure

### DOM Structure (Key Elements)

```html
<!-- Live class modal -->
<div class="me-cr-lecture-modal">
  <div class="meeting-app">
    <div class="m-layout">
      
      <!-- Header with title and action buttons -->
      <div class="m-header">
        <div class="m-header__actions">
          <!-- Record button injected here -->
          <a data-cy="meetings-feedback-button">...</a>
          <a data-cy="meetings-leaderboard-button">...</a>
        </div>
      </div>
      
      <!-- Video area -->
      <div class="m-activity">
        <div class="video-channel">
          <div class="streams-layout">
            <!-- Native Agora players here - we HIDE this -->
            <div class="stream-tile">
              <div id="stream-{uid}" class="video-playback">
                <video class="agora_video_player">...</video>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Footer controls -->
      <div class="m-footer">
        <div class="control-panel">
          <div class="control-panel__actions">
            <!-- Status indicators injected HERE -->
            <a data-cy="meetings-mic-disabled-button">...</a>
            <a data-cy="meetings-camera-disabled-button">...</a>
            <a>Fullscreen</a>
            <a data-cy="meetings-raise-hand-button">...</a>
          </div>
        </div>
      </div>
      
    </div>
  </div>
</div>
```

### Important Selectors

| Selector | Purpose |
|----------|---------|
| `.agora_video_player` | Native Agora video element (detection trigger) |
| `.m-header__actions` (2nd) | Header action buttons (Record button location) |
| `.streams-layout` | Container for all video tiles (we hide this) |
| `.control-panel__actions` | Footer control buttons (status indicator location) |
| `.m-recording__label` | Scaler's own recording timer display |

---

## API Endpoints

### 1. Get Active Meeting Slug

```
GET https://www.scaler.com/academy/mentee/events
```

**Response Structure:**
```json
{
  "futureEvents": [
    {
      "meeting_slug": "react-11-building-xyz-1234",
      "title": "React 11 - Building...",
      "start_time": "2026-03-27T15:00:00"
    }
  ],
  "topCardEvent": {
    "meeting_slug": "react-11-building-xyz-1234"
  }
}
```

**Note:** Use `meeting_slug` (underscore), NOT `meeting-slug` (hyphen).

### 2. Get Agora Credentials

```
GET https://www.scaler.com/meetings/{slug}/live-session
```

**Response Structure:**
```json
{
  "tokens": {
    "video_broadcasting": "006xxxx...AGORA_TOKEN",
    "chat": "..."
  },
  "data": {
    "feedback_forms": [
      { "item_id": 526225 }  // This becomes the channel name
    ]
  },
  "participants": [
    { "user_id": 2061828, "name": "Instructor Name" },
    { "user_id": 1234567, "name": "Student Name" }
  ]
}
```

**Credential Extraction:**
- `appId`: `"03d2d4319a52428ea2e5068d87f3bca9"` (hardcoded, Scaler's Agora App ID)
- `channel`: `String(data.feedback_forms[0].item_id)` - MUST be string
- `token`: `tokens.video_broadcasting`
- `uid`: `parseInt("1" + lastParticipantUserId)` - Prepend "1" to last participant's user_id

---

## Important notes on stream selection


### UID Convention

Scaler uses a specific UID pattern:
- `1xxxxxxx` - Camera feed (starts with 1)
- `2xxxxxxx` - Screenshare feed (starts with 2)

```javascript
detectStreamType(uid) {
    const str = uid.toString();
    if (str.startsWith('2')) return 'screenshare';
    if (str.startsWith('1')) return 'camera';
    return 'unknown';
}
```

### Track Priority

When both camera and screenshare exist:
- **Main view**: Screenshare (larger, primary content)
- **PiP overlay**: Camera (instructor face)

When only one exists, it goes to main view.

---

## Implementation Details

### Message Passing (Content ↔ Page Context)

**Content Script → Page Context:**
```javascript
// Send command
window.dispatchEvent(new CustomEvent("scaler-stream-command", {
    detail: { type: "init", data: { config } }
}));

// Command types: "init", "set-live", "request-download", "cleanup"
```

**Page Context → Content Script:**
```javascript
// Send event
window.dispatchEvent(new CustomEvent("scaler-stream-event", {
    detail: { type: "recording-status", data: { status: "Recording", color: "#22c55e" } }
}));

// Event types: "connection-status", "recording-status", "chunk-available", "layout-update", "download-ready"
```

### MediaRecorder Configuration

```javascript
const mimeType = 'video/webm; codecs=vp8,opus';
const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined
});
recorder.start(1000); // Chunk every 1 second for smooth DVR
```

### DVR Blob Assembly

```javascript
// Assemble chunks into playable video
const blob = new Blob(this.recordedChunks, { type: "video/webm" });
const url = URL.createObjectURL(blob);
videoElement.src = url;
```

---

## Known & Gotchas

### 1. Channel ID Must Be String
```javascript
// WRONG - Agora will fail silently
const channel = data.feedback_forms[0].item_id; // number

// CORRECT
const channel = String(data.feedback_forms[0].item_id); // string
```

### 2. UID Generation 
The UID must be unique and follow Scaler's pattern. Using the last participant's ID with "1" prefix works because:
- You're joining as a new audience member
- The "1" prefix identifies you as a camera-type stream (even though you're not publishing)

### 3. Audio Track Timing
Audio tracks may arrive after video. The code waits 500ms after video subscription before starting recording to capture audio.


### 4. Memory Usage
Recorded chunks stay in memory. A 1-hour class at decent quality can use 500MB-1GB RAM. 


---

## to do
- [ ] Add picture-in-picture browser API support

---

## Testing Checklist

- [ ] Button appears only on live class pages (not recordings)
- [ ] Credentials fetch succeeds when class is active
- [ ] Video displays in custom container
- [ ] Audio plays correctly
- [ ] Recording starts automatically after connection
- [ ] Status indicators update in footer
- [ ] Timeline seek works (forward/backward)
- [ ] "LIVE" badge returns to live stream
- [ ] Download produces playable .webm file
- [ ] Keyboard shortcuts work (Space, Arrow keys)
- [ ] Cleanup on page navigation (no memory leaks)
- [ ] Toggle in popup enables/disables feature

---

## Debugging Tips

### Console Logs
All logs prefixed with `[Scaler++]`:
```javascript
console.log("[Scaler++] Activating Live Stream Recorder...");
console.error("[Scaler++] Configuration failed:", err);
```

### Agora Debug Mode
Enable verbose Agora logs:
```javascript
AgoraRTC.setLogLevel(0); // 0=DEBUG, 1=INFO, 2=WARNING, 3=ERROR
```

### Check Credentials
Manually test API endpoints in browser console:
```javascript
// Get meeting slug
const events = await fetch('/academy/mentee/events').then(r => r.json());
console.log(events.futureEvents[0].meeting_slug);

// Get credentials
const session = await fetch('/meetings/SLUG/live-session').then(r => r.json());
console.log(session.tokens.video_broadcasting);
```

### MediaRecorder State
```javascript
console.log(mediaRecorder.state); // "inactive", "recording", "paused"
console.log(recordedChunks.length); // Number of chunks
console.log(new Blob(recordedChunks).size / 1024 / 1024); // Size in MB
```

---


