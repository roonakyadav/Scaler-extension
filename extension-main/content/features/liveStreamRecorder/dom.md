# Live Stream Recorder - DOM Structure & Injections

This document explains Scaler's live class DOM structure and where the Live Stream Recorder injects its components.

---

## Table of Contents

1. [Scaler's Native DOM Structure](#scalers-native-dom-structure)
2. [Injection Points](#injection-points)
3. [Injected Components](#injected-components)
4. [Visual Layout Map](#visual-layout-map)
5. [Element Reference](#element-reference)

---

## Scaler's Native DOM Structure

When you join a live class on Scaler, the page renders the following key structure:

```
.me-cr-lecture-modal
└── .react-root.meeting-app
    └── .layout.m-layout
        └── .layout__content.m-layout__content.m-widget
            └── .live.layout
                └── .meeting.layout__content
                    └── .meeting-main
                        ├── .m-header                    ← [HEADER BAR]
                        ├── .m-activity                  ← [MAIN CONTENT AREA]
                        │   └── .m-activity__top
                        │       └── .video-channel       ← [VIDEO CONTAINER]
                        │           ├── .streams-layout  ← [NATIVE VIDEO TILES]
                        │           └── .m-connection    ← [CONNECTION STATUS]
                        └── .m-footer                    ← [FOOTER CONTROLS]
                    └── .meeting-sidebar                 ← [RIGHT SIDEBAR]
```

### Key Native Elements

| Selector | Purpose |
|----------|---------|
| `.m-header` | Top header with title and action buttons |
| `.m-header__actions` (2nd instance) | Right-side header buttons (feedback, leaderboard, settings) |
| `.video-channel` | Container for all video-related elements |
| `.streams-layout` | Native Agora video tiles container |
| `.stream-tile` | Individual video tile wrapper |
| `.agora_video_player` | Native Agora video element |
| `.m-connection.m-connection--error` | "Connection interrupted" error overlay |
| `.control-panel__actions` | Footer control buttons (mic, camera, fullscreen, etc.) |
| `.meeting-sidebar` | Right sidebar with chat, questions, etc. |
| `.meeting-sidebar .aspect-ratio__container .streams-layout` | Sidebar camera feed container |

---

## Injection Points

The Live Stream Recorder injects components at **4 locations**:

```
┌─────────────────────────────────────────────────────────────────┐
│ .m-header                                                        │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ .m-header__actions (right side)                             │ │
│ │ ┌─────────┐                                                 │ │
│ │ │ ① REC   │ ← Record button injected here                   │ │
│ │ │ BUTTON  │                                                 │ │
│ │ └─────────┘                                                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ .video-channel                                                   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ .streams-layout (HIDDEN when recorder active)               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ② #scaler-stream-recorder-container                         │ │
│ │    ← Custom video player injected AFTER .streams-layout     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ .m-connection--error (HIDDEN when recorder active)          │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ .m-footer                                                        │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ .control-panel__actions                                     │ │
│ │ ┌──────────────────┐ ┌───┐ ┌───┐ ┌───┐                     │ │
│ │ │ ③ STATUS PANEL   │ │MIC│ │CAM│ │FS │  ...                │ │
│ │ │ Connected|Rec|MB │ │   │ │   │ │   │                     │ │
│ │ └──────────────────┘ └───┘ └───┘ └───┘                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│ .meeting-sidebar    │
│ ┌─────────────────┐ │
│ │ .aspect-ratio   │ │
│ │ ┌─────────────┐ │ │
│ │ │ .stream-tile│ │ │
│ │ │ ┌─────────┐ │ │ │
│ │ │ │④ CAMERA │ │ │ │
│ │ │ │  FEED   │ │ │ │
│ │ │ └─────────┘ │ │ │
│ │ └─────────────┘ │ │
│ └─────────────────┘ │
│ [Chat, Questions...]│
└─────────────────────┘
```

---

## Injected Components

### ① Record Button (Header)

**Location:** `.m-header__actions` (2nd instance, right side)  
**Injected by:** `injectButton()` in `liveStreamRecorder.js:83`

```html
<div id="scaler-live-recorder-btn-container" class="m-header__action" 
     style="display: inline-block; margin-right: 8px;">
    <a id="scaler-live-recorder-btn" 
       class="tappable btn btn-icon m-btn btn-large m-btn--default" 
       title="Record Live Stream" 
       style="color: rgb(239, 68, 68);">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" 
             fill="none" stroke="currentColor" stroke-width="2" 
             stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
        </svg>
    </a>
</div>
```

**Behavior:** Clicking activates the recorder, fetches Agora credentials, and initializes the custom player.

---

### ② Custom Video Player (Main Area)

**Location:** Inside `.video-channel`, after `.streams-layout`  
**Injected by:** `prepareUI()` in `liveStreamRecorder.js:174`

```html
<div id="scaler-stream-recorder-container">
    <!-- Live video from our Agora client -->
    <div id="live-video-container" style="display: block;">
        <!-- Agora SDK injects video element here -->
        <div id="agora-video-player-track-video-{uid}-client-{id}">
            <video class="agora_video_player" playsinline muted></video>
        </div>
    </div>
    
    <!-- DVR playback video (hidden during live) -->
    <video id="dvr-video-player" playsinline src="blob:..." style="display: none;"></video>

    <!-- Video Controls Overlay -->
    <div class="video-controls-overlay">
        <!-- Timeline scrubber -->
        <div class="timeline-container">
            <div class="timeline-fill" id="recorder-timeline-fill" style="width: 100%;"></div>
            <input type="range" min="0" max="100" value="100" 
                   class="timeline-input" id="recorder-timeline-slider">
        </div>
        
        <!-- Control buttons row -->
        <div class="controls-row">
            <div class="left-controls">
                <button class="play-btn" id="recorder-play-pause-btn">⏸</button>
                <span class="time-display" id="recorder-time-display">04:43</span>
            </div>
            
            <div class="right-controls">
                <button id="recorder-download-btn" class="live-badge-btn" 
                        style="background: rgba(59, 130, 246, 0.2); color: #3b82f6;">
                    ⬇ DOWNLOAD
                </button>
                <button class="live-badge-btn is-live" id="recorder-live-badge">LIVE</button>
            </div>
        </div>
    </div>
</div>
```

**Visibility States:**
- `#live-video-container`: Visible during live playback
- `#dvr-video-player`: Visible during DVR/rewind playback
- `.video-controls-overlay`: Appears on hover (CSS `opacity` transition)

---

### ③ Footer Status Panel

**Location:** Inside `.control-panel__actions`, at the beginning  
**Injected by:** `injectFooterControls()` in `liveStreamRecorder.js:247`

```html
<div id="scaler-recorder-footer-status" class="scaler-recorder-footer-controls">
    <!-- Connection Status -->
    <div class="recorder-status-item" title="Connection Status">
        <span class="recorder-status-dot" id="recorder-status-dot" 
              style="background-color: rgb(34, 197, 94);"></span>
        <span id="recorder-connection-status" class="recorder-status-text" 
              style="color: rgb(34, 197, 94);">Connected</span>
    </div>
    
    <!-- Recording Status -->
    <div class="recorder-status-item" title="Recording Status">
        <span class="recorder-rec-icon">●</span>
        <span id="recorder-recording-status" class="recorder-status-text" 
              style="color: rgb(34, 197, 94);">Recording</span>
    </div>
    
    <!-- Buffer Size -->
    <div class="recorder-status-item" title="Buffer Size">
        <span class="recorder-buffer-icon">💾</span>
        <span id="recorder-buffer-size" class="recorder-status-text">34.6 MB</span>
    </div>
</div>
```

**Status Colors:**
| Status | Color | Hex |
|--------|-------|-----|
| Connecting | Amber | `#fbbf24` |
| Connected | Green | `#22c55e` |
| Recording | Green | `#22c55e` |
| Error | Red | `#ef4444` |

---

### ④ Sidebar Camera Feed

**Location:** `.meeting-sidebar .aspect-ratio__container .streams-layout .stream-tile`  
**Injected by:** `prepareSidebarCameraContainer()` in `liveStreamRecorder.js:309`

**Original Scaler content (replaced):**
```html
<div class="stream-tile" style="width: 320px; height: 179px;">
    <div class="gesture-detector video-playback video-playback--secondary" id="stream-12061828">
        <div class="video-playback__overlay">
            <div class="video-playback__header">...</div>
            <div class="video-playback__footer">
                <i class="icon-mic primary"></i>
                <div class="video-playback__name">Mrinal Bhattacharya</div>
            </div>
        </div>
    </div>
</div>
```

**Replaced with:**
```html
<div class="stream-tile" style="width: 320px; height: 179px;">
    <div id="recorder-sidebar-camera" style="width: 100%; height: 100%; background: #1a1a1a;">
        <!-- Agora SDK injects camera video element here -->
        <div id="agora-video-player-track-video-{camera-uid}-client-{id}">
            <video class="agora_video_player" playsinline muted></video>
        </div>
    </div>
</div>
```

**Note:** Original content is stored in `this.originalSidebarContent` and restored on deactivation.

---

## Visual Layout Map

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              SCALER LIVE CLASS                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ │  ← Back  │  React 11- Building...  │ Lecture │  [①REC] [👍] [🏆] [⚙️]      │ │
│ │                        .m-header                                           │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┬─────────────────────────┤
│                                                      │   .meeting-sidebar      │
│                                                      │ ┌─────────────────────┐ │
│                                                      │ │ ④ INSTRUCTOR CAMERA │ │
│           ② MAIN VIDEO PLAYER                        │ │  #recorder-sidebar- │ │
│        #scaler-stream-recorder-container             │ │       camera        │ │
│                                                      │ └─────────────────────┘ │
│    ┌──────────────────────────────────────────┐      │                         │
│    │                                          │      │ ┌─────────────────────┐ │
│    │         SCREENSHARE / MAIN FEED          │      │ │       Chat          │ │
│    │         #live-video-container            │      │ │                     │ │
│    │              (or #dvr-video-player)      │      │ │  To: Everyone ▼     │ │
│    │                                          │      │ │                     │ │
│    │                                          │      │ │  [Type message...]  │ │
│    │                                          │      │ │                     │ │
│    └──────────────────────────────────────────┘      │ └─────────────────────┘ │
│    ┌──────────────────────────────────────────┐      │                         │
│    │ [⏸] 04:43          [⬇ DOWNLOAD] [●LIVE]  │      │  [Chat][Q&A][Notes]     │
│    │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │      │       [Help][📞]        │
│    │           .video-controls-overlay        │      │                         │
│    └──────────────────────────────────────────┘      │                         │
├──────────────────────────────────────────────────────┴─────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ │ ③ [🟢Connected|●Recording|💾34.6MB] │ [🎤] [📷] [⛶] [✋Raise] [📺]         │ │
│ │     #scaler-recorder-footer-status   │        .control-panel__actions      │ │
│ │                                 .m-footer                                  │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Element Reference

### IDs (Injected by Extension)

| ID | Location | Purpose |
|----|----------|---------|
| `scaler-live-recorder-btn-container` | Header | Button wrapper |
| `scaler-live-recorder-btn` | Header | Record activation button |
| `scaler-stream-recorder-container` | Video channel | Main player container |
| `live-video-container` | Player | Live Agora stream target |
| `dvr-video-player` | Player | DVR playback `<video>` element |
| `recorder-timeline-fill` | Player | Timeline progress bar fill |
| `recorder-timeline-slider` | Player | Timeline `<input type="range">` |
| `recorder-play-pause-btn` | Player | Play/Pause button |
| `recorder-time-display` | Player | Current time display |
| `recorder-download-btn` | Player | Download recording button |
| `recorder-live-badge` | Player | LIVE indicator badge |
| `scaler-recorder-footer-status` | Footer | Status panel container |
| `recorder-status-dot` | Footer | Connection status dot |
| `recorder-connection-status` | Footer | Connection status text |
| `recorder-recording-status` | Footer | Recording status text |
| `recorder-buffer-size` | Footer | Buffer size display |
| `recorder-sidebar-camera` | Sidebar | Camera feed target |

### Classes (Extension CSS)

| Class | Purpose |
|-------|---------|
| `scaler-recorder-footer-controls` | Footer status panel styling |
| `recorder-status-item` | Individual status item in footer |
| `recorder-status-dot` | Colored connection indicator dot |
| `recorder-rec-icon` | Pulsing record icon |
| `recorder-buffer-icon` | Buffer/disk icon |
| `recorder-status-text` | Status text styling |
| `video-controls-overlay` | Player controls container |
| `timeline-container` | Seek bar container |
| `timeline-fill` | Seek bar progress fill |
| `timeline-input` | Seek bar input |
| `controls-row` | Horizontal controls layout |
| `left-controls` | Left-aligned controls group |
| `right-controls` | Right-aligned controls group |
| `play-btn` | Play/pause button |
| `time-display` | Time display text |
| `live-badge-btn` | Badge button base style |
| `live-badge-btn.is-live` | Active LIVE state |

---

## Hidden Elements

When the recorder is active, these elements are hidden:

| Selector | Method | Restored On Deactivate |
|----------|--------|------------------------|
| `.streams-layout` (main) | `display: none` | Yes |
| `.m-connection.m-connection--error` | `display: none` + MutationObserver | Yes |
| Sidebar original content | innerHTML replaced | Yes (stored in `originalSidebarContent`) |

---

## Script Injections

The recorder also injects scripts into the page context (required for Agora SDK):

```html
<!-- Agora Web SDK -->
<script src="chrome-extension://{id}/libs/agora-sdk.js"></script>

<!-- Recorder Bridge (page context communication) -->
<script id="scaler-recorder-bridge-script" 
        src="chrome-extension://{id}/content/features/liveStreamRecorder/recorderBridge.js">
</script>
```

These are injected by `injectAgoraAndInit()` and communicate with the content script via `CustomEvent`:

- **Content → Page:** `scaler-stream-command` event
- **Page → Content:** `scaler-stream-event` event

---


## Cleanup on Deactivate [needs more testing]

When the recorder is deactivated (feature toggled off), `deactivate()` performs:

1. Remove `#scaler-stream-recorder-container`
2. Remove `#scaler-recorder-footer-status`
3. Restore sidebar `.stream-tile` original innerHTML
4. Disconnect `connectionErrorObserver`
5. Restore `.m-connection--error` visibility
6. Restore `.streams-layout` visibility (`display: ""`)
7. Remove keydown event listener
8. Send `cleanup` command to bridge (leaves Agora channel, stops recording)
