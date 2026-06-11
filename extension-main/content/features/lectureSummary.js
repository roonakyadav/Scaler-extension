// ============================================
// features/lectureSummary.js
// AI lecture summary tab on the class session page.
//
// Flow:
//   1. User opens the "Summary" tab on a session page.
//   2. Look up a cached summary on the backend (GET /api/summary?slug=).
//        found    → render it.
//        missing  → check the transcript cache for the same lecture.
//            transcript cached → show a "Generate" button.
//            no transcript     → ask the user to generate the transcript first.
//   3. Generate calls the user's own OpenAI-compatible LLM (via the background
//      service worker) with the transcript, then caches the structured result.
//
// The lecture slug is the SAME identifier used for transcripts, so a lecture's
// transcript and summary share one key. The numeric class id is saved as
// metadata alongside it.
// ============================================
(function (global) {
  const SUMMARY_TAB_ID = "classroom-lecture-summary";
  const SUMMARY_PANEL_ID = "scaler-summary-panel";
  const INSTRUCTOR_PANEL_ID = "scaler-instructor-panel"; // sibling feature — never hide it
  const SUMMARY_CONFIG_KEY = "scaler_summary_config";

  // Per-URL cache so repeated tab opens don't refetch the slug/title.
  const _lectureCache = { url: "", promise: null };
  // Cache transcript text per slug so Generate doesn't refetch a huge payload.
  const _transcriptTextCache = new Map();

  function _isSessionPage() {
    const url = new URL(location.href);
    const isSessionPath = /\/academy\/mentee-dashboard\/class\/\d/.test(
      url.pathname,
    );
    return isSessionPath && url.searchParams.get("joinSession") !== "1";
  }

  function _extractClassId() {
    const match = location.pathname.match(/\/class\/(\d+)/);
    return match ? match[1] : null;
  }

  // ── Lecture identity (classId + slug + title) ───────────────────────────
  // Mirrors videoDownloader._fetchLectureSlug: resolve the unique slug from
  // Scaler's classroom meta API. Kept self-contained so this feature has no
  // hard dependency on the video downloader instance.
  function _resolveLecture() {
    const currentUrl = location.pathname;
    if (_lectureCache.promise && _lectureCache.url === currentUrl) {
      return _lectureCache.promise;
    }

    _lectureCache.url = currentUrl;
    _lectureCache.promise = (async () => {
      const classId = _extractClassId();
      if (!classId) return { classId: null, slug: null, title: "" };

      try {
        const res = await fetch(
          `https://www.scaler.com/api/v2/classroom/${classId}/meta`,
          { credentials: "include" },
        );
        if (!res.ok) {
          return { classId, slug: null, title: document.title || "" };
        }
        const json = await res.json();
        const attrs = json?.data?.attributes || {};
        const slug = attrs.slug || null;
        const title =
          attrs.name ||
          attrs.academy_module?.name ||
          document.title ||
          slug ||
          "";
        return { classId, slug, title };
      } catch (e) {
        console.warn("[Scaler++] Summary: failed to resolve lecture:", e.message);
        return { classId, slug: null, title: document.title || "" };
      }
    })();

    return _lectureCache.promise;
  }

  function _getUserEmail() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(["scaler_user"], (r) =>
          resolve(r?.scaler_user?.email || ""),
        );
      } catch (e) {
        resolve("");
      }
    });
  }

  function _getSummaryConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([SUMMARY_CONFIG_KEY], (r) =>
          resolve(r?.[SUMMARY_CONFIG_KEY] || {}),
        );
      } catch (e) {
        resolve({});
      }
    });
  }

  function _saveSummaryConfig(config) {
    try {
      chrome.storage.local.set({ [SUMMARY_CONFIG_KEY]: config });
    } catch (e) {
      /* ignore */
    }
  }

  // ── Background messaging helpers ────────────────────────────────────────
  function _sendMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { success: false, error: "No response" });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }

  // ── Tab + panel scaffolding (mirrors instructorInfo.js) ─────────────────
  function _ensureSummaryPanel() {
    let panel = document.getElementById(SUMMARY_PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = SUMMARY_PANEL_ID;
    panel.className = "section me-cr-section";
    panel.style.display = "none";

    const content = document.createElement("div");
    content.className = "section-content";
    panel.appendChild(content);

    const lectureContainer =
      document.querySelector(".me-cr-lecture-container") ||
      document.querySelector(".flex-fill");
    if (lectureContainer && lectureContainer.parentElement) {
      lectureContainer.parentElement.insertBefore(
        panel,
        lectureContainer.nextSibling,
      );
    }

    return panel;
  }

  function _setLectureContainerVisible(isVisible) {
    const containers = document.querySelectorAll(
      ".me-cr-lecture-container, .flex-fill",
    );
    containers.forEach((container) => {
      // Never touch our own panel or the instructor panel.
      if (container.id === SUMMARY_PANEL_ID) return;
      if (container.id === INSTRUCTOR_PANEL_ID) return;

      if (isVisible) {
        const prev = container.dataset.scalerSummaryPrevDisplay;
        if (prev !== undefined) {
          // Never restore to "none" — that value can leak in if another panel
          // (e.g. instructor info) had the container hidden when we captured it.
          container.style.display = prev && prev !== "none" ? prev : "";
          delete container.dataset.scalerSummaryPrevDisplay;
        }
      } else if (container.dataset.scalerSummaryPrevDisplay === undefined) {
        container.dataset.scalerSummaryPrevDisplay = container.style.display;
        container.style.display = "none";
      }
    });
  }

  function _deactivateInstructorPanelIfOpen() {
    const tab = document.getElementById("classroom-instructor-info");
    if (tab) {
      tab.classList.remove("navigation-tab-item--active");
      tab.classList.remove("me-cr-tabs__tab-item--active");
    }
    const panel = document.getElementById(INSTRUCTOR_PANEL_ID);
    if (panel) panel.style.display = "none";
  }

  function _activateSummaryTab() {
    const tab = document.getElementById(SUMMARY_TAB_ID);
    if (!tab) return;

    const tabs = tab.closest(".navigation-tabs");
    if (tabs) {
      tabs.querySelectorAll(".navigation-tab-item").forEach((item) => {
        item.classList.remove("navigation-tab-item--active");
        item.classList.remove("me-cr-tabs__tab-item--active");
      });
    }

    tab.classList.add("navigation-tab-item--active");
    tab.classList.add("me-cr-tabs__tab-item--active");

    _deactivateInstructorPanelIfOpen();

    const panel = _ensureSummaryPanel();
    panel.style.display = "block";

    // Defer the container hide so it wins over the instructor feature's
    // bubbled nav handler, which re-shows the container on any non-instructor
    // tab click. Running last guarantees the summary panel stands alone.
    setTimeout(() => _setLectureContainerVisible(false), 0);

    _loadSummary(panel);
  }

  function _deactivateSummaryTab(restoreContainer) {
    const tab = document.getElementById(SUMMARY_TAB_ID);
    if (tab) {
      tab.classList.remove("navigation-tab-item--active");
      tab.classList.remove("me-cr-tabs__tab-item--active");
    }
    const panel = document.getElementById(SUMMARY_PANEL_ID);
    if (panel) panel.style.display = "none";
    if (restoreContainer) _setLectureContainerVisible(true);
  }

  function _ensureNavigationHandler(navigationTabs) {
    if (!navigationTabs || navigationTabs.dataset.scalerSummaryNav === "true") {
      return;
    }
    navigationTabs.addEventListener("click", (event) => {
      const target = event.target.closest(".navigation-tab-item");
      if (!target) return;
      if (target.id === SUMMARY_TAB_ID) return; // our own tab handles itself
      // If the instructor tab was clicked it manages the container itself —
      // don't restore it. For native tabs, restore the lecture container.
      const restore = target.id !== "classroom-instructor-info";
      _deactivateSummaryTab(restore);
    });
    navigationTabs.dataset.scalerSummaryNav = "true";
  }

  function _ensureSummaryTab() {
    const navigationTabs = document.querySelector(".navigation-tabs");
    if (!navigationTabs) return null;

    let tab = document.getElementById(SUMMARY_TAB_ID);
    if (!tab) {
      tab = document.createElement("a");
      tab.className = "navigation-tab-item me-cr-tabs__tab-item";
      tab.id = SUMMARY_TAB_ID;
      tab.href = "#";

      const heading = document.createElement("div");
      heading.className = "me-cr-tabs__tab-item-heading";
      heading.textContent = "Summary";
      tab.appendChild(heading);

      navigationTabs.appendChild(tab);
    }

    if (!tab.dataset.scalerSummaryHandler) {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        _activateSummaryTab();
      });
      tab.dataset.scalerSummaryHandler = "true";
    }

    _ensureNavigationHandler(navigationTabs);
    return tab;
  }

  // ── Rendering helpers ───────────────────────────────────────────────────
  function _panelContentRoot(panel) {
    const root = panel.querySelector(".section-content");
    root.innerHTML = "";

    const card = document.createElement("div");
    card.className = "event-card event-card--rounded";
    root.appendChild(card);

    const cardContent = document.createElement("div");
    cardContent.className = "event-card__content-container";
    cardContent.style.alignItems = "flex-start";
    cardContent.style.textAlign = "left";
    cardContent.style.width = "100%";
    cardContent.style.boxSizing = "border-box";
    cardContent.style.padding = "24px 32px";
    card.appendChild(cardContent);

    const headerRow = document.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.justifyContent = "space-between";
    headerRow.style.alignItems = "center";
    headerRow.style.width = "100%";

    const header = document.createElement("div");
    header.className = "event-card__content-header";
    header.textContent = "Lecture Summary [Scaler++]";
    header.style.textAlign = "left";
    headerRow.appendChild(header);

    const gear = document.createElement("button");
    gear.type = "button";
    gear.textContent = "⚙";
    gear.title = "Summary AI settings";
    gear.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:18px;line-height:1;padding:4px 8px;color:#64748b;";
    gear.addEventListener("click", () => _toggleSettings(cardContent));
    headerRow.appendChild(gear);

    cardContent.appendChild(headerRow);
    return cardContent;
  }

  function _subText(parent, text) {
    const el = document.createElement("div");
    el.className = "event-card__content-subheader";
    el.style.marginTop = "10px";
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function _renderSection(parent, title, items) {
    if (!items || !items.length) return;
    const section = document.createElement("div");
    section.style.marginTop = "18px";
    section.style.width = "100%";

    const h = document.createElement("div");
    h.textContent = title;
    h.style.fontWeight = "700";
    h.style.fontSize = "14px";
    h.style.marginBottom = "6px";
    h.style.color = "#0f172a";
    section.appendChild(h);

    const ul = document.createElement("ul");
    ul.style.margin = "0";
    ul.style.paddingLeft = "20px";
    ul.style.display = "grid";
    ul.style.gap = "4px";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      li.style.fontSize = "13px";
      li.style.lineHeight = "1.5";
      li.style.color = "#334155";
      ul.appendChild(li);
    });
    section.appendChild(ul);
    parent.appendChild(section);
  }

  function _renderSummary(panel, summary, meta) {
    const root = _panelContentRoot(panel);

    const isEmpty =
      !summary ||
      (!summary.topics?.length &&
        !summary.notes?.length &&
        !summary.deadlines?.length &&
        !summary.announcements?.length);

    if (isEmpty) {
      _subText(root, "The generated summary was empty.");
      return;
    }

    _renderSection(root, "📢 Announcements", summary.announcements);
    _renderSection(root, "⏰ Deadlines", summary.deadlines);
    _renderSection(root, "📚 Topics Taught", summary.topics);
    _renderSection(root, "📝 Notes", summary.notes);

    if (meta && (meta.generatedBy || meta.model)) {
      const footer = document.createElement("div");
      footer.style.marginTop = "20px";
      footer.style.fontSize = "11px";
      footer.style.color = "#94a3b8";
      const bits = [];
      if (meta.generatedBy) bits.push(`Generated by ${meta.generatedBy}`);
      if (meta.model) bits.push(`Model: ${meta.model}`);
      footer.textContent = bits.join("  ·  ");
      root.appendChild(footer);
    }
  }

  function _renderGenerate(panel, lecture) {
    const root = _panelContentRoot(panel);
    _subText(
      root,
      "A transcript is cached for this lecture, but no summary yet. Generate one using your own AI API key. Configure using the gear icon",
    );

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Generate Summary";
    btn.style.cssText =
      "margin-top:16px;padding:10px 18px;border:none;border-radius:8px;background:#0073ff;color:#fff;font-size:14px;font-weight:600;cursor:pointer;";
    btn.addEventListener("click", () => _onGenerate(panel, lecture, btn));
    root.appendChild(btn);
  }

  function _renderNoTranscript(panel) {
    const root = _panelContentRoot(panel);
    _subText(
      root,
      "No transcript is cached for this lecture yet. Generate the transcript first (via the recording download tool), then come back to generate a summary.",
    );
  }

  function _renderMessage(panel, message) {
    const root = _panelContentRoot(panel);
    _subText(root, message);
  }

  // ── Settings (gear) form ────────────────────────────────────────────────
  async function _toggleSettings(cardContent) {
    const existing = cardContent.querySelector("[data-scaler-summary-settings]");
    if (existing) {
      existing.remove();
      return;
    }

    const config = await _getSummaryConfig();

    const box = document.createElement("div");
    box.setAttribute("data-scaler-summary-settings", "true");
    box.style.cssText =
      "margin-top:16px;width:100%;padding:16px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;display:grid;gap:10px;box-sizing:border-box;";

    const mkField = (labelText, key, type, placeholder) => {
      const wrap = document.createElement("div");
      wrap.style.display = "grid";
      wrap.style.gap = "4px";
      const label = document.createElement("label");
      label.textContent = labelText;
      label.style.fontSize = "12px";
      label.style.fontWeight = "600";
      label.style.color = "#475569";
      const input = document.createElement("input");
      input.type = type;
      input.value = config[key] || "";
      input.placeholder = placeholder;
      input.style.cssText =
        "padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;";
      input.addEventListener("input", () => {
        config[key] = input.value.trim();
        _saveSummaryConfig(config);
      });
      wrap.appendChild(label);
      wrap.appendChild(input);
      return wrap;
    };

    const title = document.createElement("div");
    title.textContent = "AI Settings (OpenAI-compatible)";
    title.style.fontWeight = "700";
    title.style.fontSize = "13px";
    box.appendChild(title);

    box.appendChild(
      mkField(
        "Base URL",
        "baseUrl",
        "text",
        "https://api.openai.com/v1  (or full /chat/completions)",
      ),
    );
    box.appendChild(mkField("Model", "model", "text", "gpt-4o-mini"));
    box.appendChild(mkField("API Key", "apiKey", "password", "sk-..."));

    const note = document.createElement("div");
    note.style.fontSize = "11px";
    note.style.color = "#94a3b8";
    note.textContent =
      "Your key is stored locally in this browser and used only to call your endpoint. It is never sent to Scaler++ servers.";
    box.appendChild(note);

    cardContent.appendChild(box);
  }

  // ── Generate flow ───────────────────────────────────────────────────────
  async function _onGenerate(panel, lecture, btn) {
    const config = await _getSummaryConfig();
    if (!config.baseUrl || !config.apiKey) {
      _renderGenerate(panel, lecture);
      const root = panel.querySelector(".event-card__content-container");
      _toggleSettings(root);
      _subText(
        root,
        "⚠ Add your Base URL and API Key in settings (⚙) first, then click Generate again.",
      );
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
      btn.style.opacity = "0.7";
    }

    // 1. Get the transcript text (cached on the backend).
    let transcript = _transcriptTextCache.get(lecture.slug);
    if (!transcript) {
      const tResp = await _sendMessage({
        action: "checkTranscriptCache",
        slug: lecture.slug,
      });
      if (tResp?.success && tResp.data?.cached && tResp.data.text) {
        transcript = tResp.data.text;
        _transcriptTextCache.set(lecture.slug, transcript);
      }
    }
    if (!transcript) {
      _renderMessage(
        panel,
        "Could not load the transcript for this lecture. It may no longer be cached.",
      );
      return;
    }

    // 2. Generate via the user's LLM (through the background worker).
    const gResp = await _sendMessage({
      action: "generateSummary",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model || "",
      transcript,
    });

    if (!gResp?.success) {
      _renderGenerate(panel, lecture);
      const root = panel.querySelector(".event-card__content-container");
      _renderMessageInline(
        root,
        `❌ Generation failed: ${gResp?.error || "unknown error"}`,
      );
      return;
    }

    const summary = gResp.summary;
    const email = await _getUserEmail();

    // 3. Render + cache (first-write-wins on the backend).
    _renderSummary(panel, summary, {
      generatedBy: email,
      model: config.model || "",
    });

    _sendMessage({
      action: "saveSummary",
      slug: lecture.slug,
      classId: lecture.classId || "",
      title: lecture.title || lecture.slug,
      summary,
      model: config.model || "",
      generatedBy: email,
    });
  }

  function _renderMessageInline(root, text) {
    const el = document.createElement("div");
    el.className = "event-card__content-subheader";
    el.style.marginTop = "14px";
    el.style.color = "#dc2626";
    el.textContent = text;
    root.appendChild(el);
  }

  // ── Loader (decides what to show when the tab opens) ────────────────────
  async function _loadSummary(panel) {
    _renderMessage(panel, "Loading summary…");

    const lecture = await _resolveLecture();
    if (!lecture.slug) {
      _renderMessage(
        panel,
        "Couldn't identify this lecture, so a summary can't be looked up.",
      );
      return;
    }

    // 1. Cached summary?
    const sResp = await _sendMessage({
      action: "checkSummaryCache",
      slug: lecture.slug,
    });
    if (sResp?.success && sResp.data?.cached && sResp.data.summary) {
      _renderSummary(panel, sResp.data.summary, {
        generatedBy: sResp.data.generatedBy,
        model: sResp.data.model,
      });
      return;
    }

    // 2. Transcript cached? → offer Generate.
    const tResp = await _sendMessage({
      action: "checkTranscriptCache",
      slug: lecture.slug,
    });
    if (tResp?.success && tResp.data?.cached) {
      if (tResp.data.text) _transcriptTextCache.set(lecture.slug, tResp.data.text);
      _renderGenerate(panel, lecture);
      return;
    }

    // 3. No transcript → tell the user to make one first.
    _renderNoTranscript(panel);
  }

  function _observeSession() {
    if (window._summaryTabObserver) return;
    if (!_isSessionPage()) return;

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (_isSessionPage()) _ensureSummaryTab();
      }, 300);
    });

    const root = document.querySelector(".me-cr-body") || document.body;
    observer.observe(root, { childList: true, subtree: true });
    window._summaryTabObserver = observer;
  }

  function _teardownSession() {
    if (window._summaryTabObserver) {
      window._summaryTabObserver.disconnect();
      window._summaryTabObserver = null;
    }
    _deactivateSummaryTab(true);
    const tab = document.getElementById(SUMMARY_TAB_ID);
    if (tab) tab.remove();
    const panel = document.getElementById(SUMMARY_PANEL_ID);
    if (panel) panel.remove();
  }

  global.initLectureSummary = function () {
    if (_isSessionPage()) {
      _ensureSummaryTab();
      _observeSession();
    } else {
      _teardownSession();
    }
  };
})(window);
