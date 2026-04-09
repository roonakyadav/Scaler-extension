// ============================================================
// videoDownloader.js
// Injects a download button into Scaler recordings.
// ============================================================

class VideoDownloader {
  constructor() {
    this.enabled = true;
    this.init();
  }

  async init() {
    // Check if the feature is enabled in settings
    try {
      const result = await chrome.storage.sync.get("cleanerSettings");
      if (
        result.cleanerSettings &&
        result.cleanerSettings["video-downloader"] === false
      ) {
        this.enabled = false;
      }
    } catch (e) {
      // Default to enabled
    }

    // Listen for live toggle changes from the popup
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === "toggleSetting" && msg.key === "video-downloader") {
        this.enabled = msg.value;
        const existing = document.getElementById("scaler-video-downloader");
        if (!msg.value && existing) {
          existing.remove();
        } else if (msg.value) {
          this.checkAndInject();
        }
      }
    });

    if (this.enabled) {
      this.checkAndInject();
    }

    // Observe DOM mutations for SPA navigation
    const observer = new MutationObserver(() => {
      if (this.enabled) this.checkAndInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  checkAndInject() {
    // 1. Safely look for vp-controls and the target header container
    // The presence of .vp-controls is the primary indicator that this is a recording,
    // as live sessions do not have it.
    const vpControls = document.querySelector(".vp-controls");
    const headerActions = document.querySelectorAll(".m-header__actions")[1];

    if (!vpControls || !headerActions) {
      return;
    }

    // 3. Inject only if we haven't already
    if (document.getElementById("scaler-video-downloader")) {
      return;
    }

    this.injectButton(headerActions);
  }

  injectButton(headerActions) {
    const container = document.createElement("div");
    container.id = "scaler-video-downloader";
    container.className = "m-header__action dropdown"; // mimic existing classes
    container.style.position = "relative";
    container.style.display = "inline-block";
    container.style.marginRight = "8px";

    const button = document.createElement("a");
    button.className = "tappable btn btn-icon m-btn btn-large m-btn--default";
    button.title = "Download Recording";

    // Using a generic download icon or generic SVG since icon-download might not be defined
    button.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top:2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

    // Add dropdown menu container
    const menu = document.createElement("div");
    menu.className = "downloader-menu";
    menu.style.display = "none";
    menu.style.position = "absolute";
    menu.style.top = "100%";
    menu.style.right = "0";
    menu.style.background = "#2C2D35"; // Match Scaler dark theme commonly used
    menu.style.border = "1px solid #4a4a52";
    menu.style.borderRadius = "6px";
    menu.style.padding = "8px 0";
    menu.style.marginTop = "4px";
    menu.style.zIndex = "9999";
    menu.style.minWidth = "150px";
    menu.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";

    // Audio Option
    const audioOption = document.createElement("div");
    audioOption.innerText = "Audio";
    this.styleOption(audioOption);
    audioOption.onclick = () => {
      this.startDownload("audio");
      menu.style.display = "none";
    };

    // Video Option
    const videoOption = document.createElement("div");
    videoOption.innerText = "Video";
    this.styleOption(videoOption);
    videoOption.onclick = () => {
      this.startDownload("video");
      menu.style.display = "none";
    };

    // Transcript Option

    const transcriptOption = document.createElement("div");
    transcriptOption.innerText = "Transcript";
    this.styleOption(transcriptOption);
    transcriptOption.onclick = () => {
      this.startDownload("transcript");
      menu.style.display = "none";
    };

    menu.appendChild(audioOption);
    menu.appendChild(videoOption);
    menu.appendChild(transcriptOption);

    container.appendChild(button);
    container.appendChild(menu);

    // Toggle Menu
    button.onclick = (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    };

    // Close Menu on outside click
    document.addEventListener("click", () => {
      menu.style.display = "none";
    });

    // Insert before the original first action (usually leaderboard trophy icon)
    headerActions.insertBefore(container, headerActions.firstChild);
  }

  styleOption(opt) {
    opt.style.padding = "10px 16px";
    opt.style.cursor = "pointer";
    opt.style.color = "#fff";
    opt.style.fontSize = "14px";
    opt.style.fontFamily = "Inter, sans-serif";
    opt.style.transition = "background 0.2s";
    opt.onmouseover = () => (opt.style.background = "#4a4a52");
    opt.onmouseout = () => (opt.style.background = "transparent");
  }

  async startDownload(type) {
    const btn = document
      .getElementById("scaler-video-downloader")
      .querySelector("a");
    const originalIcon = btn.innerHTML;
    btn.innerHTML =
      '<span style="font-size:12px; font-weight:bold;">...</span>';

    chrome.runtime.sendMessage({ type: "GET_VIDEO_URL" }, (response) => {
      // Must check lastError first — if the background SW is inactive,
      // Chrome sets this and throws if we don't read it.
      if (chrome.runtime.lastError) {
        console.warn(
          "[Scaler++] sendMessage error:",
          chrome.runtime.lastError.message,
        );
        btn.innerHTML = originalIcon;
        alert(
          "⚠️ Extension background is not responding.\n\nTry reloading the page.",
        );
        return;
      }

      btn.innerHTML = originalIcon;

      if (!response || !response.url) {
        alert(
          "⚠️ Could not locate the video stream.\n\nPlease ensure the video is playing first, then try again.",
        );
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: "INITIATE_DOWNLOAD",
          payload: {
            url: response.url,
            type: type,
            title: document.title || "",
          },
        },
        () => {
          // Consume any potential lastError from this message too
          if (chrome.runtime.lastError) {
            console.warn(
              "[Scaler++] INITIATE_DOWNLOAD error:",
              chrome.runtime.lastError.message,
            );
          }
        },
      );
    });
  }
}

// Launch the script
window.ScalerVideoDownloader = new VideoDownloader();
