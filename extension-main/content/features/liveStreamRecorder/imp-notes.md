This feature acts aggressively on existing elements: 
* replaces the entire video stream instead of modifying existing ones 
* it does not try to use the existing tokens from current session , instead fetches them freshly by a sequence of api calls from scaler.com  

# Activation Flow

1. **Detection**: Content script monitors for `.agora_video_player` element on page
2. **Button Injection**: Red "Record" button added to `.m-header__actions` (top-right header)
3. **On Click**:
   - Fetch meeting slug from `/academy/mentee/events`
   - Fetch Agora credentials from `/meetings/{slug}/live-session`
   - Hide native `.streams-layout` container
   - Inject custom video container with timeline controls
   - Inject status indicators into footer `.control-panel__actions`
   - Load Agora SDK and bridge script into page context
   - Connect to Agora channel as audience member

# Recording Flow

1. **Stream Subscription**: Bridge subscribes to all published video/audio tracks
2. **Track Detection**: UIDs starting with `2` = screenshare, `1` = camera
3. **MediaRecorder**: Records the primary track (screenshare preferred) + all audio
4. **Chunking**: Data available every 1 second, sent to content script via events
5. **DVR Buffer**: Chunks stored in array, can be assembled into playable blob anytime

# DVR Playback

1. User seeks/pauses → Switch from live container to `<video>` element
2. Create blob from recorded chunks → Set as video source
3. Mute live audio tracks, unmute video element
4. "LIVE" badge click → Return to live stream

