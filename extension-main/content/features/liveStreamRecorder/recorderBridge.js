// ============================================================
// recorderBridge.js
// Runs in the PAGE context to access AgoraRTC and DOM
// ============================================================

(function() {
    console.log("[Scaler++] Recorder Bridge loading...");

    let config = null;
    let streamDirector = null;

    class StreamDirector {
        constructor(config) {
            this.config = config;
            this.client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
            this.tracks = new Map();
            this.mediaRecorder = null;
            this.recordedChunks = [];
            this.recordingStartTime = 0;
            this.audioTracks = new Set();
            this.isLive = true;
            this.screenshareTrack = null;
            this.cameraTrack = null;
            
            this.init();
        }

        async init() {
            this.client.setClientRole("audience");
            this.client.on("user-published", this.handleUserPublished.bind(this));
            this.client.on("user-unpublished", this.handleUserUnpublished.bind(this));

            try {
                await this.client.join(this.config.appId, this.config.channel, this.config.token, this.config.uid);
                this.notify("connection-status", { status: "Connected", color: "#22c55e" });
            } catch (error) {
                console.error("[Scaler++] Join error:", error);
                this.notify("connection-status", { status: "Error", color: "#ef4444" });
            }
        }

        notify(type, data) {
            window.dispatchEvent(new CustomEvent("scaler-stream-event", { detail: { type, data } }));
        }

        async handleUserPublished(user, mediaType) {
            await this.client.subscribe(user, mediaType);

            if (mediaType === "audio") {
                user.audioTrack.play();
                this.audioTracks.add(user.audioTrack);
                this.manageRecording();
            }

            if (mediaType === "video") {
                const type = this.detectStreamType(user.uid);
                const trackInfo = { uid: user.uid, track: user.videoTrack, type };
                this.tracks.set(user.uid, trackInfo);

                if (type === 'screenshare') this.screenshareTrack = trackInfo;
                else if (type === 'camera') this.cameraTrack = trackInfo;

                this.updateLayout();
                setTimeout(() => this.manageRecording(), 500);
            }
        }

        handleUserUnpublished(user, mediaType) {
            if (mediaType === "video") {
                this.tracks.delete(user.uid);
                if (this.screenshareTrack?.uid === user.uid) this.screenshareTrack = null;
                if (this.cameraTrack?.uid === user.uid) this.cameraTrack = null;
                this.updateLayout();
            }
            if (mediaType === "audio") {
                this.audioTracks.delete(user.audioTrack);
            }
        }

        detectStreamType(uid) {
            const str = uid.toString();
            if (str.startsWith('2')) return 'screenshare';
            if (str.startsWith('1')) return 'camera';
            return 'unknown';
        }

        updateLayout() {
            this.notify("layout-update", {
                screenshare: this.screenshareTrack ? { uid: this.screenshareTrack.uid } : null,
                camera: this.cameraTrack ? { uid: this.cameraTrack.uid } : null
            });
            
            const mainTrack = this.screenshareTrack || this.cameraTrack;
            if (mainTrack && this.isLive) {
                mainTrack.track.play("live-video-container");
            }
            
            // Play camera track in Scaler's native sidebar container
            if (this.cameraTrack && this.screenshareTrack) {
                const sidebarContainer = document.getElementById("recorder-sidebar-camera");
                if (sidebarContainer) {
                    this.cameraTrack.track.play("recorder-sidebar-camera");
                }
            }
        }

        manageRecording() {
            const target = this.screenshareTrack || this.cameraTrack;
            if (!target) return;

            if (this.mediaRecorder) {
                if (this.mediaRecorder._trackUid === target.uid && this.mediaRecorder.state === 'recording') return;
                if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
                setTimeout(() => this.startRecording(target), 150);
            } else {
                this.startRecording(target);
            }
        }

        startRecording(trackInfo) {
            try {
                const stream = new MediaStream();
                const videoMediaTrack = trackInfo.track.getMediaStreamTrack();
                if (!videoMediaTrack) return;
                
                stream.addTrack(videoMediaTrack);
                this.audioTracks.forEach(t => {
                    const audioMediaTrack = t.getMediaStreamTrack();
                    if (audioMediaTrack && audioMediaTrack.readyState === 'live') stream.addTrack(audioMediaTrack);
                });

                const mimeType = 'video/webm; codecs=vp8,opus';
                this.mediaRecorder = new MediaRecorder(stream, { 
                    mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined 
                });
                
                this.mediaRecorder._trackUid = trackInfo.uid;
                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        this.notify("chunk-available", { size: e.data.size, blob: e.data });
                    }
                };

                this.mediaRecorder.onstart = () => {
                    this.recordingStartTime = Date.now();
                    this.notify("recording-status", { status: "Recording", color: "#22c55e", startTime: this.recordingStartTime });
                };

                this.mediaRecorder.start(1000);
            } catch (error) {
                console.error("[Scaler++] Start recording error:", error);
            }
        }

        setLive(isLive) {
            this.isLive = isLive;
            this.updateLayout();
            if (isLive) {
                this.audioTracks.forEach(t => t.setVolume(100));
            } else {
                this.audioTracks.forEach(t => t.setVolume(0));
            }
        }
        
        requestDownload() {
            if (this.mediaRecorder) this.mediaRecorder.requestData();
            setTimeout(() => this.notify("download-ready", {}), 500);
        }

        cleanup() {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            if (this.client) {
                this.client.leave();
            }
            this.tracks.forEach(t => t.track.stop());
            this.audioTracks.forEach(t => t.stop());
        }
    }

    // Listen for commands from content script
    window.addEventListener("scaler-stream-command", (e) => {
        const { type, data } = e.detail;
        if (type === "init") {
            if (streamDirector) streamDirector.cleanup();
            streamDirector = new StreamDirector(data.config);
        } else if (streamDirector) {
            if (type === "set-live") streamDirector.setLive(data.isLive);
            if (type === "request-download") streamDirector.requestDownload();
            if (type === "cleanup") {
                streamDirector.cleanup();
                streamDirector = null;
            }
        }
    });

    console.log("[Scaler++] Recorder Bridge ready.");
})();
